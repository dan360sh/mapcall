// Элементы управления на экране карты: видимость, ближайший человек,
// координаты центра карты, «где я».

import { state, referencePos } from './state.js';
import { centerOn, panToMyMarker } from './map.js';
import { $, copyToClipboard, showToast } from './lib/dom.js';
import { haversineKm, formatDistance, formatCoords } from './lib/geo.js';
import { requestPermissionAgain, lookupIpPosition } from './location.js';

let nearestId = null;
let onToggleVisibleCb = () => {};

export function findNearest() {
  const ref = referencePos();
  if (!ref) return null;
  let best = null;
  for (const u of state.users.values()) {
    if (u.lat == null || u.id === state.userId) continue;
    const dist = haversineKm(ref.lat, ref.lng, u.lat, u.lng);
    if (!best || dist < best.dist) best = { ...u, dist };
  }
  return best;
}

export function renderVisibility() {
  const btn = $('btn-toggle-visible');
  const label = $('toggle-label');
  const icon = btn.querySelector('.toggle-icon');
  const denied = state.geoPermission === 'denied';

  btn.classList.toggle('geo-denied', denied);
  btn.classList.toggle('active', !denied && state.isVisible);
  icon.textContent = denied ? '📍' : '👁';
  label.textContent = denied
    ? 'Разрешить геолокацию'
    : state.isVisible ? 'Скрыться с карты' : 'Показаться на карте';
}

export function renderNearest() {
  const label = $('nearest-btn-label');
  const coords = $('nearest-coords');
  const btn = $('btn-find-nearest');

  // Без точки отсчёта показываем хоть кого-то
  const target = findNearest() ?? [...state.users.values()][0] ?? null;
  nearestId = target?.id ?? null;
  btn.classList.toggle('has-nearest', !!target);
  coords.classList.toggle('hidden', !target);

  if (!target) {
    label.textContent = 'Нет людей рядом';
    return;
  }
  const name = target.name || 'Пользователь';
  label.textContent = target.dist != null ? `${name} (${formatDistance(target.dist)})` : name;
  $('nearest-coords-text').textContent = formatCoords(target.lat, target.lng);
}

export function renderCenterCoords({ lat, lng }) {
  $('focus-coords-text').textContent = formatCoords(lat, lng);
  $('focus-coords').classList.remove('hidden');
}

export function initControls({ onToggleVisible }) {
  onToggleVisibleCb = onToggleVisible;

  $('btn-toggle-visible').addEventListener('click', async () => {
    if (state.geoPermission === 'denied') {
      if (!(await requestPermissionAgain())) {
        showToast('Разрешите геолокацию в настройках устройства', 4000);
      }
      return;
    }
    onToggleVisibleCb(!state.isVisible);
  });

  $('btn-find-nearest').addEventListener('click', () => {
    const user = nearestId ? state.users.get(nearestId) : null;
    if (user) centerOn(user, 15);
    else if (!referencePos()) lookupIpPosition();
  });

  $('btn-locate-me').addEventListener('click', () => {
    if (!panToMyMarker()) showToast('Местоположение ещё не определено');
  });

  for (const id of ['focus-coords', 'nearest-coords']) {
    const el = $(id);
    el.addEventListener('click', () => copyToClipboard(el.textContent.trim(), el));
  }
}
