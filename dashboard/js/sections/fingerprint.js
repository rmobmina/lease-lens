// Inspection fingerprint (the project's novel view): what lies underneath one RentSafeTO score.
// Each building's latest evaluation is laid out on the same grid: one square per inspection
// item, grouped into five areas, coloured by the item's rating. Because every item sits in the
// same place for every building, two fingerprints can be compared at a glance.
// All data work lives in ../fingerprint-model.js; this file only draws and handles input.

import { enhanceSelect } from '../components/select.js';
import { itemLabel } from '../model.js';
import { itemStats, buildingProfile, sameScorePairs, contrastFor, scoreOptions, cityFindings, SCALE_MAX, UNCOMMON_SHARE } from '../fingerprint-model.js';
import { tip, pct, fmt, esc, titleCase, formatDate, cssVar, anchorEvent } from '../ui.js';
import { renderProfile } from './fp-profile.js';

const $ = (id) => document.getElementById(id);
const GAP = 3;
const PER_ROW = 13; // the largest group has 13 items, so each group fits on one row when there's room
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

let layoutCache = { key: null, layout: null };
const prevFill = { a: new Map(), b: new Map() }; // last colours drawn, so a change of building animates
let wired = false;

const ratingColor = (v) => cssVar(`--fp-${v}`);
const ratingText = (v) => `${v} of ${SCALE_MAX}`;

export function renderFingerprint(ctx, M, state) {
  const { pm } = ctx;
  wire(ctx);
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
  const sel = $('fp-score');
  sel.innerHTML = options.map((o) => `<option value="${o.score}" ${o.score === state.score ? 'selected' : ''}>${o.score} (${fmt.n(o.n)} buildings)</option>`).join('');
  sel.disabled = mode === 'custom';
  $('fp-next').hidden = mode === 'custom' || pairs.length < 2;
  $('fp-next').textContent = pairs.length > 1 ? `Show another pair (${(state.pairIndex % pairs.length) + 1} of ${pairs.length})` : '';
  $('fp-reset').hidden = mode !== 'custom';
  $('fp-a').placeholder = a ? titleCase(a.address) : 'Search an address…';
  $('fp-b').placeholder = b ? titleCase(b.address) : 'Search an address…';

  // ---- intro numbers (computed, not typed) -------------------------------------
  const scores = pm.latest.map((r) => r.score).sort(d3.ascending);
  $('fp-spread').innerHTML = `Half of Toronto's ${fmt.n(scores.length)} evaluated buildings score between <b>${d3.quantileSorted(scores, 0.25)}</b> and <b>${d3.quantileSorted(scores, 0.75)}</b>`;
  renderLegend();

  // ---- the pair -------------------------------------------------------------------
  const pa = a && buildingProfile(a, layout);
  const pb = b && buildingProfile(b, layout);
  $('fp-verdict').innerHTML = pa && pb ? verdict(pa, pb, mode) : 'Not enough buildings with this score to compare.';
  renderProfile($('fp-profile'), pa, pb);
  drawBuilding($('fp-a-card'), pa, 'a', ctx, pm);
  drawBuilding($('fp-b-card'), pb, 'b', ctx, pm);
  renderTable(layout, pa, pb);

  // ---- Toronto overview -------------------------------------------------------------
  const cityLayout = ctx.ward ? { groups: layout.groups, stats: itemStats(ctx.latest, pm.cats, itemLabel).stats } : layout;
  drawCity($('fp-city-chart'), cityLayout, ctx.latest.length);
  renderCityNotes(cityLayout, ctx);
  renderMethod(pm, layout);
}

// ---- input --------------------------------------------------------------------------
function wire(ctx) {
  if (wired) return;
  wired = true;
  $('fp-score').addEventListener('change', (e) => ctx.setFp({ score: +e.target.value, pairIndex: 0 }));
  enhanceSelect($('fp-score'), { search: true, searchLabel: 'Search scores', placeholder: 'Find a score…' });
  $('fp-next').addEventListener('click', () => ctx.setFp((s) => ({ pairIndex: s.pairIndex + 1 })));
  $('fp-reset').addEventListener('click', () => ctx.setFp({ a: null, b: null, pairIndex: 0 }, '#/compare'));
  const pick = (input, slot) => {
    const go = () => {
      const r = ctx.findBuilding(input.value);
      if (!r) return;
      input.value = '';
      ctx.setFp((s) => (slot === 'a' ? { a: r.rsn, b: null } : { a: s.a ?? s.shownA, b: r.rsn }));
    };
    input.addEventListener('change', go);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  };
  pick($('fp-a'), 'a');
  pick($('fp-b'), 'b');
  $('fp-goto-cur').addEventListener('click', () => ctx.setPeriod('cur'));
}

