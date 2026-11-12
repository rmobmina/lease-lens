// Q5: Which buildings improved or declined the most between evaluations?
// Diverging bars from a shared zero: improvements extend right, declines extend left.

import { biggestMovers } from '../model.js';
import { setFinding, tip, fmt, pct, esc, titleCase, signed, svgIn, cssVar, legendKey, formatDate, empty } from '../ui.js';
import { snapshot, play } from '../chart-motion.js';

export function renderMovers(ctx, state) {
  const { pairs, pm, ward, selected } = ctx;
  const box = document.getElementById('movers-chart');
  const before = snapshot(box);
  box.innerHTML = '';
  const C = { up: cssVar('--up'), down: cssVar('--down') };
  document.getElementById('movers-legend').innerHTML = legendKey(C.up, '▲ Score went up', 'bar') + legendKey(C.down, '▼ Score went down', 'bar');
  if (!pairs.length) { empty(box, 'No re-inspections for this selection.'); setFinding('q5-takeaway', null); return; }

  const { up, down } = biggestMovers(pairs, state.n);
  const groups = [
    { title: 'Biggest improvements', rows: up },
    { title: 'Biggest declines', rows: down },
  ];
  // If the selected building isn't already listed, show its own biggest change underneath.
  const listed = new Set([...up, ...down].map((p) => p.rsn));
  if (selected && !listed.has(selected)) {
    const own = pm.pairs.filter((p) => p.rsn === selected);
    if (own.length) groups.push({ title: 'Your selected building (largest change)', rows: [d3.greatest(own, (p) => Math.abs(p.delta))] });
  }

  const narrow = box.clientWidth < 700;
  const rowH = narrow ? 50 : 28, headH = 32;
  const H = d3.sum(groups, (g) => headH + g.rows.length * rowH) + 30;
  const { svg, width } = svgIn(box, H, `Diverging bar chart of the buildings with the largest score increases and decreases between consecutive evaluations.`);
  const labelW = narrow ? 0 : Math.min(340, width * 0.38);
  const valueW = 92;
  const maxAbs = d3.max(groups.flatMap((g) => g.rows), (p) => Math.abs(p.delta));
  const x = d3.scaleLinear().domain([-maxAbs, maxAbs]).range([labelW + valueW, width - valueW]);
  const zx = x(0);

  // axis at the bottom + zero line
  svg.append('g').attr('class', 'grid').attr('transform', `translate(0,${H - 24})`)
    .call(d3.axisBottom(x).ticks(6).tickSize(-(H - 30)).tickFormat(''));
  svg.append('g').attr('class', 'axis').attr('transform', `translate(0,${H - 24})`)
    .call(d3.axisBottom(x).ticks(6).tickSizeOuter(0).tickFormat((v) => signed(v)));

  let yOff = 0;
  for (const g of groups) {
    svg.append('text').attr('class', 'group-title').attr('x', 0).attr('y', yOff + 22).text(g.title);
    yOff += headH;
    const rows = svg.append('g').selectAll('g').data(g.rows).join('g')
      .attr('class', (p) => `row${p.rsn === selected ? ' selected' : ''}`)
      .attr('data-k', (p) => `${g.title}|${p.rsn}|${p.b.date}`)
      .attr('transform', (p, i) => `translate(0,${yOff + i * rowH})`)
      .attr('tabindex', 0).attr('role', 'button')
      .attr('aria-label', (p) => `${titleCase(p.b.address)}: ${p.delta > 0 ? 'up' : 'down'} ${Math.abs(p.delta)} points, from ${p.a.score} to ${p.b.score}. Press Enter to select.`)
      .on('click', (ev, p) => { tip.hide(); ctx.select(p.rsn, { from: 'movers' }); })
      .on('keydown', (ev, p) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); ctx.select(p.rsn, { from: 'movers' }); } })
      .on('mouseenter', (ev, p) => tip.show(moverTip(p), ev))
      .on('mousemove', (ev) => tip.move(ev)).on('mouseleave', () => tip.hide())
      .on('focus', function (ev, p) { const b = this.getBoundingClientRect(); tip.show(moverTip(p), { clientX: b.left + b.width * 0.6, clientY: b.top + b.height }); })
      .on('blur', () => tip.hide());
    yOff += g.rows.length * rowH;

    const barH = 14;
    const by = narrow ? 26 : (rowH - barH) / 2;
    rows.append('rect').attr('class', 'row-hit').attr('x', 0).attr('y', 1).attr('width', width).attr('height', rowH - 2).attr('rx', 4);
    // address + ward on one line
    const lab = rows.append('text').attr('class', 'row-label').attr('x', narrow ? 0 : labelW - 8).attr('y', narrow ? 15 : by + barH / 2 + 4.5).attr('text-anchor', narrow ? 'start' : 'end');
    lab.append('tspan').text((p) => titleCase(p.b.address));
    lab.append('tspan').attr('class', 'row-sub').text((p) => `  ${p.b.wardName}`);
    rows.append('path').attr('data-bar', '').attr('fill', (p) => (p.delta > 0 ? C.up : C.down)).attr('d', (p) => barPath(zx, x(p.delta), by, barH));
    rows.append('text').attr('class', 'value').attr('data-val', '')
      .attr('x', (p) => x(p.delta) + (p.delta > 0 ? 8 : -8)).attr('y', by + barH / 2 + 4).attr('text-anchor', (p) => (p.delta > 0 ? 'start' : 'end'))
      .html((p) => `<tspan class="value-strong">${p.delta > 0 ? '▲' : '▼'} ${signed(p.delta)}</tspan>`);
    rows.append('text').attr('class', 'row-sub')
      .attr('x', (p) => (p.delta > 0 ? zx - 8 : zx + 8)).attr('y', by + barH / 2 + 4).attr('text-anchor', (p) => (p.delta > 0 ? 'end' : 'start'))
      .text((p) => `${p.a.score} → ${p.b.score}`);
  }
  svg.append('line').attr('x1', zx).attr('x2', zx).attr('y1', headH - 6).attr('y2', H - 24).attr('stroke', cssVar('--ink')).attr('stroke-width', 1.5);
  play(before, box);

  const top = up[0], bot = down[0];
  setFinding('q5-takeaway', top && {
    value: signed(top.delta),
    caption: `points: the biggest jump, at <b>${esc(titleCase(top.b.address))}</b> (${top.a.score} → ${top.b.score})`,
    text: `${bot ? `The biggest drop was ${esc(titleCase(bot.b.address))}, from ${bot.a.score} to ${bot.b.score}. ` : ''}Swings this large are uncommon: ${pct(pairs.filter((p) => Math.abs(p.delta) > 20).length / pairs.length, 1)} of re-inspections changed by more than 20 points.`,
  });

  document.getElementById('q5-method').innerHTML = `<ul>
    <li>Each bar compares two consecutive evaluations of the same building within the ${pm.P.long}${ward ? ', for buildings in the selected ward' : ''}.</li>
    <li>Each building appears at most once per list, using its single largest increase (or decrease). Ties are ordered by address.</li>
    <li>The numbers beside zero show the earlier and later score (for example 41 → 89). Hover or focus a row for the inspection dates.</li>
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
