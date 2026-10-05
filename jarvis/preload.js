const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('jarvis', {
  chat: (text) => ipcRenderer.invoke('chat', text),
  tts: (text) => ipcRenderer.invoke('tts', text),
  stt: (audio, mime) => ipcRenderer.invoke('stt', audio, mime),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (s) => ipcRenderer.invoke('settings:set', s),
  reset: () => ipcRenderer.invoke('reset'),
  onEvent: (fn) => ipcRenderer.on('jarvis-event', (_e, ev) => fn(ev)),
});
