const { app, BrowserWindow, protocol, ipcMain, dialog, safeStorage, shell, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');
const { Store, MIME } = require('./store.cjs');
const { Jobs } = require('./jobs.cjs');
const { jsonRequest, redact } = require('./providers.cjs');

const ORIGIN = 'studio://app';
protocol.registerSchemesAsPrivileged([{ scheme: 'studio', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }]);
app.setName('LTaiQin Studio');
if (process.env.STUDIO_QA_USER_DATA) app.setPath('userData', path.resolve(process.env.STUDIO_QA_USER_DATA));
const ROOT = path.resolve(__dirname, '../renderer-dist');
const CSP = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob: data:; connect-src 'self' blob: data:; worker-src 'self' blob:; font-src 'self' data:; object-src 'none'; frame-src 'none'; base-uri 'self'";
let window, store, jobs;

function checkSender(event) {
  const parsed = new URL(event.senderFrame.url);
  if (parsed.protocol !== 'studio:' || parsed.hostname !== 'app' || event.sender !== window?.webContents) throw new Error('请求来源无效');
}
function handle(channel, fn) { ipcMain.handle(channel, async (event, args) => { checkSender(event); return fn(args); }); }
function notify() { if (window && !window.isDestroyed()) window.webContents.send('studio:state', store.snapshot()); }
function mimeFor(file) { return MIME[path.extname(file).toLowerCase()] || ({ '.html':'text/html; charset=utf-8', '.css':'text/css', '.js':'application/javascript', '.svg':'image/svg+xml', '.wasm':'application/wasm', '.ico':'image/x-icon' })[path.extname(file).toLowerCase()] || 'application/octet-stream'; }

function fileResponse(file, request, mime) {
  const stat = fs.statSync(file);
  const headers = { 'Content-Type': mime || mimeFor(file), 'Accept-Ranges': 'bytes', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': CSP };
  const range = request.headers.get('range');
  let start = 0, end = stat.size - 1, status = 200;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match) return new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */' + stat.size } });
    if (!match[1]) start = Math.max(0, stat.size - Number(match[2]));
    else { start = Number(match[1]); if (match[2]) end = Math.min(end, Number(match[2])); }
    if (start > end || start >= stat.size) return new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */' + stat.size } });
    status = 206; headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
  }
  headers['Content-Length'] = String(Math.max(0, end - start + 1));
  return new Response(request.method === 'HEAD' || !stat.size ? null : Readable.toWeb(fs.createReadStream(file, { start, end })), { status, headers });
}

