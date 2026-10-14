export const native = (window as any).studio;
export type Asset = { id: string; name: string; kind: string; mime: string; url: string; bytes: number; createdAt: string; prompt?: string; source?: string };
export type Snapshot = { assets: Asset[]; jobs: any[]; scenes: any[]; settings: any };
export async function storeBlob(blob: Blob, name: string, kind: string): Promise<Asset> {
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
  return native.storeBlob({ base64, name, kind });
}
export async function waitJob(id: string): Promise<Asset[]> {
  return new Promise((resolve, reject) => {
    let off = () => {};
    const check = (state: Snapshot) => {
      const job = state.jobs.find(j => j.id === id);
      if (!job) return;
      if (job.status === 'succeeded') { off(); resolve(job.results.map((key: string) => state.assets.find(a => a.id === key)).filter(Boolean)); }
      else if (['failed','paused','interrupted'].includes(job.status)) { off(); reject(new Error(job.error || '生成未完成')); }
    };
    off = native.onState(check);
    native.snapshot().then(check).catch(reject);
  });
}
