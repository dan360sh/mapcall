// Обёртка над нативным плагином CallNotification (Android).
// На вебе и в Electron все методы — no-op, поэтому вызывающему коду не нужны проверки.

import { Capacitor, registerPlugin } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';

export const isNative = Capacitor.isNativePlatform();
const plugin = isNative ? registerPlugin('CallNotification') : null;

function invoke(method, args) {
  if (!plugin) return Promise.resolve();
  return plugin[method](args).catch((err) => console.warn(`[native] ${method} failed`, err));
}

export const native = {
  saveToken:              (token)   => invoke('saveToken', { token }),
  clearToken:             ()        => invoke('clearToken'),
  startBackground:        ()        => invoke('startBackground'),
  stopBackground:         ()        => invoke('stopBackground'),
  setVisible:             (visible) => invoke('setVisible', { visible }),
  showCallNotification:   (callerName) => invoke('showCallNotification', { callerName }),
  cancelCallNotification: ()        => invoke('cancelCallNotification'),

  // JS-сокет активен → нативный сервис отключает своё соединение, и наоборот.
  setJsWsActive(active, snapshot = {}) {
    return invoke('setJsWsActive', { active, ...snapshot });
  },

  onAppStateChange(cb) {
    if (isNative) CapApp.addListener('appStateChange', ({ isActive }) => cb(isActive));
  },
};
