const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  requestDeviceCode: (clientId, scope) => ipcRenderer.invoke('github:device-code', clientId, scope),
  pollForToken: (clientId, deviceCode, interval) => ipcRenderer.invoke('github:poll-token', clientId, deviceCode, interval),
  openFile: (base64, fileName) => ipcRenderer.invoke('open-file', base64, fileName),
})
