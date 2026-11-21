// By category: the comparison at a glance.
//
// One row per inspection area. In each row, Building A's bar sits directly above Building B's, both growing from
// the same left edge on ONE scale: the share of that area's rated items that were rated low. Each bar is labelled
// with its count and its denominator ("2 of 12"); N/A and missing ratings are never in the denominator, and an
// area with nothing rated says "No rated items" instead of drawing a zero.
//
// Only the rows where the two buildings differ most are drawn in maple; the rest stay grey, so the eye goes to the
// real differences (a row is emphasised only if the low-rated counts differ, never an invented gap). Selecting an
// area opens its items as the same shared rows "Every item" uses (fp-rows.js).
//
// Bars keep their previous widths and ease to the new ones, so picking another pair moves them instead of redrawing.

import { esc, titleCase, pct } from '../ui.js';
import { pairedProfile, pairRows } from '../fingerprint-model.js';
import { rowsHtml, colHead, bindItemTips } from './fp-rows.js';
import { reducedMotion } from '../motion.js';

let openKey = null;
const prevW = new Map();   // `${area}:${slot}` → the width drawn last

export function renderProfile(box, pa, pb) {
  if (!pa || !pb) { box.innerHTML = ''; box.hidden = true; return; }
  box.hidden = false;
  const { rows, domain } = pairedProfile(pa, pb);
  const groups = pairRows(pa, pb);
  const P = { a: pa, b: pb };
  const twoSystems = pa.era !== pb.era;
  if (twoSystems) rows.forEach((r) => { r.strong = false; });   // no "biggest difference" across two rating scales
  if (openKey && !rows.some((r) => r.key === openKey)) openKey = null;

  const name = (p) => esc(titleCase(p.rec.address));
  const val = (g) => (g.rated ? `<b>${g.low}</b> of ${g.rated}` : '<span class="pf-none">No rated items</span>');
  const width = (g) => (g.rated ? Math.max(0, Math.min(100, (g.low / g.rated / domain) * 100)) : 0);
  const bar = (r, slot) => {
    const g = r[slot], key = `${r.key}:${slot}`;
    return `<div class="pf-bar-row${g.rated ? '' : ' is-none'}" data-slot="${slot}">
        <span class="pf-who" aria-hidden="true">${slot.toUpperCase()}</span>
        <span class="pf-track" data-key="${key}" style="--w:${(prevW.get(key) ?? 0).toFixed(2)}%" data-w="${width(g).toFixed(2)}"><span class="pf-bar"></span></span>
        <span class="pf-val">${val(g)}</span>
      </div>`;
  };
  const spoken = (g) => (g.rated ? `${g.low} of ${g.rated} rated low` : 'no rated items');

  box.innerHTML = `<table class="pf"><colgroup><col class="pf-col-area" /><col /></colgroup>
    <caption class="pf-cap">Share of each area’s rated items rated low${twoSystems ? ', each on its own system’s scale (0–1 of 3, or 1–2 of 5)' : ' (0 or 1 of 3)'}. A and B share one scale; N/A and missing ratings are left out. Select an area to see its items.</caption>
    <thead><tr>
      <th scope="col" class="pf-h-area">Inspection area</th>
      <th scope="col" class="pf-h-bars"><span class="pf-key"><b>A</b> ${name(pa)}</span><span class="pf-key"><b>B</b> ${name(pb)}</span></th>
    </tr></thead>
    <tbody>${rows.map((r, i) => `
      <tr class="pf-row${r.strong ? ' is-strong' : ''}" data-key="${r.key}">
        <th scope="row" class="pf-area"><button type="button" class="pf-row-btn" data-key="${r.key}" aria-expanded="false" aria-controls="pf-items-${r.key}"
          aria-label="${esc(r.label)}: Building A ${spoken(r.a)}, Building B ${spoken(r.b)}. Show the items."><span class="pf-label">${esc(r.label)}</span><span class="pf-chev" aria-hidden="true"></span></button></th>
        <td class="pf-bars">${bar(r, 'a')}${bar(r, 'b')}</td>
      </tr>
      <tr class="pf-items" id="pf-items-${r.key}" data-key="${r.key}" hidden><td colspan="2">
        <table class="fp-rows"><thead><tr><th scope="col" class="fp-m-h-item">Item</th><th scope="col" class="fp-m-h">${colHead(P, 'a')}</th><th scope="col" class="fp-m-h">${colHead(P, 'b')}</th></tr></thead>
        <tbody>${groups[i].rows.length ? rowsHtml(groups[i].rows, P) : '<tr><td colspan="3" class="pf-none">No items in this area for either building.</td></tr>'}</tbody></table>
      </td></tr>`).join('')}</tbody>
    <tfoot aria-hidden="true"><tr><td></td><td><div class="pf-axis"><span>0</span><span>${pct(domain / 2)}</span><span>${pct(domain)}</span></div></td></tr></tfoot></table>`;

  const table = box.querySelector('table');
  table.addEventListener('click', (e) => {
    const btn = e.target.closest('.pf-row-btn');
    if (!btn) return;
    openKey = openKey === btn.dataset.key ? null : btn.dataset.key;
    syncOpen(table);
  });
  bindItemTips(table, groups, P, document.getElementById('fp-live'));
  // the bars ease from their last widths to the new ones
  const tracks = [...table.querySelectorAll('.pf-track')];
  const set = () => tracks.forEach((t) => { t.style.setProperty('--w', `${t.dataset.w}%`); prevW.set(t.dataset.key, +t.dataset.w); });
  if (reducedMotion()) set(); else requestAnimationFrame(() => requestAnimationFrame(set));
  syncOpen(table, false);
}

function syncOpen(table, animate = true) {
  table.querySelectorAll('.pf-row').forEach((tr) => {
    const on = tr.dataset.key === openKey;
    tr.classList.toggle('is-open', on);
    tr.querySelector('.pf-row-btn').setAttribute('aria-expanded', String(on));
    const items = tr.nextElementSibling;
    const was = !items.hidden;
    items.hidden = !on;
    if (on && !was && animate && !reducedMotion()) items.animate([{ opacity: 0, transform: 'translateY(-4px)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)' });
  });
  fitRows(table);
}

// The comparison is the page's main visual: its area rows share the panel's free height (up to 76 px a row) instead
// of leaving a blank band under a short chart. With an area open, rows keep their compact height and the panel
// scrolls inside itself.
function fitRows(table) {
  const panel = table.closest('.fp-panel');
  table.style.removeProperty('--pf-h');
  if (!panel || !panel.clientHeight || openKey || document.body.classList.contains('is-story')) return;
  const rows = table.querySelectorAll('.pf-row');
  const first = rows[0]?.querySelector('.pf-bars');
  if (!first) return;
  const pad = parseFloat(getComputedStyle(panel).paddingBottom) || 0;
  const free = panel.getBoundingClientRect().bottom - pad - table.getBoundingClientRect().bottom - 2;
  if (free < rows.length) return;
  table.style.setProperty('--pf-h', `${Math.min(76, first.offsetHeight + Math.floor(free / rows.length))}px`);
}

// after a resize: the rows are fitted again to the new panel
export function refitProfile(box) {
  const table = box?.querySelector('table.pf');
  if (table) fitRows(table);
}
