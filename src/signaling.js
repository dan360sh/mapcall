// WebSocket signaling client

let ws = null;
let savedToken = null;
const handlers = {};

export async function connect(token) {
  savedToken = token;
  return new Promise((resolve) => {
    const base = (import.meta.env.VITE_SERVER_URL || 'http://localhost:3000')
      .replace(/^http:/, 'ws:')
      .replace(/^https:/, 'wss:');

    ws = new WebSocket(`${base}/ws`);

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'auth', data: { token } }));
      resolve(true);
    };

    ws.onerror = () => resolve(false);

    ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      (handlers[msg.type] || []).forEach(cb => cb(msg.data));
    };

    ws.onclose = () => {
      if (savedToken) setTimeout(() => connect(savedToken), 3000);
    };
  });
}

export function send(type, data = {}) {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type, data }));
  }
}

export function on(type, handler) {
  (handlers[type] ??= []).push(handler);
}

export function off(type, handler) {
  handlers[type] = (handlers[type] || []).filter(h => h !== handler);
}
