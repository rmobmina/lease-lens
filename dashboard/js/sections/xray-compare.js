// "Same score. Different story." The selected building next to another building with the same
// (or, if none, a labelled near) overall score, category by category, on aligned scales (D3).
// Matching rules live in ../xray-model.js (findMatches) and are tested.

import { itemLabel } from '../model.js';
import { zoneByKey, zoneDifferences, findMatches, ratingClass } from '../xray-model.js';
import { tip, pct, esc, titleCase, formatDate } from '../ui.js';

const ORDER = ['exterior', 'systems', 'shared', 'records', 'grounds'];
const MAX_OPTIONS = 40;

export function renderCompare(box, { rec, pm, ctx, M, matchRsn, onChoose, onOpen }) {
  if (!rec) {
    box.innerHTML = `<p class="card-text">This building has no evaluation in the ${esc(pm.P.long)}, so there's no score to match. Switch the scoring system in the sidebar to compare it.</p>`;
    return;
  }
  let res = findMatches(rec, ctx.latest, pm.cats);
  let scope = ctx.ward ? `in ${esc(M.wardName.get(ctx.ward))}` : 'in Toronto';
  if (!res.matches.length && ctx.ward) { res = findMatches(rec, pm.latest, pm.cats); scope = `in Toronto (none in ${esc(M.wardName.get(ctx.ward))})`; }
  if (!res.matches.length) {
    box.innerHTML = `<p class="card-text">No other building in the ${esc(pm.P.long)} scored within 2 points of ${rec.score}, so there's nothing comparable to show.</p>`;
    return;
  }
  const chosen = res.matches.find((m) => m.rec.rsn === matchRsn) ?? res.matches[0];
  const options = res.matches.slice(0, MAX_OPTIONS);
  if (!options.includes(chosen)) options.push(chosen);
  const pa = res.base, pb = chosen.profile, a = rec, b = chosen.rec;
  const diffs = zoneDifferences(pa, pb);
  const top = diffs[0];

  const tolText = res.tolerance === 0
    ? `${res.matches.length} other building${res.matches.length === 1 ? '' : 's'} ${scope} also scored <b>${rec.score}</b> in their latest evaluation.`
    : `No other building ${scope} scored exactly ${rec.score}, so these are <b>within ±${res.tolerance} point${res.tolerance === 1 ? '' : 's'}</b>.`;

  box.innerHTML = `
    <div class="xr-cmp-controls">
      <label class="field"><span class="field-label">Compare with</span>
        <select id="xr-cmp-select">${options.map((m) => `<option value="${m.rec.rsn}" ${m === chosen ? 'selected' : ''}>${esc(titleCase(m.rec.address))} · score ${m.rec.score} · ${m.profile.poor} rated poorly</option>`).join('')}</select></label>
      <p class="xr-cmp-note">${tolText} ${res.matches.length > 1 ? `Listed from the most different inspection profile to the least${res.matches.length > MAX_OPTIONS ? ` (first ${MAX_OPTIONS} shown)` : ''}.` : ''}</p>
    </div>
    <p class="fp-verdict xr-cmp-verdict" aria-live="polite">${verdict(pa, pb, top)}</p>
    <div class="xr-cmp-pair">
      ${card('This building', a, pa, null)}
      ${card(res.tolerance === 0 ? 'Same score' : `Within ±${res.tolerance}`, b, pb, b.rsn)}
    </div>
    <div class="xr-cmp-chart chart" id="xr-cmp-chart"></div>
    <div class="legend xr-cmp-legend" aria-hidden="true">
      <span class="fp-legend-label">Item rating</span>
      ${[['p3', `${pa.scale.max} · top mark`], ['p2', 'below top'], ['p1', 'poor'], ['p0', `${pa.scale.min} · lowest`]].map(([k, l]) => `<span class="key"><span class="xr-pip-key r-${k}"></span>${l}</span>`).join('')}
      <span class="key"><span class="xr-pip-key r-na"></span>N/A</span>
    </div>
    <details class="fp-table"><summary>Show the comparison as a table</summary><div class="fp-table-scroll"><table>
      <thead><tr><th scope="col">Category</th><th scope="col">${esc(titleCase(a.address))}</th><th scope="col">${esc(titleCase(b.address))}</th></tr></thead>
      <tbody>${ORDER.map((k) => { const za = pa.zones.find((z) => z.key === k), zb = pb.zones.find((z) => z.key === k); return `<tr><th scope="row">${esc(zoneByKey.get(k).label)}</th><td>${cellTxt(za)}</td><td>${cellTxt(zb)}</td></tr>`; }).join('')}</tbody>
    </table></div></details>`;

  box.querySelector('#xr-cmp-select').addEventListener('change', (e) => onChoose(e.target.value));
  box.querySelector('[data-open]')?.addEventListener('click', (e) => onOpen(e.currentTarget.dataset.open));
  drawMatrix(box.querySelector('#xr-cmp-chart'), pa, pb, top);
}

const cellTxt = (z) => (z.status === 'none' ? 'Not evaluated' : `${z.poor} of ${z.applicable} rated poorly (${pct(z.share)})`);

function card(label, r, p, openRsn) {
  return `<article class="xr-cmp-card">
    <p class="card-label">${label}</p>
    <h3 class="xr-cmp-name">${esc(titleCase(r.address))}</h3>
    <p class="fp-meta">Ward ${+r.ward} · ${esc(r.wardName)} · evaluated ${formatDate(r.date)}</p>
    <p class="fp-score"><span class="fp-score-num">${r.score}</span><span class="fp-score-of">/100</span>
      <span class="fp-score-sub">${p.poor ? `<b>${p.poor}</b> of ${p.applicable} items rated poorly` : `none of ${p.applicable} items rated poorly`}</span></p>
    ${openRsn ? `<button type="button" class="btn btn-sm" data-open="${openRsn}">Open its X-Ray</button>` : '<p class="xr-cmp-here">Shown in the X-Ray above</p>'}
  </article>`;
}

