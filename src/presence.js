// Синхронизация списка пользователей на карте с сервером.

import { on } from './signaling.js';
import { state } from './state.js';
import { replaceUserMarkers, upsertUserMarker, removeUserMarker, setUserBusy } from './map.js';

export function initPresence({ onChange }) {
  on('users-list', (users) => {
    state.users.clear();
    users.forEach((u) => { if (u.lat != null) state.users.set(u.id, u); });
    replaceUserMarkers([...state.users.values()]);
    onChange();
  });

  on('user-appeared', (u) => {
    if (u.lat == null || u.id === state.userId) return;
    state.users.set(u.id, { ...state.users.get(u.id), ...u });
    upsertUserMarker(u);
    onChange();
  });

  on('user-disappeared', ({ id }) => {
    state.users.delete(id);
    removeUserMarker(id);
    onChange();
  });

  on('user-moved', ({ id, lat, lng }) => {
    const u = state.users.get(id);
    if (!u) return;
    u.lat = lat;
    u.lng = lng;
    upsertUserMarker({ id, lat, lng });
    onChange();
  });

  on('user-busy', ({ id }) => updateBusy(id, true));
  on('user-free', ({ id }) => updateBusy(id, false));
}

function updateBusy(id, busy) {
  const u = state.users.get(id);
  if (u) u.busy = busy;
  setUserBusy(id, busy);
}
