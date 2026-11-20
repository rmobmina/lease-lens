// Inspection fingerprint (the project's novel view): what lies underneath one RentSafeTO score.
// Each building's latest evaluation is laid out on the same grid: one square per inspection
// item, grouped into five areas, coloured by the item's rating. Because every item sits in the
// same place for every building, two fingerprints can be compared at a glance.
// All data work lives in ../fingerprint-model.js; this file only draws and handles input.

import { enhanceSelect } from '../components/select.js';
import { initSearch } from '../atlas/search.js';
import { itemLabel } from '../model.js';
import { itemStats, buildingProfile, sameScorePairs, contrastFor, scoreOptions, cityFindings, SCALE_MAX, UNCOMMON_SHARE } from '../fingerprint-model.js';
import { tip, pct, fmt, esc, titleCase, formatDate, cssVar, anchorEvent } from '../ui.js';
import { renderProfile, refitProfile } from './fp-profile.js';
import { reducedMotion } from '../motion.js';

const $ = (id) => document.getElementById(id);
const GAP = 3;
const PER_ROW = 13; // the largest group has 13 items, so each group fits on one row when there's room
const reduceMotion = reducedMotion;

let layoutCache = { key: null, layout: null };
const prevFill = { a: new Map(), b: new Map() }; // last colours drawn, so a change of building animates
let wired = false;
// One view at a time (By category · Every item · All of Toronto), swapped in place so the page fits the
// window. Charts measure the panel they are drawn in, so the shown panel is redrawn when it changes.
const TABS = ['profile', 'items', 'city'];
let tab = 'profile';
let last = null;
let shown = null; // the pair on screen, for the address suggestions

const ratingColor = (v) => cssVar(`--fp-${v}`);
const ratingText = (v) => `${v} of ${SCALE_MAX}`;

export function renderFingerprint(ctx, M, state) {
  const { pm } = ctx;
  last = [ctx, M, state];
  wire(ctx);
  syncTabs();
  const off = pm.era !== 'cur';
  $('fp-unavailable').hidden = !off;
  $('fp-main').hidden = off;
  if (off) return;

  // The grid order and the "uncommon" reference always use all of Toronto, so a building's
  // fingerprint looks the same whichever ward filter is on.
  if (layoutCache.key !== pm) layoutCache = { key: pm, layout: itemStats(pm.latest, pm.cats, itemLabel) };
  const layout = layoutCache.layout;

  // ---- which two buildings -------------------------------------------------
  const pool = ctx.latest.length >= 2 ? ctx.latest : pm.latest;
  const options = scoreOptions(pool);
  if (!options.some((o) => o.score === state.score)) state.score = options.some((o) => o.score === 92) ? 92 : d3.median(options, (o) => o.score) | 0;
  let a = state.a && pm.latestByRsn.get(state.a);
  let b = state.b && pm.latestByRsn.get(state.b);
  let pairs = [];
  let mode = 'example';
  if (a) {
    mode = 'custom';
    if (!b) b = contrastFor(a, pool.some((r) => r.rsn === a.rsn) ? pool : pm.latest, pm.cats);
  } else {
    pairs = sameScorePairs(pool, state.score, pm.cats);
    if (!pairs.length) pairs = sameScorePairs(pm.latest, state.score, pm.cats);
    [a, b] = pairs[state.pairIndex % Math.max(1, pairs.length)] ?? [];
  }

  // ---- controls --------------------------------------------------------------
  // The score menu always shows the score on screen: the pair's score, or building A's when the reader chose
  // their own buildings (choosing a score from it goes back to matched pairs at that score).
  const shownScore = mode === 'custom' && a ? a.score : state.score;
  const opts = options.some((o) => o.score === shownScore) ? options : [...options, { score: shownScore, n: 1 }].sort((x, y) => x.score - y.score);
  const sel = $('fp-score');
  sel.innerHTML = opts.map((o) => `<option value="${o.score}" ${o.score === shownScore ? 'selected' : ''}>${o.score} (${fmt.n(o.n)} building${o.n === 1 ? '' : 's'})</option>`).join('');
  shown = { a, b, pool, pm };
  $('fp-next').hidden = mode === 'custom' || pairs.length < 2;
  $('fp-next').textContent = pairs.length > 1 ? `Show another pair (${(state.pairIndex % pairs.length) + 1} of ${pairs.length})` : '';
  $('fp-reset').hidden = mode !== 'custom';
  $('fp-a').placeholder = a ? titleCase(a.address) : 'Start typing an address…';
  $('fp-b').placeholder = b ? titleCase(b.address) : 'Start typing an address…';

  // ---- intro numbers (computed, not typed) -------------------------------------
  const scores = pm.latest.map((r) => r.score).sort(d3.ascending);
  // the citywide spread lives in the title's ⓘ (read from this hidden source by the info popover)
  $('fp-spread').innerHTML = `<p>Half of Toronto's ${fmt.n(scores.length)} evaluated buildings score between <b>${d3.quantileSorted(scores, 0.25)}</b> and <b>${d3.quantileSorted(scores, 0.75)}</b>, so a score alone separates buildings very little.</p>`;
  renderLegend();

  // ---- the pair -------------------------------------------------------------------
  const pa = a && buildingProfile(a, layout);
  const pb = b && buildingProfile(b, layout);
  $('fp-verdict').innerHTML = pa && pb ? takeaway(pa, pb) : 'Not enough buildings with this score to compare.';
  renderProfile($('fp-profile'), pa, pb);
  // the guided story shows the item grids without the tabs
  const story = document.body.classList.contains('is-story');
  if (tab === 'items' || story) drawMatrix($('fp-matrix'), pa, pb, ctx, pm);
  renderTable(layout, pa, pb);

  // ---- Toronto overview -------------------------------------------------------------
  if (tab === 'city' && !story) {
    const cityLayout = ctx.ward ? { groups: layout.groups, stats: itemStats(ctx.latest, pm.cats, itemLabel).stats } : layout;
    renderCityNotes(cityLayout, ctx);
    drawCity($('fp-city-chart'), cityLayout, ctx.latest.length);
  }
  renderMethod(pm, layout);
}

