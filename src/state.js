// Общее состояние приложения (без UI). Модули читают его напрямую,
// изменения делаются только через функции владельцев (location, presence).

import { STORAGE } from './config.js';

export const state = {
  userId:        null,
  myPos:         null,        // { lat, lng } — GPS
  ipPos:         null,        // { lat, lng } — грубая позиция по IP
  geoPermission: 'unknown',   // 'unknown' | 'granted' | 'denied'
  isVisible:     localStorage.getItem(STORAGE.visible) === '1',
  users:         new Map(),   // userId → { id, name, avatar, lat, lng, busy }
};

export function setVisible(visible) {
  state.isVisible = visible;
  localStorage.setItem(STORAGE.visible, visible ? '1' : '0');
}

export function referencePos() {
  return state.myPos ?? state.ipPos;
}