// ---- annotations ------------------------------------------------------------------------
function verdict(pa, pb, mode) {
  const name = (p) => `<b>${esc(titleCase(p.rec.address))}</b>`;
  const same = pa.rec.score === pb.rec.score;
  const lead = same ? `Both buildings scored <b>${pa.rec.score}</b>.` : `These scored <b>${pa.rec.score}</b> and <b>${pb.rec.score}</b>.`;
  const desc = (p) => {
    if (!p.low.length) return `${name(p)} had no item rated 0 or 1`;
    const g = d3.greatest(p.groups, (x) => x.low);
    return `${name(p)} had <b>${p.low.length}</b> item${p.low.length === 1 ? '' : 's'} rated 0 or 1${g.low > 1 ? `, ${g.low} of them in ${g.label.toLowerCase()}` : ''}`;
  };
  const tail = mode === 'example' ? ' Same number, different problems.' : '';
  return `${lead} ${desc(pa)}; ${desc(pb)}.${tail}`;
}

function notesFor(p, pm) {
  const r = p.rec;
  const out = [];
  if (p.low.length) {
    const g = d3.greatest(p.groups, (x) => (x.rated ? x.low / x.rated : 0));
    out.push(`Weakest area: <b>${esc(g.label.toLowerCase())}</b>, with ${g.low} of ${g.rated} items rated 0 or 1.`);
  } else {
    out.push(`No item rated 0 or 1. ${p.belowTop} of ${p.rated} items were rated 2, one below the top mark.`);
  }
  for (const i of p.uncommon.slice(0, 3)) {
    out.push(`<span class="fp-ring" aria-hidden="true"></span><b>${esc(i.stat.label)}</b> rated ${i.rating}: only ${pct(i.stat.lowShare, 1)} of Toronto buildings get a mark this low.`);
  }
  if (p.na) out.push(`${p.na} item${p.na === 1 ? '' : 's'} marked N/A (doesn't apply). These aren't counted as problems or in the score.`);
  if (r.reactive != null && r.reactive < 0) out.push(`The score includes a reactive adjustment of ${r.reactive} points (the City's “current reactive score”).`);
  const evs = pm.recs.filter((d) => d.rsn === r.rsn).length;
  out.push(`Inspected ${formatDate(r.date)}${evs > 1 ? `, the latest of ${evs} evaluations since 2023` : ''}.`);
  return out;
}