function syncTabs() {
  for (const t of TABS) {
    const btn = $(`fp-tab-${t}`), on = t === tab;
    btn.setAttribute('aria-selected', String(on));
    btn.tabIndex = on ? 0 : -1;
    $(`fp-panel-${t}`).hidden = !on;
  }
}
function showTab(t, focus = false) {
  if (t === tab) return;
  tab = t;
  syncTabs();
  if (focus) $(`fp-tab-${t}`).focus();
  const panel = $(`fp-panel-${t}`);
  if (!reduceMotion()) panel.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, easing: 'ease-out' });
  if (last) renderFingerprint(...last);
}

// ---- input --------------------------------------------------------------------------
function wire(ctx) {
  if (wired) return;
  wired = true;
  $('fp-score').addEventListener('change', (e) => ctx.setFp({ score: +e.target.value, pairIndex: 0, a: null, b: null }));
  enhanceSelect($('fp-score'), { search: true, searchLabel: 'Search scores', placeholder: 'Find a score…' });
  $('fp-next').addEventListener('click', () => ctx.setFp((s) => ({ pairIndex: s.pairIndex + 1 })));
  $('fp-reset').addEventListener('click', () => ctx.setFp({ a: null, b: null, pairIndex: 0 }, '#/compare'));
  // Building A / B: address search over the buildings evaluated under the scoring system on screen (scores
  // from the two systems are never compared). Empty, a field suggests buildings with the same score as the
  // other building; each option says whether its score matches.
  const pick = (slot) => {
    const other = slot === 'a' ? 'b' : 'a';
    const sameAs = (r) => shown?.[other] && r.score === shown[other].score && r.rsn !== shown[other].rsn;
    initSearch($(`fp-${slot}`), $(`fp-${slot}-list`), {
      source: () => shown?.pm.latest ?? [],
      describe: (r) => `${esc(r.wardName)} · score <b class="tnum">${r.score}</b>${shown?.[other] ? (r.score === shown[other].score ? ' · same score' : ` · ${r.score > shown[other].score ? '+' : '−'}${Math.abs(r.score - shown[other].score)} vs ${slot === 'a' ? 'B' : 'A'}`) : ''}`,
      suggest: () => {
        if (!shown?.[other]) return null;
        const pool = shown.pm.latest.filter(sameAs);
        return { label: `Also scored ${shown[other].score}`, records: d3.shuffle(pool.slice()).slice(0, 6) };
      },
      noMatch: (text) => {
        const elsewhere = ctx.searchAll?.().some((r) => r.era !== shown?.pm.era && r.address.includes(text.toUpperCase()));
        return elsewhere
          ? 'Only evaluated under the other scoring system. Scores from the two systems aren’t compared; switch systems to see it.'
          : 'No evaluated building matches that address.';
      },
      onPick: (r) => ctx.setFp((s) => (slot === 'a'
        // a new A gets a same-score partner, unless the reader chose a B with that score themselves
        ? { a: r.rsn, b: s.b && s.b !== r.rsn && shown?.b?.rsn === s.b && shown.b.score === r.score ? s.b : null }
        : { a: s.a ?? shown?.a?.rsn, b: r.rsn })),
    });
  };
  pick('a');
  pick('b');
  $('fp-goto-cur').addEventListener('click', () => ctx.setPeriod('cur'));
  // tabs: click, and arrow keys / Home / End between them (the APG tabs pattern, automatic activation)
  for (const t of TABS) $(`fp-tab-${t}`).addEventListener('click', () => showTab(t));
  $('fp-tab-profile').parentElement.addEventListener('keydown', (e) => {
    const i = TABS.indexOf(tab);
    const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: TABS.length - 1 }[e.key];
    if (next == null) return;
    e.preventDefault();
    showTab(TABS[(next + TABS.length) % TABS.length], true);
  });
  // the rating legend: a labelled disclosure beside the tabs
  $('fp-legend-btn').addEventListener('click', () => {
    const open = $('fp-legend').hidden;
    $('fp-legend').hidden = !open;
    $('fp-legend-btn').setAttribute('aria-expanded', String(open));
  });
  // the full table and the method open on request, in dialogs
  for (const [btn, dlg] of [['fp-table-open', 'fp-table-dialog'], ['fp-method-open', 'fp-method-dialog']]) {
    const d = $(dlg);
    $(btn).addEventListener('click', () => d.showModal());
    d.querySelector('[data-close]').addEventListener('click', () => d.close());
    d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
    d.addEventListener('close', () => $(btn).focus());
  }
  // charts follow the panel's size
  let raf = 0;
  new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { if (!last || $('fp-main').closest('[hidden]')) return; if (tab === 'profile') refitProfile($('fp-profile')); else renderFingerprint(...last); }); })
    .observe($('fp-panel-items').parentElement);
}

