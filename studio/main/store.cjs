const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DEFAULTS = {
  image: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-image-2.5-sunburst', editFormat: 'json' },
  video: { baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', model: 'doubao-seedance-2-5-260628' },
  audio: { baseUrl: 'https://dashscope.aliyuncs.com/api/v1', model: 'qwen3-tts-flash' },
};
const TYPES = ['image', 'video', 'audio'];
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.glb': 'model/gltf-binary', '.spz': 'application/octet-stream', '.json': 'application/json' };
const MAX_FILE = 200 * 1024 * 1024;

function atomic(file, value) {
  const temporary = file + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(temporary, file);
}

function validateProvider(input, previous = {}) {
  if (!input || typeof input !== 'object') throw new Error('接口配置无效');
  const url = new URL(String(input.baseUrl || ''));
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('API 地址需要完整的 HTTP / HTTPS 地址，不能包含密码或查询参数');
  if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('外部 API 请使用 HTTPS 地址');
  const model = String(input.model || '').trim();
  if (!model || model.length > 160 || /[\r\n]/.test(model)) throw new Error('请填写服务商的模型 ID');
  const editFormat = input.editFormat || previous.editFormat || 'json';
  if (!['json', 'multipart'].includes(editFormat)) throw new Error('图片编辑协议无效');
  return { baseUrl: url.toString().replace(/\/$/, ''), model, editFormat };
}

class Store {
  constructor(root, encryption) {
    this.root = root;
    this.encryption = encryption;
    this.memoryKeys = {};
    fs.mkdirSync(path.join(root, 'media'), { recursive: true, mode: 0o700 });
    fs.mkdirSync(path.join(root, 'scenes'), { recursive: true, mode: 0o700 });
    this.file = path.join(root, 'studio.json');
    this.data = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf8')) : { version: 1, providers: structuredClone(DEFAULTS), assets: [], jobs: [], scenes: [] };
    if (this.data.version !== 1) throw new Error('本地配置版本不支持，请先备份工作目录');
    this.save();
  }
  save() { atomic(this.file, this.data); }
  key(kind) {
    const encrypted = this.data.providers[kind]?.encryptedKey;
    if (this.memoryKeys[kind]) return this.memoryKeys[kind];
    if (!encrypted) return '';
    try { return this.encryption.decryptString(Buffer.from(encrypted, 'base64')); }
    catch { return ''; }
  }
  settings() {
    return { providers: Object.fromEntries(TYPES.map(kind => {
      const { encryptedKey, ...publicValues } = this.data.providers[kind];
      return [kind, { ...publicValues, hasKey: !!this.key(kind), keyStorage: this.encryption.isEncryptionAvailable() ? 'encrypted' : 'memory' }];
    })), dataDirectory: this.root };
  }
  updateSettings(input) {
    const providers = structuredClone(this.data.providers);
    const memoryKeys = { ...this.memoryKeys };
    for (const kind of TYPES) {
      const item = input.providers?.[kind];
      if (!item) continue;
      const old = this.data.providers[kind];
      const revised = { ...validateProvider(item, old), encryptedKey: old.encryptedKey };
      // A key belongs to the configured origin; require re-entry when switching.
      if (new URL(old.baseUrl).origin !== new URL(revised.baseUrl).origin) {
        delete revised.encryptedKey;
        delete memoryKeys[kind];
      }
      if (item.clearKey) { delete revised.encryptedKey; delete memoryKeys[kind]; }
      if (typeof item.apiKey === 'string' && item.apiKey.trim()) {
        const key = item.apiKey.trim();
        if (key.length > 4096 || /[\r\n]/.test(key)) throw new Error('API Key 格式无效');
        if (this.encryption.isEncryptionAvailable()) revised.encryptedKey = this.encryption.encryptString(key).toString('base64');
        else { memoryKeys[kind] = key; delete revised.encryptedKey; }
      }
      providers[kind] = revised;
    }
    this.data.providers = providers;
    this.memoryKeys = memoryKeys;
    this.save();
    return this.settings();
  }
  provider(kind) {
    if (!TYPES.includes(kind)) throw new Error('生成类型无效');
    const apiKey = this.key(kind);
    if (!apiKey) throw new Error('请先在「API 设置」填写此服务的密钥');
    return { ...this.data.providers[kind], apiKey };
  }
  publicAsset(asset) { const { filename, ...rest } = asset; return { ...rest, url: 'studio://app/media/' + asset.id + '/' + encodeURIComponent(asset.name) }; }
  asset(id) {
    const asset = this.data.assets.find(item => item.id === id);
    if (!asset) throw new Error('找不到本地素材');
    return asset;
  }
  assetPath(id) { return path.join(this.root, 'media', this.asset(id).filename); }
  assetDataUrl(id) {
    const asset = this.asset(id);
    const file = this.assetPath(id);
    if (fs.statSync(file).size > 50 * 1024 * 1024) throw new Error('单个内联参考素材请控制在 50 MB 以内；更大的视频请使用服务商可读取的 HTTPS 链接');
    return 'data:' + asset.mime + ';base64,' + fs.readFileSync(file).toString('base64');
  }
  addAsset(bytes, name, kind, meta = {}) {
    if (!Buffer.isBuffer(bytes)) bytes = Buffer.from(bytes);
    if (!bytes.length || bytes.length > MAX_FILE) throw new Error('素材大小需介于 1 字节到 200 MB');
    const ext = path.extname(name).toLowerCase();
    if (!MIME[ext]) throw new Error('不支持这种素材格式');
    const id = crypto.randomUUID();
    const filename = id + ext;
    fs.writeFileSync(path.join(this.root, 'media', filename), bytes, { mode: 0o600 });
    const asset = { id, filename, name: path.basename(name).slice(0, 160), kind, mime: MIME[ext], bytes: bytes.length, createdAt: new Date().toISOString(), ...meta };
    this.data.assets.push(asset); this.save();
    return this.publicAsset(asset);
  }
  importFile(file) {
    const ext = path.extname(file).toLowerCase();
    const mime = MIME[ext];
    if (!mime) throw new Error('不支持这种素材格式');
    if (fs.statSync(file).size > MAX_FILE) throw new Error('导入文件不能超过 200 MB');
    const kind = mime.startsWith('image/') ? 'image' : mime.startsWith('video/') ? 'video' : mime.startsWith('audio/') ? 'audio' : 'model';
    return this.addAsset(fs.readFileSync(file), path.basename(file), kind);
  }
  saveScene({ json, title, id }) {
    if (typeof json !== 'string' || Buffer.byteLength(json) > 8 * 1024 * 1024) throw new Error('场景文件过大');
    JSON.parse(json);
    const record = id ? this.data.scenes.find(s => s.id === id) : null;
    if (id && !record) throw new Error('找不到此场景');
    const next = record || { id: crypto.randomUUID(), createdAt: new Date().toISOString() };
    next.title = String(title || '未命名场景').slice(0, 100);
    next.updatedAt = new Date().toISOString();
    fs.writeFileSync(path.join(this.root, 'scenes', next.id + '.json'), json, { mode: 0o600 });
    if (!record) this.data.scenes.push(next);
    this.save(); return next;
  }
  loadScene(id) {
    if (!this.data.scenes.some(s => s.id === id)) throw new Error('找不到此场景');
    return JSON.parse(fs.readFileSync(path.join(this.root, 'scenes', id + '.json'), 'utf8'));
  }
  snapshot() { return { assets: this.data.assets.map(a => this.publicAsset(a)), jobs: this.data.jobs, scenes: this.data.scenes, settings: this.settings() }; }
}

module.exports = { Store, DEFAULTS, TYPES, MIME, MAX_FILE, validateProvider, atomic };
