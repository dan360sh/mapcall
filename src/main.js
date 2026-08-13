import { connect, send, on } from './signaling.js';
import { initMap, updateUsers, removeUserMarker, setOnMarkerClick, showMyMarker, hideMyMarker, panToMyMarker } from './map.js';
import { initCall, acceptCall, endCall } from './call.js';
import { hideAllArrows } from './arrows.js';
import { Geolocation } from '@capacitor/geolocation';
import { registerPlugin } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';

const CallNotification = registerPlugin('CallNotification');

// ── App state ──────────────────────────────────────────────────────────────
let myUserId = null;
let callState = 'idle';   // idle | calling | receiving | active
let callPeer = null;      // userId of the other party
let watchId = null;
let myLat = null;
let myLng = null;
let isAppActive = true;   // false when app is backgrounded

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
  CallNotification.clearToken().catch(() => {});
  CallNotification.stopBackground().catch(() => {});
  localStorage.removeItem('mapcall_token');
  localStorage.removeItem('mapcall_visible');
  location.reload();
});

// Electron: token arrives via IPC
window.electronAPI?.on('auth-token', (token) => {
  localStorage.setItem('mapcall_token', token);
  startApp(token);
});

// ── Coordinates display ────────────────────────────────────────────────────
function updateCoordsDisplay(lat, lng) {
  const panel = $('coords-panel');
  if (!panel) return;
  const latStr = lat.toFixed(6);
  const lngStr = lng.toFixed(6);
  $('coords-text').textContent = `${latStr}, ${lngStr}`;
  panel.classList.remove('hidden');
}

$('btn-copy-coords').addEventListener('click', () => {
  const text = $('coords-text').textContent;
  navigator.clipboard?.writeText(text).then(() => {
    $('btn-copy-coords').textContent = '✓';
    setTimeout(() => { $('btn-copy-coords').textContent = '⎘'; }, 1500);
  });
});

// ── Toggle visibility on map ───────────────────────────────────────────────
let isVisible = localStorage.getItem('mapcall_visible') === '1';

function applyVisibleUI() {
  $('btn-toggle-visible').classList.toggle('active', isVisible);
  $('toggle-label').textContent = isVisible ? 'Скрыться с карты' : 'Показаться на карте';
}

$('btn-toggle-visible').addEventListener('click', () => {
  isVisible = !isVisible;
  localStorage.setItem('mapcall_visible', isVisible ? '1' : '0');
  applyVisibleUI();
  console.log('[App] toggle-visible:', isVisible, 'myLat:', myLat);
  if (Capacitor.isNativePlatform()) {
    CallNotification.setVisible({ visible: isVisible }).catch(() => {});
  }
  send('toggle-visible', { visible: isVisible });
  if (isVisible && myLat !== null) {
    send('update-location', { lat: myLat, lng: myLng });
  }
});

// ── "Где я" button ─────────────────────────────────────────────────────────
$('btn-locate-me').addEventListener('click', () => {
  panToMyMarker();
});

// ── Уведомления о звонках ──────────────────────────────────────────────────
function setupCallNotifications() {
  if (!Capacitor.isNativePlatform()) return;

  CapApp.addListener('appStateChange', ({ isActive }) => {
    isAppActive = isActive;
    console.log('[App] appStateChange isActive=' + isActive);
    if (isActive) {
      CallNotification.setJsWsActive({ active: true }).catch(() => {});
    } else {
      // Передаём текущее состояние — сервис восстановит видимость на карте
      CallNotification.setJsWsActive({
        active: false,
        visible: isVisible,
        lat: myLat,
        lng: myLng,
      }).catch(() => {});
    }
  });
}

function showCallNotification(callerName) {
  if (!Capacitor.isNativePlatform()) return;
  CallNotification.showCallNotification({ callerName }).catch(console.warn);
}

function cancelCallNotification() {
  if (!Capacitor.isNativePlatform()) return;
  CallNotification.cancelCallNotification().catch(() => {});
}

// ── GPS watching (всегда активен после логина) ─────────────────────────────
async function startGpsWatch() {
  // Запрашиваем разрешение явно — на Android показывает системный диалог
  try {
    await Geolocation.requestPermissions();
  } catch (e) {
    console.warn('Permission request failed:', e);
  }

  let centered = false;

  watchId = await Geolocation.watchPosition(
    { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 },
    (position, err) => {
      if (err || !position) { console.warn('Geolocation error:', err); return; }
      const { latitude, longitude, accuracy } = position.coords;

      // Игнорируем позиции точностью хуже 500м
      if (accuracy > 500) return;

      myLat = latitude;
      myLng = longitude;
      localStorage.setItem('mapcall_last_lat', String(latitude));
      localStorage.setItem('mapcall_last_lng', String(longitude));
      showMyMarker(myLat, myLng);
      updateCoordsDisplay(myLat, myLng);

      // Центрируем карту только на первом надёжном фиксе
      if (!centered) {
        centered = true;
        window.__ymap?.setCenter([myLat, myLng], 15, { duration: 500 });
      }

      if (isVisible) {
        send('update-location', { lat: myLat, lng: myLng });
      }
    }
  );
}

