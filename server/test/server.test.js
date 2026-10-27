const test = require('node:test');
const assert = require('node:assert/strict');
const WebSocket = require('ws');
const { createServer } = require('../app');

const config = {
  isProduction: false,
  jwtSecret: 'test-secret',
  clientUrl: 'http://client.test',
  oauth: { yandex: {}, google: {} },
  pendingCallTtlMs: 60_000,
  reconnectGraceMs: 50,
  heartbeatMs: 60_000,
  wsMaxPayload: 64 * 1024,
  maxNameLength: 32,
};

async function start() {
  const ctx = createServer({ config, upsertUser: async () => {} });
  await new Promise((r) => ctx.server.listen(0, '127.0.0.1', r));
  const base = `127.0.0.1:${ctx.server.address().port}`;
  return { ...ctx, http: `http://${base}`, ws: `ws://${base}/ws` };
}

function client(url) {
  const ws = new WebSocket(url);
  const inbox = [];
  const waiters = [];
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw);
    inbox.push(msg);
    for (const w of [...waiters]) {
      if (w.type === msg.type) { waiters.splice(waiters.indexOf(w), 1); w.resolve(msg.data); }
    }
  });
  return {
    ws,
    opened: new Promise((r) => ws.once('open', r)),
    send: (type, data) => ws.send(JSON.stringify({ type, data })),
    next: (type) => {
      const found = inbox.findIndex((m) => m.type === type);
      if (found >= 0) return Promise.resolve(inbox.splice(found, 1)[0].data);
      return new Promise((resolve, reject) => {
        waiters.push({ type, resolve });
        setTimeout(() => reject(new Error(`timeout waiting for ${type}`)), 2000);
      });
    },
  };
}

function stop(srv) {
  srv.server.closeAllConnections();
  srv.server.close();
}

async function guest(http, name) {
  const r = await fetch(`${http}/auth/guest`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
  });
  assert.equal(r.status, 200);
  return (await r.json()).token;
}

async function login(srv, name) {
  const c = client(srv.ws);
  await c.opened;
  c.send('auth', { token: await guest(srv.http, name) });
  const ok = await c.next('auth-ok');
  return { ...c, id: ok.userId };
}

test('HTTP: гостевой вход валидирует имя, OAuth без настроек отвечает 503', async (t) => {
  const srv = await start();
  t.after(() => stop(srv));

  const bad = await fetch(`${srv.http}/auth/guest`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '   ' }),
  });
  assert.equal(bad.status, 400);

  const r = await fetch(`${srv.http}/auth/yandex`, { redirect: 'manual' });
  assert.equal(r.status, 503);
});

test('OAuth callback с поддельным state редиректит с ошибкой во fragment', async (t) => {
  const srv = await start();
  t.after(() => stop(srv));
  const r = await fetch(`${srv.http}/auth/google/callback?code=x&state=forged`, { redirect: 'manual' });
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), 'http://client.test/callback.html#error=auth_failed');
});

test('WS: неверный токен → auth-error, неавторизованные сообщения игнорируются', async (t) => {
  const srv = await start();
  t.after(() => stop(srv));
  const c = client(srv.ws);
  await c.opened;
  c.send('get-users', {});
  c.send('auth', { token: 'garbage' });
  await c.next('auth-error');
  c.ws.close();
});

test('WS: звонок между двумя клиентами и обрыв соединения', async (t) => {
  const srv = await start();
  t.after(() => stop(srv));

  const alice = await login(srv, 'Alice');
  const bob = await login(srv, 'Bob');

  bob.send('update-location', { lat: 55.75, lng: 37.61 });
  bob.send('toggle-visible', { visible: true });
  const appeared = await alice.next('user-appeared');
  assert.equal(appeared.name, 'Bob');

  alice.send('call-request', { calleeId: bob.id });
  const incoming = await bob.next('incoming-call');
  assert.equal(incoming.callerName, 'Alice');

  bob.send('call-accept', { callerId: alice.id });
  await alice.next('call-accepted');
  await bob.next('start-webrtc');

  bob.send('webrtc-offer', { to: alice.id, sdp: 'v=0' });
  assert.equal((await alice.next('webrtc-offer')).sdp, 'v=0');

  // Bob пропадает → по истечении grace Alice получает call-ended
  bob.ws.terminate();
  await alice.next('call-ended');
  await alice.next('user-disappeared');
  alice.ws.close();
});
