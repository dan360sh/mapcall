// WebSocket-транспорт: аутентификация соединения, heartbeat, grace-период
// на переподключение. Вся логика состояния — в Hub.

const WebSocket = require('ws');

function createConn(ws) {
  return {
    send(message) {
      if (ws.readyState !== WebSocket.OPEN) return;
      try { ws.send(JSON.stringify(message)); } catch (err) { console.error('[ws-send]', err.message); }
    },
  };
}

function attachWebSocket(server, { hub, verifyToken, reconnectGraceMs, heartbeatMs, maxPayload }) {
  const wss = new WebSocket.Server({ server, path: '/ws', maxPayload });
  const graceTimers = new Map(); // userId → timeout

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) { ws.terminate(); continue; }
      ws.isAlive = false;
      try { ws.ping(); } catch { /* сокет уже закрывается */ }
    }
  }, heartbeatMs);

  const sweeper = setInterval(() => hub.sweep(), 5_000);

  wss.on('close', () => {
    clearInterval(heartbeat);
    clearInterval(sweeper);
    graceTimers.forEach(clearTimeout);
    graceTimers.clear();
  });

  wss.on('connection', (ws) => {
    const conn = createConn(ws);
    let userId = null;

    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('error', (err) => console.error('[ws-error]', err.message));

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      if (!msg || typeof msg.type !== 'string') return;
      const data = msg.data && typeof msg.data === 'object' ? msg.data : {};

      try {
        if (msg.type === 'auth') {
          if (userId) return; // повторная авторизация на том же сокете запрещена
          const profile = verifyToken(data.token);
          if (!profile) {
            // Сокет не закрываем: нативный сервис Android переподключается на close
            // каждые 3 с — с невалидным токеном это превратилось бы в бесконечный цикл.
            conn.send({ type: 'auth-error', data: {} });
            return;
          }
          userId = profile.userId;
          clearTimeout(graceTimers.get(userId));
          graceTimers.delete(userId);
          hub.connect(conn, profile);
          return;
        }

        if (!userId) return;
        hub.handle(userId, msg.type, data);
      } catch (err) {
        console.error('[ws-msg]', msg.type, err.message);
      }
    });

    ws.on('close', () => {
      if (!userId || !hub.isCurrent(userId, conn)) return;
      const id = userId;
      clearTimeout(graceTimers.get(id));
      graceTimers.set(id, setTimeout(() => {
        graceTimers.delete(id);
        hub.disconnect(id, conn);
      }, reconnectGraceMs));
    });
  });

  return wss;
}

module.exports = { attachWebSocket };
