// Small D3 chart helpers shared by all views. Each helper appends to a container element.

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const eraColor = (era) => css(era === 'pre' ? '--pre' : '--cur');
const fmt = {
  n: d3.format(','),
  f1: d3.format(',.1f'),
  pct: (v) => (v == null || !isFinite(v) ? '–' : d3.format('.1f')(v) + '%'),
  sgn: d3.format('+.1f'),
};

// Ordered rating colours: low (worse) red -> high (better) blue. Lower is worse in both files.
const RATING_COLORS = {
  pre: { 1: '#a32b2b', 2: '#e34948', 3: '#b9b8b0', 4: '#86b6ef', 5: '#2a78d6' },
  cur: { 0: '#a32b2b', 1: '#e34948', 2: '#86b6ef', 3: '#2a78d6' },
};
// Diverging score scale: red (low) – gray – blue (high)
function divergingScale(domain) {
  return d3.scaleDiverging(d3.piecewise(d3.interpolateRgb, ['#c62f2f', '#e8a19a', '#d9d8d2', '#8fb9ec', '#1c5cab'])).domain(domain).clamp(true);
}

// ---- tooltip -------------------------------------------------------------
const tip = {
  el: null,
  show(html, ev) {
    this.el ??= document.getElementById('tooltip');
    this.el.innerHTML = html;
    this.el.hidden = false;
    this.move(ev);
  },
  move(ev) {
    if (!this.el || this.el.hidden) return;
    const w = this.el.offsetWidth, h = this.el.offsetHeight;
    let x = ev.clientX + 14, y = ev.clientY + 14;
    if (x + w > window.innerWidth - 8) x = ev.clientX - w - 14;
    if (y + h > window.innerHeight - 8) y = ev.clientY - h - 14;
    this.el.style.left = x + 'px';
    this.el.style.top = y + 'px';
  },
  hide() { if (this.el) this.el.hidden = true; },
};
function bindTip(sel, htmlFn) {
  sel.on('mouseenter', (ev, d) => tip.show(htmlFn(d), ev))
    .on('mousemove', (ev) => tip.move(ev))
    .on('mouseleave', () => tip.hide());
}

// ---- encoding legend (marks & channels) ----------------------------------
function encoding(parent, spec) {
  const div = document.createElement('div');
  div.className = 'encoding';
  const rows = [['Mark', spec.mark], ['x-position', spec.x], ['y-position', spec.y], ['Colour', spec.color], ['Size', spec.size], ['Other', spec.other]];
  div.innerHTML = rows.filter(([, v]) => v).map(([k, v]) => `<b>${k}</b><span>${v}</span>`).join('');
  parent.appendChild(div);
  return div;
}

function el(tag, attrs = {}, html = '') {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v; else if (k === 'style') e.style.cssText = v; else e.setAttribute(k, v);
  }
  if (html) e.innerHTML = html;
  return e;
}

function card(parent, title, sub) {
  const c = el('div', { class: 'card' });
  c.appendChild(el('h3', {}, title));
  if (sub) c.appendChild(el('div', { class: 'hint' }, sub));
  parent.appendChild(c);
  return c;
}

function legend(parent, items, square = false) {
  const d = el('div', { class: 'legend' });
  d.innerHTML = items.map((i) => `<span><span class="sw ${square ? 'sq' : ''}" style="background:${i.color}"></span>${i.label}</span>`).join('');
  parent.appendChild(d);
  return d;
}