// ---- the takeaway ------------------------------------------------------------------------
// One sentence under the selectors, from the data: the shared score, then who had items rated 0 or 1.
function takeaway(pa, pb) {
  const name = (p) => `<b>${esc(titleCase(p.rec.address))}</b>`;
  const n = (p) => p.low.length;
  const items = (k) => (k === 1 ? 'an item' : `${k} items`);
  const lead = pa.rec.score === pb.rec.score
    ? `Both scored <b>${pa.rec.score}</b>.`
    : `They scored <b>${pa.rec.score}</b> and <b>${pb.rec.score}</b>, so this isn’t a same-score comparison.`;
  let tail;
  if (!n(pa) && !n(pb)) tail = 'Neither had an item rated 0 or 1.';
  else if (!n(pb)) tail = `Only ${name(pa)} had ${items(n(pa))} rated 0 or 1.`;
  else if (!n(pa)) tail = `Only ${name(pb)} had ${items(n(pb))} rated 0 or 1.`;
  else tail = `${name(pa)} had ${items(n(pa))} rated 0 or 1; ${name(pb)} had ${n(pb)}.`;
  return `${lead} ${tail}`;
}

// ---- every item: one shared matrix --------------------------------------------------------
// A row per inspection category and a column per building, so the same category reads straight across.
// Each column header holds the building's address, inspection date and facts (once); each cell holds the
// category's count of items rated 0 or 1, its item tiles (same order for every building) and, beside them,
// the names of the items rated low. Names and tiles share the item's details (hover, focus, tap).
function drawMatrix(table, pa, pb, ctx, pm) {
  if (!pa || !pb) { table.innerHTML = '<tbody><tr><td class="card-text">No pair to show.</td></tr></tbody>'; return; }
  const P = { a: pa, b: pb };
  const evals = (r) => pm.recs.filter((d) => d.rsn === r.rsn).length;
  const head = (slot) => {
    const r = P[slot].rec, k = evals(r);
    const facts = [`Ward ${+r.ward} · ${esc(r.wardName)}`, r.yearBuilt ? `built ${r.yearBuilt}` : null, r.storeys ? `${r.storeys} storeys` : null, r.units ? `${r.units} units` : null].filter(Boolean);
    return `<th scope="col" class="fp-m-head">
      <span class="card-label">Building ${slot.toUpperCase()}</span>
      <a class="fp-name" href="#/explore?b=${r.rsn}">${esc(titleCase(r.address))}</a>
      <span class="fp-meta">Inspected ${formatDate(r.date)}${k > 1 ? ` · latest of ${k} evaluations since 2023` : ''}</span>
      <span class="fp-meta">${facts.join(' · ')}</span>
      ${r.reactive != null && r.reactive < 0 ? `<span class="fp-meta">Includes a reactive adjustment of ${r.reactive} points</span>` : ''}
    </th>`;
  };
  const who = (slot) => `${slot.toUpperCase()} · ${esc(titleCase(P[slot].rec.address))}`;
  const cell = (slot, gi) => {
    const g = P[slot].groups[gi];
    const lows = g.items.filter((i) => i.low).sort((x, y) => x.rating - y.rating);
    return `<td class="fp-m-cell" data-slot="${slot}" data-group="${gi}">
      <span class="fp-m-who">${who(slot)}</span>
      <span class="fp-m-count${g.low ? ' is-low' : ''}">${g.rated ? `<b>${g.low}</b> of ${g.rated} rated 0–1` : 'Not rated'}</span>
      <div class="fp-m-body">
        <div class="fp-m-tiles"></div>
        ${lows.length ? `<ul class="fp-m-lows" aria-label="Rated 0 or 1">${lows.map((i) => `
          <li><button type="button" class="fp-m-low" data-col="${esc(i.col)}"><span class="fp-chip" style="background:${ratingColor(i.rating)}" aria-hidden="true">${i.rating}</span><span class="fp-m-low-name">${esc(i.stat.label)}${i.uncommon ? '<span class="fp-ring" title="Uncommon low mark" aria-hidden="true"></span><span class="visually-hidden">, uncommon low mark</span>' : ''}</span></button></li>`).join('')}</ul>` : ''}
      </div>
    </td>`;
  };
  table.innerHTML = `<caption class="visually-hidden">Every inspection item, by category, for ${esc(titleCase(pa.rec.address))} and ${esc(titleCase(pb.rec.address))}</caption>
    <colgroup><col class="fp-m-col-cat" /><col /><col /></colgroup>
    <thead><tr><th scope="col" class="fp-m-cat-head">Inspection category</th>${head('a')}${head('b')}</tr></thead>
    <tbody>${pa.groups.map((g, gi) => `<tr><th scope="row" class="fp-m-cat">${esc(g.label)}</th>${cell('a', gi)}${cell('b', gi)}</tr>`).join('')}</tbody>`;

  // the tiles: one small grid per category and building, wrapping inside its own column
  for (const slot of ['a', 'b']) {
    const p = P[slot], r = p.rec;
    const old = prevFill[slot];
    const animate = !reduceMotion() && old.size && old.get('__rsn') !== r.rsn;
    table.querySelectorAll(`.fp-m-cell[data-slot="${slot}"]`).forEach((td) => {
      const g = p.groups[+td.dataset.group];
      const box = td.querySelector('.fp-m-tiles');
      drawTiles(box, g, r, pm, animate ? old : null);
    });
    prevFill[slot] = new Map([['__rsn', r.rsn], ...p.groups.flatMap((g) => g.items).filter((i) => i.status === 'rated').map((i) => [i.col, ratingColor(i.rating)])]);
    ctx.registerShown?.(slot, r.rsn);
  }

  // the names of low-rated items open the same details as their tiles (keyboard, hover and touch)
  table.querySelectorAll('.fp-m-low').forEach((btn) => {
    const slot = btn.closest('.fp-m-cell').dataset.slot;
    const it = P[slot].groups.flatMap((g) => g.items).find((i) => i.col === btn.dataset.col);
    const show = () => { hotCol(it.col); tip.show(cellTip(it, P[slot].rec, pm), anchorEvent(btn)); $('fp-live').textContent = cellSpoken(it); };
    const hide = () => { hotCol(null); tip.hide(); };
    btn.addEventListener('mouseenter', show);
    btn.addEventListener('mouseleave', hide);
    btn.addEventListener('focus', show);
    btn.addEventListener('blur', hide);
    btn.addEventListener('click', show);
  });
}

