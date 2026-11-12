// Compare: "How can two buildings with similar scores have different inspection problems?"
// The selected building next to another with the same (or, if none, the closest) overall score: one aligned
// dumbbell chart, category by category, on one 0–100% scale, and the item-level ratings of one category on
// demand. Matching rules live in ../xray-model.js (findMatches) and are tested; nothing here changes them.
//
// The view is built once per box and then updated: choosing another building moves the marks to their new
// values (interruptible d3 transitions) instead of redrawing the page.

import { itemLabel } from '../model.js';
import { zoneByKey, zoneDifferences, findMatches, ratingClass } from '../xray-model.js';
import { tip, pct, esc, titleCase, formatDate } from '../ui.js';
import { enhanceSelect } from '../components/select.js';

const ORDER = ['exterior', 'shared', 'systems', 'grounds', 'records'];   // the same order as the Inspection list
const MAX_OPTIONS = 40;
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function renderCompare(box, { rec, pm, ctx, M, matchRsn, zone = null, onChoose, onZone, onOpen }) {
  if (!rec) {
    box.innerHTML = `<p class="bx-cmp-empty">This building has no evaluation in the ${esc(pm.P.long)}, so there’s no score to match. Switch the scoring system in Layers to compare it.</p>`;
    box._cmp = null;
    return;
  }
  let res = findMatches(rec, ctx.latest, pm.cats);
  let fallback = null;
  if (!res.matches.length && ctx.ward) { res = findMatches(rec, pm.latest, pm.cats); fallback = M.wardName.get(ctx.ward); }
  if (!res.matches.length) {
    box.innerHTML = `<p class="bx-cmp-empty">No other building in the ${esc(pm.P.long)} scored within 2 points of ${rec.score}, so there’s nothing comparable to show.</p>`;
    box._cmp = null;
    return;
  }
  const chosen = res.matches.find((m) => m.rec.rsn === matchRsn) ?? res.matches[0];
  const options = res.matches.slice(0, MAX_OPTIONS);
  if (!options.includes(chosen)) options.push(chosen);
  const pa = res.base, pb = chosen.profile, a = rec, b = chosen.rec;
  const diffs = zoneDifferences(pa, pb);
  const top = diffs[0]?.comparable && diffs[0].gap !== 0 ? diffs[0] : null;

  // ---- skeleton (once per building and scoring system) -------------------------------------------------------
  const key = `${a.rsn}|${a.era}`;
  if (box._cmp?.key !== key) {
    box.innerHTML = `
      <div class="bx-cmp-top">
        <p class="bx-cmp-lede" id="xr-cmp-lede" aria-live="polite"></p>
        <div class="bx-cmp-pick">
          <label class="field bx-cmp-field"><span class="field-label" id="xr-cmp-label">Compare with <button type="button" class="info-btn" data-info="compare-match" aria-label="How the other building is chosen">i</button></span>
            <select id="xr-cmp-select"></select></label>
        </div>
      </div>
      <div class="bx-cmp-body">
        <div class="bx-cmp-main">
          <div class="bx-cmp-ids">
            <div class="bx-cmp-id" id="xr-cmp-a"></div>
            <div class="bx-cmp-id" id="xr-cmp-b"></div>
          </div>
          <div class="bx-cmp-chart chart" id="xr-cmp-chart"></div>
        </div>
        <aside class="bx-cmp-detail" id="xr-cmp-detail" aria-live="polite" aria-label="Category detail"></aside>
      </div>
      <table class="visually-hidden" id="xr-cmp-table"></table>`;
    box._cmp = { key, zone: zone && ORDER.includes(zone) ? zone : null };
    const sel = box.querySelector('#xr-cmp-select');
    sel.addEventListener('change', (e) => onChoose(e.target.value));
    enhanceSelect(sel, { search: true, searchLabel: 'Search buildings', placeholder: 'Search buildings…', labelledBy: 'xr-cmp-label' });
  }
  const st = box._cmp;
  Object.assign(st, { pa, pb, a, b, top, onZone, onOpen });

  // ---- the selector: same scoring system, closest score first, most different profile first ----------------------
  const sel = box.querySelector('#xr-cmp-select');
  const opts = options.map((m) => `<option value="${m.rec.rsn}" data-sub="${m.rec.score} · ${m.profile.poor} poor"${m === chosen ? ' selected' : ''}>${esc(titleCase(m.rec.address))}</option>`).join('');
  if (sel.dataset.opts !== opts) { sel.innerHTML = opts; sel.dataset.opts = opts; }
  sel.value = b.rsn;

  // ---- one sentence: what this comparison shows -----------------------------------------------------------------
  const same = a.score === b.score;
  const profiles = top ? 'Different inspection profiles.' : 'Similar inspection profiles.';
  box.querySelector('#xr-cmp-lede').innerHTML = `<b>${same ? 'Same overall score.' : 'Similar overall scores.'}</b> ${profiles}`
    + (res.tolerance ? ` <span class="bx-cmp-tol">Closest available score: ${b.score}</span>` : '')
    + (fallback ? ` <span class="bx-cmp-tol">None in ${esc(fallback)}; showing Toronto.</span>` : '');

  // ---- the two buildings (also the chart's key: ● this building, ◆ the other) ------------------------------------
  const id = (mark, role, r, p, open) => `<p class="bx-cmp-role"><span class="bx-mark bx-mark-${mark}" aria-hidden="true"></span>${role}</p>
    <p class="bx-cmp-name">${esc(titleCase(r.address))}</p>
    <p class="bx-cmp-score"><b>${r.score}</b> / 100 <span>· ${p.poor} of ${p.applicable} rated poorly · ${formatDate(r.date)}</span>
      ${open ? `<button type="button" class="link-btn bx-cmp-open" data-open="${r.rsn}">Open <span aria-hidden="true">→</span><span class="visually-hidden"> ${esc(titleCase(r.address))} in the Building Explorer</span></button>` : ''}</p>`;
  box.querySelector('#xr-cmp-a').innerHTML = id('a', 'This building', a, pa, false);
  box.querySelector('#xr-cmp-b').innerHTML = id('b', same ? 'Same score' : `Within ±${Math.abs(b.score - a.score)}`, b, pb, true);
  box.querySelector('[data-open]')?.addEventListener('click', (e) => onOpen(e.currentTarget.dataset.open));

  // screen readers get the whole comparison as a table
  box.querySelector('#xr-cmp-table').innerHTML = `<caption>Share of applicable items rated poorly, by category</caption>
    <thead><tr><th scope="col">Category</th><th scope="col">${esc(titleCase(a.address))}</th><th scope="col">${esc(titleCase(b.address))}</th></tr></thead>
    <tbody>${ORDER.map((k) => { const za = zoneOf(pa, k), zb = zoneOf(pb, k); return `<tr><th scope="row">${esc(zoneByKey.get(k).label)}</th><td>${cellTxt(za)}</td><td>${cellTxt(zb)}</td></tr>`; }).join('')}</tbody>`;

  drawDumbbell(box.querySelector('#xr-cmp-chart'), st, () => renderDetail(box, st));
  renderDetail(box, st);
}