app.whenReady().then(async () => {
  const encryption = {
    isEncryptionAvailable: () => safeStorage.isEncryptionAvailable() && (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text'),
    encryptString: value => safeStorage.encryptString(value),
    decryptString: value => safeStorage.decryptString(value),
  };
  store = new Store(app.getPath('userData'), encryption);
  // A separate network session honors the OS proxy without sharing website
  // cookies or exposing credentials to the renderer's network session.
  const apiSession = session.fromPartition('studio-api');
  const fetchImpl = (url, options) => apiSession.fetch(String(url), { ...options, credentials: 'omit' });
  jobs = new Jobs(store, { onChange: notify, fetchImpl });
  protocol.handle('studio', request => {
    try {
      const url = new URL(request.url);
      if (url.hostname !== 'app' || !['GET','HEAD'].includes(request.method)) return new Response('Not found', { status: 404 });
      if (url.pathname.startsWith('/media/')) {
        const id = url.pathname.split('/')[2];
        const asset = store.asset(id);
        return fileResponse(store.assetPath(id), request, asset.mime);
      }
      const decoded = decodeURIComponent(url.pathname);
      if (decoded.includes('..') || decoded.includes('\\') || decoded.includes('\0')) return new Response('Not found', { status: 404 });
      const file = path.resolve(ROOT, '.' + decoded);
      if (!file.startsWith(ROOT + path.sep) && file !== ROOT) return new Response('Not found', { status: 404 });
      const target = fs.existsSync(file) && fs.statSync(file).isFile() ? file : path.extname(decoded) ? null : path.join(ROOT, 'index.html');
      return target ? fileResponse(target, request) : new Response('Not found', { status: 404 });
    } catch { return new Response('Not found', { status: 404 }); }
  });

  handle('studio:snapshot', () => store.snapshot());
  handle('studio:settings', args => { const result = store.updateSettings(args); notify(); return result; });
  handle('studio:models', async () => {
    const config = store.provider('image');
    const result = await jsonRequest(config, 'models', null, { method: 'GET', fetchImpl });
    return (result.data || []).map(item => item.id).filter(id => typeof id === 'string').slice(0, 1000);
  });
  handle('studio:generate', ({ kind, request }) => jobs.create(kind, request));
  handle('studio:pause', id => { jobs.pause(id); return true; });
  handle('studio:resume', id => jobs.resume(id));
  handle('studio:import', async ({ kind = 'all' } = {}) => {
    const filters = kind === 'image' ? [{ name: '图片', extensions: ['png','jpg','jpeg','webp'] }] : kind === 'model' ? [{ name: '3D 与动画', extensions: ['glb','spz'] }] : [{ name: '图片、视频、音频和 3D 素材', extensions: ['png','jpg','jpeg','webp','mp4','mov','webm','mp3','wav','m4a','ogg','glb','spz'] }];
    const result = await dialog.showOpenDialog(window, { title: '导入本地素材', properties: ['openFile','multiSelections'], filters });
    if (result.canceled) return [];
    if (result.filePaths.length > 50) throw new Error('一次最多导入 50 个文件');
    const assets = result.filePaths.map(file => store.importFile(file)); notify(); return assets;
  });
  handle('studio:store-blob', ({ base64, name, kind }) => {
    if (typeof base64 !== 'string' || base64.length > 280 * 1024 * 1024) throw new Error('素材大小无效');
    if (!['image','video','audio','model'].includes(kind)) throw new Error('素材类型无效');
    const asset = store.addAsset(Buffer.from(base64, 'base64'), String(name), kind, { source: 'local' }); notify(); return asset;
  });
  handle('studio:save-scene', args => { const scene = store.saveScene(args); notify(); return scene; });
  handle('studio:load-scene', id => store.loadScene(id));
  handle('studio:export', async id => {
    const asset = store.asset(id);
    const result = await dialog.showSaveDialog(window, { title: '导出到本机', defaultPath: path.join(app.getPath('downloads'), asset.name) });
    if (result.canceled) return false;
    fs.copyFileSync(store.assetPath(id), result.filePath); return true;
  });
  handle('studio:open-folder', () => shell.openPath(store.root));
  handle('studio:about', () => ({ version: app.getVersion(), platform: process.platform, upstream: 'storytold/artcraft', commit: 'd4e4ac69bbd93d237eaf5d0260bc6a5ff3a5e373' }));
  handle('studio:docs', key => {
    const urls = { artcraft: 'https://github.com/storytold/artcraft', image: 'https://developers.openai.com/api/docs/guides/image-generation', video: 'https://docs.volcengine.com/docs/ark/create-video-generation-task-api?lang=zh', audio: 'https://help.aliyun.com/zh/model-studio/qwen-tts-api' };
    if (!urls[key]) throw new Error('文档入口不存在');
    return shell.openExternal(urls[key]);
  });

  window = new BrowserWindow({ width: 1440, height: 960, minWidth: 1040, minHeight: 720, title: 'LTaiQin Studio · ArtCraft', backgroundColor: '#f8f7f4', show: false, autoHideMenuBar: true, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, target) => { if (!target.startsWith(ORIGIN + '/')) event.preventDefault(); });
  window.webContents.session.setPermissionRequestHandler((_, permission, callback) => callback(false));
  window.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*','https://*/*'] }, (_, callback) => callback({ cancel: true }));
  await window.loadURL(ORIGIN + '/');
  window.show();
  if (process.env.STUDIO_QA === '1') window.webContents.on('render-process-gone', (_, details) => console.error('Renderer exited:', details.reason));
}).catch(error => {
  dialog.showErrorBox('无法打开创作工作台', redact(error.message, ''));
  app.quit();
});
app.on('before-quit', () => jobs?.close());
app.on('window-all-closed', () => app.quit());
