// Address search: an ARIA 1.2 combobox (input + listbox). The keyboard and screen-reader way to reach
// any building without touching the map: type, ↑/↓ to move, Enter to pick, Esc to close.
// Ranking: address starts with the text, then a word starts with it, then it appears anywhere.

import { esc, titleCase } from '../ui.js';

export function rankMatches(records, text, limit = 8) {
  const v = text.trim().toUpperCase().replace(/\s+/g, ' ');
  if (!v) return [];
  const out = [];
  for (const r of records) {
    const a = r.address.toUpperCase();
    const i = a.indexOf(v);
    if (i < 0) continue;
    const rank = i === 0 ? 0 : a[i - 1] === ' ' ? 1 : 2;
    out.push({ r, rank });
  }
  out.sort((x, y) => x.rank - y.rank || x.r.address.localeCompare(y.r.address, 'en', { numeric: true }));
  return out.slice(0, limit).map((x) => x.r);
}

export function initSearch(input, list, { source, onPick, describe }) {
  const status = document.createElement('p');
  status.className = 'visually-hidden';
  status.setAttribute('role', 'status');
  input.after(status);
  let items = [], active = -1;

  const close = () => {
    list.hidden = true; items = []; active = -1;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  };
  const paint = () => {
    list.querySelectorAll('[role=option]').forEach((li, i) => li.setAttribute('aria-selected', String(i === active)));
    if (active >= 0) { input.setAttribute('aria-activedescendant', `search-opt-${active}`); list.children[active]?.scrollIntoView({ block: 'nearest' }); }
    else input.removeAttribute('aria-activedescendant');
  };
  const open = () => {
    items = rankMatches(source(), input.value);
    active = items.length ? 0 : -1;
    if (!input.value.trim()) { close(); status.textContent = ''; return; }
    list.innerHTML = items.length
      ? items.map((r, i) => `<li role="option" id="search-opt-${i}" data-i="${i}"><b>${esc(titleCase(r.address))}</b><span>${describe(r)}</span></li>`).join('')
      : '<li class="search-none" aria-disabled="true">No evaluated building matches that address</li>';
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    status.textContent = items.length ? `${items.length} result${items.length === 1 ? '' : 's'}. Use the up and down arrows to choose.` : 'No results.';
    paint();
  };
  const pick = (i) => {
    const r = items[i];
    if (!r) return;
    input.value = '';
    close();
    status.textContent = `${titleCase(r.address)} selected.`;
    onPick(r);
  };

  input.addEventListener('input', open);
  input.addEventListener('focus', () => { if (input.value.trim()) open(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (list.hidden) open(); else { active = Math.min(items.length - 1, active + 1); paint(); } }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); paint(); }
    else if (e.key === 'Enter') { e.preventDefault(); if (list.hidden) open(); pick(Math.max(0, active)); }
    else if (e.key === 'Escape') { if (!list.hidden) { e.preventDefault(); e.stopPropagation(); close(); } else input.value = ''; }
  });
  input.addEventListener('blur', () => setTimeout(close, 120));
  list.addEventListener('mousedown', (e) => e.preventDefault()); // keep focus in the input
  list.addEventListener('click', (e) => { const li = e.target.closest('[data-i]'); if (li) pick(+li.dataset.i); });
  return { close, focus: () => input.focus() };
}
