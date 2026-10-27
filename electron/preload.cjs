const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,

  // Результат OAuth: main-процесс перехватывает редирект попапа на callback.html
  onAuthResult: (cb) => {
    ipcRenderer.on('auth-result', (_event, { token, error }) => cb({ token, error }));
  },
});