function drawTiles(box, g, r, pm, old) {
  box.innerHTML = '';
  const width = Math.max(80, box.clientWidth);
  const size = Math.round(Math.max(16, Math.min(22, 18 * (parseFloat(getComputedStyle(document.documentElement).fontSize) / 16 || 1))));
  const perRow = Math.max(1, Math.floor((width + GAP) / (size + GAP)));
  const flat = g.items.map((it, i) => ({ it, x: (i % perRow) * (size + GAP) + 2, y: Math.floor(i / perRow) * (size + GAP) + 2 }));
  const height = Math.max(1, Math.ceil(g.items.length / perRow)) * (size + GAP) + 2;
  const svg = d3.select(box).append('svg').attr('width', Math.min(width, perRow * (size + GAP) + 2)).attr('height', height)
    .attr('role', 'img').attr('aria-label', `${g.label}, ${titleCase(r.address)}: ${g.low} of ${g.rated} items rated 0 or 1.`);
  const cells = svg.append('g').attr('class', 'fp-cells').selectAll('g').data(flat).join('g')
    .attr('class', (d) => `fp-cell ${d.it.status}`).attr('data-col', (d) => d.it.col)
    .attr('transform', (d) => `translate(${d.x},${d.y})`);
  cells.append('rect').attr('class', 'fp-hit').attr('x', -GAP / 2).attr('y', -GAP / 2).attr('width', size + GAP).attr('height', size + GAP);
  const sq = cells.append('rect').attr('class', 'fp-sq').attr('width', size).attr('height', size).attr('rx', 2);
  sq.filter((d) => d.it.status === 'rated')
    .attr('fill', (d) => (old?.has(d.it.col) ? old.get(d.it.col) : ratingColor(d.it.rating)))
    .transition().duration(old ? 380 : 0).attr('fill', (d) => ratingColor(d.it.rating));
  // N/A and blank: an empty outline, never a coloured (problem-looking) square
  sq.filter((d) => d.it.status !== 'rated').attr('fill', 'none').attr('x', 0.5).attr('y', 0.5).attr('width', size - 1).attr('height', size - 1);
  // the digit repeats the colour for low marks, so they don't depend on colour vision
  cells.filter((d) => d.it.low).append('text').attr('class', 'fp-digit').attr('x', size / 2).attr('y', size / 2 + 4).attr('text-anchor', 'middle').text((d) => d.it.rating);
  cells.filter((d) => d.it.uncommon).append('rect').attr('class', 'fp-uncommon').attr('x', -2).attr('y', -2).attr('width', size + 4).attr('height', size + 4).attr('rx', 3);
  bindCells(svg, cells, flat, (d) => cellTip(d.it, r, pm), (d) => cellSpoken(d.it), `${g.label}, ${titleCase(r.address)}`);
}

