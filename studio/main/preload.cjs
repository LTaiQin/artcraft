const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('studio', {
  snapshot: () => ipcRenderer.invoke('studio:snapshot'),
  settings: value => ipcRenderer.invoke('studio:settings', value),
  listImageModels: () => ipcRenderer.invoke('studio:models'),
  generate: (kind, request) => ipcRenderer.invoke('studio:generate', { kind, request }),
  pause: id => ipcRenderer.invoke('studio:pause', id),
  resume: id => ipcRenderer.invoke('studio:resume', id),
  importFiles: kind => ipcRenderer.invoke('studio:import', { kind }),
  storeBlob: value => ipcRenderer.invoke('studio:store-blob', value),
  saveScene: value => ipcRenderer.invoke('studio:save-scene', value),
  loadScene: id => ipcRenderer.invoke('studio:load-scene', id),
  exportAsset: id => ipcRenderer.invoke('studio:export', id),
  openFolder: () => ipcRenderer.invoke('studio:open-folder'),
  about: () => ipcRenderer.invoke('studio:about'),
  openDocs: key => ipcRenderer.invoke('studio:docs', key),
  onState: callback => { const handler = (_, value) => callback(value); ipcRenderer.on('studio:state', handler); return () => ipcRenderer.removeListener('studio:state', handler); },
});