const zoneOf = (p, k) => p.zones.find((z) => z.key === k);
const cellTxt = (z) => (z.status === 'none' ? 'Not evaluated' : `${z.poor} of ${z.applicable} rated poorly (${pct(z.share)})`);
const gapPts = (za, zb) => (za.share == null || zb.share == null ? null : Math.round(zb.share * 100) - Math.round(za.share * 100));

// ---- the chart: one row per category; ● this building and ◆ the other on one 0–100% scale ------------------------
function drawDumbbell(box, st, onChange) {
  const { pa, pb, top } = st;
  const width = Math.max(300, Math.floor(box.clientWidth));
  const height = Math.max(240, Math.floor(box.clientHeight || 320));
  const narrow = width < 560;
  const m = { top: 28, right: narrow ? 8 : 16, bottom: 8, left: narrow ? 0 : 196 };
  const valW = narrow ? 0 : 152;                       // the three number columns: this, other, difference
  const rowsTop = m.top + (narrow ? 0 : 0);
  const rowH = Math.max(narrow ? 64 : 48, Math.min(92, (height - m.top - m.bottom) / ORDER.length));
  const H = Math.round(m.top + rowH * ORDER.length + m.bottom);
  const trackX0 = m.left, trackX1 = width - m.right - valW;
  const x = d3.scaleLinear().domain([0, 1]).range([trackX0 + 8, trackX1 - 8]);
  const dur = reduced() ? 0 : 360;

  let svg = d3.select(box).select('svg.bx-db');
  if (svg.empty() || +svg.attr('data-w') !== width || +svg.attr('data-h') !== H) {
    box.innerHTML = '';
    svg = d3.select(box).append('svg').attr('class', 'bx-db').attr('data-w', width).attr('data-h', H)
      .attr('viewBox', `0 0 ${width} ${H}`).attr('width', width).attr('height', H).attr('role', 'group');
    // scale: gridlines at 0, 25, 50, 75, 100% with labels on top
    const ax = svg.append('g').attr('class', 'bx-db-axis');
    for (const v of [0, 0.25, 0.5, 0.75, 1]) {
      ax.append('line').attr('x1', x(v)).attr('x2', x(v)).attr('y1', m.top - 6).attr('y2', H - m.bottom).attr('class', v === 0 ? 'bx-db-zero' : 'bx-db-grid');
      ax.append('text').attr('x', x(v)).attr('y', m.top - 12).attr('text-anchor', v === 0 ? 'start' : v === 1 ? 'end' : 'middle').text(`${v * 100}%`);
    }
    if (!narrow) {
      const hd = svg.append('g').attr('class', 'bx-db-head');
      hd.append('text').attr('x', 0).attr('y', m.top - 12).text('Share of items rated poorly');
      const cx = (i) => trackX1 + 8 + i * 48 + 40;
      hd.append('text').attr('class', 'bx-db-ha').attr('x', cx(0)).attr('y', m.top - 12).attr('text-anchor', 'end').text('●');
      hd.append('text').attr('class', 'bx-db-hb').attr('x', cx(1)).attr('y', m.top - 12).attr('text-anchor', 'end').text('◆');
      hd.append('text').attr('x', cx(2)).attr('y', m.top - 12).attr('text-anchor', 'end').text('Diff.');
    }
    svg.append('g').attr('class', 'bx-db-rows');
  }
  svg.attr('aria-label', `Share of applicable items rated poorly, by category: this building (circle) and ${titleCase(pb.rec.address)} (diamond). Select a category to compare its items.`);

  const data = ORDER.map((k, i) => ({ k, i, za: zoneOf(pa, k), zb: zoneOf(pb, k) }));
  const rows = svg.select('.bx-db-rows').selectAll('g.bx-db-row').data(data, (d) => d.k)
    .join((enter) => {
      const g = enter.append('g').attr('class', 'bx-db-row').attr('tabindex', 0).attr('role', 'button')
        .attr('transform', (d) => `translate(0,${rowsTop + d.i * rowH})`);
      g.append('rect').attr('class', 'bx-db-hit').attr('x', -4).attr('y', 2).attr('width', width + 4).attr('height', rowH - 4).attr('rx', 4);
      g.append('line').attr('class', 'bx-db-track').attr('x1', x(0)).attr('x2', x(1));
      g.append('line').attr('class', 'bx-db-link');
      g.append('circle').attr('class', 'bx-db-a').attr('r', 7);
      g.append('path').attr('class', 'bx-db-b').attr('d', d3.symbol(d3.symbolDiamond, 150)());
      g.append('text').attr('class', 'bx-db-label');
      g.append('text').attr('class', 'bx-db-tag');
      for (const c of ['va', 'vb', 'vd']) g.append('text').attr('class', `bx-db-val bx-db-${c}`).attr('text-anchor', 'end');
      g.append('text').attr('class', 'bx-db-none');
      return g;
    });
  const yMid = narrow ? rowH * 0.66 : rowH / 2;
  rows.each(function (d) {
    const g = d3.select(this);
    const { za, zb } = d;
    const okA = za.share != null, okB = zb.share != null;
    const gap = gapPts(za, zb);
    const isTop = top?.key === d.k;
    g.select('.bx-db-track').attr('y1', yMid).attr('y2', yMid);
    g.select('.bx-db-label').attr('x', 0).attr('y', narrow ? 18 : yMid - (isTop ? 4 : -5)).text(zoneByKey.get(d.k).label);
    // phones have no number columns: the two shares sit at the end of the label line instead
    const tag = narrow ? `${okA ? pct(za.share) : '—'} · ${okB ? pct(zb.share) : '—'}${isTop ? ' · largest' : ''}` : isTop ? 'Largest difference' : '';
    g.select('.bx-db-tag').attr('x', narrow ? x(1) : 0).attr('text-anchor', narrow ? 'end' : 'start').attr('y', narrow ? 18 : yMid + 14).classed('is-vals', narrow && !isTop).text(tag);
    const xa = okA ? x(za.share) : x(0), xb = okB ? x(zb.share) : x(0);
    g.select('.bx-db-link').transition('v').duration(dur).ease(d3.easeCubicOut)
      .attr('x1', xa).attr('x2', xb).attr('y1', yMid).attr('y2', yMid).attr('opacity', okA && okB ? 1 : 0);
    g.select('.bx-db-a').transition('v').duration(dur).ease(d3.easeCubicOut).attr('cx', xa).attr('cy', yMid).attr('opacity', okA ? 1 : 0);
    g.select('.bx-db-b').transition('v').duration(dur).ease(d3.easeCubicOut).attr('transform', `translate(${xb},${yMid})`).attr('opacity', okB ? 1 : 0);
    g.select('.bx-db-none').attr('x', x(0) + 12).attr('y', yMid + 4)
      .text(!okA && !okB ? 'Not evaluated in either building' : !okA ? 'Not evaluated here' : !okB ? 'Not evaluated there' : '');
    if (!narrow) {
      const cx = (i) => trackX1 + 8 + i * 48 + 40;
      g.select('.bx-db-va').attr('x', cx(0)).attr('y', yMid + 4).text(okA ? pct(za.share) : '—');
      g.select('.bx-db-vb').attr('x', cx(1)).attr('y', yMid + 4).text(okB ? pct(zb.share) : '—');
      g.select('.bx-db-vd').attr('x', cx(2)).attr('y', yMid + 4).classed('is-big', isTop).text(gap == null ? '—' : gap === 0 ? '0' : `${Math.abs(gap)} pts`);
    } else {
      g.selectAll('.bx-db-val').text('');
    }
    g.attr('aria-label', `${zoneByKey.get(d.k).label}: ${cellTxt(za)} in this building, ${cellTxt(zb)} in ${titleCase(pb.rec.address)}.${gap ? ` ${Math.abs(gap)} points apart.` : ''}${isTop ? ' Largest difference.' : ''}`);
  });

  const paint = () => {
    rows.classed('is-selected', (d) => d.k === st.zone).classed('is-dim', (d) => !!st.zone && d.k !== st.zone)
      .attr('aria-pressed', (d) => String(d.k === st.zone));
  };
  const choose = (k) => {
    st.zone = st.zone === k ? null : k;
    st.onZone?.(st.zone);
    paint();
    onChange();
  };
  rows.on('click', (ev, d) => choose(d.k))
    .on('keydown', function (ev, d) {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); choose(d.k); return; }
      const j = { ArrowDown: d.i + 1, ArrowUp: d.i - 1, Home: 0, End: ORDER.length - 1 }[ev.key];
      if (j == null) return;
      ev.preventDefault();
      rows.nodes()[(j + ORDER.length) % ORDER.length].focus();
    })
    .on('mouseenter', (ev, d) => tip.show(`<div class="tt-title">${esc(zoneByKey.get(d.k).label)}</div>
        <dl><dt>● Here</dt><dd>${cellTxt(d.za)}</dd><dt>◆ There</dt><dd>${cellTxt(d.zb)}</dd></dl>`, ev))
    .on('mousemove', (ev) => tip.move(ev)).on('mouseleave', () => tip.hide());
  paint();
}

