// Hub — состояние «онлайн» и звонков. Не знает про WebSocket:
// каждому пользователю соответствует conn с методом send(message).
//
// Инварианты:
//   • users       — подключённые пользователи (один conn на userId — последний авторизованный)
//   • pending     — calleeId → входящий неотвеченный вызов (не больше одного на callee)
//   • active      — userId → peerId, всегда симметрично
//   • сообщения о звонке принимаются только от участников этого звонка

class Hub {
  constructor({ pendingCallTtlMs = 60_000, now = Date.now } = {}) {
    this.pendingCallTtlMs = pendingCallTtlMs;
    this.now = now;
    this.users   = new Map(); // userId → { id, name, avatar, conn, lat, lng, visible }
    this.pending = new Map(); // calleeId → { callerId, expires }
    this.active  = new Map(); // userId → peerId
  }

  // ── Подключение / отключение ───────────────────────────────────────────────

  connect(conn, { userId, name, avatar }) {
    const prev = this.users.get(userId);
    const user = {
      id: userId, name, avatar: avatar ?? null, conn,
      lat:     prev?.lat ?? null,
      lng:     prev?.lng ?? null,
      visible: prev?.visible ?? false,
    };
    this.users.set(userId, user);

    conn.send({ type: 'auth-ok', data: { userId, name, avatar: user.avatar, activePeer: this.active.get(userId) ?? null } });
    conn.send({ type: 'users-list', data: this.visibleUsers(userId) });

    const incoming = this.livePending(userId);
    if (incoming) conn.send({ type: 'incoming-call', data: this.callerInfo(incoming.callerId) });
    return user;
  }

  // Вызывается, когда соединение окончательно потеряно (после grace-периода).
  disconnect(userId, conn) {
    const user = this.users.get(userId);
    if (!user || user.conn !== conn) return; // уже переподключился с другим conn
    this.endCall(userId);
    this.cancelOutgoing(userId);
    if (user.visible && user.lat !== null) {
      this.broadcast({ type: 'user-disappeared', data: { id: userId } }, userId);
    }
    this.users.delete(userId);
  }

  isCurrent(userId, conn) {
    return this.users.get(userId)?.conn === conn;
  }

  // ── Входящие сообщения ────────────────────────────────────────────────────

  handle(userId, type, data = {}) {
    const user = this.users.get(userId);
    if (!user) return;

    switch (type) {
      case 'update-location': return this.updateLocation(user, data);
      case 'toggle-visible':  return this.toggleVisible(user, data);
      case 'call-request':    return this.callRequest(user, data);
      case 'call-accept':     return this.callAccept(user, data);
      case 'call-reject':     return this.callReject(user, data);
      case 'call-cancel':     return this.callCancel(user, data);
      case 'hangup':          return this.endCall(user.id);
      case 'webrtc-offer':
      case 'webrtc-answer':
      case 'webrtc-ice':      return this.relay(user, type, data);
      case 'get-users':
        return user.conn.send({ type: 'users-list', data: this.visibleUsers(user.id) });
      default:
        return undefined;
    }
  }

  updateLocation(user, { lat, lng }) {
    if (!isLatLng(lat, lng)) return;
    const firstFix = user.lat === null;
    user.lat = lat;
    user.lng = lng;
    if (!user.visible) return;
    if (firstFix) {
      this.broadcast({ type: 'user-appeared', data: this.publicUser(user) }, user.id);
    } else {
      this.broadcast({ type: 'user-moved', data: { id: user.id, lat, lng } }, user.id);
    }
  }

  toggleVisible(user, { visible }) {
    const wasVisible = user.visible;
    user.visible = !!visible;
    if (user.visible && user.lat !== null) {
      // Шлём даже если уже был видим: клиенты мержат маркер, а пропущенное
      // появление (например, после переподключения) восстанавливается.
      this.broadcast({ type: 'user-appeared', data: this.publicUser(user) }, user.id);
    } else if (!user.visible && wasVisible) {
      this.broadcast({ type: 'user-disappeared', data: { id: user.id } }, user.id);
    }
  }

  callRequest(caller, { calleeId }) {
    if (typeof calleeId !== 'string' || calleeId === caller.id) return;
    if (this.active.has(caller.id)) return;

    this.cancelOutgoing(caller.id, calleeId);

    const existing = this.livePending(calleeId);
    let reason = null;
    if (!this.users.has(calleeId))                             reason = 'offline';
    else if (this.active.has(calleeId))                         reason = 'busy';
    else if (existing && existing.callerId !== caller.id)      reason = 'busy';
    if (reason) {
      caller.conn.send({ type: 'call-rejected', data: { calleeId, reason } });
      return;
    }

    this.pending.set(calleeId, { callerId: caller.id, expires: this.now() + this.pendingCallTtlMs });
    this.sendTo(calleeId, { type: 'incoming-call', data: this.callerInfo(caller.id) });
  }

