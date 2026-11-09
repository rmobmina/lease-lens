// Building report: everything the five questions say about ONE building a renter is considering.

import { scoreBand, itemProblemRates, decadeMedians } from '../model.js';
import { tip, pct, fmt, esc, titleCase, signed, formatDate, svgIn, cssVar } from '../ui.js';

const SHOW_PROBLEMS = 5;

// "Scores higher than 72% of …" for most buildings; flipped for low scorers so it never reads "higher than 0%".
function rankText(r, rs, who, also = false) {
  const lower = rs.filter((d) => d.score < r.score).length / rs.length;
  const higher = rs.filter((d) => d.score > r.score).length / rs.length;
  const lead = also ? 'It' : 'This building';
  return lower >= 0.5
    ? `${lead} scores higher than <b>${pct(lower)}</b> of ${who}.`
    : `${lead} scores lower than <b>${pct(higher)}</b> of ${who}.`;
}

const BAND = {
  low10: { label: 'Lowest 10% in Toronto', cls: 'band-low10' },
  low25: { label: 'Lowest 25% in Toronto', cls: 'band-low25' },
  other: { label: 'Above the lowest 25%', cls: 'band-ok' },
};

export function renderBuilding(ctx, M) {
  const { pm, selected } = ctx;
  const empty = document.getElementById('b-empty'), report = document.getElementById('b-report');
  const r = selected && pm.latestByRsn.get(selected);
  if (!r) {
    report.hidden = true; empty.hidden = false;
    const other = selected && M.byPeriod[pm.era === 'cur' ? 'pre' : 'cur'].latestByRsn.get(selected);
    document.getElementById('b-empty-note').innerHTML = other
      ? `${esc(titleCase(other.address))} has no evaluation in the ${pm.P.long}. Switch the scoring system in the sidebar to see it.`
      : '';
    renderSuggestions(ctx);
    return;
  }
  empty.hidden = true; report.hidden = false;

  // header
  document.getElementById('b-title').textContent = titleCase(r.address);
  document.getElementById('b-meta').innerHTML = [
    `Ward ${+r.ward} · ${esc(r.wardName)}`,
    r.yearBuilt ? `Built ${r.yearBuilt}` : 'Year built not recorded',
    `${r.storeys ?? '–'} storeys · ${r.units ?? '–'} units`,
    r.propertyType ? titleCase(r.propertyType) : '',
  ].filter(Boolean).map((s) => `<span>${s}</span>`).join('');

  // 1. score + rank
  const band = scoreBand(r.score, pm);
  const wardRs = pm.latest.filter((d) => d.ward === r.ward);
  document.getElementById('b-score').innerHTML = `
    <p class="card-label">Latest score</p>
    <p class="score-big">${r.score}<small>/100</small></p>
    <p class="band ${BAND[band].cls}">${band === 'other' ? '' : '<span aria-hidden="true">▼ </span>'}${BAND[band].label}</p>
    <p class="card-text">Evaluated ${formatDate(r.date)}. ${rankText(r, pm.latest, 'Toronto buildings')} ${rankText(r, wardRs, `the ${fmt.n(wardRs.length)} in ${esc(r.wardName)}`, true)}</p>
    <p class="card-links"><a href="#/q1" data-keep>See it on the map →</a></p>`;

  // 2. history
  const evs = pm.recs.filter((d) => d.rsn === r.rsn).sort((a, b) => a.time - b.time);
  const hist = document.getElementById('b-history');
  const prev = evs.length > 1 ? evs.at(-2) : null;
  hist.querySelector('.card-text').innerHTML = prev
    ? `<b>${signed(r.score - prev.score)} points</b> since the previous evaluation (${formatDate(prev.date)}). ${evs.length} evaluations in the ${pm.P.long}.`
    : `Only one evaluation so far in the ${pm.P.long}, so there's no change to show yet.`;
  drawHistory(hist.querySelector('.mini-chart'), evs);

  // 3. problems in the latest evaluation
  const city = new Map(itemProblemRates(pm.latest, pm).map((d) => [d.col, d]));
  const rated = pm.cats.filter((c) => r.ratings[c] != null);
  const poor = rated.filter((c) => r.ratings[c] <= pm.P.poorMax)
    .sort((a, b) => r.ratings[a] - r.ratings[b] || city.get(a).share - city.get(b).share);
  const typical = d3.median(pm.latest, (d) => pm.cats.filter((c) => d.ratings[c] != null && d.ratings[c] <= pm.P.poorMax).length);
  const scaleMax = pm.era === 'cur' ? 3 : 5;
  document.getElementById('b-problems').innerHTML = `
    <p class="card-label">Problems found in the latest inspection</p>
    <p class="card-headline">${poor.length ? `${poor.length} of ${rated.length} items rated poorly` : `None of ${rated.length} items rated poorly`}</p>
    <p class="card-text">A typical Toronto building has ${typical} item${typical === 1 ? '' : 's'} rated poorly. “Poorly” means ${pm.P.poorText}.</p>
    ${poor.length ? `<ul class="problem-list">${poor.map((c, i) => `<li ${i >= SHOW_PROBLEMS ? 'hidden' : ''}><span class="pl-name">${esc(city.get(c).label)}</span>
      <span class="pl-rating">rated ${r.ratings[c]} of ${scaleMax}</span>
      <span class="pl-city">poor in ${pct(city.get(c).share)} of buildings</span></li>`).join('')}</ul>` : ''}
    ${poor.length > SHOW_PROBLEMS ? `<button type="button" class="btn btn-quiet" id="b-more">Show all ${poor.length} problems</button>` : ''}
    <p class="card-links"><a href="#/xray/${r.rsn}">Open its Building X-Ray →</a><br>${pm.era === 'cur' ? `<a href="#/fingerprint/${r.rsn}">See its inspection fingerprint →</a><br>` : ''}<a href="#/q3" data-keep>How common are these problems? →</a></p>`;

  document.getElementById('b-more')?.addEventListener('click', (e) => {
    document.querySelectorAll('#b-problems li[hidden]').forEach((li) => (li.hidden = false));
    e.currentTarget.remove();
  });

  // 4. context: age + nearby
  const decade = r.yearBuilt ? Math.floor(r.yearBuilt / 10) * 10 : null;
  const dm = decade != null && decadeMedians(pm.latest.filter((d) => d.yearBuilt != null), 10).find((d) => d.decade === decade);
  const near = r.lat == null ? [] : pm.latest.filter((d) => d.rsn !== r.rsn && d.lat != null)
    .map((d) => ({ d, km: haversine(r, d) })).sort((a, b) => a.km - b.km).slice(0, 5);
  document.getElementById('b-context').innerHTML = `
    <p class="card-label">Compared with similar buildings</p>
    ${dm ? `<p class="card-text">Buildings from the <b>${decade}s</b> typically score <b>${dm.median}</b> (${fmt.n(dm.n)} buildings). This one is ${r.score === dm.median ? 'right at' : `<b>${Math.abs(r.score - dm.median)} points ${r.score > dm.median ? 'above' : 'below'}</b>`} that.</p>`
      : '<p class="card-text">Not enough buildings from the same decade to compare.</p>'}
    ${near.length ? `<p class="card-sub">Nearest buildings</p><ul class="near-list">${near.map(({ d, km }) => `
      <li><button type="button" data-rsn="${d.rsn}"><span class="nl-name">${esc(titleCase(d.address))}</span>
      <span class="nl-km">${km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`}</span>
      <span class="nl-score ${scoreBand(d.score, pm)}">${d.score}</span></button></li>`).join('')}</ul>` : ''}
    <p class="card-links"><a href="#/q2" data-keep>Does age matter? →</a></p>`;
  document.querySelectorAll('#b-context [data-rsn]').forEach((b) => b.addEventListener('click', () => ctx.select(b.dataset.rsn, { open: true })));
}

function drawHistory(box, evs) {
  box.innerHTML = '';
  const { svg, width, height } = svgIn(box, 170, `Score history: ${evs.map((e) => `${e.score} on ${e.date}`).join(', ')}`);
  const m = { top: 22, right: 24, bottom: 26, left: 34 };
  const t = d3.extent(evs, (e) => e.time);
  if (t[0] === t[1]) { t[0] -= 864e5 * 180; t[1] += 864e5 * 180; }
  const x = d3.scaleTime().domain(t).range([m.left + 16, width - m.right - 16]);
  const y = d3.scaleLinear().domain([Math.min(50, Math.floor((d3.min(evs, (e) => e.score) - 5) / 10) * 10), 100]).range([height - m.bottom, m.top]);
  svg.append('g').attr('class', 'grid').attr('transform', `translate(${m.left},0)`).call(d3.axisLeft(y).ticks(3).tickSize(-(width - m.left - m.right)).tickFormat(''));
  svg.append('g').attr('class', 'axis').attr('transform', `translate(${m.left},0)`).call(d3.axisLeft(y).ticks(3).tickSizeOuter(0));
  svg.append('g').attr('class', 'axis').attr('transform', `translate(0,${height - m.bottom})`)
    .call(d3.axisBottom(x).tickValues(evs.map((e) => new Date(e.time))).tickFormat(d3.timeFormat("%b '%y")).tickSizeOuter(0));
  const accent = cssVar('--accent');
  svg.append('path').datum(evs).attr('fill', 'none').attr('stroke', accent).attr('stroke-width', 2)
    .attr('d', d3.line().x((e) => x(e.time)).y((e) => y(e.score)));
  const dots = svg.append('g').selectAll('circle').data(evs).join('circle')
    .attr('cx', (e) => x(e.time)).attr('cy', (e) => y(e.score)).attr('r', 5)
    .attr('fill', accent).attr('stroke', cssVar('--surface')).attr('stroke-width', 2);
  dots.on('mouseenter', (ev, e) => tip.show(`<div class="tt-title">${e.score} / 100</div><div class="tt-sub">Evaluated ${formatDate(e.date)}</div>`, ev))
    .on('mousemove', (ev) => tip.move(ev)).on('mouseleave', () => tip.hide());
  // few points, so each one is labelled directly
  svg.append('g').selectAll('text').data(evs).join('text').attr('class', 'annot')
    .attr('x', (e) => x(e.time)).attr('y', (e) => y(e.score) - 10).attr('text-anchor', 'middle').text((e) => e.score);
}

function renderSuggestions(ctx) {
  const { pm } = ctx;
  const lowest = d3.least(pm.latest, (r) => r.score);
  const box = document.getElementById('b-suggest');
  box.innerHTML = `<button type="button" class="chip" data-act="random">A random building</button>
    <button type="button" class="chip" data-act="low">The lowest-scoring building</button>`;
  box.querySelector('[data-act=random]').addEventListener('click', () => ctx.select(pm.latest[Math.floor(Math.random() * pm.latest.length)].rsn, { open: true }));
  box.querySelector('[data-act=low]').addEventListener('click', () => ctx.select(lowest.rsn, { open: true }));
}

function haversine(a, b) {
  const R = 6371, k = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * k) / 2) ** 2 + Math.cos(a.lat * k) * Math.cos(b.lat * k) * Math.sin(((b.lon - a.lon) * k) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