// ---- frame ----------------------------------------------------------------
function frame(parent, { width, height = 300, margin = {} } = {}) {
  const W = width || Math.max(320, Math.min(parent.clientWidth || 700, 1100) - 4);
  const m = { top: 14, right: 16, bottom: 38, left: 48, ...margin };
  const svg = d3.select(parent).append('svg').attr('width', W).attr('height', height).attr('viewBox', `0 0 ${W} ${height}`);
  const g = svg.append('g').attr('transform', `translate(${m.left},${m.top})`);
  return { svg, g, w: W - m.left - m.right, h: height - m.top - m.bottom, m };
}
function axes(f, x, y, { xLabel, yLabel, xTicks, yTicks, xFormat, yFormat, yGrid = true } = {}) {
  if (yGrid) f.g.append('g').attr('class', 'gridlines').call(d3.axisLeft(y).ticks(yTicks || 6).tickSize(-f.w).tickFormat(''));
  const xa = d3.axisBottom(x); if (xTicks != null) xa.ticks(xTicks); if (xFormat) xa.tickFormat(xFormat);
  const ya = d3.axisLeft(y).ticks(yTicks || 6); if (yFormat) ya.tickFormat(yFormat);
  f.g.append('g').attr('class', 'axis').attr('transform', `translate(0,${f.h})`).call(xa);
  f.g.append('g').attr('class', 'axis').call(ya);
  if (xLabel) f.g.append('text').attr('x', f.w / 2).attr('y', f.h + 32).attr('text-anchor', 'middle').text(xLabel);
  if (yLabel) f.g.append('text').attr('transform', 'rotate(-90)').attr('x', -f.h / 2).attr('y', -38).attr('text-anchor', 'middle').text(yLabel);
}

// ---- histogram ------------------------------------------------------------
function histogram(parent, values, { domain = [0, 100], binWidth = 2, color, height = 220, xLabel = 'Overall score', refLines = [], highlight } = {}) {
  const f = frame(parent, { height });
  const x = d3.scaleLinear().domain(domain).range([0, f.w]);
  const thresholds = d3.range(domain[0], domain[1] + binWidth, binWidth);
  const bins = d3.bin().domain([domain[0], domain[1] + binWidth]).thresholds(thresholds)(values);
  const y = d3.scaleLinear().domain([0, d3.max(bins, (b) => b.length) || 1]).nice().range([f.h, 0]);
  if (highlight) f.g.append('rect').attr('x', x(highlight[0])).attr('width', x(highlight[1]) - x(highlight[0])).attr('y', 0).attr('height', f.h).attr('fill', 'var(--grid)').attr('opacity', 0.6);
  axes(f, x, y, { xLabel, yLabel: 'Evaluations' });
  const bars = f.g.selectAll('rect.bar').data(bins).join('rect').attr('class', 'bar')
    .attr('x', (b) => x(b.x0) + 1).attr('width', (b) => Math.max(0, x(Math.min(b.x1, domain[1] + binWidth)) - x(b.x0) - 2))
    .attr('y', (b) => y(b.length)).attr('height', (b) => f.h - y(b.length)).attr('fill', color).attr('rx', 1);
  bindTip(bars, (b) => `Score ${b.x0}–${b.x1 - 1}<br><b>${fmt.n(b.length)}</b> evaluations (${fmt.pct((b.length / values.length) * 100)})`);
  for (const r of refLines) {
    f.g.append('line').attr('x1', x(r.v)).attr('x2', x(r.v)).attr('y1', 0).attr('y2', f.h).attr('stroke', 'var(--ink)').attr('stroke-dasharray', r.dash || '4 3');
    f.g.append('text').attr('x', x(r.v) + 3).attr('y', 10 + (r.dy || 0)).text(r.label).style('fill', 'var(--ink)');
  }
  return f;
}

