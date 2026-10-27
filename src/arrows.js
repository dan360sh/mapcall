// Полупрозрачные стрелки поверх камеры того, кому звонят.

export const DIRECTIONS = ['up', 'down', 'left', 'right', 'forward'];
const ARROW_VISIBLE_MS = 1500;
const timers = {};

export function showArrow(dir) {
  if (!DIRECTIONS.includes(dir)) return;
  const el = document.getElementById(`arrow-${dir}`);
  if (!el) return;
  el.classList.add('show');
  clearTimeout(timers[dir]);
  timers[dir] = setTimeout(() => el.classList.remove('show'), ARROW_VISIBLE_MS);
}

export function hideAllArrows() {
  DIRECTIONS.forEach((dir) => {
    clearTimeout(timers[dir]);
    document.getElementById(`arrow-${dir}`)?.classList.remove('show');
  });
}
