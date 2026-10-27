// Интеграция с Яндекс.Картами 2.1.
//
// Весь пользовательский текст (имена, URL аватаров) экранируется: содержимое
// балуна — это HTML, и неэкранированное имя гостя = XSS у всех на карте.

import { YANDEX_MAPS_KEY, DEFAULT_CENTER } from './config.js';
import { escapeHtml, safeImageUrl } from './lib/dom.js';

export const DEFAULT_AVATAR = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
  '<circle cx="50" cy="50" r="50" fill="#2a2a4a"/>' +
  '<circle cx="50" cy="38" r="22" fill="#808098"/>' +
  '<ellipse cx="50" cy="92" rx="34" ry="26" fill="#808098"/>' +
  '</svg>',
);

let ymap = null;
let initPromise = null;
const markers = new Map();   // userId → { placemark, user }
let myMarker = null;
let onCallCb = () => {};

export function setOnCallRequest(cb) {
  onCallCb = cb;
}

// Кнопка «Позвонить» внутри балуна — через делегирование, без inline onclick.
document.addEventListener('click', (e) => {
  const btn = e.target.closest?.('[data-call-user]');
  if (!btn) return;
  const entry = markers.get(btn.dataset.callUser);
  if (entry) onCallCb(entry.user.id, entry.user.name);
});

// Повторные вызовы возвращают ту же карту.
export function initMap() {
  initPromise ??= loadYandexMaps(YANDEX_MAPS_KEY).then(() => {
    ymap = new window.ymaps.Map('ymap', { center: DEFAULT_CENTER, zoom: 10, controls: ['zoomControl'] });
  }).catch((err) => {
    initPromise = null;
    throw err;
  });
  return initPromise;
}

function loadYandexMaps(apiKey) {
  return new Promise((resolve, reject) => {
    if (window.ymaps) { window.ymaps.ready(resolve); return; }
    const s = document.createElement('script');
    s.src = `https://api-maps.yandex.ru/2.1/?apikey=${encodeURIComponent(apiKey)}&lang=ru_RU`;
    s.onload = () => window.ymaps.ready(resolve);
    s.onerror = () => { s.remove(); reject(new Error('Yandex Maps failed to load')); };
    document.head.appendChild(s);
  });
}

// ── Камера ───────────────────────────────────────────────────────────────────

export function centerOn({ lat, lng }, zoom, duration = 500) {
  ymap?.setCenter([lat, lng], zoom ?? ymap.getZoom(), { duration });
}

export function onCenterChange(cb) {
  ymap?.events.add('boundschange', () => {
    const [lat, lng] = ymap.getCenter();
    cb({ lat, lng });
  });
}

// ── Маркеры пользователей ────────────────────────────────────────────────────

function balloonHtml(user) {
  const name = escapeHtml(user.name || 'Пользователь');
  // onerror-фолбэк здесь не сработает: ymaps вырезает обработчики из шаблонов балуна
  const avatar = escapeHtml(safeImageUrl(user.avatar, DEFAULT_AVATAR));
  const action = user.busy
    ? '<div class="balloon-busy">📵 Занято</div>'
    : `<button class="balloon-call" data-call-user="${escapeHtml(user.id)}">📞 Позвонить</button>`;
  return `
    <div class="balloon">
      <img class="balloon-avatar" src="${avatar}" alt="" />
      <div class="balloon-name">${name}</div>
      ${action}
    </div>`;
}

function applyAppearance(entry) {
  const { placemark, user } = entry;
  const name = user.name || 'Пользователь';
  placemark.options.set('preset', user.busy ? 'islands#redPersonIcon' : 'islands#bluePersonIcon');
  placemark.properties.set({
    hintContent:    escapeHtml(user.busy ? `${name} — Занято` : name),
    balloonContent: balloonHtml(user),
  });
}

// Добавляет или обновляет маркер. Поля, которых нет в patch, сохраняются.
export function upsertUserMarker(patch) {
  if (!ymap || patch.lat == null || patch.lng == null) return;
  const existing = markers.get(patch.id);
  if (existing) {
    existing.user = { ...existing.user, ...stripUndefined(patch) };
    existing.placemark.geometry.setCoordinates([existing.user.lat, existing.user.lng]);
    applyAppearance(existing);
    return;
  }
  const user = { busy: false, ...patch };
  const placemark = new window.ymaps.Placemark([user.lat, user.lng], {}, {});
  const entry = { placemark, user };
  applyAppearance(entry);
  ymap.geoObjects.add(placemark);
  markers.set(user.id, entry);
}

export function replaceUserMarkers(users) {
  if (!ymap) return;
  const keep = new Set(users.map((u) => u.id));
  for (const id of [...markers.keys()]) if (!keep.has(id)) removeUserMarker(id);
  users.forEach(upsertUserMarker);
}

export function removeUserMarker(userId) {
  const entry = markers.get(userId);
  if (!entry) return;
  ymap?.geoObjects.remove(entry.placemark);
  markers.delete(userId);
}

export function setUserBusy(userId, busy) {
  const entry = markers.get(userId);
  if (!entry || entry.user.busy === busy) return;
  entry.user.busy = busy;
  applyAppearance(entry);
}

export function isUserBusy(userId) {
  return markers.get(userId)?.user.busy ?? false;
}

// ── Мой маркер ───────────────────────────────────────────────────────────────

export function showMyMarker({ lat, lng }) {
  if (!ymap) return;
  if (myMarker) {
    myMarker.geometry.setCoordinates([lat, lng]);
    return;
  }
  myMarker = new window.ymaps.Placemark(
    [lat, lng],
    { iconContent: 'Я', hintContent: 'Моё местоположение' },
    { preset: 'islands#blueStretchyIcon', zIndex: 1000 },
  );
  ymap.geoObjects.add(myMarker);
}

export function panToMyMarker() {
  if (!ymap || !myMarker) return false;
  ymap.setCenter(myMarker.geometry.getCoordinates(), 15, { duration: 400 });
  return true;
}

function stripUndefined(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}
