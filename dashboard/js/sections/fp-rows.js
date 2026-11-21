// Compare buildings: the shared item rows. One row per inspection item with three columns (the item, Building A's
// rating, Building B's rating), used by "Every item" (the whole matrix) and by "By category" (one area's rows when
// it is opened), so an item always reads the same way wherever it appears.
//
// A rating is a compact numbered cell in a fixed position. Low ratings (that building's own low range) are
// maple red, with the number always visible; 2 and 3 stay neutral. A real 0 is a filled cell; every missing state
// is a word, never a number or an empty box: "N/A", "No rating recorded", "Not in this scoring system".

import { esc, titleCase, pct, tip, anchorEvent } from '../ui.js';
import { SCALES } from '../fingerprint-model.js';

const MISSING = { na: 'N/A', blank: 'No rating recorded', absent: 'Not in this scoring system' };
const MISSING_LONG = { na: 'N/A: doesn’t apply here, not counted', blank: 'No rating recorded', absent: 'Not in this building’s scoring system' };

// the colour step of a rating on its own system's scale: lowest, other low, below the top, top
const step = (v, S) => (v <= S.lowMax ? (v === S.min ? 'r-lowest' : 'r-low') : v === S.max ? 'r-top' : 'r-mid');

export function ratingCell(c, S, slot) {
  const who = `<span class="fp-r-who" aria-hidden="true">${slot.toUpperCase()}</span>`;
  if (c.status !== 'rated') return `${who}<span class="fp-r-miss is-${c.status}">${MISSING[c.status]}</span>`;
  return `${who}<span class="fp-r-num ${step(c.rating, S)}">${c.rating}</span><span class="visually-hidden"> of ${S.max}${c.low ? ', rated low' : ''}</span>`;
}

// Rows for one area. `P` = { a, b } profiles; `rows` = pairRows(…)[i].rows (already filtered by the caller).
export function rowsHtml(rows, P) {
  const twoSystems = P.a.era !== P.b.era;
  return rows.map((r) => `<tr class="fp-m-row${r.low ? ' has-low' : ''}${r.diff ? ' is-diff' : ''}" data-col="${esc(r.col)}">
      <th scope="row" class="fp-m-item"><button type="button" class="fp-item" data-col="${esc(r.col)}">${esc(r.label)}</button>${twoSystems && r.system !== 'both' ? `<span class="fp-sys">${SCALES[r.system].system} item</span>` : ''}</th>
      <td class="fp-r" data-slot="a">${ratingCell(r.a, P.a.scale, 'a')}</td>
      <td class="fp-r" data-slot="b">${ratingCell(r.b, P.b.scale, 'b')}</td>
    </tr>`).join('');
}

// The column header: which building each rating column is, its score, and its scale.
export function colHead(P, slot) {
  const p = P[slot];
  return `<span class="fp-h-tag">${slot.toUpperCase()}</span><span class="fp-h-name">${esc(titleCase(p.rec.address))}</span><span class="fp-h-sub">${p.rec.score}/100${P.a.era !== P.b.era ? ` · rated ${p.scale.range}` : ''}</span>`;
}

// Item details on hover, keyboard focus and tap: the City's item name, both ratings and, for current-system items,
// how often Toronto buildings got a low rating on it.
export function bindItemTips(root, groups, P, live) {
  const byCol = new Map(groups.flatMap((g) => g.rows).map((r) => [r.col, r]));
  const hot = (col) => root.querySelectorAll('.fp-m-row').forEach((tr) => tr.classList.toggle('is-hot', tr.dataset.col === col));
  root.querySelectorAll('.fp-item').forEach((btn) => {
    const r = byCol.get(btn.dataset.col);
    if (!r) return;
    const val = (c, S) => (c.status === 'rated' ? `<b>${c.rating}</b> of ${S.max}${c.low ? ' (low)' : ''}` : MISSING_LONG[c.status]);
    const html = `<div class="tt-title">${esc(r.label)}</div>
      <div class="tt-sub">${esc(r.stat.groupLabel)} · City item name: ${esc(r.stat.official)}</div>
      <dl><dt>A · ${esc(titleCase(P.a.rec.address))}</dt><dd>${val(r.a, P.a.scale)}</dd>
        <dt>B · ${esc(titleCase(P.b.rec.address))}</dt><dd>${val(r.b, P.b.scale)}</dd>
        ${r.stat.rated ? `<dt>Toronto</dt><dd>${pct(r.stat.lowShare, 1)} of buildings rated it 0 or 1</dd>` : ''}</dl>`;
    const spoken = () => `${r.label}: Building A ${r.a.status === 'rated' ? `${r.a.rating} of ${P.a.scale.max}` : MISSING[r.a.status]}; Building B ${r.b.status === 'rated' ? `${r.b.rating} of ${P.b.scale.max}` : MISSING[r.b.status]}.`;
    const show = () => { hot(r.col); tip.show(html, anchorEvent(btn)); if (live) live.textContent = spoken(); };
    const hide = () => { hot(null); tip.hide(); };
    btn.addEventListener('mouseenter', show);
    btn.addEventListener('mouseleave', hide);
    btn.addEventListener('focus', show);
    btn.addEventListener('blur', hide);
    btn.addEventListener('click', show);   // touch
  });
}
