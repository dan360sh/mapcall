// Машина состояний звонка + оверлеи.
//
//   idle ──startCall──▶ calling ──call-accepted──▶ active (caller)
//     │                    └─rejected/cancel/timeout─▶ idle
//     └─incoming-call─▶ receiving ──accept──▶ accepting ──start-webrtc──▶ active (callee)
//                          └─reject/cancelled─▶ idle      └─call-cancelled─▶ idle
//
//   active ──hangup/call-ended/сбой WebRTC──▶ idle

import { send, on } from './signaling.js';
import { initCall, prepareSession, startAsCallee, closeSession } from './call.js';
import { startRingtone, stopRingtone } from './ringtone.js';
import { native } from './native.js';
import { isUserBusy, DEFAULT_AVATAR } from './map.js';
import { state as app } from './state.js';
import { $, setImage, showToast } from './lib/dom.js';
import { OUTGOING_CALL_TIMEOUT_MS } from './config.js';

const OVERLAYS = ['overlay-incoming', 'overlay-calling', 'overlay-caller', 'overlay-callee'];

const REJECT_MESSAGES = {
  busy:     'Абонент занят',
  offline:  'Абонент не в сети',
  timeout:  'Абонент не отвечает',
  rejected: 'Вызов отклонён',
};

let status = 'idle'; // idle | calling | receiving | accepting | active
let peerId = null;
let role = null;     // 'caller' | 'callee'
let outgoingTimer = null;

export const getCallStatus = () => status;

function showOverlay(id) {
  OVERLAYS.forEach((o) => $(o)?.classList.toggle('hidden', o !== id));
}

// Сбрасывает локальное состояние. Ничего не отправляет на сервер.
function reset() {
  clearTimeout(outgoingTimer);
  stopRingtone();
  native.cancelCallNotification();
  closeSession();
  status = 'idle';
  peerId = null;
  role = null;
  showOverlay(null);
}

// ── Исходящий ────────────────────────────────────────────────────────────────

export function startCall(userId, userName) {
  if (status !== 'idle' || !userId || userId === app.userId) return;
  if (isUserBusy(userId)) { showToast(REJECT_MESSAGES.busy); return; }
  if (!send('call-request', { calleeId: userId })) { showToast('Нет связи с сервером'); return; }

  status = 'calling';
  peerId = userId;
  role = 'caller';
  $('callee-name').textContent = userName || 'Пользователь';
  showOverlay('overlay-calling');
  startRingtone();

  outgoingTimer = setTimeout(() => {
    if (status !== 'calling') return;
    send('call-cancel', { calleeId: peerId });
    reset();
    showToast(REJECT_MESSAGES.timeout);
  }, OUTGOING_CALL_TIMEOUT_MS);
}

function cancelOutgoing() {
  if (status !== 'calling') return;
  send('call-cancel', { calleeId: peerId });
  reset();
}

// ── Входящий ─────────────────────────────────────────────────────────────────

function onIncoming({ callerId, callerName, callerAvatar }) {
  if (status === 'receiving' && peerId === callerId) return; // повтор после переподключения
  if (status !== 'idle') {
    send('call-reject', { callerId });
    return;
  }
  status = 'receiving';
  peerId = callerId;
  role = 'callee';
  setImage($('caller-avatar'), callerAvatar, DEFAULT_AVATAR);
  $('caller-name').textContent = callerName || 'Пользователь';
  showOverlay('overlay-incoming');
  native.showCallNotification(callerName || 'Входящий звонок');
}

function accept() {
  if (status !== 'receiving') return;
  native.cancelCallNotification();
  if (!send('call-accept', { callerId: peerId })) { showToast('Нет связи с сервером'); return; }
  status = 'accepting';
  prepareSession(peerId, 'callee');
  showOverlay('overlay-callee');
}

function reject() {
  if (status !== 'receiving') return;
  send('call-reject', { callerId: peerId });
  reset();
}

// ── Активный звонок ──────────────────────────────────────────────────────────

export function hangup() {
  if (status === 'active' || status === 'accepting') send('hangup', { to: peerId });
  reset();
}

function wireSignaling() {
  on('incoming-call', onIncoming);

  on('call-cancelled', () => {
    if (status === 'receiving' || status === 'accepting') reset();
  });

  on('call-accepted', ({ calleeId }) => {
    if (status !== 'calling' || calleeId !== peerId) return;
    clearTimeout(outgoingTimer);
    stopRingtone();
    status = 'active';
    prepareSession(peerId, 'caller');
    showOverlay('overlay-caller');
  });

  on('call-rejected', ({ calleeId, reason }) => {
    if (status !== 'calling' || calleeId !== peerId) return;
    reset();
    showToast(REJECT_MESSAGES[reason] ?? REJECT_MESSAGES.rejected);
  });

  on('start-webrtc', ({ callerId }) => {
    if (status !== 'accepting' || callerId !== peerId) return;
    status = 'active';
    startAsCallee();
  });

  on('call-ended', () => {
    if (status === 'active' || status === 'accepting') {
      reset();
      showToast('Звонок завершён');
    }
  });

  // После переподключения сервер сообщает, жив ли наш звонок.
  on('auth-ok', ({ activePeer }) => {
    if (status === 'calling') {
      // Неизвестно, дошёл ли запрос — отменяем, пользователь позвонит снова
      cancelOutgoing();
    } else if (status === 'receiving') {
      reset(); // если вызов ещё жив, сервер сразу пришлёт incoming-call повторно
    } else if ((status === 'active' || status === 'accepting') && activePeer !== peerId) {
      reset();
      showToast('Звонок прервался');
    }
  });
}

export function initCallController() {
  initCall({ onFailed: () => { hangup(); showToast('Соединение потеряно'); } });
  wireSignaling();

  $('btn-accept').addEventListener('click', accept);
  $('btn-reject').addEventListener('click', reject);
  $('btn-cancel').addEventListener('click', cancelOutgoing);
  $('btn-hangup-caller').addEventListener('click', hangup);
  $('btn-hangup-callee').addEventListener('click', hangup);
}
