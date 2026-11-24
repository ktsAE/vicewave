const drawings = {
  power: '<path d="M12 2v9M6.3 5.8a8.5 8.5 0 1 0 11.4 0"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
  antenna:
    '<circle cx="12" cy="12" r="1.4" fill="currentColor"/><path d="M8.5 8.5a5 5 0 0 0 0 7m7-7a5 5 0 0 1 0 7M5.4 5.4a9 9 0 0 0 0 13.2m13.2-13.2a9 9 0 0 1 0 13.2"/>',
  list: '<path d="M9 6h12M9 12h12M9 18h12M3 6h.5M3 12h.5M3 18h.5"/>',
  pin: '<path d="M19 10c0 5-7 11-7 11s-7-6-7-11a7 7 0 0 1 14 0Z"/><circle cx="12" cy="10" r="2"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
  link: '<path d="M14 4h6v6m-1-5L10 14m0-9H5v14h14v-5"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
};
export function icon(name) {
  return (
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    (drawings[name] || '') +
    '</svg>'
  );
}
export function decorate(scope = document) {
  scope.querySelectorAll('[data-icon]').forEach((e) => (e.innerHTML = icon(e.dataset.icon)));
}
export const el = (id) => document.getElementById(id);
export const esc = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
export const norm = (value) =>
  String(value ?? '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
export function read(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem('vicewave:' + key)) ?? fallback;
  } catch {
    return fallback;
  }
}
export function save(key, value) {
  try {
    localStorage.setItem('vicewave:' + key, JSON.stringify(value));
  } catch {}
}
export function outside(url, label) {
  if (!/^https:\/\//.test(url || '')) return '';
  return (
    '<a href="' +
    esc(url) +
    '" target="_blank" rel="noopener noreferrer">' +
    esc(label) +
    ' ' +
    icon('link') +
    '</a>'
  );
}