function cellTip(it, r, pm) {
  const s = it.stat;
  const val = it.status === 'rated' ? `<b>${ratingText(it.rating)}</b>${it.rating === SCALE_MAX ? ' (top mark)' : ''}`
    : it.status === 'na' ? 'N/A, doesn\'t apply here (not counted)' : 'Not recorded (blank)';
  return `<div class="tt-title">${esc(s.label)}</div>
    <div class="tt-sub">${esc(s.groupLabel)} · City item name: ${esc(s.official)}</div>
    <dl><dt>Rating</dt><dd>${val}</dd>
      <dt>Inspected</dt><dd>${formatDate(r.date)}</dd>
      <dt>Toronto</dt><dd>${pct(s.lowShare, 1)} rated 0–1 · ${pct(s.belowTopShare)} rated 2 or lower</dd></dl>
    ${it.uncommon ? `<p class="tt-hint"><b>Uncommon:</b> fewer than ${pct(UNCOMMON_SHARE)} of buildings get a mark this low here.</p>` : ''}`;
}
const cellSpoken = (it) => `${it.stat.label}, ${it.stat.groupLabel}: ${it.status === 'rated' ? `rated ${ratingText(it.rating)}` : it.status === 'na' ? 'not applicable' : 'not recorded'}${it.uncommon ? ', uncommon low mark' : ''}.`;

