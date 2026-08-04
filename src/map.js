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

  ymap = new ymaps.Map('ymap', { center: [55.7558, 37.6173], zoom: 10, controls: ['zoomControl'] });
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
      { preset: 'islands#bluePersonIcon' }
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
    { iconContent: 'Я', hintContent: 'Моё местоположение' },
    { preset: 'islands#blueStretchyIcon', zIndex: 1000 }
  );
  ymap.geoObjects.add(myMarker);
}

export function hideMyMarker() {
  if (myMarker && ymap) {
    ymap.geoObjects.remove(myMarker);
    myMarker = null;
  }
}

export function panToMyMarker() {
  if (!ymap || !myMarker) return;
  const coords = myMarker.geometry.getCoordinates();
  ymap.setCenter(coords, 15, { duration: 400 });
}
