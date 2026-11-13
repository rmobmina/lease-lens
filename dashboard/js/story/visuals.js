// Story visuals that take the whole stage: the score distribution (prologue), the inspection
// categories (problems), one building's timeline (history) and the three checks (conclusion).
// Each one is sized to the space it is given (width AND height), so the chapter never scrolls,
// and redraws when that space changes. Coloured only from CSS tokens.

import { esc, fmt, pct, cssVar, tip } from '../ui.js';
import { renderTimeline } from '../sections/xray-timeline.js';

export function drawVisual(kind, el, D, app) {
  el.innerHTML = '';
  el.dataset.kind = kind;
  if (kind === 'distribution') distribution(el, D);
  if (kind === 'categories') categories(el, D);
  if (kind === 'history') history(el, D, app);
  if (kind === 'steps') steps(el, D);
}

// the drawing area left for a chart once its one-line title is placed
function box(el, title) {
  const head = document.createElement('p');
  head.className = 'story-visual-title';
  head.textContent = title;
  el.append(head);
  const W = Math.max(280, Math.min(el.clientWidth, 1040));
  // a container without its own height (the analysis drawer) gets a proportional chart
  const room = el.clientHeight > 160 ? el.clientHeight - head.offsetHeight - 12 : Math.round(W * 0.5);
  // never taller than the room it has (a short panel gets a shorter chart, not one that spills out)
  const H = el.clientHeight > 160 ? Math.min(room, Math.round(W * 0.62)) : Math.max(200, Math.min(room, Math.round(W * 0.62)));
  return { W, H };
}

// ---- prologue: how many buildings got each score ----------------------------------------
function distribution(el, D) {
  const { bins, median, q1, q3, n } = D.dist;
  const { W, H } = box(el, `Latest score of each evaluated building, ${D.dist.label ?? '2023 – present system'} (${fmt.n(n)} buildings)`);
  const m = { top: 40, right: 12, bottom: 46, left: 44 };
  const lo = Math.min(50, d3.min(bins, (d) => d.score));
  const x = d3.scaleBand().domain(d3.range(lo, 101)).range([m.left, W - m.right]).paddingInner(0.18);
  const y = d3.scaleLinear().domain([0, d3.max(bins, (d) => d.n)]).nice().range([H - m.bottom, m.top]);
  const svg = d3.select(el).append('svg').attr('viewBox', `0 0 ${W} ${H}`).attr('width', W).attr('height', H)
    .attr('role', 'img').attr('aria-label', `Bar chart of latest scores. Median ${median}; the middle half of buildings scored ${q1} to ${q3}.`);
  svg.append('rect').attr('class', 'story-band').attr('x', x(q1)).attr('width', x(q3) + x.bandwidth() - x(q1))
    .attr('y', m.top - 18).attr('height', H - m.bottom - m.top + 18);
  svg.append('text').attr('class', 'annot-sub').attr('x', x(q3) + x.bandwidth()).attr('y', m.top - 24).attr('text-anchor', 'end').text(`Middle half: ${q1}–${q3}`);
  svg.append('g').attr('class', 'grid').attr('transform', `translate(${m.left},0)`)
    .call(d3.axisLeft(y).ticks(4).tickSize(-(W - m.left - m.right)).tickFormat(''));
  svg.append('g').attr('class', 'axis').attr('transform', `translate(${m.left},0)`).call(d3.axisLeft(y).ticks(4).tickSizeOuter(0));
  svg.append('g').attr('class', 'axis').attr('transform', `translate(0,${H - m.bottom})`)
    .call(d3.axisBottom(x).tickValues(x.domain().filter((s) => s % 10 === 0)).tickSizeOuter(0));
  svg.append('text').attr('class', 'axis-title').attr('x', W - m.right).attr('y', H - 6).attr('text-anchor', 'end').text('Latest score (out of 100)');
  svg.append('g').selectAll('rect').data(bins.filter((d) => d.score >= lo)).join('rect')
    .attr('x', (d) => x(d.score)).attr('width', x.bandwidth()).attr('y', (d) => y(d.n)).attr('height', (d) => y(0) - y(d.n))
    .attr('fill', (d) => (d.score === median ? cssVar('--accent') : cssVar('--chart-neutral')))
    .on('mouseenter', (ev, d) => tip.show(`<b>Score ${d.score}</b><br>${fmt.n(d.n)} buildings`, ev))
    .on('mousemove', (ev) => tip.move(ev)).on('mouseleave', () => tip.hide());
  const mx = x(median) + x.bandwidth() / 2;
  const mb = bins.find((d) => d.score === median);
  svg.append('text').attr('class', 'annot').attr('x', mx - 8).attr('y', y(mb.n) + 4).attr('text-anchor', 'end').text(`Median ${median}`);
}

