// Semi-transparent arrow overlay for callee screen

const timers = {};

export function showArrow(dir) {
  const el = document.getElementById(`arrow-${dir}`);
  if (!el) return;
  el.classList.add('show');
  clearTimeout(timers[dir]);
  timers[dir] = setTimeout(() => el.classList.remove('show'), 1500);
}

export function hideAllArrows() {
  ['up', 'down', 'left', 'right', 'forward'].forEach(dir => {
    clearTimeout(timers[dir]);
    document.getElementById(`arrow-${dir}`)?.classList.remove('show');
  });
}
