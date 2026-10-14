const fs = require('node:fs');
const { MAX_FILE } = require('./store.cjs');

function endpoint(base, suffix) { return base.replace(/\/$/, '') + '/' + suffix.replace(/^\//, ''); }
function redact(message, key) { return String(message).replaceAll(key || '\0', '[密钥已隐藏]').replace(/Bearer\s+[^\s"']+/gi, 'Bearer [已隐藏]').slice(0, 700); }
async function readLimited(response, limit) {
  if (Number(response.headers.get('content-length') || 0) > limit) throw new Error('服务返回的数据过大');
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > limit) { await response.body.cancel?.().catch(() => {}); throw new Error('服务返回的数据超过大小限制'); }
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
async function jsonRequest(config, suffix, body, { method = 'POST', signal, fetchImpl = fetch } = {}) {
  try {
    const timeout = AbortSignal.timeout(method === 'GET' ? 45_000 : 240_000);
    const isForm = body instanceof FormData;
    const response = await fetchImpl(endpoint(config.baseUrl, suffix), {
      method, redirect: 'manual', signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      headers: { Authorization: 'Bearer ' + config.apiKey, ...(body && !isForm ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: isForm ? body : JSON.stringify(body) } : {}),
    });
    const bytes = await readLimited(response, 100 * 1024 * 1024);
    let result;
    try { result = JSON.parse(bytes.toString()); } catch { throw new Error('接口返回了非 JSON 内容（HTTP ' + response.status + '），请检查 API 地址及协议'); }
    if (!response.ok || (result.error && !['failed','cancelled','expired'].includes(result.status)) || (result.code && !result.output)) {
      const error = new Error('HTTP ' + response.status + ' · ' + (result.error?.message || result.message || result.error || '服务拒绝请求'));
      error.httpStatus = response.status;
      throw error;
    }
    return result;
  } catch (error) {
    if (error.name === 'TimeoutError') throw new Error('请求超时；生成请求可能已经被服务商接受，请先查看服务商记录，避免重复计费');
    const safe = new Error(redact(error.message, config.apiKey));
    safe.httpStatus = error.httpStatus;
    throw safe;
  }
}

function imagePayload(config, request, store) {
  const body = { model: config.model, prompt: String(request.prompt || '').trim(), n: Number(request.count || 1), size: request.size || '1024x1024', quality: request.quality || 'auto', output_format: 'png' };
  if (!body.prompt || body.prompt.length > 32000) throw new Error('请输入 1—32000 字符的图片提示词');
  if (!Number.isInteger(body.n) || body.n < 1 || body.n > 4) throw new Error('一次生成 1—4 张图片');
  if (body.size !== 'auto') {
    const dimensions = /^(\d{2,4})x(\d{2,4})$/.exec(body.size);
    const width = Number(dimensions?.[1]), height = Number(dimensions?.[2]);
    if (!dimensions || width % 16 || height % 16 || width / height < 1 / 3 || width / height > 3 || Math.max(width, height) > 3840 || width * height > 3840 * 2160) throw new Error('图片尺寸需为 16 的倍数，宽高比 1:3—3:1，最多 3840×2160 像素');
  }
  if (!['auto','low','medium','high','xhigh','max'].includes(body.quality)) throw new Error('图片质量选项无效');
  if (request.background) {
    if (!['auto','opaque','transparent'].includes(request.background)) throw new Error('背景选项无效');
    body.background = request.background;
  }
  const references = request.references || [];
  if (!Array.isArray(references) || references.length > 16) throw new Error('图片编辑最多 16 张参考图');
  if (references.length) {
    const urls = references.map(id => { if (store.asset(id).kind !== 'image') throw new Error('图片参考只能使用图片'); return store.assetDataUrl(id); });
    body.images = urls.map(url => ({ image_url: url }));
    if (request.maskId) {
      if (store.asset(request.maskId).mime !== 'image/png') throw new Error('蒙版需要 PNG 图片');
      body.mask = { image_url: store.assetDataUrl(request.maskId) };
    }
  }
  return body;
}

function videoPayload(config, request, store) {
  const prompt = String(request.prompt || '').trim();
  const refs = request.references || [];
  if (!Array.isArray(refs) || refs.length > 50 || (!prompt && !refs.length)) throw new Error('请填写视频提示词或添加参考素材（最多 50 个）');
  const duration = Number(request.duration || 5);
  if (!Number.isInteger(duration) || duration < 4 || duration > 30) throw new Error('Seedance 2.5 时长需为 4—30 秒');
  if (!['480p','720p','1080p'].includes(request.resolution || '720p')) throw new Error('视频分辨率无效');
  if (!['16:9','9:16','1:1','4:3','3:4','21:9','adaptive'].includes(request.ratio || '16:9')) throw new Error('视频画幅无效');
  const content = prompt ? [{ type: 'text', text: prompt }] : [];
  const counts = { image: 0, video: 0, audio: 0 };
  const modes = new Set();
  for (const ref of refs) {
    let kind, url;
    if (ref.id) { const asset = store.asset(ref.id); kind = asset.kind; url = store.assetDataUrl(ref.id); }
    else {
      kind = ref.kind; const parsed = new URL(ref.url);
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error('远程参考素材需要 HTTPS 链接');
      url = parsed.toString();
    }
    if (!['image', 'video', 'audio'].includes(kind)) throw new Error('视频参考素材只能使用图片、视频、音频');
    const role = ref.role || 'reference_' + kind;
    const allowed = kind === 'image' ? ['reference_image', 'first_frame', 'last_frame'] : kind === 'video' ? ['reference_video'] : ['reference_audio'];
    if (!allowed.includes(role)) throw new Error('素材角色无效');
    counts[kind]++; modes.add(role);
    content.push({ type: kind + '_url', [kind + '_url']: { url }, role });
  }
  if (counts.image > 30 || counts.video > 10 || counts.audio > 10) throw new Error('参考素材上限：30 张图片、10 段视频、10 段音频');
  const frameMode = modes.has('first_frame') || modes.has('last_frame');
  if (frameMode && refs.some(r => !['first_frame', 'last_frame'].includes(r.role))) throw new Error('首尾帧模式请仅保留首帧 / 尾帧图片');
  if (modes.has('last_frame') && !modes.has('first_frame')) throw new Error('尾帧需要和首帧一起使用');
  if (refs.filter(r => r.role === 'first_frame').length > 1 || refs.filter(r => r.role === 'last_frame').length > 1) throw new Error('首帧与尾帧各只能指定一张');
  return { model: config.model, content, duration, resolution: request.resolution || '720p', ratio: frameMode ? 'adaptive' : request.ratio || '16:9', generate_audio: request.generateAudio !== false, watermark: false };
}

function audioPayload(config, request) {
  const text = String(request.prompt || '').trim();
  if (!text || Array.from(text).length > 600) throw new Error('Qwen 语音合成每次请输入 1—600 字符');
  const input = { text, voice: String(request.voice || 'Cherry'), language_type: request.language || 'Chinese' };
  if (request.instructions) {
    if (!config.model.includes('instruct')) throw new Error('声音风格指令需要选择 qwen3-tts-instruct-flash');
    input.instructions = String(request.instructions).slice(0, 1500);
  }
  return { model: config.model, input };
}

async function download(url, { signal, fetchImpl = fetch } = {}) {
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('服务返回的下载地址无效');
  // Media URLs may point to a different CDN. Never send the API key to a CDN.
  const response = await fetchImpl(parsed, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(180000)]) : AbortSignal.timeout(180000), redirect: 'follow' });
  if (!response.ok) throw new Error('下载生成结果失败（HTTP ' + response.status + '）；云端任务已生成，可稍后重试下载');
  return readLimited(response, MAX_FILE);
}

async function generateImage(config, request, store, options) {
  const body = imagePayload(config, request, store);
  let payload = body;
  if (body.images && config.editFormat === 'multipart') {
    const form = new FormData();
    const { images, mask, ...fields } = body;
    Object.entries(fields).forEach(([key, value]) => form.set(key, String(value)));
    for (const id of request.references) {
      const asset = store.asset(id);
      form.append('image[]', new Blob([fs.readFileSync(store.assetPath(id))], { type: asset.mime }), asset.name);
    }
    if (request.maskId) form.set('mask', new Blob([fs.readFileSync(store.assetPath(request.maskId))], { type: 'image/png' }), 'mask.png');
    payload = form;
  }
  const result = await jsonRequest(config, body.images ? 'images/edits' : 'images/generations', payload, options);
  if (!Array.isArray(result.data) || !result.data.length) throw new Error('图片接口未返回 data 图片列表');
  const assets = [];
  for (const item of result.data) {
    const bytes = item.b64_json ? Buffer.from(item.b64_json, 'base64') : item.url ? await download(item.url, options) : null;
    if (!bytes) throw new Error('图片接口未返回 b64_json 或 url');
    assets.push(store.addAsset(bytes, 'GPT-Image-' + Date.now() + '.png', 'image', { prompt: request.prompt, model: config.model, source: 'generated' }));
  }
  return assets;
}

async function generateAudio(config, request, store, options) {
  const result = await jsonRequest(config, 'services/aigc/multimodal-generation/generation', audioPayload(config, request), options);
  const audio = result.output?.audio;
  const bytes = audio?.url ? await download(audio.url, options) : audio?.data ? Buffer.from(audio.data, 'base64') : null;
  if (!bytes) throw new Error('百炼接口未返回音频 URL 或数据');
  return [store.addAsset(bytes, 'Qwen-Voice-' + Date.now() + '.wav', 'audio', { prompt: request.prompt, model: config.model, source: 'generated' })];
}

module.exports = { jsonRequest, imagePayload, videoPayload, audioPayload, generateImage, generateAudio, download, redact, endpoint, readLimited };
