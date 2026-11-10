// Story visuals that have no workspace view of their own: the score distribution (prologue),
// the two buildings' item strips (aha) and the three checks (resolution).
// Drawn with D3 into #story-visual, coloured only from CSS tokens.

import { esc, titleCase, fmt, cssVar, tip } from '../ui.js';
import { ratingClass, scaleFor, XRAY_ZONES } from '../xray-model.js';
import { itemLabel } from '../model.js';

export function drawVisual(kind, el, D) {
  el.innerHTML = '';
  el.dataset.kind = kind;
  if (kind === 'distribution') distribution(el, D);
  if (kind === 'fingerprints') fingerprints(el, D);
  if (kind === 'steps') steps(el, D);
}

// ---- prologue: how many buildings got each score ----------------------------------------
function distribution(el, D) {
  const { bins, median, q1, q3, n } = D.dist;
  const head = document.createElement('p');
  head.className = 'story-visual-title';
  head.textContent = `Latest score of each evaluated building, ${D.dist.label ?? 'current scoring system'} (${fmt.n(n)} buildings)`;
  el.append(head);
  const W = Math.max(320, Math.min(el.clientWidth, 980));
  const H = Math.max(260, Math.min(440, Math.round(W * 0.5)));
  const m = { top: 58, right: 16, bottom: 40, left: 44 };
  const lo = Math.min(50, d3.min(bins, (d) => d.score));
  const x = d3.scaleBand().domain(d3.range(lo, 101)).range([m.left, W - m.right]).paddingInner(0.18);
  const y = d3.scaleLinear().domain([0, d3.max(bins, (d) => d.n)]).nice().range([H - m.bottom, m.top]);
  const svg = d3.select(el).append('svg').attr('viewBox', `0 0 ${W} ${H}`).attr('width', W).attr('height', H)
    .attr('role', 'img').attr('aria-label', `Bar chart of latest scores. Median ${median}; the middle half of buildings scored ${q1} to ${q3}.`);
  // middle-half band
  svg.append('rect').attr('class', 'story-band').attr('x', x(q1)).attr('width', x(q3) + x.bandwidth() - x(q1))
    .attr('y', 22).attr('height', H - m.bottom - 22);
  // band label above the band, right-aligned to it so it never runs off a narrow chart
  svg.append('text').attr('class', 'annot-sub').attr('x', x(q3) + x.bandwidth()).attr('y', 14).attr('text-anchor', 'end').text(`Middle half: ${q1}–${q3}`);
  svg.append('g').attr('class', 'grid').attr('transform', `translate(${m.left},0)`)
    .call(d3.axisLeft(y).ticks(4).tickSize(-(W - m.left - m.right)).tickFormat(''));
  svg.append('g').attr('class', 'axis').attr('transform', `translate(${m.left},0)`).call(d3.axisLeft(y).ticks(4).tickSizeOuter(0));
  svg.append('g').attr('class', 'axis').attr('transform', `translate(0,${H - m.bottom})`)
    .call(d3.axisBottom(x).tickValues(x.domain().filter((s) => s % 10 === 0)).tickSizeOuter(0));
  svg.append('text').attr('class', 'axis-title').attr('x', W - m.right).attr('y', H - 6).attr('text-anchor', 'end').text('Latest score (out of 100)');
  svg.append('text').attr('class', 'axis-title').attr('x', m.left).attr('y', 14).text('Buildings');
  svg.append('g').selectAll('rect').data(bins.filter((d) => d.score >= lo)).join('rect')
    .attr('x', (d) => x(d.score)).attr('width', x.bandwidth()).attr('y', (d) => y(d.n)).attr('height', (d) => y(0) - y(d.n))
    .attr('fill', (d) => (d.score === median ? cssVar('--accent') : cssVar('--chart-neutral')))
    .on('mouseenter', (ev, d) => tip.show(`<b>Score ${d.score}</b><br>${fmt.n(d.n)} buildings`, ev))
    .on('mousemove', (ev) => tip.move(ev)).on('mouseleave', () => tip.hide());
  // median annotation
  const mx = x(median) + x.bandwidth() / 2;
  const mb = bins.find((d) => d.score === median);
  svg.append('line').attr('class', 'story-leader').attr('x1', mx).attr('x2', mx).attr('y1', y(mb.n) - 3).attr('y2', y(mb.n) - 12);
  svg.append('text').attr('class', 'annot').attr('x', mx).attr('y', y(mb.n) - 16).attr('text-anchor', W < 560 ? 'end' : 'middle').text(`Median ${median}`);
}

