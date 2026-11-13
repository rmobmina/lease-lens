// Q4: When a building is inspected again, does its overall score usually improve?
// Split bar = share of re-inspections that went up / stayed the same / went down.
// Histogram = how large those changes were.

import { changeSummary } from '../model.js';
import { tip, pct, fmt, signed, svgIn, cssVar, empty, setFinding, chartHeight } from '../ui.js';
import { snapshot, play } from '../chart-motion.js';

const CLIP = 30; // changes beyond ±30 are grouped into the end bars (labelled)

export function renderChanges(ctx, state) {
  const { pairs: allPairs, pm, ward } = ctx;
  const pairs = state.start === 'low' ? allPairs.filter((p) => p.a.score <= pm.t25) : allPairs;
  const split = document.getElementById('change-split');
  const box = document.getElementById('change-chart');
  const before = snapshot(box);
  box.innerHTML = '';
  if (!pairs.length) { split.innerHTML = ''; empty(box, 'No re-inspections for this selection.'); setFinding('q4-takeaway', null); return; }

  const s = changeSummary(pairs);
  const C = { up: cssVar('--up'), down: cssVar('--down'), flat: cssVar('--flat') };
  const parts = [
    { k: 'up', n: s.up, label: 'improved', glyph: '▲' },
    { k: 'flat', n: s.same, label: 'no change', glyph: '●' },
    { k: 'down', n: s.down, label: 'declined', glyph: '▼' },
  ];
  split.innerHTML = `
    <div class="split-bar" role="img" aria-label="${parts.map((p) => `${pct(p.n / s.n)} ${p.label}`).join(', ')}">
      ${parts.map((p) => `<div style="flex:${p.n} 0 0;background:${C[p.k]}" title="${fmt.n(p.n)} ${p.label}"></div>`).join('')}
    </div>
    <div class="split-labels">
      ${parts.map((p) => `<span><span class="glyph" style="color:${C[p.k]}" aria-hidden="true">${p.glyph}</span><b>${pct(p.n / s.n)}</b>${p.label} <span class="muted">(${fmt.n(p.n)})</span></span>`).join('')}
    </div>`;

  // histogram of change values
  const H = chartHeight(box);
  const { svg, width } = svgIn(box, H, `Histogram of score changes between consecutive evaluations, ${fmt.n(s.n)} re-inspections.`);
  const m = { top: 28, right: 16, bottom: 46, left: 52 };
  const clamp = (v) => Math.max(-CLIP, Math.min(CLIP, v));
  const counts = d3.rollup(pairs, (v) => v.length, (p) => clamp(p.delta));
  const bins = d3.range(-CLIP, CLIP + 1).map((k) => ({ k, n: counts.get(k) ?? 0 }));
  const x = d3.scaleBand().domain(bins.map((b) => b.k)).range([m.left, width - m.right]).paddingInner(0);
  const y = d3.scaleLinear().domain([0, d3.max(bins, (b) => b.n)]).nice().range([H - m.bottom, m.top]);
  const gap = x.bandwidth() > 6 ? 2 : 1;

  svg.append('g').attr('class', 'grid').attr('transform', `translate(${m.left},0)`)
    .call(d3.axisLeft(y).ticks(5).tickSize(-(width - m.left - m.right)).tickFormat(''));
  svg.append('g').attr('class', 'axis').attr('transform', `translate(${m.left},0)`).call(d3.axisLeft(y).ticks(5).tickSizeOuter(0).tickFormat((v) => (v ? d3.format('~s')(v) : '')));  // the baseline needs no 0, which would meet the first x label
  // seven labels where they have room, three where they don't (each label needs ~44 px)
  const tickVals = (width - m.left - m.right) / 7 >= 44 ? [-30, -20, -10, 0, 10, 20, 30] : [-30, 0, 30];
  svg.append('g').attr('class', 'axis').attr('transform', `translate(0,${H - m.bottom})`)
    .call(d3.axisBottom(x).tickValues(tickVals).tickSizeOuter(0).tickFormat((k) => (k === -CLIP ? `≤ −${CLIP}` : k === CLIP ? `≥ +${CLIP}` : signed(k))));
  svg.append('text').attr('class', 'axis-title').attr('x', (m.left + width - m.right) / 2).attr('y', H - 8).attr('text-anchor', 'middle').text('Change in score at re-inspection (points)');
  svg.append('text').attr('class', 'axis-title').attr('transform', 'rotate(-90)').attr('x', -(m.top + H - m.bottom) / 2).attr('y', 14).attr('text-anchor', 'middle').text('Re-inspections');

  const colorOf = (k) => (k > 0 ? C.up : k < 0 ? C.down : C.flat);
  const bars = svg.append('g').selectAll('rect').data(bins.filter((b) => b.n > 0)).join('rect')
    .attr('data-k', (b) => b.k).attr('data-bar', '')
    .attr('x', (b) => x(b.k) + gap / 2).attr('width', Math.max(1, x.bandwidth() - gap))
    .attr('y', (b) => y(b.n)).attr('height', (b) => y(0) - y(b.n)).attr('fill', (b) => colorOf(b.k));
  // invisible full-height hit targets per bin (bigger than the bars)
  svg.append('g').selectAll('rect').data(bins).join('rect')
    .attr('x', (b) => x(b.k)).attr('width', x.bandwidth()).attr('y', m.top).attr('height', H - m.top - m.bottom).attr('fill', 'transparent')
    .on('mouseenter', (ev, b) => { bars.attr('fill-opacity', (d) => (d.k === b.k ? 1 : 0.55)); tip.show(binTip(b, s.n), ev); })
    .on('mousemove', (ev) => tip.move(ev))
    .on('mouseleave', () => { bars.attr('fill-opacity', 1); tip.hide(); });

  play(before, box);

  // zero line + median annotation
  const zx = x(0) + x.bandwidth() / 2;
  svg.append('line').attr('x1', zx).attr('x2', zx).attr('y1', m.top - 6).attr('y2', H - m.bottom).attr('stroke', cssVar('--ink')).attr('stroke-width', 1);
  svg.append('text').attr('class', 'annot-sub').attr('x', zx - 6).attr('y', m.top - 12).attr('text-anchor', 'end').text('◀ declined');
  svg.append('text').attr('class', 'annot-sub').attr('x', zx + 6).attr('y', m.top - 12).text('improved ▶');
  if (s.median !== 0) {
    const mxp = x(clamp(Math.round(s.median))) + x.bandwidth() / 2;
    svg.append('line').attr('x1', mxp).attr('x2', mxp).attr('y1', m.top + 4).attr('y2', H - m.bottom).attr('stroke', cssVar('--ink')).attr('stroke-width', 1.5).attr('stroke-dasharray', '4 3');
    svg.append('text').attr('class', 'annot').attr('x', mxp + 6).attr('y', m.top + 14).text(`Median ${signed(s.median)}`);
  }

  const months = Math.round(s.medianDays / 30.4);
  // The split bar above already gives the up / same / down shares, so the finding adds what it can't show:
  // how big the typical change is.
  const within10 = pct(pairs.filter((p) => Math.abs(p.delta) <= 10).length / s.n);
  setFinding('q4-takeaway', state.start === 'low' ? {
    value: `${signed(s.median)}`,
    caption: `points: the typical change for buildings that started in the lowest 25% (score ${pm.t25} or below)`,
    text: `${pct(s.up / s.n)} of them improved at their next inspection. Part of this rebound is expected statistically: a building that scores unusually low once tends to score closer to typical next time, even without real repairs.`,
  } : {
    value: `${signed(s.median)}`,
    caption: `points: the typical change between inspections, about ${months} months apart`,
    text: `Scores usually rise a little at re-inspection, but ${pct(s.down / s.n)} fell. ${within10} of scores moved by 10 points or less.`,
  });

  document.getElementById('q4-method').innerHTML = `<ul>
    <li>A <b>re-inspection</b> is any evaluation of a building that follows an earlier evaluation of the same building, matched by its City registration number (RSN).</li>
    <li>Change = new score − previous score. A building inspected three times contributes two comparisons. ${fmt.n(s.n)} comparisons from ${fmt.n(s.buildings)} buildings${ward ? ' in this ward' : ''}.</li>
    <li>Only evaluations within the ${pm.P.long} are compared. Comparisons across the 2023 scoring change are left out because the two systems score differently.</li>
    <li>Changes larger than ${CLIP} points in either direction are grouped into the end bars (${fmt.n(pairs.filter((p) => Math.abs(p.delta) > CLIP).length)} comparisons).</li>
    <li>“Started in the lowest 25%” means the earlier score was ${pm.t25} or below, the same citywide cut-off used on the map.</li>
  </ul>`;
}

function binTip(b, total) {
  const label = b.k === -CLIP ? `Dropped ${CLIP}+ points` : b.k === CLIP ? `Rose ${CLIP}+ points` : b.k === 0 ? 'No change' : `${b.k > 0 ? 'Rose' : 'Dropped'} ${Math.abs(b.k)} point${Math.abs(b.k) === 1 ? '' : 's'}`;
  return `<div class="tt-title">${label}</div><dl><dt>Re-inspections</dt><dd><b>${fmt.n(b.n)}</b> (${pct(b.n / total, 1)})</dd></dl>`;
}
