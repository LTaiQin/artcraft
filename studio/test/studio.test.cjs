const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { Store, DEFAULTS } = require('../main/store.cjs');
const { Jobs } = require('../main/jobs.cjs');
const api = require('../main/providers.cjs');

// Test-only cipher exercises the storage contract; the actual app uses DPAPI
// through Electron safeStorage on Windows.
const cipherKey = crypto.randomBytes(32);
const encryption = {
  isEncryptionAvailable: () => true,
  encryptString(value) { const iv = crypto.randomBytes(12); const c = crypto.createCipheriv('aes-256-gcm', cipherKey, iv); return Buffer.concat([iv, c.update(value), c.final(), c.getAuthTag()]); },
  decryptString(bytes) { const d = crypto.createDecipheriv('aes-256-gcm', cipherKey, bytes.subarray(0, 12)); d.setAuthTag(bytes.subarray(-16)); return Buffer.concat([d.update(bytes.subarray(12, -16)), d.final()]).toString(); },
};
function setup(t, encrypt = encryption) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ltaiqin-studio-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = new Store(root, encrypt);
  store.updateSettings({ providers: Object.fromEntries(Object.entries(DEFAULTS).map(([kind, config]) => [kind, { ...config, apiKey: 'test-key-' + kind }])) });
  return store;
}
function json(value, status = 200) { return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } }); }
async function until(predicate) { for (let i = 0; i < 200; i++) { if (predicate()) return; await new Promise(r => setTimeout(r, 5)); } throw new Error('test timed out'); }

test('keys survive encrypted restart, snapshots contain no key, origin change clears key', t => {
  const store = setup(t);
  assert(!fs.readFileSync(store.file, 'utf8').includes('test-key'));
  assert(!JSON.stringify(store.snapshot()).includes('encryptedKey'));
  assert(!JSON.stringify(store.snapshot()).includes('test-key'));
  const restarted = new Store(store.root, encryption);
  assert.equal(restarted.provider('image').apiKey, 'test-key-image');
  restarted.updateSettings({ providers: { image: { ...DEFAULTS.image, baseUrl: 'https://example.test/v1' } } });
  assert.equal(restarted.settings().providers.image.hasKey, false);
  assert.throws(() => restarted.provider('image'), /密钥/);
});

test('unavailable OS encryption keeps keys only in memory', t => {
  const store = setup(t, { isEncryptionAvailable: () => false });
  assert.equal(store.provider('audio').apiKey, 'test-key-audio');
  assert(!fs.readFileSync(store.file, 'utf8').includes('test-key'));
  assert.equal(new Store(store.root, { isEncryptionAvailable: () => false }).settings().providers.audio.hasKey, false);
});

test('external HTTP and credential-bearing URLs are rejected', t => {
  const store = setup(t);
  for (const baseUrl of ['http://example.test/v1', 'https://user:password@example.test/v1', 'https://example.test/?key=x']) {
    assert.throws(() => store.updateSettings({ providers: { image: { ...DEFAULTS.image, baseUrl } } }));
  }
});

test('official image JSON editing sends references and mask, saves base64 output locally', async t => {
  const store = setup(t); const image = store.addAsset(Buffer.from('fixture'), 'ref.png', 'image');
  const calls = [];
  const fetchImpl = async (url, options) => { calls.push({ url, options }); return json({ data: [{ b64_json: Buffer.from('output').toString('base64') }] }); };
  const assets = await api.generateImage(store.provider('image'), { prompt: 'change light', references: [image.id], maskId: image.id }, store, { fetchImpl });
  assert.equal(calls[0].url, 'https://api.openai.com/v1/images/edits');
  const body = JSON.parse(calls[0].options.body);
  assert(body.images[0].image_url.startsWith('data:image/png;base64,'));
  assert.equal(body.mask.image_url, body.images[0].image_url);
  assert.equal(body.model, 'gpt-image-2.5-sunburst');
  assert(!('response_format' in body));
  assert.equal(fs.readFileSync(store.assetPath(assets[0].id), 'utf8'), 'output');
});

test('compatible multipart edits and CDN downloads do not forward credentials', async t => {
  const store = setup(t); const ref = store.addAsset(Buffer.from('fixture'), 'ref.png', 'image');
  let calls = 0;
  await api.generateImage({ ...store.provider('image'), baseUrl: 'https://compatible.test/v1/', editFormat: 'multipart' }, { prompt: 'edit', references: [ref.id] }, store, { fetchImpl: async (url, options) => {
    calls++;
    if (calls === 1) {
      assert.equal(url, 'https://compatible.test/v1/images/edits');
      assert(options.body instanceof FormData);
      assert.equal(options.body.get('image[]').name, 'ref.png');
      assert.equal(options.headers.Authorization, 'Bearer test-key-image');
      assert(!options.headers['Content-Type']);
      return json({ data: [{ url: 'https://cdn.test/image.png' }] });
    }
    assert.equal(String(url), 'https://cdn.test/image.png');
    assert(!options.headers);
    return new Response(Buffer.from('cdn result'));
  } });
  assert.equal(calls, 2);
});

