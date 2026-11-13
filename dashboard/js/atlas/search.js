// Address search: an ARIA 1.2 combobox (input + listbox), shared by the header search and the Compare
// page's Building A / Building B fields. Type, ↑/↓ to move, Enter to pick, Esc to close.
// Ranking: the whole address, then the address starts with the text, then a word starts with it, then it
// appears anywhere. Common street words are matched in either form ("avenue" finds "AVE", "east" finds "E").
// A linear scan of ~3,500 short strings takes well under a millisecond, so typing is not debounced.

import { esc, titleCase } from '../ui.js';

const ABBR = {
  AVENUE: 'AVE', STREET: 'ST', ROAD: 'RD', DRIVE: 'DR', BOULEVARD: 'BLVD', CRESCENT: 'CRES', COURT: 'CRT',
  PLACE: 'PL', SQUARE: 'SQ', TERRACE: 'TER', PARKWAY: 'PKWY', GARDENS: 'GDNS', CIRCLE: 'CIR', LANE: 'LANE',
  TRAIL: 'TRL', HEIGHTS: 'HTS', GROVE: 'GRV', EAST: 'E', WEST: 'W', NORTH: 'N', SOUTH: 'S', SAINT: 'ST',
};
// Upper case, single spaces, no punctuation, long street words shortened to the City's forms.
export const normalizeAddress = (text) => text.toUpperCase().replace(/[.,#']/g, ' ').replace(/\s+/g, ' ').trim()
  .split(' ').map((w) => ABBR[w] ?? w).join(' ');

const normCache = new WeakMap(); // record → normalised address (the records themselves are never modified)
const normOf = (r) => { let a = normCache.get(r); if (a === undefined) normCache.set(r, (a = normalizeAddress(r.address))); return a; };

export function rankMatches(records, text, limit = 8) {
  const v = normalizeAddress(text);
  if (!v) return [];
  const out = [];
  for (const r of records) {
    const a = normOf(r);
    const i = a.indexOf(v);
    if (i < 0) continue;
    const rank = a === v ? -1 : i === 0 ? 0 : a[i - 1] === ' ' ? 1 : 2;
    out.push({ r, rank });
  }
  out.sort((x, y) => x.rank - y.rank || x.r.address.localeCompare(y.r.address, 'en', { numeric: true }));
  return out.slice(0, limit).map((x) => x.r);
}

let uid = 0;

// source()         the records to search
// describe(r)      the second line of an option (HTML)
// onPick(r)        a building was chosen
// suggest()        optional: { label, records } shown when the field is focused while empty
// noMatch(text)    optional: the message when nothing matches (HTML)
export function initSearch(input, list, { source, onPick, describe, suggest, noMatch, limit = 8 }) {
  const prefix = `cb${++uid}-opt-`;
  const status = document.createElement('p');
  status.className = 'visually-hidden';
  status.setAttribute('role', 'status');
  input.after(status);
  let items = [], active = -1;

  const close = () => {
    list.hidden = true; items = []; active = -1;
    list.classList.remove('is-up');
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  };
  const paint = () => {
    list.querySelectorAll('[role=option]').forEach((li, i) => li.setAttribute('aria-selected', String(i === active)));
    if (active >= 0) { input.setAttribute('aria-activedescendant', `${prefix}${active}`); list.querySelector(`#${prefix}${active}`)?.scrollIntoView({ block: 'nearest' }); }
    else input.removeAttribute('aria-activedescendant');
  };
  // The list never leaves the window: it takes the room below the field, or flips above it when there is
  // clearly more room there, and scrolls inside itself if the options need more than that.
  const place = () => {
    const box = input.getBoundingClientRect();
    const below = window.innerHeight - box.bottom - 12, above = box.top - 12;
    const up = below < 200 && above > below;
    list.classList.toggle('is-up', up);
    list.style.maxHeight = `${Math.max(120, Math.min(360, up ? above : below))}px`;
  };
  const option = (r, i) => `<li role="option" id="${prefix}${i}" data-i="${i}"><b>${esc(titleCase(r.address))}</b><span>${describe(r)}</span></li>`;
  const open = () => {
    const text = input.value.trim();
    let head = '';
    if (!text) {
      const s = suggest?.();
      if (!s?.records.length) { close(); status.textContent = ''; return; }
      items = s.records.slice(0, limit);
      head = `<li class="search-head" role="presentation">${esc(s.label)}</li>`;
      active = -1;
    } else {
      items = rankMatches(source(), text, limit);
      active = items.length ? 0 : -1;
    }
    list.innerHTML = items.length
      ? head + items.map(option).join('')
      : `<li class="search-none" aria-disabled="true">${noMatch?.(text) ?? 'No evaluated building matches that address'}</li>`;
    list.hidden = false;
    place();
    input.setAttribute('aria-expanded', 'true');
    status.textContent = items.length ? `${items.length} ${text ? 'result' : 'suggestion'}${items.length === 1 ? '' : 's'}. Use the up and down arrows to choose.` : 'No results.';
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
  input.addEventListener('focus', () => { if (input.value.trim() || suggest) open(); });
  input.addEventListener('click', () => { if (list.hidden && (input.value.trim() || suggest)) open(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (list.hidden) open(); else { active = Math.min(items.length - 1, active + 1); paint(); } }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); paint(); }
    else if (e.key === 'Enter') { e.preventDefault(); if (list.hidden) open(); else if (items.length) pick(Math.max(0, active)); }
    else if (e.key === 'Escape') { if (!list.hidden) { e.preventDefault(); e.stopPropagation(); close(); } else input.value = ''; }
  });
  input.addEventListener('blur', () => setTimeout(close, 120));
  list.addEventListener('mousedown', (e) => e.preventDefault()); // keep focus in the input
  list.addEventListener('click', (e) => { const li = e.target.closest('[data-i]'); if (li) pick(+li.dataset.i); });
  return { close, focus: () => input.focus() };
}