// ---- one building ------------------------------------------------------------------------
function drawBuilding(card, p, slot, ctx, pm) {
  const head = card.querySelector('.fp-head'), chart = card.querySelector('.fp-chart'), notes = card.querySelector('.fp-notes'), lows = card.querySelector('.fp-lows');
  chart.innerHTML = '';
  if (!p) { head.innerHTML = '<p class="card-text">No building to show.</p>'; notes.innerHTML = ''; lows.innerHTML = ''; return; }
  const r = p.rec;
  head.innerHTML = `
    <p class="card-label">Building ${slot.toUpperCase()}</p>
    <h2 class="fp-name"><a href="#/explore?b=${r.rsn}">${esc(titleCase(r.address))}</a></h2>
    <p class="fp-meta">Ward ${+r.ward} · ${esc(r.wardName)}${r.yearBuilt ? ` · built ${r.yearBuilt}` : ''} · ${r.units ?? '–'} units</p>
    <p class="fp-score"><span class="fp-score-num">${r.score}</span><span class="fp-score-of">/100</span>
      <span class="fp-score-sub">${p.low.length ? `<b>${p.low.length}</b> of ${p.rated} items rated 0 or 1` : `none of ${p.rated} items rated 0 or 1`}</span></p>`;

  const width = Math.max(260, chart.clientWidth);
  const cell = Math.max(16, Math.min(28, Math.floor((width + GAP) / PER_ROW - GAP)));
  const perRow = Math.max(1, Math.floor((width + GAP) / (cell + GAP)));
  const titleH = 22, groupGap = 14;
  let y = 0;
  const rows = p.groups.map((g) => {
    const top = y;
    const lines = Math.ceil(g.items.length / perRow) || 1;
    y += titleH + lines * (cell + GAP) + groupGap;
    return { g, top };
  });
  const height = y - groupGap + 2;
  const svg = d3.select(chart).append('svg').attr('viewBox', `0 0 ${width} ${height}`).attr('width', width).attr('height', height)
    .attr('role', 'img').attr('aria-label', `Inspection fingerprint for ${titleCase(r.address)}: ${p.rated} items rated, ${p.low.length} rated 0 or 1. ${p.groups.map((g) => `${g.label}: ${g.low} of ${g.rated} rated 0 or 1`).join('. ')}. Full list in the table below.`);

  const flat = [];
  for (const { g, top } of rows) {
    const gg = svg.append('g').attr('transform', `translate(0,${top})`);
    gg.append('text').attr('class', 'group-title').attr('x', 0).attr('y', 14).text(g.label);
    gg.append('text').attr('class', 'value').attr('x', width).attr('y', 14).attr('text-anchor', 'end')
      .html(g.rated ? `<tspan class="${g.low ? 'value-strong' : ''}">${g.low}</tspan> of ${g.rated} at 0–1` : 'not rated');
    g.items.forEach((it, i) => flat.push({ it, x: (i % perRow) * (cell + GAP), y: top + titleH + Math.floor(i / perRow) * (cell + GAP) }));
  }

  const old = prevFill[slot];
  const animate = !reduceMotion() && old.size && old.get('__rsn') !== r.rsn;
  const cells = svg.append('g').attr('class', 'fp-cells').selectAll('g').data(flat).join('g')
    .attr('class', (d) => `fp-cell ${d.it.status}`).attr('data-col', (d) => d.it.col)
    .attr('transform', (d) => `translate(${d.x},${d.y})`);
  cells.append('rect').attr('class', 'fp-hit').attr('x', -GAP / 2).attr('y', -GAP / 2).attr('width', cell + GAP).attr('height', cell + GAP);
  const sq = cells.append('rect').attr('class', 'fp-sq').attr('width', cell).attr('height', cell).attr('rx', 2);
  sq.filter((d) => d.it.status === 'rated')
    .attr('fill', (d) => (animate && old.has(d.it.col) ? old.get(d.it.col) : ratingColor(d.it.rating)))
    .transition().duration(animate ? 380 : 0).attr('fill', (d) => ratingColor(d.it.rating));
  // N/A and blank: an empty outline, never a coloured (problem-looking) square
  sq.filter((d) => d.it.status !== 'rated').attr('fill', 'none').attr('x', 0.5).attr('y', 0.5).attr('width', cell - 1).attr('height', cell - 1);
  // The digit repeats the colour for low marks, so they don't depend on colour vision.
  cells.filter((d) => d.it.low).append('text').attr('class', 'fp-digit').attr('x', cell / 2).attr('y', cell / 2 + 4).attr('text-anchor', 'middle').text((d) => d.it.rating);
  cells.filter((d) => d.it.uncommon).append('rect').attr('class', 'fp-uncommon').attr('x', -2).attr('y', -2).attr('width', cell + 4).attr('height', cell + 4).attr('rx', 3);
  prevFill[slot] = new Map([['__rsn', r.rsn], ...flat.filter((d) => d.it.status === 'rated').map((d) => [d.it.col, ratingColor(d.it.rating)])]);

  bindCells(svg, cells, flat, (d) => cellTip(d.it, r, pm), (d) => cellSpoken(d.it));

  // Direct labels: the low marks, listed by name (no hovering needed).
  lows.innerHTML = p.low.length
    ? `<p class="card-sub">Rated 0 or 1</p><ul class="fp-low-list">${[...p.low].sort((x, y) => x.rating - y.rating || x.stat.lowShare - y.stat.lowShare).map((i) => `
      <li data-col="${esc(i.col)}"><span class="fp-chip" style="background:${ratingColor(i.rating)}" aria-hidden="true">${i.rating}</span>
        <span class="fp-low-name">${esc(i.stat.label)}${i.uncommon ? '<span class="fp-ring" title="Uncommon low mark" aria-label="uncommon"></span>' : ''}</span>
        <span class="fp-low-city">${pct(i.stat.lowShare)} of buildings</span></li>`).join('')}</ul>`
    : '';
  notes.innerHTML = `<ul class="fp-note-list">${notesFor(p, pm).map((n) => `<li>${n}</li>`).join('')}</ul>`;
  ctx.registerShown?.(slot, r.rsn);
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
function bindCells(svg, cells, flat, tipHtml, spoken) {
  const hot = (col) => document.querySelectorAll('#fp-main [data-col]').forEach((n) => n.classList.toggle('is-hot', n.dataset.col === col));
  cells.on('mouseenter', function (ev, d) { hot(d.it.col); tip.show(tipHtml(d), ev); })
    .on('mousemove', (ev) => tip.move(ev))
    .on('mouseleave', () => { hot(null); tip.hide(); });
  const group = svg.select('.fp-cells').attr('tabindex', 0).attr('role', 'group')
    .attr('aria-label', 'Inspection items. Use the arrow keys to move between items.');
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
    colH = 120;
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
  $('fp-legend').innerHTML = `<span class="fp-legend-label">Item rating</span>
    ${sw(3, '3 · top mark')}${sw(2, '2')}${sw(1, '1')}${sw(0, '0 · lowest')}
    <span class="key"><span class="fp-key fp-key-na"></span>N/A · doesn't apply</span>
    <span class="key"><span class="fp-key fp-key-ring" style="background:${ratingColor(1)}">1</span>uncommon low mark</span>`;
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
