// Q5: Which buildings improved or declined the most between evaluations?
// A ranked list built for the narrow analysis panel: each row is the address (shortened to the room it has,
// in full on hover, focus and in its accessible name) over the two scores and the ward, then a bar for the size
// of the change and the signed change. Rises and drops share one scale; direction is carried by the glyph
// (▲ ▼), the sign and the group title as well as by colour.

import { biggestMovers } from '../model.js';
import { setFinding, tip, fmt, pct, esc, titleCase, signed, svgIn, cssVar, legendKey, formatDate, empty } from '../ui.js';
import { snapshot, play } from '../chart-motion.js';

const ROW = 36, HEAD = 28, AXIS = 22, DEFAULT_N = 5, MAX_N = 10;

// Shorten an SVG text to fit `max` px, ending with an ellipsis; the full text stays in its <title>.
function fitText(node, max) {
  const full = node.textContent;
  if (node.getComputedTextLength() <= max) return;
  let lo = 0, hi = full.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    node.textContent = `${full.slice(0, mid).trimEnd()}…`;
    if (node.getComputedTextLength() <= max) lo = mid; else hi = mid - 1;
  }
  node.textContent = `${full.slice(0, lo).trimEnd()}…`;
}

export function renderMovers(ctx, state) {
  const { pairs, pm, ward, selected } = ctx;
  const box = document.getElementById('movers-chart');
  const before = snapshot(box);
  box.innerHTML = '';
  const C = { up: cssVar('--up'), down: cssVar('--down') };
  // no separate colour key: the group titles, the ▲ ▼ glyphs and the signs already say which way each moved
  document.getElementById('movers-legend').hidden = true;
  if (!pairs.length) { empty(box, 'No re-inspections for this selection.'); setFinding('q5-takeaway', null); return; }

  // How many rows: the top 5 of each list by default (up to 10 when only one direction is shown), never more
  // than the panel's height holds. The group titles say how many are listed.
  const dir = state.dir ?? 'both';
  const nGroups = dir === 'both' ? 2 : 1;
  const own = selected && pm.pairs.filter((p) => p.rsn === selected);
  const ownExtra = own?.length ? HEAD + ROW : 0;
  const room = box.clientHeight > 120 ? box.clientHeight - AXIS - nGroups * HEAD - ownExtra : Infinity;
  const cap = dir === 'both' ? DEFAULT_N : MAX_N;
  const n = Math.max(1, Math.min(cap, Math.floor(room / ROW / nGroups)));
  const { up, down } = biggestMovers(pairs, n);
  const groups = [
    dir !== 'down' && { key: 'up', title: `Biggest rises · top ${up.length}`, rows: up },
    dir !== 'up' && { key: 'down', title: `Biggest drops · top ${down.length}`, rows: down },
  ].filter((g) => g && g.rows.length);
  // the selected building, if it isn't listed: its own largest change, underneath
  const listed = new Set(groups.flatMap((g) => g.rows).map((p) => p.rsn));
  if (own?.length && !listed.has(selected) && box.clientHeight - AXIS - d3.sum(groups, (g) => HEAD + g.rows.length * ROW) >= HEAD + ROW) {
    groups.push({ key: 'own', title: 'Your selected building', rows: [d3.greatest(own, (p) => Math.abs(p.delta))] });
  }

  const H = d3.sum(groups, (g) => HEAD + g.rows.length * ROW) + AXIS;
  const { svg, width } = svgIn(box, H, `Ranked bars: the buildings whose score changed most between consecutive evaluations. ${groups.map((g) => g.title).join('; ')}.`);
  const labelW = Math.round(Math.min(300, width * 0.52));
  const valueW = 52;
  const x0 = labelW + 8;
  const maxAbs = d3.max(groups.flatMap((g) => g.rows), (p) => Math.abs(p.delta));
  const x = d3.scaleLinear().domain([0, maxAbs]).nice().range([x0, width - valueW]);

  // light gridlines and a points axis under the bars
  // three ticks (0, the middle, the end) so the labels never meet in a narrow panel; the unit on the last one
  const [, xMax] = x.domain();
  const ticks = [0, xMax / 2, xMax];
  svg.append('g').attr('class', 'grid').attr('transform', `translate(0,${H - AXIS})`)
    .call(d3.axisBottom(x).tickValues(ticks).tickSize(-(H - AXIS)).tickFormat(''));
  svg.append('g').attr('class', 'axis').attr('transform', `translate(0,${H - AXIS})`)
    .call(d3.axisBottom(x).tickValues(ticks).tickSizeOuter(0).tickFormat((v) => (v === xMax ? `${v} pts` : `${v}`)))
    .call((a) => a.select('.tick:last-of-type text').attr('text-anchor', 'end').attr('dx', 4));

  let yOff = 0;
  for (const g of groups) {
    svg.append('text').attr('class', 'group-title').attr('x', 0).attr('y', yOff + 20).text(g.title);
    yOff += HEAD;
    const rows = svg.append('g').selectAll('g').data(g.rows).join('g')
      .attr('class', (p) => `row${p.rsn === selected ? ' selected' : ''}`)
      .attr('data-k', (p) => `${g.key}|${p.rsn}|${p.b.date}`)
      .attr('transform', (p, i) => `translate(0,${yOff + i * ROW})`)
      .attr('tabindex', 0).attr('role', 'button')
      .attr('aria-label', (p) => `${titleCase(p.b.address)}, ${p.b.wardName}: ${p.delta > 0 ? 'up' : 'down'} ${Math.abs(p.delta)} points, from ${p.a.score} to ${p.b.score}. Press Enter to show it on the map.`)
      .on('click', (ev, p) => { tip.hide(); ctx.select(p.rsn, { from: 'movers' }); })
      .on('keydown', (ev, p) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); ctx.select(p.rsn, { from: 'movers' }); } })
      .on('mouseenter', (ev, p) => tip.show(moverTip(p), ev))
      .on('mousemove', (ev) => tip.move(ev)).on('mouseleave', () => tip.hide())
      .on('focus', function (ev, p) { const b = this.getBoundingClientRect(); tip.show(moverTip(p), { clientX: b.left + b.width * 0.6, clientY: b.top + b.height }); })
      .on('blur', () => tip.hide());
    yOff += g.rows.length * ROW;

    rows.append('title').text((p) => `${titleCase(p.b.address)} · ${p.b.wardName}`);
    rows.append('rect').attr('class', 'row-hit').attr('x', -4).attr('y', 1).attr('width', width + 4).attr('height', ROW - 2).attr('rx', 4);
    rows.append('text').attr('class', 'row-label').attr('x', 0).attr('y', 15).text((p) => titleCase(p.b.address))
      .each(function () { fitText(this, labelW - 4); });
    rows.append('text').attr('class', 'row-sub').attr('x', 0).attr('y', 30).text((p) => `${p.a.score} → ${p.b.score} · ${p.b.wardName}`)
      .each(function () { fitText(this, labelW - 4); });
    const barH = 12, by = (ROW - barH) / 2 - 1;
    rows.append('path').attr('data-bar', '').attr('fill', (p) => (p.delta > 0 ? C.up : C.down)).attr('d', (p) => barPath(x0, x(Math.abs(p.delta)), by, barH));
    rows.append('text').attr('class', 'value').attr('data-val', '').attr('x', (p) => x(Math.abs(p.delta)) + 6).attr('y', by + barH / 2 + 4.5)
      .html((p) => `<tspan class="value-strong">${p.delta > 0 ? '▲' : '▼'} ${signed(p.delta)}</tspan>`);
  }
  play(before, box);

  // The finding adds what the list can't show (the list already names the biggest rise and drop): how rare
  // swings this size are.
  const big = pairs.filter((p) => Math.abs(p.delta) > 20).length;
  setFinding('q5-takeaway', {
    value: pct(big / pairs.length, 1),
    caption: `of ${fmt.n(pairs.length)} re-inspections${ward ? ' in this ward' : ''} changed by more than 20 points`,
    text: `Most scores move only a little between evaluations, so a swing at the top of this list is unusual for the building as well as for the city.`,
  });

  document.getElementById('q5-method').innerHTML = `<ul>
    <li>Each bar compares two consecutive evaluations of the same building within the ${pm.P.long}${ward ? ', for buildings in the selected ward' : ''}.</li>
    <li>Each building appears at most once per list, using its single largest increase (or decrease). Ties are ordered by address.</li>
    <li>Bar length is the size of the change in points, on one scale for rises and drops. Under each address are the earlier and later scores (for example 41 → 89) and the ward. Hover or focus a row for the full address and inspection dates; select it to show the building on the map.</li>
    <li>The panel lists the top 5 of each by default (up to 10 when showing only rises or only drops), fewer if the window is short.</li>
  </ul>`;
}

