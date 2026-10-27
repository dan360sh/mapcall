const test = require('node:test');
const assert = require('node:assert/strict');
const { Hub } = require('../hub');

function fakeConn() {
  const inbox = [];
  return {
    inbox,
    send: (m) => inbox.push(m),
    last: (type) => [...inbox].reverse().find((m) => m.type === type),
    has: (type) => inbox.some((m) => m.type === type),
    clear: () => { inbox.length = 0; },
  };
}

function setup({ now } = {}) {
  let t = 0;
  const hub = new Hub({ pendingCallTtlMs: 1000, now: now ?? (() => t) });
  const conns = {};
  const join = (id) => {
    conns[id] = fakeConn();
    hub.connect(conns[id], { userId: id, name: id.toUpperCase(), avatar: null });
    return conns[id];
  };
  return { hub, conns, join, advance: (ms) => { t += ms; } };
}

function establishCall(hub, a, b) {
  hub.handle(a, 'call-request', { calleeId: b });
  hub.handle(b, 'call-accept', { callerId: a });
}

test('auth-ok содержит activePeer и список видимых пользователей без себя', () => {
  const { hub, join } = setup();
  const a = join('a');
  hub.handle('a', 'update-location', { lat: 1, lng: 2 });
  hub.handle('a', 'toggle-visible', { visible: true });
  const b = join('b');
  assert.deepEqual(b.last('auth-ok').data.activePeer, null);
  assert.deepEqual(b.last('users-list').data.map((u) => u.id), ['a']);
  assert.ok(!a.last('users-list').data.some((u) => u.id === 'a'));
});

test('некорректные координаты игнорируются', () => {
  const { hub, join } = setup();
  join('a');
  hub.handle('a', 'update-location', { lat: 'x', lng: 2 });
  hub.handle('a', 'update-location', { lat: 91, lng: 2 });
  assert.equal(hub.users.get('a').lat, null);
});

test('повторное подключение сохраняет видимость — нет «призраков» на карте', () => {
  const { hub, join } = setup();
  join('a');
  hub.handle('a', 'update-location', { lat: 1, lng: 2 });
  hub.handle('a', 'toggle-visible', { visible: true });
  join('a'); // переподключение с новым conn
  assert.equal(hub.users.get('a').visible, true);
  const c = join('c');
  assert.deepEqual(c.last('users-list').data.map((u) => u.id), ['a']);
});

test('полный цикл звонка: request → accept → relay → hangup', () => {
  const { hub, conns, join } = setup();
  join('a'); join('b'); join('c');

  hub.handle('a', 'call-request', { calleeId: 'b' });
  assert.equal(conns.b.last('incoming-call').data.callerId, 'a');

  hub.handle('b', 'call-accept', { callerId: 'a' });
  assert.ok(conns.a.has('call-accepted'));
  assert.equal(conns.b.last('start-webrtc').data.callerId, 'a');
  assert.ok(conns.c.has('user-busy'));
  assert.equal(conns.b.last('auth-ok').data.activePeer, null);

  hub.handle('b', 'webrtc-offer', { to: 'a', sdp: 'SDP' });
  assert.deepEqual(conns.a.last('webrtc-offer').data, { from: 'b', sdp: 'SDP', candidate: undefined });

  hub.handle('a', 'hangup', {});
  assert.ok(conns.b.has('call-ended'));
  assert.equal(hub.active.size, 0);
});

test('нельзя принять несуществующий вызов', () => {
  const { hub, conns, join } = setup();
  join('a'); join('mallory');
  hub.handle('mallory', 'call-accept', { callerId: 'a' });
  assert.equal(hub.active.size, 0);
  assert.ok(!conns.a.has('call-accepted'));
  assert.ok(conns.mallory.has('call-cancelled'));
});

test('нельзя завершить чужой звонок или влезть в чужую сигнализацию', () => {
  const { hub, conns, join } = setup();
  join('a'); join('b'); join('mallory');
  establishCall(hub, 'a', 'b');
  conns.a.clear();

  hub.handle('mallory', 'hangup', { to: 'a' });
  assert.equal(hub.active.get('a'), 'b');

  hub.handle('mallory', 'webrtc-offer', { to: 'a', sdp: 'evil' });
  assert.ok(!conns.a.has('webrtc-offer'));
});

