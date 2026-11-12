// "Is this score still current?" One building's evaluations over time (D3).
// Points are connected only within one scoring system; the change shown for each point is
// against the previous evaluation in the SAME system. Selecting a point shows that inspection
// in the X-Ray above (every evaluation in the data has item-level ratings).

import { timelineSegments, trendSummary } from '../xray-model.js';
import { tip, esc, formatDate, signed, cssVar, anchorEvent } from '../ui.js';

const SYSTEM = { pre: '2017 – 2023 system', cur: '2023 – now system' };

// `where` names what a point opens, so the same chart reads correctly beside the map ('inMap': the
// point opens the X-Ray) and inside the X-Ray ('inXray': it replaces the inspection shown above).
const WORDS = {
  inXray: { shown: 'Shown in the X-Ray above.', pick: 'Click to show this inspection in the X-Ray.', aShown: ' Shown in the X-Ray.', aPick: ' Press Enter to show it in the X-Ray.', group: 'Enter to show one in the X-Ray' },
  inMap: { shown: 'The latest evaluation, shown on the map.', pick: 'Click to inspect this evaluation in the X-Ray.', aShown: ' Shown on the map.', aPick: ' Press Enter to inspect it in the X-Ray.', group: 'Enter to inspect one in the X-Ray' },
};