// ---- scatter --------------------------------------------------------------
function scatter(parent, data, { x: xAcc, y: yAcc, xDomain, yDomain = [0, 100], xLog = false, color, r = 2.5, height = 320, xLabel, yLabel = 'Overall score', tipFn, onClick, jitterX = 0, jitterY = 0, opacity = 0.45, overlay } = {}) {
  const f = frame(parent, { height });
  const xs = (xLog ? d3.scaleLog() : d3.scaleLinear()).domain(xDomain || d3.extent(data, xAcc)).range([0, f.w]);
  if (!xLog) xs.nice();
  const ys = d3.scaleLinear().domain(yDomain).range([f.h, 0]);
  axes(f, xs, ys, { xLabel, yLabel, xFormat: xLog ? (v) => ([10, 20, 50, 100, 200, 500].includes(v) ? v : '') : (xDomain && xDomain[0] > 1000 ? d3.format('d') : null) });
  const key = (d) => d.uid ?? d.r?.uid ?? d.b?.uid ?? String(xAcc(d)) + yAcc(d);
  const jx = (d) => (jitterX ? (hash(key(d)) - 0.5) * jitterX : 0);
  const jy = (d) => (jitterY ? (hash(key(d) + "y") - 0.5) * jitterY : 0);
  const pts = f.g.append('g').selectAll('circle').data(data).join('circle')
    .attr('cx', (d) => xs(xAcc(d) + jx(d))).attr('cy', (d) => ys(yAcc(d) + jy(d))).attr('r', r)
    .attr('fill', color).attr('fill-opacity', opacity);
  if (tipFn) bindTip(pts, tipFn);
  if (onClick) pts.style('cursor', 'pointer').on('click', (ev, d) => onClick(d));
  if (overlay) overlay(f, xs, ys);
  return { f, xs, ys };
}
function hash(s) { // deterministic jitter in [0,1)
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 10000) / 10000;
}

// ---- grouped box plot -----------------------------------------------------
// groups: [{key, label}], series: [{key, color, label}], values(groupKey, seriesKey) -> number[]
function boxplot(parent, { groups, series, values, yDomain = [0, 100], height = 300, xLabel, yLabel = 'Overall score', minN = 5 }) {
  const f = frame(parent, { height, margin: { bottom: 48 } });
  const x0 = d3.scaleBand().domain(groups.map((g) => g.key)).range([0, f.w]).padding(0.2);
  const x1 = d3.scaleBand().domain(series.map((s) => s.key)).range([0, x0.bandwidth()]).padding(0.15);
  const y = d3.scaleLinear().domain(yDomain).range([f.h, 0]);
  axes(f, x0, y, { xLabel, yLabel, xFormat: (k) => groups.find((g) => g.key === k)?.label ?? k });
  f.g.selectAll('.axis text').filter(function () { return this.parentNode.parentNode.getAttribute('transform')?.includes(`,${f.h})`); })
    .attr('transform', groups.length > 12 ? 'rotate(-35)' : null).style('text-anchor', groups.length > 12 ? 'end' : 'middle');
  for (const g of groups) for (const s of series) {
    const v = values(g.key, s.key).filter((d) => d != null).sort(d3.ascending);
    if (!v.length) continue;
    const q1 = d3.quantileSorted(v, 0.25), q2 = d3.quantileSorted(v, 0.5), q3 = d3.quantileSorted(v, 0.75);
    const iqr = q3 - q1, lo = Math.max(v[0], q1 - 1.5 * iqr), hi = Math.min(v[v.length - 1], q3 + 1.5 * iqr);
    const cx = x0(g.key) + x1(s.key), bw = x1.bandwidth();
    const gg = f.g.append('g').attr('opacity', v.length < minN ? 0.35 : 1);
    gg.append('line').attr('x1', cx + bw / 2).attr('x2', cx + bw / 2).attr('y1', y(lo)).attr('y2', y(hi)).attr('stroke', s.color);
    gg.append('rect').attr('x', cx).attr('width', bw).attr('y', y(q3)).attr('height', Math.max(1, y(q1) - y(q3))).attr('fill', s.color).attr('fill-opacity', 0.25).attr('stroke', s.color);
    gg.append('line').attr('x1', cx).attr('x2', cx + bw).attr('y1', y(q2)).attr('y2', y(q2)).attr('stroke', s.color).attr('stroke-width', 2);
    gg.append('rect').attr('x', cx - 2).attr('width', bw + 4).attr('y', 0).attr('height', f.h).attr('fill', 'transparent')
      .on('mouseenter', (ev) => tip.show(`<b>${g.label}</b> · ${s.label}<br>n = ${fmt.n(v.length)}<br>median ${fmt.f1(q2)} · IQR ${fmt.f1(q1)}–${fmt.f1(q3)}<br>mean ${fmt.f1(d3.mean(v))} · range ${v[0]}–${v[v.length - 1]}${v.length < minN ? '<br><i>small sample</i>' : ''}`, ev))
      .on('mousemove', (ev) => tip.move(ev)).on('mouseleave', () => tip.hide());
  }
  return f;
}

