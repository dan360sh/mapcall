// WebRTC-сессия одного звонка.
//
// Схема: камера у того, кому звонят (callee) → он создаёт offer и DataChannel.
// Звонящий (caller) отвечает, смотрит видео и шлёт команды джойстика по каналу.
// Микрофон звонящего никогда не добавляется → звонящий не может говорить.
//
// Сессию открывает контроллер звонка через prepareSession(); сигнальные
// сообщения от кого-либо, кроме ожидаемого собеседника, игнорируются.

import { send, on } from './signaling.js';
import { ICE_SERVERS, RTC_DISCONNECT_GRACE_MS } from './config.js';
import { setJoystickHandler } from './joystick.js';
import { showArrow, hideAllArrows } from './arrows.js';

let session = null;  // { id, peerId, role, pc, stream, channel, pendingIce, disconnectTimer }
let sessionSeq = 0;
let onFailed = () => {};

const remoteVideo = () => document.getElementById('remote-video');
const localVideo  = () => document.getElementById('callee-video');

export function initCall({ onFailed: failedCb }) {
  onFailed = failedCb;

  on('webrtc-offer',  ({ from, sdp })       => handleOffer(from, sdp));
  on('webrtc-answer', ({ from, sdp })       => handleAnswer(from, sdp));
  on('webrtc-ice',    ({ from, candidate }) => handleIce(from, candidate));
}

// role: 'caller' — ждём offer; 'callee' — после startAsCallee() создаём offer.
export function prepareSession(peerId, role) {
  closeSession();
  session = { id: ++sessionSeq, peerId, role, pc: null, stream: null, channel: null, pendingIce: [], disconnectTimer: null };
}

export function closeSession() {
  if (!session) return;
  const s = session;
  session = null;
  clearTimeout(s.disconnectTimer);
  s.stream?.getTracks().forEach((t) => t.stop());
  if (s.pc) {
    s.pc.onicecandidate = s.pc.onconnectionstatechange = s.pc.ontrack = s.pc.ondatachannel = null;
    s.pc.close();
  }
  setJoystickHandler(null);
  hideAllArrows();
  const rv = remoteVideo();
  if (rv) rv.srcObject = null;
  const lv = localVideo();
  if (lv) lv.srcObject = null;
}

const isCurrent = (s) => session === s;

function fail(s, reason) {
  if (!isCurrent(s)) return;
  console.warn('[rtc] session failed:', reason);
  onFailed(reason);
}

// ── Callee: камера + offer ───────────────────────────────────────────────────

export async function startAsCallee() {
  const s = session;
  if (!s || s.role !== 'callee' || s.pc) return;

  let stream;
  try {
    stream = await getCamera();
  } catch (err) {
    fail(s, `camera: ${err.message}`);
    return;
  }
  // Пока ждали разрешение на камеру, звонок могли завершить
  if (!isCurrent(s)) { stream.getTracks().forEach((t) => t.stop()); return; }
  s.stream = stream;

  const lv = localVideo();
  if (lv) { lv.srcObject = stream; lv.muted = true; }

  s.pc = buildPeerConnection(s);
  stream.getTracks().forEach((t) => s.pc.addTrack(t, stream));

  s.channel = s.pc.createDataChannel('joystick');
  s.channel.onmessage = (e) => {
    try { showArrow(JSON.parse(e.data).dir); } catch { /* мусор в канале */ }
  };

  try {
    const offer = await s.pc.createOffer();
    await s.pc.setLocalDescription(offer);
    if (isCurrent(s)) send('webrtc-offer', { to: s.peerId, sdp: offer.sdp });
  } catch (err) {
    fail(s, `offer: ${err.message}`);
  }
}

async function getCamera() {
  const size = { width: { ideal: 1280 }, height: { ideal: 720 } };
  try {
    return await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', ...size }, audio: false });
  } catch {
    // Десктоп или устройство без задней камеры
    return navigator.mediaDevices.getUserMedia({ video: size, audio: false });
  }
}

// ── Caller: answer ───────────────────────────────────────────────────────────

async function handleOffer(from, sdp) {
  const s = session;
  if (!s || s.role !== 'caller' || s.peerId !== from || s.pc) return;

  s.pc = buildPeerConnection(s);
  try {
    await s.pc.setRemoteDescription({ type: 'offer', sdp });
    await flushIce(s);
    const answer = await s.pc.createAnswer();
    await s.pc.setLocalDescription(answer);
    if (isCurrent(s)) send('webrtc-answer', { to: from, sdp: answer.sdp });
  } catch (err) {
    fail(s, `answer: ${err.message}`);
  }
}

async function handleAnswer(from, sdp) {
  const s = session;
  if (!s || s.role !== 'callee' || s.peerId !== from || s.pc?.signalingState !== 'have-local-offer') return;
  try {
    await s.pc.setRemoteDescription({ type: 'answer', sdp });
    await flushIce(s);
  } catch (err) {
    fail(s, `remote answer: ${err.message}`);
  }
}

// Кандидаты, пришедшие раньше remoteDescription, складываем в очередь —
// иначе addIceCandidate бросает InvalidStateError и кандидат (часто TURN) теряется.
async function handleIce(from, candidate) {
  const s = session;
  if (!s || s.peerId !== from || !candidate) return;
  if (!s.pc?.remoteDescription) { s.pendingIce.push(candidate); return; }
  await s.pc.addIceCandidate(candidate).catch((err) => console.warn('[rtc] bad ICE candidate', err.message));
}

async function flushIce(s) {
  const queued = s.pendingIce.splice(0);
  for (const c of queued) {
    if (!isCurrent(s)) return;
    await s.pc.addIceCandidate(c).catch((err) => console.warn('[rtc] bad ICE candidate', err.message));
  }
}

// ── RTCPeerConnection ────────────────────────────────────────────────────────

function buildPeerConnection(s) {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

  pc.onicecandidate = ({ candidate }) => {
    if (candidate && isCurrent(s)) send('webrtc-ice', { to: s.peerId, candidate });
  };

  pc.onconnectionstatechange = () => {
    if (!isCurrent(s)) return;
    clearTimeout(s.disconnectTimer);
    switch (pc.connectionState) {
      case 'failed':
        fail(s, 'connection failed');
        break;
      case 'disconnected':
        // Часто временно (смена сети) — даём шанс восстановиться
        s.disconnectTimer = setTimeout(() => {
          if (pc.connectionState === 'disconnected') fail(s, 'connection lost');
        }, RTC_DISCONNECT_GRACE_MS);
        break;
      default:
        break;
    }
  };

  if (s.role === 'caller') {
    pc.ontrack = ({ track, streams }) => {
      const vid = remoteVideo();
      if (!vid) return;
      if (streams[0]) {
        vid.srcObject = streams[0];
      } else {
        // Некоторые браузеры не передают streams — собираем поток вручную
        if (!vid.srcObject) vid.srcObject = new MediaStream();
        vid.srcObject.addTrack(track);
      }
      vid.play().catch(() => {}); // iOS Safari требует явный play()
    };

    pc.ondatachannel = ({ channel }) => {
      s.channel = channel;
      setJoystickHandler((dir) => {
        if (channel.readyState === 'open') channel.send(JSON.stringify({ dir }));
      });
    };
  }

  return pc;
}
