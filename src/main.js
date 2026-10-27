// Точка входа: экраны, жизненный цикл приложения и связывание модулей.

import { connect, disconnect, forceReconnect, send, on, onStatus } from './signaling.js';
import { getToken, saveToken, clearToken, loginWithOAuth, loginAsGuest } from './auth.js';
import { initMap, centerOn, onCenterChange, showMyMarker, setOnCallRequest, DEFAULT_AVATAR } from './map.js';
import { initLocation, startTracking, lastKnownPosition } from './location.js';
import { initCallController, startCall } from './callController.js';
import { initPresence } from './presence.js';
import { initControls, renderVisibility, renderNearest, renderCenterCoords, findNearest } from './controls.js';
import { state, setVisible } from './state.js';
import { native } from './native.js';
import { $, setImage, showToast } from './lib/dom.js';
import { STORAGE } from './config.js';

// ── Экраны ───────────────────────────────────────────────────────────────────

function showScreen(id) {
  ['screen-login', 'screen-map'].forEach((s) => $(s).classList.toggle('hidden', s !== id));
  if (id === 'screen-login') $('loading-overlay').classList.add('hidden');
}

function showLoading() {
  $('loading-overlay').classList.remove('hidden', 'fade-out');
}

function hideLoading() {
  const el = $('loading-overlay');
  if (el.classList.contains('hidden')) return;
  el.classList.add('fade-out');
  setTimeout(() => el.classList.add('hidden'), 450);
}

// ── Вход / выход ─────────────────────────────────────────────────────────────

function showLoginError(text = 'Ошибка авторизации. Попробуйте снова.') {
  const el = $('login-error');
  el.textContent = text;
  el.classList.remove('hidden');
}

async function login(getTokenFn) {
  $('login-error').classList.add('hidden');
  try {
    startApp(await getTokenFn());
  } catch (err) {
    if (err.message === 'cancelled' || err.message === 'superseded') return;
    showLoginError(err.message === 'popup_blocked'
      ? 'Браузер заблокировал окно входа. Разрешите всплывающие окна.'
      : undefined);
  }
}

function submitGuest() {
  const name = $('guest-name').value.trim();
  if (!name) { $('guest-name').focus(); return; }
  login(() => loginAsGuest(name));
}

function logout() {
  native.clearToken();
  native.stopBackground();
  disconnect();
  clearToken();
  localStorage.removeItem(STORAGE.visible);
  location.reload();
}

$('btn-yandex').addEventListener('click', () => login(() => loginWithOAuth('yandex')));
$('btn-google').addEventListener('click', () => login(() => loginWithOAuth('google')));
$('btn-guest-submit').addEventListener('click', submitGuest);
$('guest-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') submitGuest(); });
$('btn-logout').addEventListener('click', logout);

// ── Видимость и местоположение ───────────────────────────────────────────────

function publishPresence() {
  if (!state.isVisible) return;
  send('toggle-visible', { visible: true });
  if (state.myPos) send('update-location', state.myPos);
}

function toggleVisible(visible) {
  setVisible(visible);
  native.setVisible(visible);
  renderVisibility();
  send('toggle-visible', { visible });
  if (visible && state.myPos) send('update-location', state.myPos);
}

let centeredOnGps = false;
let centeredOnNearest = false;

// Без GPS, но с примерной позицией — один раз показываем ближайшего человека.
function focusNearestOnce() {
  if (centeredOnNearest || state.myPos || !state.ipPos) return;
  const nearest = findNearest();
  if (!nearest) return;
  centeredOnNearest = true;
  centerOn(nearest, 14, 800);
}

function wireLocation() {
  initLocation({
    onPosition(pos) {
      showMyMarker(pos);
      renderNearest();
      if (!centeredOnGps) { centeredOnGps = true; centerOn(pos, 15); }
      if (state.isVisible) send('update-location', pos);
    },
    onPermission: renderVisibility,
    onIpPosition(pos) {
      if (!state.myPos) centerOn(pos, 10);
      renderNearest();
      focusNearestOnce();
    },
  });
}

// ── Сигнализация ─────────────────────────────────────────────────────────────

function wireSignaling() {
  on('auth-ok', ({ userId, name, avatar }) => {
    state.userId = userId;
    $('user-name').textContent = name;
    setImage($('user-avatar'), avatar, DEFAULT_AVATAR);
    hideLoading();
    native.setJsWsActive(true);
    publishPresence();
  });

  on('auth-error', () => {
    disconnect();
    clearToken();
    native.clearToken();
    showScreen('screen-login');
    showLoginError('Сессия истекла. Войдите снова.');
  });

  onStatus((status) => {
    $('conn-status').classList.toggle('hidden', status === 'online');
  });

  initPresence({
    onChange() {
      renderNearest();
      focusNearestOnce();
    },
  });
}

// ── Нативный фон (Android) ───────────────────────────────────────────────────

function wireAppLifecycle() {
  let wasBackgrounded = false;
  native.onAppStateChange((isActive) => {
    if (isActive) {
      native.setJsWsActive(true);
      if (wasBackgrounded) { wasBackgrounded = false; forceReconnect(); }
    } else {
      wasBackgrounded = true;
      // Нативный сервис берёт соединение на себя и восстанавливает видимость
      native.setJsWsActive(false, { visible: state.isVisible, lat: state.myPos?.lat, lng: state.myPos?.lng });
    }
  });
}

// ── Запуск ───────────────────────────────────────────────────────────────────

let initialized = false;

async function initOnce() {
  if (initialized) return;
  initialized = true;

  wireSignaling();
  wireLocation();
  wireAppLifecycle();
  initCallController();
  initControls({ onToggleVisible: toggleVisible });
  setOnCallRequest(startCall);
  renderVisibility();

  try {
    await initMap();
    onCenterChange(renderCenterCoords);
    const last = lastKnownPosition();
    if (last) { showMyMarker(last); centerOn(last, 15, 0); }
  } catch (err) {
    console.error('[map]', err);
    showToast('Не удалось загрузить карту', 5000);
  }
  startTracking();
}

async function startApp(token) {
  saveToken(token);
  showScreen('screen-map');
  showLoading();
  await initOnce();

  native.saveToken(token);
  native.setVisible(state.isVisible);
  await native.setJsWsActive(true);
  native.startBackground();

  const ok = await connect(token);
  if (!ok) {
    // Сигнализация будет переподключаться сама — показываем карту и баннер
    hideLoading();
    $('conn-status').classList.remove('hidden');
  }
}

const savedToken = getToken();
if (savedToken) startApp(savedToken);
else showScreen('screen-login');
