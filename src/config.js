// Конфигурация клиента — единственное место, где читаются env-переменные.

export const SERVER_URL = (import.meta.env.VITE_SERVER_URL || window.location.origin).replace(/\/+$/, '');
export const WS_URL = `${SERVER_URL.replace(/^http/, 'ws')}/ws`;
export const YANDEX_MAPS_KEY = import.meta.env.VITE_YANDEX_MAPS_KEY || '';

export const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'turn:157.22.253.103:3478', username: 'mapcall', credential: 'turn_pass_mc24' },
];

export const STORAGE = {
  token:   'mapcall_token',
  visible: 'mapcall_visible',
  lastLat: 'mapcall_last_lat',
  lastLng: 'mapcall_last_lng',
};

export const OUTGOING_CALL_TIMEOUT_MS = 45_000;
export const RTC_DISCONNECT_GRACE_MS  = 5_000;
export const MAX_GPS_ACCURACY_M       = 1_000;
export const DEFAULT_CENTER           = [55.7558, 37.6173];
