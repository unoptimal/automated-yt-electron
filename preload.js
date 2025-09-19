const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  onChromeMessage: (callback) => ipcRenderer.on('from-chrome', (event, ...args) => callback(...args)),

  // CHANGED: This now accepts a single object argument (e.g., { name, buffer })
  // and passes it directly through to the main process.
  saveFile: (data) => ipcRenderer.invoke('save-file', data)
});