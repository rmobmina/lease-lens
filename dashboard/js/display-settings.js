// Display settings: theme, text size, contrast, typeface and motion, in one panel behind the header's
// "Display" button. Each setting is an attribute on <html> that tokens.css (and motion.js) read, so every
// page, chart, the map and the X-Ray follow it from the same place:
//
//   data-theme     light | dark          (absent: follow the system)
//   data-text      115 | 130             (absent: 100%; scales every --text-* and --chart-* size)
//   data-contrast  high                  (stronger text, borders, gridlines and chart greys; links underlined)
//   data-font      legible               (Atkinson Hyperlegible, loaded only when chosen)
//   data-motion    reduce                (absent: follow the system; motion.js and the CSS both honour it)
//
// Saved per browser under one key. index.html applies the saved values before the first paint (the same
// rules as apply() below, kept short there), so a reload never flashes the defaults. Works with storage
// blocked: the choices then last until the page is closed.

export const KEY = 'lease-lens-display';
const LEGACY_THEME_KEY = 'lease-lens-theme';
export const DEFAULTS = Object.freeze({ theme: 'system', text: '100', contrast: 'standard', font: 'brand', motion: 'system' });
const ALLOWED = {
  theme: ['system', 'light', 'dark'],
  text: ['100', '115', '130'],
  contrast: ['standard', 'high'],
  font: ['brand', 'legible'],
  motion: ['system', 'reduce'],
};
const LEGIBLE_FONT = 'https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:ital,wght@0,400;0,700;1,400&display=swap';

// Only known values survive, so a hand-edited or outdated entry can never break the page.
export function clean(raw) {
  const s = { ...DEFAULTS };
  for (const k of Object.keys(ALLOWED)) if (raw && ALLOWED[k].includes(String(raw[k]))) s[k] = String(raw[k]);
  return s;
}

export function read() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (raw) return clean(raw);
    const t = localStorage.getItem(LEGACY_THEME_KEY);   // the old light/dark toggle's choice carries over
    return clean({ theme: t });
  } catch { return { ...DEFAULTS }; }
}

export function save(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); localStorage.removeItem(LEGACY_THEME_KEY); } catch { /* storage unavailable */ }
}

export function apply(s, root = document.documentElement) {
  const set = (name, v) => { if (v) root.dataset[name] = v; else delete root.dataset[name]; };
  set('theme', s.theme === 'system' ? null : s.theme);
  set('text', s.text === '100' ? null : s.text);
  set('contrast', s.contrast === 'high' ? 'high' : null);
  set('font', s.font === 'legible' ? 'legible' : null);
  set('motion', s.motion === 'reduce' ? 'reduce' : null);
  if (s.font === 'legible') loadLegibleFont();
}

function loadLegibleFont() {
  if (document.getElementById('font-legible')) return;
  const l = document.createElement('link');
  l.id = 'font-legible'; l.rel = 'stylesheet'; l.href = LEGIBLE_FONT;
  document.head.append(l);
}

export const isDark = (root = document.documentElement) =>
  (root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches);