// Bar from the zero line with a 4px rounded data end and a square base.
function barPath(x0, x1, y, h) {
  const w = Math.abs(x1 - x0), r = Math.min(4, w / 2), dir = x1 >= x0 ? 1 : -1;
  if (w < 1) return `M${x0},${y}h${dir}v${h}h${-dir}z`;
  return `M${x0},${y}h${dir * (w - r)}a${r},${r} 0 0 ${dir > 0 ? 1 : 0} ${dir * r},${r}v${h - 2 * r}a${r},${r} 0 0 ${dir > 0 ? 1 : 0} ${-dir * r},${r}h${-dir * (w - r)}z`;
}

function moverTip(p) {
  return `<div class="tt-title">${esc(titleCase(p.b.address))}</div><div class="tt-sub">Ward ${p.b.ward} · ${esc(p.b.wardName)}</div>
    <dl><dt>Earlier</dt><dd><b>${p.a.score}</b> on ${formatDate(p.a.date)}</dd>
    <dt>Later</dt><dd><b>${p.b.score}</b> on ${formatDate(p.b.date)}</dd>
    <dt>Change</dt><dd><b>${signed(p.delta)}</b> points</dd>
    <dt>Built</dt><dd>${p.b.yearBuilt ?? 'not recorded'}</dd></dl>
    <div class="tt-hint">Click to select and show on the map</div>`;
}
