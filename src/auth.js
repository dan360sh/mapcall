// Авторизация на клиенте: хранение токена, OAuth-попап, гостевой вход.
//
// Результат OAuth приходит одним из двух путей:
//   • браузер — callback.html делает postMessage в окно-владельца (только same-origin)
//   • Electron — main-процесс перехватывает редирект на callback и шлёт IPC

import { SERVER_URL, STORAGE } from './config.js';

export const getToken   = () => localStorage.getItem(STORAGE.token);
export const saveToken  = (token) => localStorage.setItem(STORAGE.token, token);
export const clearToken = () => localStorage.removeItem(STORAGE.token);

let pending = null; // { resolve, reject, popup, timer }

function settle(token, error) {
  if (!pending) return;
  const { resolve, reject, popup, timer } = pending;
  pending = null;
  clearInterval(timer);
  window.removeEventListener('message', onMessage);
  try { popup?.close(); } catch { /* окно уже закрыто */ }
  if (token) resolve(token);
  else reject(new Error(error || 'auth_failed'));
}

function onMessage(e) {
  // Принимаем только от своего попапа и своего origin — иначе любая вкладка
  // могла бы подсунуть чужой токен.
  if (!pending || e.origin !== window.location.origin || e.source !== pending.popup) return;
  if (e.data?.type === 'auth-token') settle(e.data.token);
  else if (e.data?.type === 'auth-error') settle(null, e.data.error);
}

window.electronAPI?.onAuthResult?.(({ token, error }) => settle(token, error));

export function loginWithOAuth(provider) {
  if (pending) settle(null, 'superseded');

  const popup = window.open(`${SERVER_URL}/auth/${provider}`, 'mapcall-auth', 'width=560,height=680,resizable=yes');
  if (!popup) return Promise.reject(new Error('popup_blocked'));

  return new Promise((resolve, reject) => {
    // Пользователь закрыл окно — не держим промис вечно. Небольшая пауза нужна
    // Electron: он закрывает попап сам, а IPC с токеном может прийти чуть позже.
    const timer = setInterval(() => {
      if (!popup.closed) return;
      clearInterval(timer);
      const current = pending;
      setTimeout(() => { if (pending === current) settle(null, 'cancelled'); }, 1500);
    }, 500);
    pending = { resolve, reject, popup, timer };
    window.addEventListener('message', onMessage);
  });
}

export async function loginAsGuest(name) {
  const resp = await fetch(`${SERVER_URL}/auth/guest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!resp.ok) throw new Error(`guest login failed: ${resp.status}`);
  const { token } = await resp.json();
  return token;
}
