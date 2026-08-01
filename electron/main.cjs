const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');

const isDev = process.env.NODE_ENV === 'development';

// Single-instance lock — prevents multiple windows / tray icons
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

let mainWin = null;

function createWindow() {
  mainWin = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 400,
    minHeight: 600,
    title: 'MapCall',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    mainWin.loadURL('http://localhost:5173');
    mainWin.webContents.openDevTools();
  } else {
    mainWin.loadFile(path.join(__dirname, '../www/index.html'));
  }

  mainWin.on('closed', () => { mainWin = null; });
}

// Intercept navigation in ALL child windows (OAuth popups).
// When the popup is redirected to the callback URL, extract the token
// and forward it to the main window via IPC (works in both dev and prod).
app.on('web-contents-created', (_e, contents) => {
  contents.on('will-redirect', (event, url) => {
    let parsed;
    try { parsed = new URL(url); } catch { return; }

    const token = parsed.searchParams.get('token');
    const error = parsed.searchParams.get('error');

    if (token || error) {
      event.preventDefault();
      if (mainWin) {
        mainWin.webContents.send('auth-result', { token, error });
      }
      // Close the OAuth popup
      if (!contents.isDestroyed()) contents.close();
    }
  });
});

app.whenReady().then(() => {
  ipcMain.handle('get-platform', () => process.platform);

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('second-instance', () => {
  if (mainWin) {
    if (mainWin.isMinimized()) mainWin.restore();
    mainWin.focus();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
