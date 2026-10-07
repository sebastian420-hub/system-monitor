'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('monitor', {
  getStatic: () => ipcRenderer.invoke('static-info'),
  setMode: (mode) => ipcRenderer.send('set-mode', mode),
  onStats: (cb) => ipcRenderer.on('stats', (_e, data) => cb(data)),
});