test('invalid generation input never inserts jobs or reaches a billable endpoint', t => {
  const store = setup(t); const jobs = new Jobs(store, { fetchImpl: () => { throw new Error('network must not be called'); } });
  for (const [kind, request] of [['image', { prompt: '', count: 4 }], ['image', { prompt: 'x', size: '999999x10' }], ['audio', { prompt: 'x'.repeat(601) }], ['video', { prompt: 'x', duration: 100 }], ['video', { prompt: 'x', ratio: 'bad' }]]) assert.throws(() => jobs.create(kind, request));
  assert.equal(store.data.jobs.length, 0);
});

test('Seedance payload includes all three multimodal references and validates frame modes', t => {
  const store = setup(t); const refs = [
    { kind: 'image', url: 'https://cdn.test/ref.png', role: 'reference_image' },
    { kind: 'video', url: 'https://cdn.test/ref.mp4', role: 'reference_video' },
    { kind: 'audio', url: 'https://cdn.test/ref.wav', role: 'reference_audio' },
  ];
  const body = api.videoPayload(store.provider('video'), { prompt: 'story', references: refs, duration: 30 }, store);
  assert.deepEqual(body.content.map(c => c.type), ['text', 'image_url', 'video_url', 'audio_url']);
  assert.equal(body.model, 'doubao-seedance-2-5-260628');
  assert.equal(body.duration, 30);
  assert.throws(() => api.videoPayload(store.provider('video'), { references: [{ ...refs[0], role: 'last_frame' }] }, store), /首帧/);
  assert.throws(() => api.videoPayload(store.provider('video'), { references: [{ ...refs[0], role: 'first_frame' }, refs[1]] }, store), /仅保留/);
  const frame = api.videoPayload(store.provider('video'), { references: [{ ...refs[0], role: 'first_frame' }] }, store);
  assert.equal(frame.ratio, 'adaptive');
});

test('video pause, persisted restart, and resume poll the same task without a second POST', async t => {
  const store = setup(t); let posts = 0, done = false;
  const fetchImpl = async (url, options) => {
    if (options.method === 'POST') { posts++; return json({ id: 'task-preserved' }); }
    if (String(url).endsWith('/task-preserved')) return done ? json({ status: 'succeeded', content: { video_url: 'https://cdn.test/output.mp4' } }) : json({ status: 'running' });
    assert(!options.headers);
    return new Response(Buffer.from('video bytes'));
  };
  const jobs = new Jobs(store, { fetchImpl, pollMs: 10 });
  const job = jobs.create('video', { prompt: 'test' });
  await until(() => job.remoteTaskId); jobs.pause(job.id);
  await until(() => !jobs.active.size);
  assert.equal(job.status, 'paused');
  const restartedStore = new Store(store.root, encryption);
  const restarted = new Jobs(restartedStore, { fetchImpl, pollMs: 10 });
  done = true; restarted.resume(job.id);
  await until(() => restartedStore.data.jobs[0].status === 'succeeded');
  assert.equal(posts, 1);
  assert.equal(restartedStore.data.jobs[0].remoteTaskId, 'task-preserved');
  assert.equal(restartedStore.data.jobs[0].results.length, 1);
  assert.throws(() => restarted.resume(job.id), /不能/);
});

test('cloud rejection is terminal and credentials in provider errors are redacted', async t => {
  const store = setup(t); let gets = 0;
  const jobs = new Jobs(store, { pollMs: 1, fetchImpl: async (_, opts) => opts.method === 'POST' ? json({ id: 'task-failed' }) : (gets++, json({ status: 'failed', error: { message: 'Rejected test-key-video' } })) });
  const job = jobs.create('video', { prompt: 'test' });
  await until(() => !jobs.active.size);
  assert.equal(job.status, 'failed'); assert.equal(gets, 1); assert(!job.error.includes('test-key-video'));
  await assert.rejects(api.jsonRequest(store.provider('image'), 'images/generations', {}, { fetchImpl: async () => json({ error: { message: 'Bearer test-key-image rejected' } }, 401) }), error => error.httpStatus === 401 && !error.message.includes('test-key-image'));
});

test('Qwen TTS sends native Bailian format and downloads audio locally', async t => {
  const store = setup(t); let first = true;
  const assets = await api.generateAudio(store.provider('audio'), { prompt: '你好，世界', voice: 'Cherry', language: 'Chinese' }, store, { fetchImpl: async (url, opts) => {
    if (first) { first = false; assert.equal(url, 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation'); assert.deepEqual(JSON.parse(opts.body), { model: 'qwen3-tts-flash', input: { text: '你好，世界', voice: 'Cherry', language_type: 'Chinese' } }); return json({ output: { audio: { url: 'https://cdn.test/audio.wav' } } }); }
    assert(!opts.headers); return new Response(Buffer.from('wav'));
  } });
  assert.equal(assets[0].kind, 'audio');
  assert.throws(() => api.audioPayload(store.provider('audio'), { prompt: 'x', instructions: 'style' }), /instruct/);
});
