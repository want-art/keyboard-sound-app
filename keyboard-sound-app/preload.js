// 预加载：安全地暴露 IPC 桥接给渲染进程
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  updateConfig: (patch) => ipcRenderer.send('update-config', patch),
  importPack: () => ipcRenderer.invoke('import-pack'),
  clearPack: () => ipcRenderer.invoke('clear-pack'),
  audition: (profile) => ipcRenderer.send('audition', profile),
  on: (channel, cb) => { ipcRenderer.on(channel, (_e, data) => cb(data)); },
});