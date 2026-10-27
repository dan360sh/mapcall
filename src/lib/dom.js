export const $ = (id) => document.getElementById(id);

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}

// Пропускает только безопасные схемы — иначе в src можно протащить javascript:
export function safeImageUrl(url, fallback) {
  return typeof url === 'string' && /^(https?:|data:image\/)/i.test(url) ? url : fallback;
}

export function setImage(img, url, fallback) {
  if (!img) return;
  img.onerror = () => { img.onerror = null; img.src = fallback; };
  img.src = safeImageUrl(url, fallback);
}

export function copyToClipboard(text, flashEl) {
  if (!text || !navigator.clipboard) return;
  navigator.clipboard.writeText(text).then(() => {
    if (!flashEl) return;
    flashEl.classList.add('copied');
    setTimeout(() => flashEl.classList.remove('copied'), 1200);
  }).catch(() => {});
}

let toastTimer = null;

export function showToast(text, ms = 3000) {
  const el = $('toast');
  if (!el) return;
  el.textContent = text;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), ms);
}
