// Yandex Maps integration

let ymap = null;
const markers = {}; // userId → ymaps.Placemark
let myMarker = null;
let markerClickCb = null;

export function setOnMarkerClick(cb) {
  markerClickCb = cb;
}

export async function initMap() {
  await loadYandexMaps(import.meta.env.VITE_YANDEX_MAPS_KEY || '');

  // Получаем геолокацию ДО создания карты — как в примере из документации
  const mapEl = document.getElementById('ymap');
  let center = [55.7558, 37.6173];
  let zoom = 10;

  try {
    const result = await Promise.race([
      ymaps.geolocation.get({ provider: 'yandex' }),
      new Promise((_, rej) => setTimeout(rej, 4000)),
    ]);
    const bounds = result.geoObjects.get(0)?.properties.get('boundedBy');
    if (bounds) {
      const state = ymaps.util.bounds.getCenterAndZoom(
        bounds, [mapEl.offsetWidth || 800, mapEl.offsetHeight || 600]
      );
      center = state.center;
      zoom = Math.min(state.zoom, 12);
    }
  } catch {
    // Yandex IP не сработал — пробуем браузерный GPS
    await new Promise((resolve) => {
      if (!navigator.geolocation) { resolve(); return; }
      navigator.geolocation.getCurrentPosition(
        ({ coords }) => { center = [coords.latitude, coords.longitude]; zoom = 14; resolve(); },
        () => resolve(),
        { timeout: 6000, maximumAge: 60000 }
      );
    });
  }

  ymap = new ymaps.Map('ymap', { center, zoom, controls: ['zoomControl'] });
  window.__ymap = ymap;
}

function loadYandexMaps(apiKey) {
  return new Promise((resolve, reject) => {
    if (window.ymaps) { ymaps.ready(resolve); return; }
    const s = document.createElement('script');
    s.src = `https://api-maps.yandex.ru/2.1/?apikey=${encodeURIComponent(apiKey)}&lang=ru_RU`;
    s.onload = () => ymaps.ready(resolve);
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

export function updateUsers(users, merge = false) {
  if (!ymap) return;

  if (!merge) {
    Object.values(markers).forEach(m => ymap.geoObjects.remove(m));
    Object.keys(markers).forEach(k => delete markers[k]);
  }

  users.forEach(user => {
    if (user.lat == null || user.lng == null) return;

    if (markers[user.id]) {
      markers[user.id].geometry.setCoordinates([user.lat, user.lng]);
      return;
    }

    const pm = new ymaps.Placemark(
      [user.lat, user.lng],
      {
        hintContent: user.name || 'Пользователь',
        balloonContent: `
          <div style="text-align:center;padding:8px">
            <img src="${user.avatar || ''}" style="width:40px;height:40px;border-radius:50%;margin-bottom:6px" />
            <div style="font-weight:700">${user.name || ''}</div>
            <button
              onclick="window.__callUser('${user.id}','${(user.name || '').replace(/'/g, '\\\'')}')"
              style="margin-top:8px;padding:6px 14px;background:#4a90e2;color:#fff;border:none;border-radius:20px;cursor:pointer;font-weight:600">
              📞 Позвонить
            </button>
          </div>`,
      },
      {
        preset: 'islands#bluePersonIcon',
      }
    );

    pm.events.add('click', () => {
      markerClickCb?.(user.id, user.name);
    });

    ymap.geoObjects.add(pm);
    markers[user.id] = pm;
  });
}

export function removeUserMarker(userId) {
  if (markers[userId]) {
    ymap.geoObjects.remove(markers[userId]);
    delete markers[userId];
  }
}

export function showMyMarker(lat, lng) {
  if (!ymap) return;
  if (myMarker) {
    myMarker.geometry.setCoordinates([lat, lng]);
    return;
  }
  myMarker = new ymaps.Placemark(
    [lat, lng],
    { hintContent: 'Я' },
    {
      preset: 'islands#blueCircleIcon',
      iconColor: '#4a90e2',
    }
  );
  ymap.geoObjects.add(myMarker);
  ymap.setCenter([lat, lng], 15);
}

export function hideMyMarker() {
  if (myMarker && ymap) {
    ymap.geoObjects.remove(myMarker);
    myMarker = null;
  }
}
