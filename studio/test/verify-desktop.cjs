// Real Electron acceptance against a local mock server; no billable requests.
const { _electron: electron } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const appDir = path.resolve(__dirname, '..');
const out = path.resolve(process.env.STUDIO_TEST_OUTPUT || '.local-qa/studio-acceptance');
const fixtures = path.resolve(process.env.STUDIO_TEST_FIXTURES || path.join(out, 'fixtures'));
const report = { checks: [], errors: [], externalRequests: [], paidRequests: 0 };
fs.mkdirSync(out, { recursive: true });
const calls = [];
let pendingVideo = false, videoCount = 0;
const server = http.createServer(async (req, res) => {
  let body = ''; for await (const chunk of req) body += chunk;
  calls.push({ url: req.url, method: req.method, authorization: req.headers.authorization, body });
  if (req.url.startsWith('/media/')) {
    assert(!req.headers.authorization, 'CDN must not receive API credentials');
    const name = path.basename(req.url); res.end(fs.readFileSync(path.join(fixtures, name))); return;
  }
  let result;
  if (req.url === '/v1/models') result = { data: [{ id: 'gpt-image-2.5-sunburst' }] };
  else if (/\/images\/(generations|edits)$/.test(req.url)) result = { data: [{ b64_json: fs.readFileSync(path.join(fixtures, 'output.png')).toString('base64') }] };
  else if (req.url === '/v3/contents/generations/tasks' && req.method === 'POST') result = { id: 'task-ui-' + ++videoCount };
  else if (/\/v3\/contents\/generations\/tasks\//.test(req.url)) result = pendingVideo ? { status: 'running' } : { status: 'succeeded', content: { video_url: base + '/media/output.mp4' } };
  else if (req.url.endsWith('/multimodal-generation/generation')) result = { output: { audio: { url: base + '/media/output.wav' } } };
  else { res.writeHead(404); res.end('{}'); return; }
  res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(result));
});
let base, app, page;
async function inkPixels() {
  return page.locator('canvas').evaluateAll(canvases => canvases.reduce((total, canvas) => {
    const ctx = canvas.getContext('2d'); if (!ctx) return total;
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i] < 80 && pixels[i + 1] < 80 && pixels[i + 2] < 80 && pixels[i + 3] > 0) total++;
    return total;
  }, 0));
}
async function go(name) { await page.locator('.studio-sidebar').getByRole('button', { name, exact: true }).click(); }
async function snapshot() { return page.evaluate(() => window.studio.snapshot()); }
async function until(predicate) { for (let i = 0; i < 160; i++) { if (await predicate()) return; await new Promise(r => setTimeout(r, 100)); } throw new Error('condition timeout'); }
async function configure() {
  await go('API 设置');
  for (const [kind, endpoint] of [['image', '/v1'], ['video', '/v3'], ['audio', '/api/v1']]) {
    await page.getByRole('textbox', { name: `${kind} API 地址`, exact: true }).fill(base + endpoint);
    await page.getByRole('textbox', { name: `${kind} API Key`, exact: true }).fill('mock-key-' + kind);
  }
  await page.getByRole('button', { name: '保存 API 配置', exact: true }).click();
  await until(async () => (await snapshot()).settings.providers.image.hasKey);
}
async function launch() {
  app = await electron.launch({ executablePath: process.env.STUDIO_TEST_EXECUTABLE || path.join(appDir, 'node_modules/electron/dist/electron'), args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox', process.env.STUDIO_TEST_APP || appDir], env: { ...process.env, STUDIO_QA: '1', STUDIO_QA_USER_DATA: path.join(out, 'data') } });
  page = await app.firstWindow();
  page.on('pageerror', e => report.errors.push(e.message));
  page.on('dialog', dialog => dialog.accept().catch(() => {}));
  page.on('request', req => { if (/^https?:/.test(req.url())) report.externalRequests.push(req.url()); });
  await page.getByRole('heading', { name: /有些想法/ }).waitFor();
}
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + server.address().port;
  try {
    await launch();
    await page.screenshot({ path: path.join(out, 'home.png') });
    assert.equal(await page.getByText('Sign up to save', { exact: true }).count(), 0);
    report.checks.push('无账号启动和工作台界面');
    await configure();
    assert(!JSON.stringify(await snapshot()).includes('mock-key-'));
    await page.screenshot({ path: path.join(out, 'settings.png') });
    report.checks.push('三类自定义 API 配置，快照不包含密钥');

    for (const [kind, nav] of [['image', '生成图片'], ['video', '生成视频'], ['audio', '声音创作']]) {
      await go(nav); await page.getByRole('textbox', { name: '生成提示词', exact: true }).fill(kind === 'audio' ? '你好，欢迎来到创作工作台。' : 'A calm green world.');
      await page.getByRole('button', { name: kind === 'audio' ? '合成声音' : '开始生成', exact: true }).click();
      await until(async () => (await snapshot()).jobs.some(j => j.kind === kind && j.status === 'succeeded'));
      await page.screenshot({ path: path.join(out, kind + '.png') });
    }
    report.checks.push('图片、视频、语音：真实 IPC → 模拟 HTTP → 下载 → 本地素材');
    await page.evaluate(async () => {
      const s = await window.studio.snapshot();
      await window.studio.settings({ providers: { image: { ...s.settings.providers.image, editFormat: 'multipart' } } });
      await window.studio.generate('image', { prompt: 'Multipart edit.', references: [s.assets.find(a => a.kind === 'image').id] });
    });
    await until(async () => (await snapshot()).jobs.filter(j => j.kind === 'image' && j.status === 'succeeded').length === 2);
    assert(calls.some(c => c.url.endsWith('/images/edits') && c.body.includes('name="image[]"')));
    await page.evaluate(async () => { const s = await window.studio.snapshot(); await window.studio.settings({ providers: { image: { ...s.settings.providers.image, editFormat: 'json' } } }); });
    report.checks.push('Electron 网络会话的 Multipart 兼容编辑');
    const asset = (await snapshot()).assets.find(a => a.kind === 'video');
    const range = await page.evaluate(async url => { const res = await fetch(url, { headers: { Range: 'bytes=0-7' } }); return { status: res.status, size: (await res.arrayBuffer()).byteLength }; }, asset.url);
    assert.deepEqual(range, { status: 206, size: 8 });
    report.checks.push('本地媒体字节范围读取');

    await go('图片编辑'); await page.getByRole('button', { name: '空白画布', exact: true }).click();
    await page.getByRole('button', { name: '512 × 512', exact: true }).click(); await page.getByRole('button', { name: 'Create Canvas', exact: true }).click();
    await page.locator('canvas').first().waitFor(); await page.waitForTimeout(350);
    const before = await inkPixels(); await page.keyboard.press('3');
    const canvas = await page.locator('canvas').first().boundingBox(); assert(canvas);
    const x = canvas.x + canvas.width * .4, y = canvas.y + canvas.height * .4;
    await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 100, y + 85, { steps: 25 }); await page.mouse.up();
    await page.waitForTimeout(300); const painted = await inkPixels(); assert(painted > before + 100, 'brush must alter pixels');
    await page.screenshot({ path: path.join(out, 'canvas-painted.png') });
    await page.locator('button:has(svg.lucide-rotate-ccw)').first().click(); await page.waitForTimeout(350); assert(await inkPixels() < painted);
    await page.getByRole('button', { name: '保存画布到素材库', exact: true }).click();
    await until(async () => (await snapshot()).assets.some(a => a.name.startsWith('canvas-')));
    await page.getByRole('textbox', { name: '画布编辑提示词', exact: true }).fill('Add a soft green shape.'); await page.getByRole('button', { name: '生成修改', exact: true }).click();
    await until(() => calls.some(c => c.url.endsWith('/images/edits')));
    await until(async () => (await snapshot()).jobs.filter(j => j.kind === 'image' && j.status === 'succeeded').length >= 3);
    report.checks.push('真实画布绘制、撤销、本地保存与自定义图片编辑');

    await go('3D 场景'); await page.getByRole('button', { name: '导入模型', exact: true }).waitFor();
    assert.equal(await page.getByText('Sign up to save', { exact: true }).count(), 0);
    await page.getByRole('button', { name: /^add$/i }).first().click();
    const cube = await page.getByRole('img', { name: 'Cube', exact: true }).boundingBox(); assert(cube);
    await page.mouse.move(cube.x + cube.width / 2, cube.y + cube.height / 2); await page.mouse.down();
    await page.mouse.move(cube.x + cube.width / 2 + 25, cube.y + cube.height / 2 + 25, { steps: 8 }); await page.waitForTimeout(150);
    await page.mouse.move(830, 480, { steps: 30 }); await page.mouse.up();
    await page.getByText('Cube', { exact: true }).first().waitFor();
    await app.evaluate(({ dialog }, model) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [model] }); }, path.join(fixtures, 'local-cube.glb'));
    await page.getByRole('button', { name: '导入模型', exact: true }).click(); await page.getByRole('button', { name: '选择素材文件', exact: true }).click();
    await page.getByText(/local-cube/i).first().waitFor();
    await page.screenshot({ path: path.join(out, 'scene-models.png') });
    report.checks.push('真实 WebGL 几何体与本地 GLB 导入');
    await page.getByRole('button', { name: /^File$/i }).click(); await page.getByText('Save scene', { exact: true }).click();
    // Original engine uses its inline scene naming dialog.
    const textboxes = page.getByRole('textbox');
    console.log('SCENE SAVE DIALOG', await page.locator('body').innerText());
    await textboxes.last().fill('本地测试场景');
    await page.getByRole('button', { name: /^Save$/i }).last().click();
    await until(async () => (await snapshot()).scenes.length > 0);
    await page.locator('button').filter({ hasText: /^Record$/i }).first().click(); await page.getByRole('button', { name: /^capture$/i }).click();
    await page.getByRole('link', { name: '下载渲染结果', exact: true }).waitFor();
    const png = await page.evaluate(async () => { const a = [...document.querySelectorAll('a')].find(x => x.textContent.trim() === '下载渲染结果'); return Array.from(new Uint8Array(await (await fetch(a.href)).arrayBuffer())); });
    assert(png.length > 1000); assert.equal(Buffer.from(png).subarray(0, 8).toString('hex'), '89504e470d0a1a0a'); fs.writeFileSync(path.join(out, 'local-render.png'), Buffer.from(png));
    await page.getByRole('button', { name: '保存到本地素材库', exact: true }).click();
    await until(async () => (await snapshot()).assets.filter(a => a.kind === 'image').length >= 4);
    report.checks.push('3D 场景本地命名保存、真实 PNG 渲染与保存素材');

    pendingVideo = true; await go('生成视频'); await page.getByRole('textbox', { name: '生成提示词', exact: true }).fill('Resume task.'); await page.getByRole('button', { name: '开始生成', exact: true }).click();
    await until(async () => (await snapshot()).jobs.some(j => j.remoteTaskId === 'task-ui-2'));
    const postsBefore = calls.filter(c => c.method === 'POST' && c.url.includes('/contents/generations/tasks')).length;
    await page.evaluate(async () => { const s = await window.studio.snapshot(); await window.studio.pause(s.jobs.find(j => j.remoteTaskId === 'task-ui-2').id); });
    await until(async () => (await snapshot()).jobs.find(j => j.remoteTaskId === 'task-ui-2')?.status === 'paused');
    await page.evaluate(() => { window.onbeforeunload = null; }); await app.close(); app = null;
    pendingVideo = false; await launch(); await configure();
    await go('任务记录'); await page.getByRole('button', { name: '继续查询', exact: true }).click();
    await until(async () => (await snapshot()).jobs.find(j => j.remoteTaskId === 'task-ui-2')?.status === 'succeeded');
    assert.equal(calls.filter(c => c.method === 'POST' && c.url.includes('/contents/generations/tasks')).length, postsBefore);
    await go('本地素材'); await page.getByRole('button', { name: '本地测试场景', exact: false }).click();
    await page.getByText(/local-cube/i).first().waitFor();
    report.checks.push('应用重启恢复任务、仅 GET 查询、持久化场景重新加载');
    assert.deepEqual(report.errors, []); assert.deepEqual(report.externalRequests, []);
    report.passed = true; report.mockHttpRequests = calls.length;
  } catch (error) { report.passed = false; report.failure = error.stack; process.exitCode = 1; if (page) await page.screenshot({ path: path.join(out, 'failure.png') }).catch(() => {}); }
  finally { fs.writeFileSync(path.join(out, 'verification.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report)); if (page) await page.evaluate(() => { window.onbeforeunload = null; }).catch(() => {}); if (app) await app.close().catch(() => {}); await new Promise(resolve => server.close(resolve)); }
})();