// Two ways to use a point:
//   onPick(uid)    a point opens that evaluation at once (beside the map, in the story).
//   onSelect(uid)  a point becomes the chart's selection (Building Explorer History): a ring moves to it and the
//                  page shows what was picked, with its own "Inspect this evaluation" action. ← → move between points.
// summary: false leaves the headline to the page (the Explorer writes its own), and drops the change labels
// under the points; precise values are in each point's tooltip and accessible name.
export function renderTimeline(box, { points, shown, era, P, systemChange, onPick, onSelect, selected = null, where = 'inXray', height: fixedH = 230, brief = false, summary: withSummary = true }) {
  const W = onSelect ? { ...WORDS[where], shown: 'The inspection shown in the Inspection view.', pick: 'Select to see this evaluation.', aShown: ' Shown in the Inspection view.', aPick: '', group: 'Enter to select one' } : WORDS[where];
  box.innerHTML = '';
  const summary = document.createElement('p');
  summary.className = 'xr-tl-summary';
  if (withSummary) box.append(summary);

  const t = trendSummary(points, era);
  const other = points.filter((p) => p.era !== era).length;
  const otherTxt = other && brief ? ` Grey: ${other} earlier-system evaluation${other === 1 ? '' : 's'}, not compared.` : other ? ` This building also has ${other} evaluation${other === 1 ? '' : 's'} in the ${era === 'cur' ? '2017 – 2023' : '2023 – now'} system, drawn in grey. Those scores used different items and a different scale, so they aren't connected or compared.` : '';
  if (t.kind === 'empty') {
    summary.innerHTML = `No evaluations in the ${esc(P.long)}.${otherTxt}`;
    if (!points.length) return;
  } else if (t.kind === 'single') {
    summary.innerHTML = `Only one evaluation in the ${esc(P.long)} (${formatDate(t.latest.rec.date)}, score <b>${t.latest.rec.score}</b>). There isn't enough history to show a trend yet.${otherTxt}`;
  } else {
    const d = t.latest.delta;
    summary.innerHTML = `${d === 0 ? 'No change' : `<b>${d > 0 ? 'Up' : 'Down'} ${Math.abs(d)} point${Math.abs(d) === 1 ? '' : 's'}</b>`} at the latest evaluation (${formatDate(t.latest.rec.date)}, score <b>${t.latest.rec.score}</b>) compared with the one before (${formatDate(t.latest.prev.date)}, ${t.latest.prev.score}).
      ${t.n > 2 ? `${t.n} evaluations in this system, ${signed(t.total)} points overall.` : ''}${brief ? '' : ' A score describes the building on inspection day, so an older score may no longer reflect it.'}${otherTxt}`;
  }

  const width = Math.max(260, box.clientWidth); // never wider than its box: a wider SVG would be cropped
  const height = fixedH; // the guided story gives it the stage height
  const m = { top: 30, right: 28, bottom: 34, left: 40 };
  if (onSelect) { m.top = 40; m.right = 32; m.left = 44; }
  const times = points.map((p) => p.rec.time);
  let [t0, t1] = [Math.min(...times), Math.max(...times)];
  const pad = Math.max(864e5 * 120, (t1 - t0) * 0.06);
  t0 -= pad; t1 += pad;
  const x = d3.scaleTime().domain([t0, t1]).range([m.left, width - m.right]);
  const minScore = Math.min(...points.map((p) => p.rec.score));
  const y = d3.scaleLinear().domain([Math.min(50, Math.floor((minScore - 5) / 10) * 10), 100]).range([height - m.bottom, m.top]);

  const svg = d3.select(box).append('svg').attr('viewBox', `0 0 ${width} ${height}`).attr('width', width).attr('height', height)
    .attr('class', `xr-tl${onSelect ? ' xr-tl-select' : ''}`).attr('role', 'group').attr('aria-label', `Score history: ${points.length} evaluation${points.length === 1 ? '' : 's'}. Use Tab to move between points and ${W.group}.`);

  // system change marker (only if the building's history spans it)
  const change = new Date(systemChange + 'T00:00:00').getTime();
  if (change > t0 && change < t1) {
    svg.append('rect').attr('x', m.left).attr('y', m.top - 18).attr('width', x(change) - m.left).attr('height', height - m.bottom - m.top + 18).attr('fill', cssVar('--surface-2'));
    svg.append('line').attr('x1', x(change)).attr('x2', x(change)).attr('y1', m.top - 18).attr('y2', height - m.bottom).attr('stroke', cssVar('--axis')).attr('stroke-dasharray', '3 3');
    svg.append('text').attr('class', 'annot-sub').attr('x', x(change) - 6).attr('y', m.top - 6).attr('text-anchor', 'end').text('◀ 2017 – 2023 system');
    svg.append('text').attr('class', 'annot-sub').attr('x', x(change) + 6).attr('y', m.top - 6).text('2023 – now system ▶');
  }
  svg.append('g').attr('class', 'grid').attr('transform', `translate(${m.left},0)`).call(d3.axisLeft(y).ticks(4).tickSize(-(width - m.left - m.right)).tickFormat(''));
  svg.append('g').attr('class', 'axis').attr('transform', `translate(${m.left},0)`).call(d3.axisLeft(y).ticks(4).tickSizeOuter(0));
  svg.append('g').attr('class', 'axis').attr('transform', `translate(0,${height - m.bottom})`).call(d3.axisBottom(x).ticks(Math.min(8, width / 90)).tickSizeOuter(0));

  const accent = cssVar('--accent'), muted = cssVar('--muted'), surface = cssVar('--surface');
  const colorOf = (p) => (p.era === era ? accent : muted);
  for (const s of timelineSegments(points)) {
    svg.append('path').datum(s.points).attr('fill', 'none').attr('stroke', colorOf(s.points[0])).attr('stroke-width', s.points[0].era === era ? 2 : 1.25)
      .attr('stroke-dasharray', s.points[0].era === era ? null : '4 3')
      .attr('d', d3.line().x((p) => x(p.rec.time)).y((p) => y(p.rec.score)));
  }

  const latestInEra = points.filter((p) => p.era === era).at(-1);
  const isSel = (p) => (onSelect ? p.rec.uid === selected : p.rec === shown);
  const g = svg.append('g').selectAll('g').data(points).join('g')
    .attr('class', (p) => `xr-tl-pt${isSel(p) ? ' is-shown' : ''}${p.rec === shown ? ' is-current' : ''}`)
    .attr('transform', (p) => `translate(${x(p.rec.time)},${y(p.rec.score)})`)
    .attr('tabindex', (p) => (!onSelect || isSel(p) || (!points.some(isSel) && p === points.at(-1)) ? 0 : -1)).attr('role', 'button')
    .attr('aria-pressed', (p) => String(isSel(p)))
    .attr('aria-label', (p) => `${formatDate(p.rec.date)}, score ${p.rec.score}, ${SYSTEM[p.era]}. ${deltaText(p)}${p === latestInEra ? ' Latest in this system.' : ''}${p.rec === shown ? W.aShown : W.aPick}`);
  g.append('circle').attr('r', 16).attr('fill', 'transparent'); // generous hit target
  // the selection ring: one element that travels to the chosen point (Explorer), or a ring per shown point
  let ring = null;
  if (onSelect) {
    const at = points.find(isSel);
    ring = svg.append('circle').attr('class', 'xr-tl-ring').attr('r', 11).attr('fill', 'none').attr('stroke', accent).attr('stroke-width', 2)
      .attr('pointer-events', 'none').attr('opacity', at ? 1 : 0)
      .attr('cx', at ? x(at.rec.time) : 0).attr('cy', at ? y(at.rec.score) : 0);
  } else g.filter((p) => p.rec === shown).append('circle').attr('r', 10).attr('fill', 'none').attr('stroke', accent).attr('stroke-width', 2);
  g.append('circle').attr('r', (p) => (p === latestInEra ? 6.5 : 5))
    .attr('fill', (p) => (p.era === era ? accent : surface)).attr('stroke', (p) => (p.era === era ? surface : muted)).attr('stroke-width', 2);
  g.append('text').attr('class', (p) => (p === latestInEra ? 'annot' : 'annot-sub')).attr('y', onSelect ? -18 : -14).attr('text-anchor', 'middle')
    .text((p) => (p === latestInEra ? `${onSelect ? '' : 'Latest '}${p.rec.score}` : p.rec.score));
  // change from the previous evaluation in the same system, under the point
  if (withSummary) g.filter((p) => p.delta != null && p.delta !== 0).append('text').attr('class', 'annot-sub').attr('y', 22).attr('text-anchor', 'middle')
    .text((p) => signed(p.delta));
  if (ring) ring.raise();

  const html = (p) => `<div class="tt-title">${p.rec.score} / 100</div><div class="tt-sub">${formatDate(p.rec.date)} · ${SYSTEM[p.era]}</div>
    <dl><dt>Change</dt><dd>${deltaText(p)}</dd></dl><p class="tt-hint">${p.rec === shown ? W.shown : W.pick}</p>`;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const choose = (p) => {
    tip.hide();
    if (!onSelect) { onPick(p.rec.uid); return; }
    selected = p.rec.uid;
    g.classed('is-shown', isSel).attr('aria-pressed', (d) => String(isSel(d))).attr('tabindex', (d) => (isSel(d) ? 0 : -1));
    // the ring travels to the new point (interruptible: a new choice restarts from where it is)
    ring.interrupt().transition().duration(reduced ? 0 : 280).ease(d3.easeCubicOut)
      .attr('cx', x(p.rec.time)).attr('cy', y(p.rec.score)).attr('opacity', 1);
    onSelect(p.rec.uid);
  };
  const nodes = g.nodes();
  g.on('mouseenter', (ev, p) => tip.show(html(p), ev)).on('mousemove', (ev) => tip.move(ev)).on('mouseleave', () => tip.hide())
    .on('focus', function (ev, p) { tip.show(html(p), anchorEvent(this)); }).on('blur', () => tip.hide())
    .on('click', (ev, p) => choose(p))
    .on('keydown', function (ev, p) {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); choose(p); return; }
      if (!onSelect) return;
      const i = nodes.indexOf(this);
      const j = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: nodes.length - 1 }[ev.key];
      if (j == null || j < 0 || j >= nodes.length) return;
      ev.preventDefault();
      nodes[j].focus();
      choose(points[j]);
    });
}

function deltaText(p) {
  if (p.delta == null) return p.prev == null && p.era === 'cur' ? 'First evaluation in the 2023 – now system; not compared with older scores.' : 'First evaluation in this system.';
  return p.delta === 0 ? `No change from ${formatDate(p.prev.date)}.` : `${signed(p.delta)} points since ${formatDate(p.prev.date)} (${p.prev.score}).`;
}
