const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,

  // Called from renderer to listen for OAuth result sent from main process
  on: (channel, cb) => {
    const allowed = ['auth-result'];
    if (allowed.includes(channel)) {
      ipcRenderer.on(channel, (_event, data) => {
        // Translate 'auth-result' to the token/error events the renderer expects
        if (channel === 'auth-result') {
          if (data.token) cb(data.token);
        }
      });
    }
  },

  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
});