  callAccept(callee, { callerId }) {
    const call = this.livePending(callee.id);
    if (!call || call.callerId !== callerId || !this.users.has(callerId) || this.active.has(callerId)) {
      // Вызов уже отменён или протух — сообщаем, чтобы клиент вышел из «receiving»
      if (call?.callerId === callerId) this.pending.delete(callee.id);
      callee.conn.send({ type: 'call-cancelled', data: {} });
      return;
    }
    this.pending.delete(callee.id);
    this.cancelOutgoing(callee.id);

    this.active.set(callee.id, callerId);
    this.active.set(callerId, callee.id);

    this.sendTo(callerId, { type: 'call-accepted', data: { calleeId: callee.id } });
    callee.conn.send({ type: 'start-webrtc', data: { callerId } });
    this.broadcast({ type: 'user-busy', data: { id: callee.id } });
    this.broadcast({ type: 'user-busy', data: { id: callerId } });
  }

  callReject(callee, { callerId }) {
    const call = this.livePending(callee.id);
    if (!call || call.callerId !== callerId) return;
    this.pending.delete(callee.id);
    this.sendTo(callerId, { type: 'call-rejected', data: { calleeId: callee.id, reason: 'rejected' } });
  }

  callCancel(caller, { calleeId }) {
    const call = this.livePending(calleeId);
    if (!call || call.callerId !== caller.id) return;
    this.pending.delete(calleeId);
    this.sendTo(calleeId, { type: 'call-cancelled', data: {} });
  }

  endCall(userId) {
    const peerId = this.active.get(userId);
    if (!peerId) return;
    this.active.delete(userId);
    this.active.delete(peerId);
    this.sendTo(peerId, { type: 'call-ended', data: {} });
    this.broadcast({ type: 'user-free', data: { id: userId } });
    this.broadcast({ type: 'user-free', data: { id: peerId } });
  }

  relay(sender, type, { to, sdp, candidate }) {
    if (!to || this.active.get(sender.id) !== to) return;
    this.sendTo(to, { type, data: { from: sender.id, sdp, candidate } });
  }

  // Снимает исходящий вызов пользователя (кроме вызова к exceptCalleeId).
  cancelOutgoing(callerId, exceptCalleeId = null) {
    for (const [calleeId, call] of this.pending) {
      if (call.callerId === callerId && calleeId !== exceptCalleeId) {
        this.pending.delete(calleeId);
        this.sendTo(calleeId, { type: 'call-cancelled', data: {} });
      }
    }
  }

  // Удаляет протухшие вызовы и уведомляет обе стороны.
  sweep() {
    const now = this.now();
    for (const [calleeId, call] of this.pending) {
      if (now <= call.expires) continue;
      this.pending.delete(calleeId);
      this.sendTo(calleeId, { type: 'call-cancelled', data: {} });
      this.sendTo(call.callerId, { type: 'call-rejected', data: { calleeId, reason: 'timeout' } });
    }
  }

  // ── Вспомогательное ───────────────────────────────────────────────────────

  livePending(calleeId) {
    const call = this.pending.get(calleeId);
    if (!call) return null;
    if (this.now() > call.expires) {
      this.pending.delete(calleeId);
      return null;
    }
    return call;
  }

  callerInfo(callerId) {
    const caller = this.users.get(callerId);
    return { callerId, callerName: caller?.name ?? '', callerAvatar: caller?.avatar ?? null };
  }

  publicUser(u) {
    return { id: u.id, name: u.name, avatar: u.avatar, lat: u.lat, lng: u.lng, busy: this.active.has(u.id) };
  }

  visibleUsers(excludeId = null) {
    const list = [];
    for (const u of this.users.values()) {
      if (u.id !== excludeId && u.visible && u.lat !== null) list.push(this.publicUser(u));
    }
    return list;
  }

  sendTo(userId, message) {
    this.users.get(userId)?.conn.send(message);
  }

  broadcast(message, excludeId = null) {
    for (const u of this.users.values()) {
      if (u.id !== excludeId) u.conn.send(message);
    }
  }

  stats() {
    return { online: this.users.size, activeCalls: this.active.size / 2, pendingCalls: this.pending.size };
  }
}

function isLatLng(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng)
    && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

module.exports = { Hub, isLatLng };
