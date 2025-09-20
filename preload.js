// In preload.js

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  onChromeMessage: (callback) =>
    ipcRenderer.on("from-chrome", (event, ...args) => callback(...args)),
  saveFile: (data) => ipcRenderer.invoke("save-file", data),
  // Change this from 'send' to 'invoke'
  stitchVideos: (paths) => ipcRenderer.invoke("stitch-videos", paths),
  uploadVideo: (data) => ipcRenderer.invoke("upload-video", data),
});