function verdict(pa, pb, top) {
  const same = pa.rec.score === pb.rec.score;
  const lead = same ? `Both buildings scored <b>${pa.rec.score}</b>.` : `They scored <b>${pa.rec.score}</b> and <b>${pb.rec.score}</b>.`;
  const counts = `This building had ${pa.poor} item${pa.poor === 1 ? '' : 's'} rated poorly; the other had ${pb.poor}.`;
  if (!top?.comparable || top.gap === 0) return `${lead} ${counts} Their category profiles are the same.`;
  return `${lead} ${counts} The biggest gap is in <b>${esc(top.label.toLowerCase())}</b>: ${pct(top.a.share)} of applicable items rated poorly here, against ${pct(top.b.share)} there.`;
}

// Aligned profile: one row per category, the same 0–100% scale for both buildings, and the
// category's items as squares in the same order on both sides, so they can be read across.
function drawMatrix(box, pa, pb, top) {
  box.innerHTML = '';
  const width = Math.max(300, box.clientWidth);
  const narrow = width < 620;
  const labelW = narrow ? 0 : 200;
  const gap = 24;
  const colW = (width - labelW - gap) / 2;
  const maxItems = Math.max(...pa.zones.map((z) => z.items.length), 1);
  const cell = Math.max(6, Math.min(12, Math.floor((colW - 4) / maxItems) - 2));
  const rowH = (narrow ? 20 : 0) + 50;
  const H = ORDER.length * rowH + 22;
  const svg = d3.select(box).append('svg').attr('viewBox', `0 0 ${width} ${H}`).attr('width', width).attr('height', H)
    .attr('role', 'img').attr('aria-label', `Category profiles side by side. ${ORDER.map((k) => { const a = pa.zones.find((z) => z.key === k), b = pb.zones.find((z) => z.key === k); return `${zoneByKey.get(k).label}: ${cellTxt(a)} here, ${cellTxt(b)} there`; }).join('. ')}.`);
  const x = d3.scaleLinear().domain([0, 1]).range([0, colW - 64]);
  const cols = [{ p: pa, x0: labelW }, { p: pb, x0: labelW + colW + gap }];

  // headers + shared scale ticks
  for (const c of cols) {
    svg.append('text').attr('class', 'group-title').attr('x', c.x0).attr('y', 12).text(titleCase(c.p.rec.address));
  }
  ORDER.forEach((k, i) => {
    const y0 = 22 + i * rowH;
    const isTop = top?.comparable && top.gap !== 0 && top.key === k;
    if (isTop) svg.append('rect').attr('class', 'xr-cmp-hl').attr('x', 0).attr('y', y0 - 2).attr('width', width).attr('height', rowH - 4).attr('rx', 6);
    const yLabel = narrow ? y0 + 12 : y0 + 16;
    const lab = svg.append('text').attr('class', 'row-label').attr('x', 0).attr('y', yLabel).text(zoneByKey.get(k).label);
    if (isTop) {
      if (narrow) lab.append('tspan').attr('class', 'row-sub').text('  · largest difference');
      else svg.append('text').attr('class', 'row-sub').attr('x', 0).attr('y', yLabel + 16).text('Largest difference');
    }
    const yb = y0 + (narrow ? 20 : 6);
    for (const c of cols) {
      const z = c.p.zones.find((d) => d.key === k);
      const g = svg.append('g').attr('transform', `translate(${c.x0},${yb})`);
      g.append('rect').attr('class', 'xr-cmp-track').attr('width', x(1)).attr('height', 10).attr('rx', 2);
      if (z.status !== 'none') g.append('rect').attr('class', `xr-cmp-bar s-${z.status}`).attr('width', Math.max(z.poor ? 2 : 0, x(z.share))).attr('height', 10).attr('rx', 2);
      g.append('text').attr('class', 'value').attr('x', x(1) + 8).attr('y', 9)
        .html(z.status === 'none' ? 'not evaluated' : `<tspan class="value-strong">${pct(z.share)}</tspan> · ${z.poor}/${z.applicable}`);
      const sq = g.append('g').attr('transform', 'translate(0,18)').selectAll('rect').data(z.items).join('rect')
        .attr('class', (it) => `xr-sq r-${it.status === 'rated' ? ratingClass(it.rating, c.p.scale) : 'na'}`)
        .attr('x', (it, j) => j * (cell + 2) + 0.5).attr('y', 0.5).attr('width', cell - 1).attr('height', cell - 1).attr('rx', 1.5);
      sq.on('mouseenter', (ev, it) => tip.show(`<div class="tt-title">${esc(itemLabel(it.col))}</div><div class="tt-sub">${esc(titleCase(c.p.rec.address))}</div>
          <dl><dt>Rating</dt><dd>${it.status === 'rated' ? `<b>${it.rating}</b> of ${c.p.scale.max}${it.poor ? ' (poor)' : ''}` : it.status === 'na' ? 'N/A (not counted)' : 'Not recorded'}</dd></dl>`, ev))
        .on('mousemove', (ev) => tip.move(ev)).on('mouseleave', () => tip.hide());
    }
  });
  // scale ticks under the last row
  for (const c of cols) {
    const g = svg.append('g').attr('class', 'axis').attr('transform', `translate(${c.x0},${H - 4})`);
    for (const v of [0, 0.5, 1]) g.append('text').attr('x', x(v)).attr('text-anchor', v === 0 ? 'start' : v === 1 ? 'end' : 'middle').attr('font-size', 11).attr('fill', 'currentColor').text(`${v * 100}%`);
  }
}

