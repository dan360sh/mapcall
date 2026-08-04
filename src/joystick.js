// Joystick UI — 5 buttons: up, down, left, right, forward
// Draggable via the handle strip at the top

let onPressCb = null;

export function initJoystick(onPress) {
  onPressCb = onPress;

  document.querySelectorAll('.joy').forEach(btn => {
    btn.addEventListener('pointerdown', handleDown);
    btn.addEventListener('pointerup', handleUp);
    btn.addEventListener('pointerleave', handleUp);
    btn.addEventListener('contextmenu', e => e.preventDefault());
  });

  const wrap = document.querySelector('.joystick-wrap');
  const handle = document.querySelector('.joystick-handle');
  if (wrap && handle) initDrag(wrap, handle);
}

export function destroyJoystick() {
  document.querySelectorAll('.joy').forEach(btn => {
    btn.removeEventListener('pointerdown', handleDown);
    btn.removeEventListener('pointerup', handleUp);
    btn.removeEventListener('pointerleave', handleUp);
    btn.classList.remove('pressed');
  });
  onPressCb = null;
}

function handleDown(e) {
  e.preventDefault();
  const btn = e.currentTarget;
  if (btn.classList.contains('pressed')) return;
  btn.classList.add('pressed');
  onPressCb?.(btn.dataset.dir);
}

function handleUp(e) {
  e.currentTarget.classList.remove('pressed');
}

function initDrag(wrap, handle) {
  let dragging = false;
  let startX, startY, origLeft, origTop;

  handle.addEventListener('pointerdown', (e) => {
    dragging = true;
    handle.setPointerCapture(e.pointerId);

    // Конвертируем текущую позицию в left/top чтобы убрать bottom+transform
    const rect = wrap.getBoundingClientRect();
    wrap.style.left   = rect.left + 'px';
    wrap.style.top    = rect.top  + 'px';
    wrap.style.bottom = 'auto';
    wrap.style.transform = 'none';

    startX = e.clientX;
    startY = e.clientY;
    origLeft = rect.left;
    origTop  = rect.top;
    e.preventDefault();
  });

  handle.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    // Не выходить за края экрана
    const W = window.innerWidth;
    const H = window.innerHeight;
    const wRect = wrap.getBoundingClientRect();
    const newLeft = Math.max(0, Math.min(W - wRect.width,  origLeft + dx));
    const newTop  = Math.max(0, Math.min(H - wRect.height, origTop  + dy));

    wrap.style.left = newLeft + 'px';
    wrap.style.top  = newTop  + 'px';
  });

  handle.addEventListener('pointerup',     () => { dragging = false; });
  handle.addEventListener('pointercancel', () => { dragging = false; });
}