// Hover, focus and arrow keys. One tab stop per chart; arrows move between items.
// Hovering an item highlights the same item in every chart on the page (linked comparison).
const hotCol = (col) => document.querySelectorAll('#fp-main [data-col]').forEach((n) => n.classList.toggle('is-hot', n.dataset.col === col));
function bindCells(svg, cells, flat, tipHtml, spoken, label = 'Inspection items') {
  const hot = hotCol;
  cells.on('mouseenter', function (ev, d) { hot(d.it.col); tip.show(tipHtml(d), ev); })
    .on('click', function (ev, d) { hot(d.it.col); tip.show(tipHtml(d), anchorEvent(this)); }) // touch
    .on('mousemove', (ev) => tip.move(ev))
    .on('mouseleave', () => { hot(null); tip.hide(); });
  const group = svg.select('.fp-cells').attr('tabindex', 0).attr('role', 'group')
    .attr('aria-label', `${label}. Use the arrow keys to move between items.`);
  let idx = -1;
  const nodes = cells.nodes();
  const show = (i) => {
    idx = Math.max(0, Math.min(flat.length - 1, i));
    const d = flat[idx];
    hot(d.it.col);
    tip.show(tipHtml(d), anchorEvent(nodes[idx]));
    $('fp-live').textContent = spoken(d);
  };
  group.on('focus', () => show(idx < 0 ? 0 : idx))
    .on('blur', () => { hot(null); tip.hide(); })
    .on('keydown', (ev) => {
      const k = ev.key;
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(k)) return;
      ev.preventDefault();
      ev.stopPropagation(); // don't let ← / → page between questions
      if (k === 'ArrowLeft') show(idx - 1);
      if (k === 'ArrowRight') show(idx + 1);
      if (k === 'Home') show(0);
      if (k === 'End') show(flat.length - 1);
      if (k === 'ArrowUp' || k === 'ArrowDown') {
        // jump to the same position in the previous / next row of squares
        const cur = flat[idx];
        const rowsY = [...new Set(flat.map((f) => f.y))];
        const ri = rowsY.indexOf(cur.y) + (k === 'ArrowDown' ? 1 : -1);
        if (ri < 0 || ri >= rowsY.length) return;
        const inRow = flat.map((f, i) => [f, i]).filter(([f]) => f.y === rowsY[ri]);
        show(d3.least(inRow, ([f]) => Math.abs(f.x - cur.x))[1]);
      }
    });
}

