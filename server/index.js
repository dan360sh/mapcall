require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');
const { initDb, upsertUser } = require('./db');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws' });

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'mapcall-dev-secret';
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';

app.use(cors({ origin: '*' }));
app.use(express.json());

// Serve built frontend in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../www')));
}

// ── OAuth: Yandex ──────────────────────────────────────────────────────────────

app.get('/auth/yandex', (_req, res) => {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.YANDEX_CLIENT_ID,
    redirect_uri: process.env.YANDEX_REDIRECT_URI,
  });
  res.redirect(`https://oauth.yandex.ru/authorize?${params}`);
});

app.get('/auth/yandex/callback', async (req, res) => {
  try {
    const { code } = req.query;
    const tokenResp = await axios.post(
      'https://oauth.yandex.ru/token',
      new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: process.env.YANDEX_CLIENT_ID,
        client_secret: process.env.YANDEX_CLIENT_SECRET,
        redirect_uri: process.env.YANDEX_REDIRECT_URI,
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    const { access_token } = tokenResp.data;
    const profileResp = await axios.get('https://login.yandex.ru/info?format=json', {
      headers: { Authorization: `OAuth ${access_token}` },
    });
    const p = profileResp.data;
    const userId = `yandex:${p.id}`;
    const avatar = p.default_avatar_id
      ? `https://avatars.yandex.net/get-yapic/${p.default_avatar_id}/islands-50`
      : null;
    await upsertUser({ id: userId, name: p.real_name || p.login, avatar, provider: 'yandex' });
    const token = jwt.sign({ userId, name: p.real_name || p.login, avatar }, JWT_SECRET, { expiresIn: '7d' });
    res.redirect(`${CLIENT_URL}/callback.html?token=${token}`);
  } catch (e) {
    console.error('Yandex auth error:', e.message);
    res.redirect(`${CLIENT_URL}/callback.html?error=auth_failed`);
  }
});

// ── OAuth: Google ──────────────────────────────────────────────────────────────

app.get('/auth/google', (_req, res) => {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: process.env.GOOGLE_REDIRECT_URI,
    scope: 'openid profile email',
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

app.get('/auth/google/callback', async (req, res) => {
  try {
    const { code } = req.query;
    const tokenResp = await axios.post(
      'https://oauth2.googleapis.com/token',
      new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: process.env.GOOGLE_REDIRECT_URI,
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    const { id_token } = tokenResp.data;
    const profileResp = await axios.get(`https://oauth2.googleapis.com/tokeninfo?id_token=${id_token}`);
    const p = profileResp.data;
    const userId = `google:${p.sub}`;
    await upsertUser({ id: userId, name: p.name, avatar: p.picture, provider: 'google' });
    const token = jwt.sign({ userId, name: p.name, avatar: p.picture }, JWT_SECRET, { expiresIn: '7d' });
    res.redirect(`${CLIENT_URL}/callback.html?token=${token}`);
  } catch (e) {
    console.error('Google auth error:', e.message);
    res.redirect(`${CLIENT_URL}/callback.html?error=auth_failed`);
  }
});

// ── WebSocket signaling ────────────────────────────────────────────────────────

// In-memory realtime state (location + visibility)
const online = new Map(); // userId → { id, name, avatar, ws, lat, lng, visible }

function sendTo(userId, data) {
  const u = online.get(userId);
  if (u?.ws?.readyState === WebSocket.OPEN) {
    u.ws.send(JSON.stringify(data));
  }
}

function broadcast(data, excludeId = null) {
  const msg = JSON.stringify(data);
  online.forEach((u) => {
    if (u.id !== excludeId && u.ws?.readyState === WebSocket.OPEN) {
      u.ws.send(msg);
    }
  });
}

function visibleUsers() {
  return [...online.values()]
    .filter(u => u.visible && u.lat !== null)
    .map(({ id, name, avatar, lat, lng }) => ({ id, name, avatar, lat, lng }));
}

wss.on('connection', (ws) => {
  let userId = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const { type, data = {} } = msg;

    switch (type) {

      case 'auth': {
        try {
          const payload = jwt.verify(data.token, JWT_SECRET);
          userId = payload.userId;
          const prev = online.get(userId);
          online.set(userId, {
            id: userId,
            name: payload.name,
            avatar: payload.avatar,
            ws,
            lat: prev?.lat ?? null,
            lng: prev?.lng ?? null,
            visible: prev?.visible ?? false,
          });
          ws.send(JSON.stringify({ type: 'auth-ok', data: { userId, name: payload.name, avatar: payload.avatar } }));
          ws.send(JSON.stringify({ type: 'users-list', data: visibleUsers() }));
        } catch {
          ws.send(JSON.stringify({ type: 'auth-error', data: {} }));
        }
        break;
      }

      case 'update-location': {
        const u = online.get(userId);
        if (!u) return;
        u.lat = data.lat;
        u.lng = data.lng;
        if (u.visible) {
          broadcast({ type: 'user-moved', data: { id: userId, lat: data.lat, lng: data.lng } }, userId);
        }
        break;
      }

      case 'toggle-visible': {
        const u = online.get(userId);
        if (!u) return;
        u.visible = data.visible;
        if (data.visible && u.lat !== null) {
          broadcast(
            { type: 'user-appeared', data: { id: userId, name: u.name, avatar: u.avatar, lat: u.lat, lng: u.lng } },
            userId
          );
        } else {
          broadcast({ type: 'user-disappeared', data: { id: userId } }, userId);
        }
        break;
      }

      case 'call-request': {
        const caller = online.get(userId);
        if (!caller) return;
        sendTo(data.calleeId, {
          type: 'incoming-call',
          data: { callerId: userId, callerName: caller.name, callerAvatar: caller.avatar },
        });
        break;
      }

      case 'call-accept': {
        // Notify caller, and tell callee to start WebRTC
        sendTo(data.callerId, { type: 'call-accepted', data: { calleeId: userId } });
        ws.send(JSON.stringify({ type: 'start-webrtc', data: { callerId: data.callerId } }));
        break;
      }

      case 'call-reject': {
        sendTo(data.callerId, { type: 'call-rejected', data: { calleeId: userId } });
        break;
      }

      case 'call-cancel': {
        sendTo(data.calleeId, { type: 'call-cancelled', data: {} });
        break;
      }

      // WebRTC relay — just forward to the target peer
      case 'webrtc-offer':
      case 'webrtc-answer':
      case 'webrtc-ice':
        sendTo(data.to, { type, data: { ...data, from: userId } });
        break;

      case 'hangup':
        sendTo(data.to, { type: 'call-ended', data: {} });
        break;

      case 'get-users':
        ws.send(JSON.stringify({ type: 'users-list', data: visibleUsers() }));
        break;
    }
  });

  ws.on('close', () => {
    if (!userId) return;
    const u = online.get(userId);
    if (u?.visible) {
      broadcast({ type: 'user-disappeared', data: { id: userId } }, userId);
    }
    online.delete(userId);
  });
});

// ── Start ──────────────────────────────────────────────────────────────────────

initDb()
  .then(() => server.listen(PORT, () => console.log(`MapCall server → http://localhost:${PORT}`)))
  .catch(err => { console.error('DB init failed:', err); process.exit(1); });
