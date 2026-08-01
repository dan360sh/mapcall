// Joystick UI — 5 buttons: up, down, left, right, forward
// Sends direction events via callback on press (not release)

let onPressCb = null;

export function initJoystick(onPress) {
  onPressCb = onPress;
  document.querySelectorAll('.joy').forEach(btn => {
    btn.addEventListener('pointerdown', handleDown);
    btn.addEventListener('pointerup', handleUp);
    btn.addEventListener('pointerleave', handleUp);
    btn.addEventListener('contextmenu', e => e.preventDefault());
  });
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
