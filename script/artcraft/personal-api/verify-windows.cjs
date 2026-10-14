// Native Windows acceptance: the original Tauri frontend, actual IPC/Rust,
// loopback provider fixtures, local asset protocol, encrypted keys and restart.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawn, spawnSync } = require('node:child_process');
const { chromium } = require(path.resolve('frontend/node_modules/playwright'));
const root = path.resolve('.local-qa/personal-api-windows');
const fixtures = path.join(root, 'fixtures');
const executable = path.resolve(process.argv[2] || 'target/release/artcraft.exe');
fs.mkdirSync(root, { recursive: true });
const dataDir = path.join(process.env.APPDATA, 'com.ltaiqin.artcraft.personal', 'acceptance');
const calls = [];
let holdVideo = false;
let videoCount = 0;
let app, browser, page;
let debugPort = 9340;
const report = { passed: false, checks: [], errors: [] };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, timeout = 45000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const result = await fn(); if (result) return result; await delay(300); }
  throw new Error('Acceptance condition timed out');
}
const server = http.createServer(async (request, response) => {
  const chunks = []; for await (const chunk of request) chunks.push(chunk);
  const body = Buffer.concat(chunks).toString();
  calls.push({ method: request.method, url: request.url, authorization: request.headers.authorization, body });
  response.setHeader('Content-Type', 'application/json');
  if (request.url.startsWith('/media/')) {
    assert.equal(request.headers.authorization, undefined, 'CDN must not receive the provider key');
    const kind = request.url.split('/').pop();
    const extension = { image: 'png', audio: 'wav', video: 'mp4' }[kind];
    response.setHeader('Content-Type', { image: 'image/png', video: 'video/mp4', audio: 'audio/wav' }[kind]);
    response.end(fs.readFileSync(path.join(fixtures, 'output.' + extension))); return;
  }
  const base = `http://127.0.0.1:${server.address().port}`;
  if (request.url === '/v1/images/generations' || request.url === '/v1/images/edits') {
    response.end(JSON.stringify({ data: [{ b64_json: fs.readFileSync(path.join(fixtures, 'output.png')).toString('base64') }] }));
  } else if (request.method === 'POST' && request.url === '/v1/contents/generations/tasks') {
    response.end(JSON.stringify({ id: 'native-task-' + (++videoCount) }));
  } else if (request.method === 'GET' && request.url.startsWith('/v1/contents/generations/tasks/')) {
    response.end(JSON.stringify(holdVideo ? { status: 'running' } : { status: 'succeeded', content: { video_url: base + '/media/video' } }));
  } else if (request.url === '/v1/services/aigc/multimodal-generation/generation') {
    response.end(JSON.stringify({ output: { audio: { url: base + '/media/audio' } } }));
  } else { response.statusCode = 404; response.end(JSON.stringify({ error: { message: 'Unknown fixture route' } })); }
});
async function launch() {
  debugPort++;
  app = spawn(executable, [], { env: { ...process.env, ARTCRAFT_PERSONAL_DATA_DIR: dataDir, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${debugPort} --remote-allow-origins=*` }, stdio: 'ignore' });
  await until(async () => { try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`); return true; } catch { return false; } }, 90000);
  page = await until(() => browser.contexts()[0]?.pages().find(p => /tauri|localhost/.test(p.url())));
  page.on('pageerror', error => report.errors.push(error.message));
  await page.getByText('Your creative workspace', { exact: true }).waitFor();
  await page.waitForFunction(() => !!window.__TAURI__?.core?.invoke);
}
async function close() {
  if (browser) await browser.close().catch(() => {});
  browser = null; page = null;
  if (app) spawnSync('taskkill', ['/pid', String(app.pid), '/t', '/f'], { stdio: 'ignore' });
  app = null; await delay(1500);
}
const invoke = (command, args = {}) => page.evaluate(({ command, args }) => window.__TAURI__.core.invoke(command, args), { command, args });
const local = url => invoke('personal_api_request_command', { request: { url: 'https://personal.artcraft.local' + url, method: 'GET' } });
const jobs = async () => (await invoke('get_task_queue_command')).payload.tasks;
async function home() { await page.locator('nav button').first().click(); await page.mouse.move(1200,100); await page.waitForTimeout(800); }
async function open(name) { await home(); await page.getByRole('main').getByRole('button', { name }).click(); await page.waitForTimeout(900); }
async function screenshot(name) { await page.screenshot({ path: path.join(root, name + '.png') }); }
async function generate(kind, request) {
  const result = await invoke(`generate_${kind}_command`, { request }); assert.equal(result.status, 'success');
  const token = result.payload.inference_job_token;
  await until(async () => (await jobs()).find(j => j.id === token)?.task_status === 'complete_success');
  return (await jobs()).find(j => j.id === token);
}
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await launch(); await screenshot('home');
    assert.equal(await page.getByText('Login / Sign Up', { exact: true }).count(), 0);
    assert.equal((await local('/v1/session')).user.username, 'local');
    report.checks.push('原版桌面主页与免账号本地会话');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Personal APIs', exact: true }).click();
    const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
    for (const kind of ['image', 'video', 'audio']) {
      await page.getByLabel(`${kind} API Base URL`, { exact: true }).fill(baseUrl);
      await page.getByLabel(`${kind} API Key`, { exact: true }).fill('native-fixture-key');
      await page.locator(`[data-personal-api="${kind}"]`).getByRole('button', { name: 'Save', exact: true }).click();
      await page.locator(`[data-personal-api="${kind}"]`).getByText('API Key · 已保存', { exact: true }).waitFor();
    }
    await screenshot('settings');
    const keys = fs.readFileSync(path.join(dataDir, 'keys.dpapi'));
    assert(!keys.includes(Buffer.from('native-fixture-key')), 'Keys must use Windows DPAPI');
    assert(!JSON.stringify(await invoke('personal_get_settings_command')).includes('native-fixture-key'));
    report.checks.push('原版设置弹窗保存三个服务与 Windows DPAPI 密钥加密');
    await page.keyboard.press('Escape');
    await open(/^Create Image/);
    await page.locator('textarea,[contenteditable=true]').first().fill('Native image UI fixture');
    await page.getByRole('button', { name: /^Generate/ }).last().click();
    await until(async () => (await jobs()).some(j => j.task_type === 'image_generation' && j.task_status === 'complete_success'));
    const image = (await jobs()).find(j => j.task_type === 'image_generation').completed_item.primary_media_file;
    assert((await page.evaluate(async url => { const r = await fetch(url); return (await r.arrayBuffer()).byteLength; }, image.cdn_url)) > 100);
    await screenshot('image');
    report.checks.push('原版生成按钮 → 真实 Tauri IPC → Rust 图片 API → 本地图库和媒体读取');
    const edited = await generate('image', { model: 'gpt_image_2p5_sunburst', prompt: 'Native edit fixture', image_media_tokens: [image.token] });
    assert(edited.completed_item.primary_media_file.token);
    let config = (await invoke('personal_get_settings_command')).image;
    await invoke('personal_save_settings_command', { kind: 'image', config: { ...config, editFormat: 'multipart' }, key: null });
    await generate('image', { model: 'gpt_image_2p5_sunburst', prompt: 'Native mask fixture', image_media_tokens: [image.token], inpainting_mask_image_raw_bytes: [...fs.readFileSync(path.join(fixtures, 'output.png'))] });
    assert(calls.some(c => c.url.endsWith('/images/edits') && c.body.includes('name="image[]"') && c.body.includes('name="mask"')));
    report.checks.push('官方 JSON 编辑、兼容 Multipart 编辑和蒙版传递');
    await open(/^Create Video/); await screenshot('video');
    await generate('video', { model: 'seedance_2p5', prompt: 'Native video fixture', duration_seconds: 5 });
    await open(/^Create Audio/); await page.locator('textarea,[contenteditable=true]').first().fill('你好，原版语音测试');
    await page.getByRole('button', { name: /^Generate/ }).last().click();
    await until(async () => (await jobs()).some(j => j.task_type === 'audio_generation' && j.task_status === 'complete_success'));
    await screenshot('audio');
    report.checks.push('Seedance 任务创建查询下载、原版音频按钮和百炼 TTS');
    await open(/^Image Editor/);
    await page.getByText('Blank Canvas', { exact: true }).click();
    await page.getByRole('button', { name: '512 × 512', exact: true }).click(); await page.getByRole('button', { name: 'Create Canvas', exact: true }).click();
    await page.locator('canvas').first().waitFor(); await delay(800);
    const pixels = () => page.locator('canvas').evaluateAll(cs => cs.reduce((n,c) => { const ctx = c.getContext('2d'); if (!ctx) return n; const d = ctx.getImageData(0,0,c.width,c.height).data; for(let i=0;i<d.length;i+=4) if(d[i+3]>0&&(d[i]<225||d[i+1]<225||d[i+2]<225)) n++; return n; },0));
    const before = await pixels(); await page.keyboard.press('3'); const box = await page.locator('canvas').first().boundingBox();
    await page.mouse.move(box.x + box.width * .45, box.y + box.height * .45); await page.mouse.down(); await page.mouse.move(box.x + box.width * .5 + 70, box.y + box.height * .5 + 50, { steps: 20 }); await page.mouse.up(); await delay(400);
    assert((await pixels()) > before + 100, 'Original drawing brush must change pixels'); await screenshot('canvas-painted');
    report.checks.push('原版绘图窗口、画布创建和实际画笔像素验证');
    await open(/^3D Stage/); await page.locator('#video-scene-container canvas').first().waitFor(); await delay(1800); await screenshot('scene');
    assert.equal(await page.getByText('Sign up to save', { exact: true }).count(), 0);
    // Drive the unchanged scene save transport with its real original form shape.
    const saved = await invoke('personal_api_request_command', { request: { url: 'https://personal.artcraft.local/v1/media_files/upload/new_scene', method: 'POST', body: { maybe_title: 'Native fixture scene', engine_category: 'scene' }, files: [{ field: 'file', name: 'scene.json', mime: 'application/json', base64: Buffer.from('{"scene":[],"version":1}').toString('base64') }] } });
    assert.equal(saved.success, true); assert.equal(saved.media_file.media_type, 'scene_json');
    assert.equal((await local('/v1/media_files/list/user/local?filter_media_type=scene_json')).results[0].token, saved.media_file_token);
    report.checks.push('原版 WebGL 3D 窗口和本地场景保存传输');
    holdVideo = true;
    const pending = await invoke('generate_video_command', { request: { model: 'seedance_2p5', prompt: 'Resume native fixture', duration_seconds: 5 } });
    await until(async () => (await jobs()).find(j => j.id === pending.payload.inference_job_token)?.provider_job_id);
    const posts = calls.filter(c => c.method === 'POST' && c.url.endsWith('/contents/generations/tasks')).length;
    await close(); holdVideo = false; await launch();
    await until(async () => (await jobs()).find(j => j.id === pending.payload.inference_job_token)?.task_status === 'complete_success');
    assert.equal(calls.filter(c => c.method === 'POST' && c.url.endsWith('/contents/generations/tasks')).length, posts);
    assert.equal((await local('/v1/media_files/file/' + saved.media_file_token)).media_file.maybe_title, 'Native fixture scene');
    report.checks.push('原生应用重启、加密密钥恢复、场景持久化和视频任务只查询不重复提交');
    assert.deepEqual(report.errors, []);
    report.passed = true; report.mockHttpRequests = calls.length;
  } catch (error) { report.failure = error.stack; process.exitCode = 1; if (page) await screenshot('failure').catch(() => {}); }
  finally {
    fs.writeFileSync(path.join(root, 'verification.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
    await close(); await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
