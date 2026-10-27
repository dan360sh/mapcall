// Джойстик звонящего: 5 кнопок (вверх, вниз, влево, вправо, вперёд),
// перетаскивается за полоску сверху.
//
// Обработчики DOM вешаются один раз; setJoystickHandler(fn) включает
// отправку событий, setJoystickHandler(null) — выключает.

let onPress = null;
let initialized = false;

export function setJoystickHandler(handler) {
  init();
  onPress = handler;
  if (!handler) document.querySelectorAll('.joy.pressed').forEach((b) => b.classList.remove('pressed'));
}

function init() {
  if (initialized) return;
  initialized = true;

  document.querySelectorAll('.joy').forEach((btn) => {
    btn.addEventListener('pointerdown', handleDown);
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => btn.addEventListener(ev, handleUp));
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
  });

  const wrap = document.querySelector('.joystick-wrap');
  const handle = document.querySelector('.joystick-handle');
  if (wrap && handle) initDrag(wrap, handle);
}

function handleDown(e) {
  e.preventDefault();
  const btn = e.currentTarget;
  if (!onPress || btn.classList.contains('pressed')) return;
  btn.classList.add('pressed');
  onPress(btn.dataset.dir);
}

function handleUp(e) {
  e.currentTarget.classList.remove('pressed');
}

function initDrag(wrap, handle) {
  let drag = null; // { startX, startY, origLeft, origTop }

  handle.addEventListener('pointerdown', (e) => {
    handle.setPointerCapture(e.pointerId);
    // Переводим позицию в left/top, чтобы убрать bottom + transform из CSS
    const rect = wrap.getBoundingClientRect();
    Object.assign(wrap.style, { left: `${rect.left}px`, top: `${rect.top}px`, bottom: 'auto', transform: 'none' });
    drag = { startX: e.clientX, startY: e.clientY, origLeft: rect.left, origTop: rect.top };
    e.preventDefault();
  });

  handle.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const { width, height } = wrap.getBoundingClientRect();
    const left = clamp(drag.origLeft + e.clientX - drag.startX, 0, window.innerWidth - width);
    const top  = clamp(drag.origTop  + e.clientY - drag.startY, 0, window.innerHeight - height);
    wrap.style.left = `${left}px`;
    wrap.style.top  = `${top}px`;
  });

  const stop = () => { drag = null; };
  handle.addEventListener('pointerup', stop);
  handle.addEventListener('pointercancel', stop);
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}