// ---- aha: the same score, item by item --------------------------------------------------
function fingerprints(el, D) {
  const { a, b, score } = D.pair;
  const S = scaleFor('cur');
  const cols = XRAY_ZONES.flatMap((z) => z.items.cur.filter((c) => D.pm.cats.includes(c)).map((c) => ({ col: c, zone: z })));
  const head = document.createElement('p');
  head.className = 'story-visual-title';
  head.textContent = `Both scored ${score}. Each square is one inspection item, grouped by category.`;
  el.append(head);
  const legend = document.createElement('div');
  legend.className = 'legend story-legend';
  legend.innerHTML = [['p3', '3 · top mark'], ['p2', '2'], ['p1', '1 · low'], ['p0', '0 · lowest'], ['na', 'N/A or not recorded']]
    .map(([k, t]) => `<span class="key"><span class="xr-pip-key r-${k}"></span>${t}</span>`).join('');
  el.append(legend);
  const W = Math.max(320, Math.min(el.clientWidth, 980));
  const narrow = W < 640;
  const perRow = narrow ? 25 : cols.length;
  const groups = narrow ? 0 : new Set(cols.map((c) => c.zone.key)).size - 1;
  const zoneGap = narrow ? 0 : 10;
  const gap = 3;
  const cell = Math.floor(Math.min(24, (W - 4 - groups * zoneGap) / perRow - gap));
  for (const x of [a, b]) {
    const fig = document.createElement('figure');
    fig.className = 'story-strip';
    fig.innerHTML = `<figcaption><span class="story-strip-score">${x.rec.score}</span><b>${esc(titleCase(x.rec.address))}</b><span>${x.lows.length} of ${x.rated} rated items rated low</span></figcaption>`;
    el.append(fig);
    const rows = Math.ceil(cols.length / perRow);
    let zoneBreaks = 0;
    const pos = cols.map((c, i) => {
      if (i > 0 && c.zone !== cols[i - 1].zone) zoneBreaks++;
      const col = i % perRow, row = Math.floor(i / perRow);
      return { ...c, x: col * (cell + gap) + (narrow ? 0 : zoneBreaks * zoneGap), y: row * (cell + gap) };
    });
    const w = d3.max(pos, (p) => p.x) + cell + 2, h = rows * (cell + gap);
    const svg = d3.select(fig).append('svg').attr('viewBox', `0 0 ${w} ${h}`).attr('width', w).attr('height', h)
      .attr('role', 'img').attr('aria-label', `${titleCase(x.rec.address)}: ${x.lows.length} of ${x.rated} rated items rated low.`);
    svg.selectAll('rect').data(pos).join('rect')
      .attr('x', (p) => p.x + 0.5).attr('y', (p) => p.y + 0.5).attr('width', cell - 1).attr('height', cell - 1)
      .attr('class', (p) => `xr-sq r-${ratingClass(x.rec.ratings[p.col], S)}`)
      .attr('tabindex', -1)
      .on('mouseenter', (ev, p) => tip.show(`<b>${esc(itemLabel(p.col))}</b><br>${esc(p.zone.label)} · ${x.rec.ratings[p.col] ?? 'N/A or not recorded'}`, ev))
      .on('mousemove', (ev) => tip.move(ev)).on('mouseleave', () => tip.hide());
  }
}

// ---- resolution: three checks -------------------------------------------------------------
function steps(el, D) {
  const items = [
    { n: 1, title: 'Compare the area.', text: 'See how a building’s score compares with its ward and where lower scores cluster.', href: '#/explore?lens=wards', go: 'Explore the map' },
    { n: 2, title: 'Check individual inspection results.', text: 'Look at which items inspectors rated low, not only the total.', href: `#/xray/${D.pair.a.rec.rsn}`, go: 'Open a Building X-Ray' },
    { n: 3, title: 'Review the building’s inspection history.', text: 'A score describes inspection day. Check whether it has been rising or falling.', href: '#/explore?lens=changes', go: 'Re-inspection changes' },
  ];
  el.innerHTML = `<ol class="story-steps">${items.map((s) => `
    <li><span class="story-step-n" aria-hidden="true">${s.n}</span>
      <div><h3>${s.title}</h3><p>${s.text}</p><a href="${s.href}">${s.go}</a></div></li>`).join('')}</ol>`;
}
