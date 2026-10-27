// Гудки исходящего вызова (Web Audio, без файлов).

let ctx = null;
let timer = null;

function beep(freq, startTime, dur) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.frequency.value = freq;
  osc.type = 'sine';
  gain.gain.setValueAtTime(0.0001, startTime);
  gain.gain.exponentialRampToValueAtTime(0.1, startTime + 0.04);
  gain.gain.setValueAtTime(0.1, startTime + dur - 0.04);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + dur);
  osc.start(startTime);
  osc.stop(startTime + dur + 0.01);
}

function cycle() {
  if (!ctx) return;
  const t = ctx.currentTime;
  beep(440, t, 0.4);
  beep(440, t + 0.7, 0.4);
}

export function startRingtone() {
  stopRingtone();
  try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return; }
  cycle();
  timer = setInterval(cycle, 3000);
}

export function stopRingtone() {
  clearInterval(timer);
  timer = null;
  if (ctx) { ctx.close().catch(() => {}); ctx = null; }
}
