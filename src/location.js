// Геолокация: GPS через Capacitor + запасной вариант по IP.

import { Geolocation } from '@capacitor/geolocation';
import { MAX_GPS_ACCURACY_M, STORAGE } from './config.js';
import { state } from './state.js';

const PERMISSION_DENIED = 1;

let watchId = null;
let generation = 0;
let listeners = { onPosition: () => {}, onPermission: () => {}, onIpPosition: () => {} };
let ipLookup = null;

export function initLocation(callbacks) {
  listeners = { ...listeners, ...callbacks };
}

export function lastKnownPosition() {
  const lat = parseFloat(localStorage.getItem(STORAGE.lastLat));
  const lng = parseFloat(localStorage.getItem(STORAGE.lastLng));
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

function setPermission(value) {
  if (state.geoPermission === value) return;
  state.geoPermission = value;
  listeners.onPermission(value);
}

function markDenied() {
  setPermission('denied');
  lookupIpPosition();
}

async function permissionDenied() {
  try {
    const status = await Geolocation.checkPermissions();
    if (status?.location === 'denied') return true;
  } catch { /* на вебе может быть не реализовано */ }
  try {
    const status = await Geolocation.requestPermissions();
    return status?.location === 'denied';
  } catch {
    return false; // на вебе разрешение запросит сам браузер при watchPosition
  }
}

export async function startTracking() {
  const run = ++generation; // защита от параллельных вызовов — иначе два watch
  await stopTracking();
  const denied = await permissionDenied();
  if (run !== generation) return;
  if (denied) { markDenied(); return; }

  try {
    const id = await Geolocation.watchPosition(
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 30_000 },
      (position, err) => {
        if (err || !position) {
          console.warn('[geo] error', err);
          if (err?.code === PERMISSION_DENIED || /deni/i.test(err?.message ?? '')) markDenied();
          else if (!state.myPos) lookupIpPosition(); // нет фикса — хотя бы примерная позиция
          return;
        }
        setPermission('granted');

        const { latitude: lat, longitude: lng, accuracy } = position.coords;
        if (accuracy > MAX_GPS_ACCURACY_M) return;

        state.myPos = { lat, lng };
        localStorage.setItem(STORAGE.lastLat, String(lat));
        localStorage.setItem(STORAGE.lastLng, String(lng));
        listeners.onPosition(state.myPos);
      },
    );
    if (run !== generation) {
      await Geolocation.clearWatch({ id }).catch(() => {});
      return;
    }
    watchId = id;
  } catch (err) {
    console.warn('[geo] watchPosition failed', err);
    lookupIpPosition();
  }
}

export async function stopTracking() {
  if (watchId === null) return;
  const id = watchId;
  watchId = null;
  await Geolocation.clearWatch({ id }).catch(() => {});
}

// Повторный запрос разрешения (кнопка «Разрешить геолокацию»). true — если выдано.
export async function requestPermissionAgain() {
  try {
    const status = await Geolocation.requestPermissions();
    if (status?.location === 'denied') return false;
  } catch { /* веб — пробуем запустить слежение */ }
  setPermission('unknown');
  startTracking();
  return true;
}

export function lookupIpPosition() {
  ipLookup ??= fetch('https://ipapi.co/json/')
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then((d) => {
      if (!Number.isFinite(d.latitude) || !Number.isFinite(d.longitude)) throw new Error('no coords');
      state.ipPos = { lat: d.latitude, lng: d.longitude };
      listeners.onIpPosition(state.ipPos);
    })
    .catch((err) => {
      console.warn('[geo] ip lookup failed', err.message);
      ipLookup = null; // разрешаем повторить позже
    });
  return ipLookup;
}