// ---- Toronto overview: the same grid, each square a 100% column of ratings ----------------
function drawCity(box, layout, n) {
  box.innerHTML = '';
  const width = Math.max(280, box.clientWidth);
  const wide = width >= 760;
  // Wide screens: groups side by side would get cramped, so lay the groups out in one long row of columns.
  const items = layout.groups.flatMap((g) => g.items.map((col) => ({ col, g })));
  const groupGap = wide ? 14 : 0;
  let cell, colH, height, pos;
  if (wide) {
    const usable = width - groupGap * (layout.groups.length - 1);
    cell = Math.max(8, Math.floor((usable + GAP) / items.length - GAP));
    colH = box.clientHeight > 120 ? Math.max(90, Math.min(260, box.clientHeight - 34 - 10)) : 120;
    let x = 0, last = null;
    pos = items.map((d) => { if (last && d.g !== last) x += groupGap; last = d.g; const p = { ...d, x, y: 34 }; x += cell + GAP; return p; });
    height = 34 + colH + 8;
  } else {
    cell = Math.max(16, Math.min(28, Math.floor((width + GAP) / PER_ROW - GAP)));
    colH = Math.round(cell * 2.2);
    let y = 0;
    pos = [];
    for (const g of layout.groups) {
      g.items.forEach((col, i) => pos.push({ col, g, x: (i % PER_ROW) * (cell + GAP), y: y + 22 + Math.floor(i / PER_ROW) * (colH + GAP), titleY: y }));
      y += 22 + Math.ceil(g.items.length / PER_ROW) * (colH + GAP) + 14;
    }
    height = y;
  }
  const svg = d3.select(box).append('svg').attr('viewBox', `0 0 ${width} ${height}`).attr('width', width).attr('height', height)
    .attr('role', 'img').attr('aria-label', `How ${fmt.n(n)} buildings were rated on each inspection item, grouped by area. Each column shows the share of buildings at each rating.`);

  // group titles
  for (const g of layout.groups) {
    const first = pos.find((p) => p.g === g), lastP = [...pos].reverse().find((p) => p.g === g);
    if (!first) continue;
    if (wide) {
      const span = lastP.x + cell - first.x;
      svg.append('text').attr('class', 'group-title fp-city-title').attr('x', first.x).attr('y', 14).text(span >= g.label.length * 7 + 8 ? g.label : (g.short ?? g.label.split(' ')[0]));
      svg.append('line').attr('class', 'fp-bracket').attr('x1', first.x).attr('x2', lastP.x + cell).attr('y1', 24).attr('y2', 24);
    } else {
      svg.append('text').attr('class', 'group-title').attr('x', 0).attr('y', first.titleY + 14).text(g.label);
    }
  }

  const cols = svg.append('g').attr('class', 'fp-cells').selectAll('g').data(pos).join('g')
    .attr('class', 'fp-cell').attr('data-col', (d) => d.col).attr('transform', (d) => `translate(${d.x},${d.y})`);
  cols.append('rect').attr('class', 'fp-hit').attr('x', -GAP / 2).attr('y', -2).attr('width', cell + GAP).attr('height', colH + 4);
  // stacked from the baseline up: 0, 1, 2, then 3 on top, so the low marks read as a bar from the bottom
  cols.each(function (d) {
    const s = layout.stats.get(d.col);
    const gsel = d3.select(this);
    if (!s.rated) { gsel.append('rect').attr('class', 'fp-sq').attr('width', cell).attr('height', colH).attr('fill', 'none'); return; }
    let acc = 0;
    for (const v of [0, 1, 2, 3]) {
      const h = (s.dist[v] / s.rated) * colH;
      if (h <= 0) continue;
      gsel.append('rect').attr('x', 0).attr('width', cell).attr('y', colH - acc - h).attr('height', Math.max(0, h - (v < 3 ? 1 : 0))).attr('fill', ratingColor(v));
      acc += h;
    }
  });
  svg.append('line').attr('class', 'fp-base').attr('x1', 0).attr('x2', width).attr('y1', (wide ? 34 : 0) + colH + 0.5).attr('y2', (wide ? 34 : 0) + colH + 0.5).attr('hidden', wide ? null : true);

  const flat = pos.map((p) => ({ ...p, it: { stat: layout.stats.get(p.col) } }));
  bindCells(svg, cols, flat, (d) => cityTip(d.it.stat, n), (d) => `${d.it.stat.label}: ${pct(d.it.stat.lowShare)} rated 0 or 1, ${pct(d.it.stat.belowTopShare)} rated 2 or lower, across ${fmt.n(d.it.stat.rated)} buildings.`);
}

function cityTip(s, n) {
  const row = (v) => `<dt><span class="swatch bar" style="background:${ratingColor(v)}"></span> ${v}</dt><dd>${pct(s.dist[v] / s.rated, 1)} (${fmt.n(s.dist[v])})</dd>`;
  return `<div class="tt-title">${esc(s.label)}</div><div class="tt-sub">${esc(s.groupLabel)} · ${fmt.n(s.rated)} buildings rated it</div>
    <dl>${[3, 2, 1, 0].map(row).join('')}<dt>N/A</dt><dd>${fmt.n(s.na)} of ${fmt.n(n)} buildings (not counted)</dd></dl>`;
}

function renderCityNotes(layout, ctx) {
  const f = cityFindings(layout);
  const where = ctx.ward ? `In ${esc(ctx.pm.latest.find((r) => r.ward === ctx.ward)?.wardName ?? 'this ward')}` : 'Across Toronto';
  const list = (xs, key) => xs.map((s) => `${esc(s.label.toLowerCase())} (${pct(s[key])})`);
  const and = (a) => (a.length > 1 ? `${a.slice(0, -1).join(', ')} and ${a.at(-1)}` : a[0] ?? '');
  $('fp-city-notes').innerHTML = `
    <p><b>${where}, the same few items keep getting marked down.</b> The physical items most often rated below the top mark (2 or lower) are ${and(list(f.belowTop, 'belowTopShare'))}.</p>
    ${f.recordsLow.length ? `<p><b>Paperwork counts too.</b> ${and(f.recordsLow.map((s) => `${pct(s.lowShare)} of buildings got a 0 or 1 for their ${esc(s.label.toLowerCase())}`))}. A building can look fine in the lobby and still be missing the records the City requires.</p>` : ''}`;
}

