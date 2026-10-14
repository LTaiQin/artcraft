const crypto = require('node:crypto');
const { generateImage, generateAudio, imagePayload, audioPayload, videoPayload, jsonRequest, download, redact } = require('./providers.cjs');

class Jobs {
  constructor(store, { onChange = () => {}, fetchImpl = fetch, pollMs = 5000 } = {}) {
    this.store = store; this.onChange = onChange; this.fetchImpl = fetchImpl; this.pollMs = pollMs; this.active = new Map();
    // Restarting never resubmits a billable POST. Submitted video jobs can resume.
    for (const job of store.data.jobs) if (['queued','running','downloading'].includes(job.status)) {
      job.status = job.remoteTaskId ? 'paused' : 'interrupted';
      job.error = job.remoteTaskId ? '已保留云端任务 ID，点击继续查询即可。' : '程序曾中断，请检查服务商记录后再决定是否重新生成。';
    }
    store.save();
  }
  changed() { this.store.save(); this.onChange(this.store.snapshot()); }
  create(kind, request) {
    if (this.active.size >= 3) throw new Error('同时最多运行 3 个生成任务');
    const config = this.store.provider(kind);
    // Validate before writing a job or sending any billable request.
    const payload = kind === 'video' ? videoPayload(config, request, this.store) : kind === 'image' ? imagePayload(config, request, this.store) : audioPayload(config, request);
    const job = { id: crypto.randomUUID(), kind, model: config.model, baseUrl: config.baseUrl, request: structuredClone(request), createdAt: new Date().toISOString(), status: 'queued', results: [] };
    this.store.data.jobs.unshift(job); this.changed();
    this.run(job, config, payload); return job;
  }
  async run(job, config, videoBody) {
    const controller = new AbortController();
    this.active.set(job.id, controller);
    const options = { signal: controller.signal, fetchImpl: this.fetchImpl };
    try {
      job.status = 'running'; delete job.error; this.changed();
      let assets;
      if (job.kind === 'image') assets = await generateImage(config, job.request, this.store, options);
      else if (job.kind === 'audio') assets = await generateAudio(config, job.request, this.store, options);
      else {
        if (!job.remoteTaskId) {
          const task = await jsonRequest(config, 'contents/generations/tasks', videoBody, options);
          if (typeof task.id !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(task.id)) throw new Error('视频接口没有返回有效任务 ID');
          job.remoteTaskId = task.id; this.changed();
        }
        let transientFailures = 0;
        for (let attempt = 0; attempt < 720; attempt++) {
          controller.signal.throwIfAborted();
          let task;
          try { task = await jsonRequest(config, 'contents/generations/tasks/' + encodeURIComponent(job.remoteTaskId), null, { ...options, method: 'GET' }); transientFailures = 0; }
          catch (e) { if (controller.signal.aborted || [400,401,403,404].includes(e.httpStatus)) throw e; if (++transientFailures >= 3) throw e; await this.sleep(controller.signal); continue; }
          job.remoteStatus = task.status; this.changed();
          if (['failed','cancelled','expired'].includes(task.status)) { const error = new Error(task.error?.message || '视频任务状态：' + task.status); error.terminal = true; throw error; }
          if (task.status === 'succeeded') {
            const url = task.content?.video_url;
            if (!url) throw new Error('视频成功后未返回 content.video_url');
            job.status = 'downloading'; this.changed();
            const bytes = await download(url, options);
            assets = [this.store.addAsset(bytes, 'Seedance-' + Date.now() + '.mp4', 'video', { source: 'generated', prompt: job.request.prompt, model: config.model, remoteTaskId: job.remoteTaskId })];
            break;
          }
          await this.sleep(controller.signal);
        }
        if (!assets) throw new Error('已等待较长时间，可继续查询此任务；不会重复提交生成');
      }
      job.results = assets.map(a => a.id); job.status = 'succeeded'; job.finishedAt = new Date().toISOString();
    } catch (e) {
      job.status = e.terminal ? 'failed' : job.remoteTaskId ? 'paused' : controller.signal.aborted ? 'interrupted' : 'failed';
      job.error = controller.signal.aborted ? '已停止本地等待。云端任务可能仍在运行；有任务 ID 时可继续查询。' : redact(e.message, config.apiKey);
    } finally { this.active.delete(job.id); this.changed(); }
  }
  sleep(signal) {
    return new Promise((resolve, reject) => {
      const onAbort = () => { clearTimeout(timer); reject(new Error('已停止等待')); };
      const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, this.pollMs);
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) onAbort();
    });
  }
  pause(id) { this.active.get(id)?.abort(); }
  resume(id) {
    const job = this.store.data.jobs.find(j => j.id === id);
    if (!job?.remoteTaskId || job.kind !== 'video' || job.status !== 'paused') throw new Error('此任务不能继续查询');
    if (this.active.has(id) || this.active.size >= 3) throw new Error('任务已在查询或并发数已满');
    const settings = this.store.provider('video');
    if (new URL(settings.baseUrl).origin !== new URL(job.baseUrl).origin) throw new Error('请先切回提交任务时使用的 API 服务，再继续查询');
    this.run(job, { ...settings, baseUrl: job.baseUrl, model: job.model }); return job;
  }
  close() { for (const controller of this.active.values()) controller.abort(); }
}
module.exports = { Jobs };