// ---- heatmap --------------------------------------------------------------
// rows: [{key,label}], cols: [{key,label}], cell(rowKey,colKey) -> {value, n, poor}
function heatmap(parent, { rows, cols, cell, maxV, minN = 10, colLabelAngle = -40, valueLabel = '% poor' }) {
  const cw = Math.max(18, Math.min(42, Math.floor((Math.min(parent.clientWidth || 900, 1200) - 230) / cols.length)));
  const ch = 16;
  const m = { top: 110, left: 210, right: 10, bottom: 10 };
  const W = m.left + cw * cols.length + m.right, H = m.top + ch * rows.length + m.bottom;
  const svg = d3.select(parent).append('svg').attr('width', W).attr('height', H);
  const g = svg.append('g').attr('transform', `translate(${m.left},${m.top})`);
  const color = d3.scaleSequential(d3.piecewise(d3.interpolateRgb, ['#f4f2ee', '#f2b5a8', '#e34948', '#8f1f1f'])).domain([0, maxV || 1]);
  g.selectAll('text.col').data(cols).join('text').attr('class', 'col')
    .attr('transform', (c, i) => `translate(${i * cw + cw / 2},-6) rotate(${colLabelAngle})`).text((c) => c.label);
  g.selectAll('text.row').data(rows).join('text').attr('class', 'row').attr('x', -6).attr('y', (r, i) => i * ch + ch * 0.72)
    .attr('text-anchor', 'end').text((r) => r.label);
  const cells = [];
  rows.forEach((r, i) => cols.forEach((c, j) => cells.push({ r, c, i, j, ...cell(r.key, c.key) })));
  const rects = g.selectAll('rect').data(cells).join('rect')
    .attr('x', (d) => d.j * cw + 1).attr('y', (d) => d.i * ch + 1).attr('width', cw - 2).attr('height', ch - 2).attr('rx', 2)
    .attr('fill', (d) => (d.n == null || d.n === 0 ? 'transparent' : d.n < minN ? 'url(#hatch)' : color(d.value)))
    .attr('stroke', (d) => (d.n ? 'none' : 'var(--grid)'));
  const defs = svg.append('defs').append('pattern').attr('id', 'hatch').attr('patternUnits', 'userSpaceOnUse').attr('width', 5).attr('height', 5).attr('patternTransform', 'rotate(45)');
  defs.append('line').attr('x1', 0).attr('y1', 0).attr('x2', 0).attr('y2', 5).attr('stroke', '#999').attr('stroke-width', 1.5);
  bindTip(rects, (d) => `<b>${d.r.label}</b><br>${d.c.label}<br>${d.n ? `${valueLabel}: <b>${fmt.pct(d.value)}</b> (${fmt.n(d.poor)} of ${fmt.n(d.n)} rated)${d.n < minN ? '<br><i>n &lt; ' + minN + ' — hatched</i>' : ''}` : 'no rated evaluations'}`);
  // colour legend
  const lg = el('div', { class: 'legend' });
  const stops = d3.range(0, 1.01, 0.25).map((t) => t * (maxV || 1));
  lg.innerHTML = `${valueLabel}: ` + stops.map((v) => `<span><span class="sw sq" style="background:${color(v)}"></span>${fmt.pct(v)}</span>`).join('') +
    ` <span><span class="sw sq" style="background:repeating-linear-gradient(45deg,#999 0 1px,transparent 1px 4px)"></span>n &lt; ${minN}</span>`;
  parent.appendChild(lg);
}

window.LLC = { css, eraColor, fmt, RATING_COLORS, divergingScale, tip, bindTip, encoding, el, card, legend, frame, axes, histogram, scatter, boxplot, heatmap, hash };