// ---- legend, table, method --------------------------------------------------------------------
function renderLegend() {
  const sw = (v, label) => `<span class="key"><span class="fp-key" style="background:${ratingColor(v)}">${v <= 1 ? v : ''}</span>${label}</span>`;
  $('fp-legend').innerHTML = `
    ${sw(3, '3 · top mark')}${sw(2, '2')}${sw(1, '1 · low')}${sw(0, '0 · lowest')}
    <span class="key"><span class="fp-key fp-key-na"></span>N/A · doesn't apply; not counted as a problem or in the score</span>
    <span class="key"><span class="fp-key fp-key-ring" style="background:${ratingColor(1)}">1</span>uncommon low mark (fewer than ${pct(UNCOMMON_SHARE)} of Toronto buildings)</span>`;
}

function renderTable(layout, pa, pb) {
  const cellTxt = (p, col) => {
    if (!p) return '–';
    const i = p.groups.flatMap((g) => g.items).find((x) => x.col === col);
    return i.status === 'rated' ? `${i.rating}${i.uncommon ? ' (uncommon)' : ''}` : i.status === 'na' ? 'N/A' : 'blank';
  };
  $('fp-table-head').innerHTML = `<tr><th scope="col">Item</th><th scope="col">Area</th><th scope="col">${pa ? esc(titleCase(pa.rec.address)) : 'A'}</th><th scope="col">${pb ? esc(titleCase(pb.rec.address)) : 'B'}</th><th scope="col">Toronto, rated 0–1</th></tr>`;
  $('fp-table-body').innerHTML = layout.groups.flatMap((g) => g.items.map((col) => {
    const s = layout.stats.get(col);
    return `<tr><th scope="row">${esc(s.label)}</th><td>${esc(g.label)}</td><td>${cellTxt(pa, col)}</td><td>${cellTxt(pb, col)}</td><td>${pct(s.lowShare, 1)}</td></tr>`;
  })).join('');
}

function renderMethod(pm, layout) {
  const nItems = layout.stats.size;
  $('fp-method').innerHTML = `<ul>
    <li><b>Source.</b> City of Toronto Open Data, <a href="https://open.toronto.ca/dataset/apartment-building-evaluation/" target="_blank" rel="noopener">Apartment Building Evaluations</a>, 2023–current file (RentSafeTO). Evaluations from ${formatDate(pm.dates[0])} to ${formatDate(pm.dates[1])}.</li>
    <li><b>One building, one inspection.</b> Each fingerprint shows a building's most recent evaluation. Earlier inspections are not averaged in. ${fmt.n(pm.latest.length)} buildings.</li>
    <li><b>Ratings.</b> Inspectors rate up to ${nItems} items from 0 to 3. The data doesn't publish a word for each value, so we show the number. 3 is the top mark: the overall score rises with the average item rating. We call 0 or 1 a <b>low mark</b> (the two lowest values) and say “below the top mark” for 2 or lower. We never call an item “failed”.</li>
    <li><b>N/A is not a problem.</b> N/A means the item doesn't apply (no pool, no elevator). It is left out of every count and drawn as an empty outline. The City's own “areas evaluated” count matches the number of items that are not N/A.</li>
    <li><b>Percentages.</b> Share of buildings = buildings with that rating ÷ buildings where the item was rated (N/A excluded). “Uncommon” means fewer than ${pct(UNCOMMON_SHARE)} of rated buildings got a 0 or 1 on that item.</li>
    <li><b>Groups.</b> The five areas are our grouping of the City's item names, chosen so a renter can picture where each item is. Within each area, items are ordered from most to least often low-rated across Toronto, so every fingerprint uses the same layout.</li>
    <li><b>Example pairs.</b> For a chosen score, we pair the building with the most low marks with one at the same score that has the fewest, and step through further pairs in the same way. When you pick a building yourself, the comparison is the building at the same score whose ratings differ most.</li>
    <li><b>Limits.</b> Ratings describe common areas on inspection day, not individual units, rents or how the landlord responds. The 2017–2023 system used different items and a 1–5 scale, so it isn't shown here.</li>
  </ul>`;
}
