const { app, BrowserWindow, shell } = require('electron');
const path = require('path');

const isDev = process.env.NODE_ENV === 'development';

// Single-instance lock — prevents multiple windows / tray icons
if (!app.requestSingleInstanceLock()) app.quit();

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

  // Попапы разрешены только для OAuth (/auth/...), остальное — в системный браузер
  mainWin.webContents.setWindowOpenHandler(({ url }) => {
    if (isOAuthStart(url)) return { action: 'allow' };
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  if (isDev) {
    mainWin.loadURL('http://localhost:5173');
    mainWin.webContents.openDevTools();
  } else {
    mainWin.loadFile(path.join(__dirname, '../www/index.html'));
  }

  mainWin.on('closed', () => { mainWin = null; });
}

function isOAuthStart(url) {
  try { return /^\/auth\/(yandex|google)$/.test(new URL(url).pathname); } catch { return false; }
}

// Сервер редиректит попап на <CLIENT_URL>/callback.html#token=... —
// перехватываем этот редирект и передаём результат в главное окно по IPC
// (в prod главное окно открыто с file://, и postMessage туда не дойдёт).
function parseAuthCallback(url) {
  let parsed;
  try { parsed = new URL(url); } catch { return null; }
  if (!parsed.pathname.endsWith('/callback.html')) return null;
  const params = new URLSearchParams(parsed.hash.slice(1));
  const token = params.get('token');
  const error = params.get('error');
  return token || error ? { token, error } : null;
}

app.on('web-contents-created', (_e, contents) => {
  contents.on('will-redirect', (event, url) => {
    if (mainWin && contents === mainWin.webContents) return;
    const result = parseAuthCallback(url);
    if (!result) return;
    event.preventDefault();
    mainWin?.webContents.send('auth-result', result);
    if (!contents.isDestroyed()) contents.close();
  });
});

app.whenReady().then(() => {
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