// ── Incoming call ──────────────────────────────────────────────────────────
$('btn-accept').addEventListener('click', () => {
  if (callState !== 'receiving') return;
  callState = 'active';
  cancelCallNotification();
  acceptCall(callPeer);
  showOverlay('overlay-callee');
});

$('btn-reject').addEventListener('click', () => {
  if (callState !== 'receiving') return;
  send('call-reject', { callerId: callPeer });
  callState = 'idle'; callPeer = null;
  showOverlay(null);
  cancelCallNotification();
});

// ── Outgoing call ──────────────────────────────────────────────────────────
let callTimeout = null;

function startCall(userId, userName) {
  if (callState !== 'idle' || userId === myUserId) return;
  callState = 'calling';
  callPeer = userId;
  $('callee-name').textContent = userName;
  showOverlay('overlay-calling');
  send('call-request', { calleeId: userId });
  // Авто-отмена если никто не ответил за 45 секунд
  clearTimeout(callTimeout);
  callTimeout = setTimeout(() => {
    if (callState === 'calling') {
      send('call-cancel', { calleeId: callPeer });
      callState = 'idle'; callPeer = null;
      showOverlay(null);
    }
  }, 45_000);
}

$('btn-cancel').addEventListener('click', () => {
  if (callState !== 'calling') return;
  clearTimeout(callTimeout);
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
  on('auth-ok', async ({ userId, name, avatar }) => {
    const isReconnect = myUserId !== null;
    myUserId = userId;
    $('user-name').textContent = name;
    $('user-avatar').src = avatar || '';

    // При переподключении WS сбрасываем незавершённые состояния звонка.
    // 'active' не трогаем — WebRTC может пережить разрыв сигнального канала.
    if (isReconnect && (callState === 'calling' || callState === 'receiving')) {
      if (callState === 'calling') send('call-cancel', { calleeId: callPeer });
      clearTimeout(callTimeout);
      callState = 'idle'; callPeer = null;
      showOverlay(null);
      cancelCallNotification();
    }

    if (Capacitor.isNativePlatform()) {
      CallNotification.setJsWsActive({ active: true }).catch(() => {});
    }
    if (isVisible) {
      send('toggle-visible', { visible: true });
      if (myLat !== null) send('update-location', { lat: myLat, lng: myLng });
    }
    // Если приложение было закрыто во время входящего звонка — показываем overlay
    if (Capacitor.isNativePlatform() && callState === 'idle') {
      try {
        const pending = await CallNotification.getPendingCall();
        if (pending?.callerId) {
          callPeer = pending.callerId;
          callState = 'receiving';
          $('caller-name').textContent = pending.callerName || '';
          $('caller-avatar').src = pending.callerAvatar || '';
          showOverlay('overlay-incoming');
          showCallNotification(pending.callerName || '');
        }
      } catch (_) {}
    }
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
    showCallNotification(callerName);
  });

  on('call-cancelled', () => {
    if (callState === 'receiving') {
      callState = 'idle'; callPeer = null;
      showOverlay(null);
      cancelCallNotification();
    }
  });

  on('call-accepted', () => {
    if (callState !== 'calling') return;
    clearTimeout(callTimeout);
    callState = 'active';
    showOverlay('overlay-caller');
  });

  on('call-rejected', () => {
    if (callState === 'calling') {
      clearTimeout(callTimeout);
      callState = 'idle'; callPeer = null;
      showOverlay(null);
    }
  });

  on('call-ended', () => {
    endCall();
    hideAllArrows();
    callState = 'idle'; callPeer = null;
    showOverlay(null);
    cancelCallNotification();
  });
}

// ── Map marker → call user ─────────────────────────────────────────────────
setOnMarkerClick((userId, userName) => startCall(userId, userName));
window.__callUser = (userId, userName) => startCall(userId, userName);

// ── Start app ──────────────────────────────────────────────────────────────
async function startApp(token) {
  showScreen('screen-map');
  applyVisibleUI();
  setupCallNotifications();
  wireSignaling();
  initCall({ onHangup: hangup });

  await initMap();
  startGpsWatch();

  if (Capacitor.isNativePlatform()) {
    CallNotification.saveToken({ token }).catch(() => {});
    // Синхронизируем visible из localStorage в SharedPreferences (для сервиса)
    CallNotification.setVisible({ visible: isVisible }).catch(() => {});
    // Устанавливаем флаг ДО старта сервиса — он увидит jsWsActive=true
    // и не будет открывать свой WebSocket, конкурируя с JS
    await CallNotification.setJsWsActive({ active: true }).catch(() => {});
    CallNotification.startBackground().catch(() => {});
  }

  const ok = await connect(token);
  if (!ok) {
    alert('Не удалось подключиться к серверу. Проверьте, что сервер запущен.');
    showScreen('screen-login');
    return;
  }

  // Видимость восстанавливается в обработчике auth-ok (для reconnect тоже работает)
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