// ---- the detail beside the chart: the largest difference, or one category's items side by side -------------------
function renderDetail(box, st) {
  const el = box.querySelector('#xr-cmp-detail');
  const { pa, pb, a, b, top } = st;
  if (!st.zone) {
    const za = top && zoneOf(pa, top.key), zb = top && zoneOf(pb, top.key);
    el.innerHTML = top ? `<p class="bx-eyebrow">Largest difference</p>
        <p class="bx-cmp-dname">${esc(zoneByKey.get(top.key).label)}</p>
        <p class="bx-cmp-dline"><span class="bx-mark bx-mark-a" aria-hidden="true"></span>${pct(za.share)} rated poorly here <span class="muted">(${za.poor} of ${za.applicable})</span></p>
        <p class="bx-cmp-dline"><span class="bx-mark bx-mark-b" aria-hidden="true"></span>${pct(zb.share)} at ${esc(titleCase(b.address))} <span class="muted">(${zb.poor} of ${zb.applicable})</span></p>
        <p class="bx-cmp-hint">Select a category to compare its item ratings.</p>`
      : `<p class="bx-eyebrow">Category profiles</p><p class="bx-cmp-dname">No category differs</p>
        <p class="bx-cmp-hint">Both buildings had the same share rated poorly in every category both were rated in. Select a category to compare its items.</p>`;
    return;
  }
  const k = st.zone, za = zoneOf(pa, k), zb = zoneOf(pb, k), S = pa.scale;
  const byCol = new Map(zb.items.map((i) => [i.col, i]));
  const cols = [...new Set([...za.items.map((i) => i.col), ...zb.items.map((i) => i.col)])];
  const cell = (it) => {
    if (!it || it.status === 'blank') return '<span class="bx-r bx-r-none">—<span class="visually-hidden"> not recorded</span></span>';
    if (it.status === 'na') return '<span class="bx-r bx-r-na">N/A</span>';
    return `<span class="bx-r${it.poor ? ' is-poor' : ''}"><span class="bx-r-sq r-${ratingClass(it.rating, S)}" aria-hidden="true"></span>${it.rating}${it.poor ? '<span class="visually-hidden"> (poor)</span>' : ''}</span>`;
  };
  // items where the two buildings differ first, then the rest, in the City's order
  const rowsOf = cols.map((c) => ({ c, ia: za.items.find((i) => i.col === c), ib: byCol.get(c) }))
    .map((r) => ({ ...r, diff: (r.ia?.rating ?? null) !== (r.ib?.rating ?? null) }))
    .sort((x, y) => y.diff - x.diff);
  el.innerHTML = `<div class="bx-cmp-dhead">
      <p class="bx-cmp-dname">${esc(zoneByKey.get(k).label)}</p>
      <button type="button" class="popover-close" id="xr-cmp-clear" aria-label="Back to the largest difference">×</button>
    </div>
    <p class="bx-cmp-dline"><span class="bx-mark bx-mark-a" aria-hidden="true"></span>${cellTxt(za)}</p>
    <p class="bx-cmp-dline"><span class="bx-mark bx-mark-b" aria-hidden="true"></span>${cellTxt(zb)}</p>
    <table class="bx-cmp-items">
      <caption class="visually-hidden">Item ratings in ${esc(zoneByKey.get(k).label)}, ${S.min} to ${S.max} where ${S.max} is the top mark</caption>
      <thead><tr><th scope="col">Item <span class="muted">(${S.min}–${S.max})</span></th><th scope="col"><span class="bx-mark bx-mark-a" aria-hidden="true"></span><span class="visually-hidden">${esc(titleCase(a.address))}</span></th><th scope="col"><span class="bx-mark bx-mark-b" aria-hidden="true"></span><span class="visually-hidden">${esc(titleCase(b.address))}</span></th></tr></thead>
      <tbody>${rowsOf.map((r) => `<tr${r.diff ? ' class="is-diff"' : ''}><th scope="row">${esc(itemLabel(r.c))}</th><td>${cell(r.ia)}</td><td>${cell(r.ib)}</td></tr>`).join('')}</tbody>
    </table>`;
  el.querySelector('#xr-cmp-clear').addEventListener('click', () => {
    st.zone = null; st.onZone?.(null);
    const row = box.querySelector(`.bx-db-row.is-selected`);
    box.querySelectorAll('.bx-db-row').forEach((r) => { r.classList.remove('is-selected', 'is-dim'); r.setAttribute('aria-pressed', 'false'); });
    renderDetail(box, st);
    row?.focus();
  });
}
