// WebSocket signaling client

let ws = null;
let savedToken = null;
const handlers = {};

export async function connect(token) {
  savedToken = token;
  return new Promise((resolve) => {
    const base = (import.meta.env.VITE_SERVER_URL || window.location.origin)
      .replace(/^http:/, 'ws:')
      .replace(/^https:/, 'wss:');

    ws = new WebSocket(`${base}/ws`);

    ws.onopen = () => {
      console.log('[WS] opened, sending auth');
      ws.send(JSON.stringify({ type: 'auth', data: { token } }));
      resolve(true);
    };

    ws.onerror = (e) => { console.log('[WS] error', e); resolve(false); };

    ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      console.log('[WS] msg:', msg.type, JSON.stringify(msg.data).slice(0, 80));
      (handlers[msg.type] || []).forEach(cb => cb(msg.data));
    };

    ws.onclose = (e) => {
      console.log('[WS] closed code=' + e.code + ' reason=' + e.reason);
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
