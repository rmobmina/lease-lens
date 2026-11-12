// Q3: What are the most common problems found in Toronto apartment buildings?
// Ranked horizontal bars: share of buildings whose latest evaluation rated the item poorly.

import { itemProblemRates } from '../model.js';
import { tip, pct, fmt, esc, svgIn, cssVar, empty, setFinding } from '../ui.js';
import { snapshot, play } from '../chart-motion.js';

const TOP = 12;
const MIN_RATED = 30; // items rated in fewer buildings than this are listed separately, not ranked

export function renderProblems(ctx, state) {
  const { latest, pm, ward } = ctx;
  const box = document.getElementById('problem-chart');
  const more = document.getElementById('problem-more');
  const before = snapshot(box);
  box.innerHTML = '';

  // The records/physical split only exists in the 2023+ item list.
  const groupCtl = document.getElementById('item-group');
  groupCtl.hidden = pm.era !== 'cur';
  const group = pm.era === 'cur' ? state.group : 'all';

  document.getElementById('problem-def').innerHTML =
    `An item counts as a <b>problem</b> when the inspector gave it one of the two lowest ratings (${pm.P.poorText}).`;

  let rows = itemProblemRates(latest, pm);
  const few = rows.filter((d) => d.rated < MIN_RATED);
  rows = rows.filter((d) => d.rated >= MIN_RATED)
    .filter((d) => group === 'all' || (group === 'record' ? d.record : !d.record))
    .sort((a, b) => b.share - a.share || b.poor - a.poor);
  if (!rows.length) { empty(box, 'No inspection items with enough ratings for this selection.'); more.hidden = true; return; }

  const shown = state.showAll ? rows : rows.slice(0, TOP);
  more.hidden = rows.length <= TOP;
  more.textContent = state.showAll ? `Show top ${TOP} only` : `Show all ${rows.length} items`;
  more.setAttribute('aria-expanded', String(!!state.showAll));

  const narrow = box.clientWidth < 640;
  const rowH = narrow ? 44 : 30;
  const H = shown.length * rowH + 36;
  const { svg, width } = svgIn(box, H, `Bar chart of the ${shown.length} most common problems, by share of buildings rated poorly.`);
  const labelW = narrow ? 0 : Math.min(270, width * 0.36);
  const valueW = 128;
  const x0 = labelW + (narrow ? 0 : 12);
  const xMax = d3.max(shown, (d) => d.share);
  const x = d3.scaleLinear().domain([0, Math.max(0.05, xMax)]).nice().range([x0, width - valueW]);
  const barH = Math.min(18, rowH - (narrow ? 26 : 12));
  const barColor = cssVar('--ink-2');
  // The guided story can highlight one group of items (ctx.highlight: a Set of item columns).
  const hl = ctx.highlight;
  const fillFor = (d) => (!hl ? barColor : hl.has(d.col) ? cssVar('--accent') : cssVar('--axis'));

  // light gridlines + top axis in %
  svg.append('g').attr('class', 'grid').attr('transform', `translate(0,${H - 22})`)
    .call(d3.axisBottom(x).ticks(5).tickSize(-(H - 30)).tickFormat(''));
  svg.append('g').attr('class', 'axis').attr('transform', `translate(0,${H - 22})`)
    .call(d3.axisBottom(x).ticks(5).tickFormat(d3.format('.0%')).tickSizeOuter(0));

  const g = svg.append('g').selectAll('g').data(shown).join('g')
    .attr('data-k', (d) => d.col)
    .attr('transform', (d, i) => `translate(0,${i * rowH + 4})`);
  const barY = narrow ? 20 : (rowH - barH) / 2 - 2;
  g.append('rect').attr('class', 'row-hit').attr('x', 0).attr('y', -2).attr('width', width).attr('height', rowH - 2).attr('rx', 4);
  g.append('text').attr('class', 'row-label')
    .attr('x', narrow ? 0 : labelW).attr('y', narrow ? 14 : barY + barH / 2 + 4.5).attr('text-anchor', narrow ? 'start' : 'end')
    .text((d) => d.label)
    .append('tspan').attr('class', 'row-sub').text((d) => (d.record && group === 'all' ? '  · record/plan' : ''));
  // bar with a 4px rounded data end, square at the baseline
  g.append('path').attr('data-bar', '').attr('fill', fillFor).attr('class', (d) => (hl && hl.has(d.col) ? 'is-highlight' : null))
    .attr('d', (d) => {
      const w = Math.max(2, x(d.share) - x0), r = Math.min(4, w / 2), y0 = barY, h = barH;
      return `M${x0},${y0}h${w - r}a${r},${r} 0 0 1 ${r},${r}v${h - 2 * r}a${r},${r} 0 0 1 -${r},${r}h-${w - r}z`;
    });
  g.append('text').attr('class', 'value').attr('data-val', '').attr('x', (d) => x(d.share) + 8).attr('y', barY + barH / 2 + 4)
    .html((d) => `<tspan class="value-strong">${pct(d.share, 1)}</tspan> · ${fmt.n(d.poor)} bldgs`);

  g.attr('tabindex', 0).attr('class', 'row')
    .attr('aria-label', (d) => `${d.label}: rated poorly in ${pct(d.share, 1)} of buildings (${d.poor} of ${d.rated})`)
    .on('mouseenter', (ev, d) => tip.show(problemTip(d, latest.length), ev))
    .on('mousemove', (ev) => tip.move(ev)).on('mouseleave', () => tip.hide())
    .on('focus', function (ev, d) { const b = this.getBoundingClientRect(); tip.show(problemTip(d, latest.length), { clientX: b.left + 260, clientY: b.top + b.height }); })
    .on('blur', () => tip.hide());
  play(before, box);

  // takeaway
  const anyPoor = latest.filter((r) => pm.cats.some((c) => r.ratings[c] != null && r.ratings[c] <= pm.P.poorMax)).length;
  const top3 = rows.slice(0, 3);
  const all = itemProblemRates(latest, pm).filter((d) => d.rated >= MIN_RATED).sort((a, b) => b.share - a.share);
  const recordsInTop10 = all.slice(0, 10).filter((d) => d.record).length;
  setFinding('q3-takeaway', {
    value: pct(top3[0].share, 1),
    caption: `of buildings had <b>${esc(top3[0].label.toLowerCase())}</b> rated poorly, the most common ${group === 'record' ? 'record-keeping ' : group === 'physical' ? 'physical ' : ''}problem`,
    text: `Next come ${top3.slice(1).map((d) => esc(d.label.toLowerCase())).join(' and ')}. Overall, ${pct(anyPoor / latest.length)} of buildings${ward ? ' in this ward' : ''} had at least one item rated poorly in their latest evaluation.
      ${pm.era === 'cur' && group === 'all' && recordsInTop10 ? `${recordsInTop10} of the top 10 are records or plans (paperwork the landlord must keep), not physical conditions.` : ''}`,
  });

  document.getElementById('q3-method').innerHTML = `<ul>
    <li>Unit: buildings, using each building's most recent evaluation in the ${pm.P.long}${ward ? ' in the selected ward' : ''} (${fmt.n(latest.length)} buildings).</li>
    <li>Share = buildings where the item was rated ${pm.P.poorText} ÷ buildings where the item was rated. Items marked N/A (for example, no elevator or no pool) are left out of that item's count.</li>
    ${pm.era === 'cur' ? '<li>“Records &amp; plans” groups items that check documents or postings: the logs (pest control, cleaning, maintenance, service requests), the safety and repair plans, the tenant notification board, the emergency contact sign and property numbering. This grouping is ours, based on the item names.</li>' : ''}
    <li>Item names are shortened for readability; hover a bar to see the City's original name.</li>
    ${few.length ? `<li>${few.length} item${few.length === 1 ? ' was' : 's were'} rated in fewer than ${MIN_RATED} buildings and ${few.length === 1 ? 'is' : 'are'} not ranked: ${few.map((d) => `${esc(d.label)} (${d.poor} of ${d.rated})`).join(', ')}.</li>` : ''}
  </ul>`;
}

function problemTip(d, nBuildings) {
  return `<div class="tt-title">${esc(d.label)}</div><div class="tt-sub">City item name: ${esc(d.official)}</div>
    <dl><dt>Rated poorly</dt><dd><b>${fmt.n(d.poor)}</b> buildings (${pct(d.share, 1)})</dd>
    <dt>Rated</dt><dd>${fmt.n(d.rated)} buildings</dd>
    <dt>Not rated</dt><dd>${fmt.n(nBuildings - d.rated)} buildings (N/A or blank)</dd></dl>`;
}