// ---- problems: share of buildings with a low-rated item, by category ----------------------------
function categories(el, D) {
  const rows = D.cats.zones.filter((z) => z.share != null);
  const { W } = box(el, 'Share of buildings with at least one item rated low (0 or 1 of 3), by inspection category');
  // wide: label | bar | value. Narrow: the label sits above its bar, so long names are never cut.
  const narrow = W < 560;
  const rowH = narrow ? 52 : 46, m = { left: narrow ? 0 : Math.min(240, W * 0.34), right: 56 };
  const barY = narrow ? 26 : rowH / 2 - 9;
  const H = rows.length * rowH;
  const x = d3.scaleLinear().domain([0, Math.max(...rows.map((r) => r.share)) * 1.05]).range([m.left, W - m.right]);
  const svg = d3.select(el).append('svg').attr('viewBox', `0 0 ${W} ${H}`).attr('width', W).attr('height', H).attr('class', 'story-cats')
    .attr('role', 'img').attr('aria-label', rows.map((r) => `${r.label}: ${pct(r.share)}`).join('; '));
  const g = svg.selectAll('g').data(rows).join('g').attr('transform', (d, i) => `translate(0,${i * rowH})`)
    .attr('class', (d, i) => (i === 0 ? 'is-top' : ''));
  g.append('text').attr('class', 'cat-label').attr('x', narrow ? 0 : m.left - 12).attr('y', narrow ? 14 : rowH / 2).attr('dy', '0.35em')
    .attr('text-anchor', narrow ? 'start' : 'end').text((d) => d.label);
  g.append('rect').attr('class', 'cat-track').attr('x', m.left).attr('y', barY).attr('width', W - m.right - m.left).attr('height', 18);
  g.append('rect').attr('class', 'cat-bar').attr('x', m.left).attr('y', barY).attr('height', 18).attr('width', (d) => x(d.share) - m.left);
  g.append('text').attr('class', 'cat-val').attr('x', (d) => x(d.share) + 8).attr('y', barY + 9).attr('dy', '0.35em').text((d) => pct(d.share));
}

// ---- history: one building's evaluations, the same timeline as the X-Ray -------------------------
function history(el, D, app) {
  const r = D.histRec;
  const head = document.createElement('p');
  head.className = 'story-visual-title';
  head.innerHTML = `Every evaluation of <b>${esc(r.address.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()))}</b>`;
  el.append(head);
  const chart = document.createElement('div');
  chart.className = 'story-tl chart';
  el.append(chart);
  renderTimeline(chart, {
    points: D.hist.all, shown: D.hist.last?.rec ?? r, era: 'cur', P: D.pm.P, systemChange: D.pm.dates[0],
    onPick: (uid) => app?.inspect(r.rsn, uid),
    where: 'inMap',
    height: Math.max(230, Math.min(420, el.clientHeight - head.offsetHeight - 24)),
  });
}

// ---- conclusion: three checks ---------------------------------------------------------------
function steps(el, D) {
  const items = [
    { n: '01', title: 'Compare the area', text: 'How does the building’s ward compare with the city?', href: '#/explore?lens=wards', go: 'Explore the map' },
    { n: '02', title: 'Read the inspection', text: 'Which items did inspectors rate low, not only the total?', href: `#/xray/${D.pair.a.rec.rsn}`, go: 'Open a Building X-Ray' },
    { n: '03', title: 'Check the history', text: 'A score describes inspection day. Is it rising or falling?', href: '#/explore?lens=changes', go: 'Re-inspection changes' },
  ];
  el.innerHTML = `<ol class="story-steps">${items.map((s) => `
    <li><span class="story-step-n" aria-hidden="true">${s.n}</span>
      <h3>${s.title}</h3><p>${s.text}</p><a href="${s.href}">${s.go}</a></li>`).join('')}</ol>`;
}
