// Q2: Do older buildings tend to receive lower evaluation scores than newer buildings?
// One dot per building (latest evaluation). Overlay = median score per decade built,
// which shows the shape of the relationship without assuming it is a straight line.

import { pearson, decadeMedians } from '../model.js';
import { tip, hash, titleCase, buildingTip, svgIn, legendKey, cssVar, fmt, empty, setFinding } from '../ui.js';

// Fill the available panel height (desktop), with sensible limits.
const fitHeight = (box, min, max) => Math.max(min, Math.min(max, box.clientHeight - 24 || min));

export function renderAge(ctx) {
  const { latest, ward, selected, pm } = ctx;
  const box = document.getElementById('age-chart');
  box.innerHTML = '';
  const pts = latest.filter((r) => r.yearBuilt != null);
  const missing = latest.length - pts.length;
  if (pts.length < 5) { empty(box, 'Not enough buildings with a recorded year built for this selection.'); return; }

  const minN = ward ? 8 : 20;
  const meds = decadeMedians(pts, minN);
  const r = pearson(pts, (d) => d.yearBuilt, (d) => d.score);

  const H = fitHeight(box, 300, 560);
  const { svg, width } = svgIn(box, H, `Scatterplot of building year built against latest evaluation score for ${fmt.n(pts.length)} buildings, with median score per decade.`);
  const m = { top: 14, right: 20, bottom: 46, left: 46 };
  const early = pts.filter((d) => d.yearBuilt < 1900);
  const strip = early.length ? 46 : 0;
  const x0 = m.left + strip + (strip ? 14 : 0);
  const xMax = Math.max(2025, d3.max(pts, (d) => d.yearBuilt));
  const x = d3.scaleLinear().domain([1900, xMax]).range([x0, width - m.right]);
  const yMin = Math.max(0, Math.floor(d3.min(pts, (d) => d.score) / 10) * 10);
  const y = d3.scaleLinear().domain([yMin, 100]).range([H - m.bottom, m.top]);

  // Deterministic jitter (±0.45 yr, ±0.45 pt) so identical integer values don't hide each other.
  const jx = (d) => (hash(d.rsn) - 0.5) * 0.9, jy = (d) => (hash(d.rsn + 'y') - 0.5) * 0.9;
  const px = (d) => (d.yearBuilt < 1900 ? m.left + 6 + hash(d.rsn) * (strip - 12) : x(d.yearBuilt + jx(d)));
  const py = (d) => y(d.score + jy(d));

  // grid + axes
  svg.append('g').attr('class', 'grid').attr('transform', `translate(${m.left},0)`)
    .call(d3.axisLeft(y).ticks(6).tickSize(-(width - m.left - m.right)).tickFormat(''));
  svg.append('g').attr('class', 'axis').attr('transform', `translate(0,${H - m.bottom})`)
    .call(d3.axisBottom(x).tickValues(x.ticks(Math.min(7, Math.floor(width / 110))).filter((v) => !strip || v >= 1910)).tickFormat(d3.format('d')).tickSizeOuter(0));
  svg.append('g').attr('class', 'axis').attr('transform', `translate(${m.left},0)`).call(d3.axisLeft(y).ticks(6).tickSizeOuter(0));
  svg.append('text').attr('class', 'axis-title').attr('x', (x0 + width - m.right) / 2).attr('y', H - 8).attr('text-anchor', 'middle').text('Year built');
  svg.append('text').attr('class', 'axis-title').attr('transform', 'rotate(-90)').attr('x', -(m.top + H - m.bottom) / 2).attr('y', 12).attr('text-anchor', 'middle').text('Latest score (out of 100)');
  if (strip) {
    svg.append('rect').attr('x', m.left + 2).attr('y', m.top).attr('width', strip - 4).attr('height', H - m.top - m.bottom).attr('fill', cssVar('--surface-2'));
    svg.append('text').attr('class', 'annot-sub').attr('x', m.left + strip / 2).attr('y', H - m.bottom + 18).attr('text-anchor', 'middle').text('Pre-1900');
    // axis break marks
    const bx = x0 - 7;
    svg.append('path').attr('d', `M${bx - 3},${H - m.bottom + 5} l6,-10 M${bx + 2},${H - m.bottom + 5} l6,-10`).attr('stroke', cssVar('--axis')).attr('stroke-width', 1.5);
  }

  // points
  const opacity = Math.max(0.28, Math.min(0.75, 30 / Math.sqrt(pts.length)));
  svg.append('g').selectAll('circle').data(pts).join('circle')
    .attr('cx', px).attr('cy', py).attr('r', 2.8)
    .attr('fill', cssVar('--dot')).attr('fill-opacity', opacity);

  // hover layer: nearest building within 14px (much bigger than the dots)
  const delaunay = d3.Delaunay.from(pts, px, py);
  const hover = svg.append('circle').attr('r', 6).attr('fill', 'none').attr('stroke', cssVar('--ink')).attr('stroke-width', 2).style('display', 'none').style('pointer-events', 'none');
  svg.append('rect').attr('x', m.left).attr('y', m.top).attr('width', width - m.left - m.right).attr('height', H - m.top - m.bottom)
    .attr('fill', 'transparent').style('cursor', 'crosshair')
    .on('pointermove', (ev) => {
      const [mx, my] = d3.pointer(ev);
      const i = delaunay.find(mx, my), d = pts[i];
      if (Math.hypot(px(d) - mx, py(d) - my) > 14) { hover.style('display', 'none'); tip.hide(); return; }
      hover.style('display', null).attr('cx', px(d)).attr('cy', py(d));
      tip.show(buildingTip(d, '<div class="tt-hint">Click to select this building</div>'), ev);
    })
    .on('pointerleave', () => { hover.style('display', 'none'); tip.hide(); })
    .on('click', (ev) => {
      const [mx, my] = d3.pointer(ev);
      const d = pts[delaunay.find(mx, my)];
      if (Math.hypot(px(d) - mx, py(d) - my) <= 14) { tip.hide(); ctx.select(d.rsn, { from: 'age' }); }
    });

  // decade medians
  const medColor = cssVar('--accent'), surface = cssVar('--surface');
  if (meds.length > 1) {
    const mx = (d) => x(d.decade + 5);
    svg.append('path').datum(meds).attr('fill', 'none').attr('stroke', surface).attr('stroke-width', 5).attr('stroke-linejoin', 'round')
      .attr('d', d3.line().x(mx).y((d) => y(d.median)));
    svg.append('path').datum(meds).attr('fill', 'none').attr('stroke', medColor).attr('stroke-width', 2.5).attr('stroke-linejoin', 'round').attr('stroke-linecap', 'round')
      .attr('d', d3.line().x(mx).y((d) => y(d.median)));
    const dots = svg.append('g').selectAll('circle').data(meds).join('circle')
      .attr('cx', mx).attr('cy', (d) => y(d.median)).attr('r', 4.5)
      .attr('fill', medColor).attr('stroke', surface).attr('stroke-width', 2).attr('tabindex', 0)
      .attr('aria-label', (d) => `${d.decade}s: median score ${d.median}, ${d.n} buildings`);
    dots.on('mouseenter', (ev, d) => tip.show(`<div class="tt-title">Built in the ${d.decade}s</div><dl><dt>Median score</dt><dd><b>${d.median}</b></dd><dt>Buildings</dt><dd>${fmt.n(d.n)}</dd></dl>`, ev))
      .on('mousemove', (ev) => tip.move(ev)).on('mouseleave', () => tip.hide());
  }

  // selected building
  const sel = selected && pts.find((d) => d.rsn === selected);
  if (sel) {
    svg.append('circle').attr('cx', px(sel)).attr('cy', py(sel)).attr('r', 7).attr('fill', 'none').attr('stroke', cssVar('--accent')).attr('stroke-width', 2.5);
    const right = px(sel) > width - 200;
    svg.append('text').attr('class', 'annot').attr('x', px(sel) + (right ? -12 : 12)).attr('y', py(sel) + 4).attr('text-anchor', right ? 'end' : 'start')
      .text(titleCase(sel.address)).style('paint-order', 'stroke').style('stroke', surface).style('stroke-width', 4);
  }

  document.getElementById('age-legend').innerHTML = [
    legendKey(cssVar('--dot'), 'One building (latest score)'),
    legendKey(medColor, `Median score per decade (decades with ${minN}+ buildings)`, 'line'),
  ].join('');

  // Three plain-language groups
  const groups = [['Built before 1950', (d) => d.yearBuilt < 1950], ['Built 1950 – 1999', (d) => d.yearBuilt >= 1950 && d.yearBuilt < 2000], ['Built 2000 or later', (d) => d.yearBuilt >= 2000]]
    .map(([k, f]) => { const v = pts.filter(f); return { k, n: v.length, med: v.length ? d3.median(v, (d) => d.score) : null }; });
  document.getElementById('age-stats').innerHTML = groups.map((g) => `
    <div class="mini-stat"><div class="k">${g.k}</div><div class="v">${g.med ?? '–'}<span class="s"> median score</span></div><div class="s">${fmt.n(g.n)} buildings</div></div>`).join('');

  // Takeaway, generated from the numbers above
  const strength = r == null ? null : Math.abs(r) < 0.1 ? 'almost no' : Math.abs(r) < 0.3 ? 'a weak' : Math.abs(r) < 0.5 ? 'a moderate' : 'a strong';
  const mid = meds.filter((d) => d.decade >= 1920 && d.decade < 2000);
  setFinding('q2-takeaway', r == null ? null : {
    value: `r = ${r.toFixed(2)}`,
    caption: `${strength.replace(/^a /, '').replace(/^./, (c) => c.toUpperCase())} relationship between building age and score`,
    text: `${r > 0 ? 'Newer buildings score slightly higher on average. ' : r < 0 ? 'Older buildings score slightly higher on average. ' : ''}${mid.length >= 3 ? `Buildings from the 1920s to the 1990s have similar typical scores (${d3.min(mid, (d) => d.median)}–${d3.max(mid, (d) => d.median)}). ` : ''}${groups[2].n >= minN ? `Those built since 2000 score higher (median ${groups[2].med}), but there are few of them. ` : ''}Age alone doesn't predict a score well, and this can't show that age <i>causes</i> lower scores.`,
  });
  document.getElementById('q2-method').innerHTML = `<ul>
    <li>One dot per building: its most recent evaluation in the ${pm.P.long}${ward ? ', in the selected ward' : ''}.</li>
    <li>Dots are nudged by up to half a year and half a point so buildings with identical values stay visible. Hover and medians use the true values.</li>
    <li>Buildings built before 1900 (${fmt.n(early.length)}) are shown in the narrow left strip rather than stretching the axis back to the 1800s.</li>
    <li>${fmt.n(missing)} building${missing === 1 ? '' : 's'} with no recorded year built ${missing === 1 ? 'is' : 'are'} not plotted.</li>
    <li>r is the Pearson correlation between year built and score (−1 to 1; values near 0 mean little linear relationship).</li>
  </ul>`;
}
