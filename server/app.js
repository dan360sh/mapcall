const http = require('http');
const path = require('path');
const express = require('express');
const cors = require('cors');

const { Hub } = require('./hub');
const { attachWebSocket } = require('./ws');
const { createAuthRouter, createTokenVerifier } = require('./auth');

// Собирает HTTP + WebSocket сервер. Зависимости передаются явно — так сервер
// можно поднять в тестах без PostgreSQL.
function createServer({ config, upsertUser, serveStatic = config.isProduction }) {
  const app = express();
  const server = http.createServer(app);
  const hub = new Hub({ pendingCallTtlMs: config.pendingCallTtlMs });

  app.disable('x-powered-by');
  app.use(cors());
  app.use(express.json({ limit: '16kb' }));
  if (serveStatic) app.use(express.static(path.join(__dirname, '../www')));

  app.use(createAuthRouter({ config, upsertUser }));

  app.get('/health', (_req, res) => {
    res.json({ ok: true, ...hub.stats(), uptime: Math.floor(process.uptime()) });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    console.error('[http-err]', err.message);
    if (!res.headersSent) res.status(err.status || 500).json({ error: 'internal' });
  });

  const wss = attachWebSocket(server, {
    hub,
    verifyToken:      createTokenVerifier(config.jwtSecret),
    reconnectGraceMs: config.reconnectGraceMs,
    heartbeatMs:      config.heartbeatMs,
    maxPayload:       config.wsMaxPayload,
  });

  server.on('close', () => wss.close());

  return { app, server, hub, wss };
}

module.exports = { createServer };
