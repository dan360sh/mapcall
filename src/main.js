import { connect, send, on } from './signaling.js';
import { initMap, updateUsers, removeUserMarker, setOnMarkerClick } from './map.js';
import { initCall, acceptCall, endCall } from './call.js';
import { hideAllArrows } from './arrows.js';

// ── App state ──────────────────────────────────────────────────────────────
let myUserId = null;
let callState = 'idle';   // idle | calling | receiving | active
let callPeer = null;      // userId of the other party
let watchId = null;

// ── DOM refs ───────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

function showScreen(id) {
  ['screen-login', 'screen-map'].forEach(s => {
    $(`${s}`)?.classList.toggle('hidden', s !== id);
  });
}

function showOverlay(id) {
  ['overlay-incoming', 'overlay-calling', 'overlay-caller', 'overlay-callee'].forEach(o => {
    $(o)?.classList.add('hidden');
  });
  if (id) $(id)?.classList.remove('hidden');
}

// ── OAuth login ────────────────────────────────────────────────────────────
const SERVER = import.meta.env.VITE_SERVER_URL || window.location.origin;

function openOAuth(provider) {
  const popup = window.open(`${SERVER}/auth/${provider}`, 'auth', 'width=560,height=680,resizable=yes');

  const msgHandler = (e) => {
    if (e.data?.type === 'auth-token') {
      window.removeEventListener('message', msgHandler);
      popup?.close();
      const token = e.data.token;
      localStorage.setItem('mapcall_token', token);
      startApp(token);
    } else if (e.data?.type === 'auth-error') {
      window.removeEventListener('message', msgHandler);
      popup?.close();
      $('login-error').classList.remove('hidden');
    }
  };
  window.addEventListener('message', msgHandler);
}

$('btn-yandex').addEventListener('click', () => openOAuth('yandex'));
$('btn-google').addEventListener('click', () => openOAuth('google'));

// Guest login
async function loginAsGuest() {
  const name = $('guest-name').value.trim();
  if (!name) { $('guest-name').focus(); return; }
  try {
    const resp = await fetch(`${SERVER}/auth/guest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!resp.ok) throw new Error();
    const { token } = await resp.json();
    localStorage.setItem('mapcall_token', token);
    startApp(token);
  } catch {
    $('login-error').classList.remove('hidden');
  }
}

$('btn-guest-submit').addEventListener('click', loginAsGuest);
$('guest-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') loginAsGuest(); });

// Logout
$('btn-logout').addEventListener('click', () => {
  localStorage.removeItem('mapcall_token');
  location.reload();
});

// Electron: token arrives via IPC
window.electronAPI?.on('auth-token', (token) => {
  localStorage.setItem('mapcall_token', token);
  startApp(token);
});

// ── Toggle visibility on map ───────────────────────────────────────────────
let isVisible = false;

$('btn-toggle-visible').addEventListener('click', () => {
  isVisible = !isVisible;
  $('btn-toggle-visible').classList.toggle('active', isVisible);
  $('toggle-label').textContent = isVisible ? 'Скрыться с карты' : 'Показаться на карте';
  send('toggle-visible', { visible: isVisible });

  if (isVisible) {
    watchId = navigator.geolocation?.watchPosition(
      ({ coords }) => send('update-location', { lat: coords.latitude, lng: coords.longitude }),
      null,
      { enableHighAccuracy: true, maximumAge: 5000 }
    );
  } else {
    if (watchId != null) { navigator.geolocation?.clearWatch(watchId); watchId = null; }
  }
});

// ── Incoming call ──────────────────────────────────────────────────────────
$('btn-accept').addEventListener('click', () => {
  if (callState !== 'receiving') return;
  callState = 'active';
  acceptCall(callPeer);
  showOverlay('overlay-callee');
});

$('btn-reject').addEventListener('click', () => {
  if (callState !== 'receiving') return;
  send('call-reject', { callerId: callPeer });
  callState = 'idle'; callPeer = null;
  showOverlay(null);
});

// ── Outgoing call ──────────────────────────────────────────────────────────
$('btn-cancel').addEventListener('click', () => {
  if (callState !== 'calling') return;
  send('call-cancel', { calleeId: callPeer });
  callState = 'idle'; callPeer = null;
  showOverlay(null);
});

// ── Hangup ─────────────────────────────────────────────────────────────────
function hangup() {
  endCall();
  hideAllArrows();
  callState = 'idle'; callPeer = null;
  showOverlay(null);
}

$('btn-hangup-caller').addEventListener('click', hangup);
$('btn-hangup-callee').addEventListener('click', hangup);

// ── Signaling events ───────────────────────────────────────────────────────
function wireSignaling() {
  on('auth-ok', ({ userId, name, avatar }) => {
    myUserId = userId;
    $('user-name').textContent = name;
    $('user-avatar').src = avatar || '';
  });

  on('auth-error', () => {
    localStorage.removeItem('mapcall_token');
    showScreen('screen-login');
  });

  on('users-list', (users) => updateUsers(users));
  on('user-appeared', (u) => updateUsers([u], true));
  on('user-disappeared', ({ id }) => removeUserMarker(id));
  on('user-moved', ({ id, lat, lng }) => updateUsers([{ id, lat, lng }], true));

  on('incoming-call', ({ callerId, callerName, callerAvatar }) => {
    if (callState !== 'idle') {
      send('call-reject', { callerId });
      return;
    }
    callState = 'receiving';
    callPeer = callerId;
    $('caller-avatar').src = callerAvatar || '';
    $('caller-name').textContent = callerName;
    showOverlay('overlay-incoming');
  });

  on('call-cancelled', () => {
    if (callState === 'receiving') {
      callState = 'idle'; callPeer = null;
      showOverlay(null);
    }
  });

  on('call-accepted', () => {
    if (callState !== 'calling') return;
    callState = 'active';
    showOverlay('overlay-caller'); // caller sees video + joystick
  });

  on('call-rejected', () => {
    if (callState === 'calling') {
      callState = 'idle'; callPeer = null;
      showOverlay(null);
    }
  });

  on('call-ended', () => {
    endCall();
    hideAllArrows();
    callState = 'idle'; callPeer = null;
    showOverlay(null);
  });
}

// ── Map marker → call user ─────────────────────────────────────────────────
setOnMarkerClick((userId, userName) => {
  if (callState !== 'idle' || userId === myUserId) return;
  callState = 'calling';
  callPeer = userId;
  $('callee-name').textContent = userName;
  showOverlay('overlay-calling');
  send('call-request', { calleeId: userId });
});

// Expose for balloon button onclick
window.__callUser = (userId, userName) => {
  if (callState !== 'idle' || userId === myUserId) return;
  callState = 'calling';
  callPeer = userId;
  $('callee-name').textContent = userName;
  showOverlay('overlay-calling');
  send('call-request', { calleeId: userId });
};

// ── Start app ──────────────────────────────────────────────────────────────
async function startApp(token) {
  showScreen('screen-map');
  wireSignaling();

  initCall({ onHangup: hangup });

  const ok = await connect(token);
  if (!ok) {
    alert('Не удалось подключиться к серверу. Проверьте, что сервер запущен.');
    showScreen('screen-login');
    return;
  }

  await initMap();
}

// ── Bootstrap ──────────────────────────────────────────────────────────────
(function init() {
  const token = localStorage.getItem('mapcall_token');
  if (token) {
    startApp(token);
  } else {
    showScreen('screen-login');
  }
})();