test('нельзя отменить/отклонить чужой вызов', () => {
  const { hub, conns, join } = setup();
  join('a'); join('b'); join('mallory');
  hub.handle('a', 'call-request', { calleeId: 'b' });
  hub.handle('mallory', 'call-cancel', { calleeId: 'b' });
  hub.handle('mallory', 'call-reject', { callerId: 'a' });
  assert.ok(hub.pending.has('b'));
  assert.ok(!conns.b.has('call-cancelled'));
});

test('вызов занятого или офлайн-пользователя сразу отклоняется', () => {
  const { hub, conns, join } = setup();
  join('a'); join('b'); join('c');
  establishCall(hub, 'a', 'b');
  hub.handle('c', 'call-request', { calleeId: 'a' });
  assert.equal(conns.c.last('call-rejected').data.reason, 'busy');
  hub.handle('c', 'call-request', { calleeId: 'ghost' });
  assert.equal(conns.c.last('call-rejected').data.reason, 'offline');
});

test('второй входящий вызов не затирает первый', () => {
  const { hub, conns, join } = setup();
  join('a'); join('b'); join('c');
  hub.handle('a', 'call-request', { calleeId: 'b' });
  hub.handle('c', 'call-request', { calleeId: 'b' });
  assert.equal(conns.c.last('call-rejected').data.reason, 'busy');
  assert.equal(hub.pending.get('b').callerId, 'a');
});

test('новый исходящий вызов снимает предыдущий', () => {
  const { hub, conns, join } = setup();
  join('a'); join('b'); join('c');
  hub.handle('a', 'call-request', { calleeId: 'b' });
  hub.handle('a', 'call-request', { calleeId: 'c' });
  assert.ok(conns.b.has('call-cancelled'));
  assert.ok(!hub.pending.has('b'));
  assert.equal(hub.pending.get('c').callerId, 'a');
});

test('протухший вызов: sweep уведомляет обе стороны', () => {
  const { hub, conns, join, advance } = setup();
  join('a'); join('b');
  hub.handle('a', 'call-request', { calleeId: 'b' });
  advance(1001);
  hub.sweep();
  assert.ok(conns.b.has('call-cancelled'));
  assert.equal(conns.a.last('call-rejected').data.reason, 'timeout');
  hub.handle('b', 'call-accept', { callerId: 'a' });
  assert.equal(hub.active.size, 0);
});

test('входящий вызов повторно доставляется при переподключении', () => {
  const { hub, join } = setup();
  join('a'); join('b');
  hub.handle('a', 'call-request', { calleeId: 'b' });
  const b2 = join('b');
  assert.equal(b2.last('incoming-call').data.callerId, 'a');
});

test('отключение звонящего снимает его вызов, отключение участника завершает звонок', () => {
  const { hub, conns, join } = setup();
  join('a'); join('b'); join('c'); join('d');
  hub.handle('a', 'call-request', { calleeId: 'b' });
  hub.disconnect('a', conns.a);
  assert.ok(conns.b.has('call-cancelled'));
  assert.ok(!hub.pending.has('b'));

  establishCall(hub, 'c', 'd');
  hub.disconnect('c', conns.c);
  assert.ok(conns.d.has('call-ended'));
  assert.equal(hub.active.size, 0);
});

test('disconnect от устаревшего conn игнорируется', () => {
  const { hub, conns, join } = setup();
  join('a');
  const old = conns.a;
  join('a');
  hub.disconnect('a', old);
  assert.ok(hub.users.has('a'));
});

test('после переподключения в течение звонка auth-ok сообщает activePeer', () => {
  const { hub, join } = setup();
  join('a'); join('b');
  establishCall(hub, 'a', 'b');
  const a2 = join('a');
  assert.equal(a2.last('auth-ok').data.activePeer, 'b');
});
