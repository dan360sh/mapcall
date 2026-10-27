// WebSocket-клиент сигнализации.
//
// • одно соединение в каждый момент времени (старый сокет «забывается» до close)
// • авто-переподключение с экспоненциальной задержкой, пока есть токен
// • on() возвращает функцию отписки; onStatus() — 'online' | 'offline'

import { WS_URL } from './config.js';

const handlers = new Map();      // type → Set<handler>
const statusHandlers = new Set();
let ws = null;
let token = null;
let reconnectTimer = null;
let attempt = 0;

function emitStatus(status) {
  statusHandlers.forEach((cb) => cb(status));
}

function dispatch(type, data) {
  handlers.get(type)?.forEach((cb) => {
    try { cb(data); } catch (err) { console.error(`[signaling] handler "${type}" failed`, err); }
  });
}

function scheduleReconnect() {
  if (!token) return;
  clearTimeout(reconnectTimer);
  const delay = Math.min(30_000, 1_000 * 2 ** attempt++);
  reconnectTimer = setTimeout(open, delay);
}

function open() {
  clearTimeout(reconnectTimer);
  const socket = new WebSocket(WS_URL);
  ws = socket;

  return new Promise((resolve) => {
    socket.onopen = () => {
      if (socket !== ws) return;
      attempt = 0;
      socket.send(JSON.stringify({ type: 'auth', data: { token } }));
      emitStatus('online');
      resolve(true);
    };

    socket.onmessage = (e) => {
      if (socket !== ws) return;
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (msg && typeof msg.type === 'string') dispatch(msg.type, msg.data ?? {});
    };

    socket.onclose = () => {
      resolve(false);
      if (socket !== ws) return; // сокет заменён намеренно
      ws = null;
      emitStatus('offline');
      scheduleReconnect();
    };
  });
}

// Подключается с токеном. Резолвится true, если первое соединение открылось.
export function connect(newToken) {
  if (ws && token === newToken) return Promise.resolve(true);
  token = newToken;
  attempt = 0;
  closeCurrent();
  return open();
}

export function disconnect() {
  token = null;
  clearTimeout(reconnectTimer);
  closeCurrent();
}

// Пересоздаёт соединение (например, после возврата приложения из фона).
export function forceReconnect() {
  if (!token) return;
  closeCurrent();
  open();
}

function closeCurrent() {
  const old = ws;
  ws = null;
  if (old) { try { old.close(1000); } catch { /* уже закрыт */ } }
}

export function send(type, data = {}) {
  if (ws?.readyState !== WebSocket.OPEN) return false;
  ws.send(JSON.stringify({ type, data }));
  return true;
}

export function on(type, handler) {
  if (!handlers.has(type)) handlers.set(type, new Set());
  handlers.get(type).add(handler);
  return () => handlers.get(type)?.delete(handler);
}

export function onStatus(handler) {
  statusHandlers.add(handler);
  return () => statusHandlers.delete(handler);
}
