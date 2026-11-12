// Paired inspection profile: the comparison at a glance.
//
// One row per inspection area, the same five rows for both buildings. Building A's bar grows left from
// the centre and Building B's grows right, both on ONE scale: the share of that area's rated items that
// were rated low (0 or 1 of 3). Equal overall scores, unequal rows: that is the finding.
//
// Only the rows where the two buildings differ most are drawn in the strong colour; the rest stay grey,
// so the eye goes to the real differences (never invented ones: a row is emphasised only if the gap is
// at least one item and the largest or second-largest). Selecting a row opens its low-rated items
// (progressive disclosure); the full item grids stay below on the Compare page.
//
// Rows are updated in place, so picking another pair moves the bars instead of redrawing them.

import { esc, titleCase, pct } from '../ui.js';
import { pairedProfile } from '../fingerprint-model.js';

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
let openKey = null;

export function renderProfile(box, pa, pb) {
  if (!pa || !pb) { box.innerHTML = ''; box.hidden = true; return; }
  box.hidden = false;
  const { rows, domain } = pairedProfile(pa, pb);

  const name = (p) => esc(titleCase(p.rec.address));
  const total = (p) => (p.low.length ? `<b>${p.low.length}</b> of ${p.rated} items rated low` : `none of ${p.rated} items rated low`);

  let table = box.querySelector('table');
  if (!table) {
    box.innerHTML = `<table class="pf">
      <caption class="pf-cap">Share of each area’s rated items rated low (0 or 1 of 3). Same scale on both sides, 0 at the centre line. Select an area to see its items.</caption>
      <thead><tr>
        <th scope="col" class="pf-h pf-h-a"></th><th scope="col" class="pf-h pf-h-mid"><span class="visually-hidden">Inspection area</span></th><th scope="col" class="pf-h pf-h-b"></th>
      </tr></thead><tbody></tbody>
      <tfoot aria-hidden="true"><tr><td class="pf-axis pf-axis-a"><div class="pf-axis-in"></div></td><td></td><td class="pf-axis pf-axis-b"><div class="pf-axis-in"></div></td></tr></tfoot></table>`;
    table = box.querySelector('table');
    table.addEventListener('click', (e) => {
      const btn = e.target.closest('.pf-row-btn');
      if (!btn) return;
      openKey = openKey === btn.dataset.key ? null : btn.dataset.key;
      syncOpen(table);
    });
  }

  const head = (p, side) => `<span class="pf-tag">Building ${side}</span>
    <span class="pf-name">${name(p)}</span>
    <span class="pf-score"><b>${p.rec.score}</b><small>/100</small></span>
    <span class="pf-total">${total(p)}</span>`;
  table.querySelector('.pf-h-a').innerHTML = head(pa, 'A');
  table.querySelector('.pf-h-b').innerHTML = head(pb, 'B');
  const ax = `<span>0</span><span>${pct(domain / 2)}</span><span>${pct(domain)}</span>`;
  table.querySelector('.pf-axis-a .pf-axis-in').innerHTML = ax;
  table.querySelector('.pf-axis-b .pf-axis-in').innerHTML = ax;

  const body = table.tBodies[0];
  const cell = (g) => {
    if (!g.rated) return { w: 0, txt: 'not rated', zero: false, none: true };
    return { w: (g.low / g.rated / domain) * 100, txt: `${g.low} of ${g.rated}`, zero: g.low === 0, none: false };
  };
  rows.forEach((r, i) => {
    let tr = body.querySelector(`tr.pf-row[data-key="${r.key}"]`);
    if (!tr) {
      tr = document.createElement('tr');
      tr.className = 'pf-row';
      tr.dataset.key = r.key;
      tr.innerHTML = `<td class="pf-side pf-a"><div class="pf-cell"><span class="pf-track"><span class="pf-bar"></span><span class="pf-val"></span></span></div></td>
        <th scope="row" class="pf-mid"><button type="button" class="pf-row-btn" data-key="${r.key}" aria-expanded="false"><span class="pf-label"></span><span class="pf-chev" aria-hidden="true"></span></button></th>
        <td class="pf-side pf-b"><div class="pf-cell"><span class="pf-track"><span class="pf-bar"></span><span class="pf-val"></span></span></div></td>`;
      const items = document.createElement('tr');
      items.className = 'pf-items';
      items.dataset.key = r.key;
      items.hidden = true;
      items.innerHTML = '<td class="pf-items-a"></td><td></td><td class="pf-items-b"></td>';
      body.append(tr, items);
      tr.querySelectorAll('.pf-track').forEach((t) => t.style.setProperty('--w', '0%'));
    }
    tr.classList.toggle('is-strong', r.strong);
    tr.querySelector('.pf-label').textContent = r.label;
    const btn = tr.querySelector('.pf-row-btn');
    btn.setAttribute('aria-controls', `pf-items-${r.key}`);
    tr.nextElementSibling.id = `pf-items-${r.key}`;
    for (const [side, g] of [['a', r.a], ['b', r.b]]) {
      const c = cell(g);
      const td = tr.querySelector(`.pf-${side}`);
      td.classList.toggle('is-zero', c.zero);
      td.classList.toggle('is-none', c.none);
      td.querySelector('.pf-val').innerHTML = c.none ? c.txt : `<b>${g.low}</b> of ${g.rated}`;
      // the bar and its value label move together (both read --w)
      const track = td.querySelector('.pf-track');
      const w = `${Math.max(0, Math.min(100, c.w)).toFixed(2)}%`;
      if (reduced()) track.style.setProperty('--w', w); else requestAnimationFrame(() => track.style.setProperty('--w', w));
    }
    btn.setAttribute('aria-label', `${r.label}: Building A ${cell(r.a).txt} rated low, Building B ${cell(r.b).txt} rated low. Show the items.`);
    const list = (g) => {
      const lows = g.items.filter((it) => it.low).sort((x, y) => x.rating - y.rating);
      return lows.length
        ? `<ul class="pf-list">${lows.map((it) => `<li><span class="pf-chip r${it.rating}" aria-hidden="true">${it.rating}</span>${esc(it.stat.label)}</li>`).join('')}</ul>`
        : `<p class="pf-none">${g.rated ? `No item rated low (${g.rated} rated)` : 'Not rated'}</p>`;
    };
    tr.nextElementSibling.querySelector('.pf-items-a').innerHTML = list(r.a);
    tr.nextElementSibling.querySelector('.pf-items-b').innerHTML = list(r.b);
  });
  syncOpen(table);
}

function syncOpen(table) {
  table.querySelectorAll('.pf-row').forEach((tr) => {
    const on = tr.dataset.key === openKey;
    tr.classList.toggle('is-open', on);
    tr.querySelector('.pf-row-btn').setAttribute('aria-expanded', String(on));
    const items = tr.nextElementSibling;
    const was = !items.hidden;
    items.hidden = !on;
    if (on && !was && !reduced()) items.animate([{ opacity: 0, transform: 'translateY(-4px)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)' });
  });
}
