// Temporal chapter — rendering + interaction. All numbers come from TEMPORAL.build() (temporal-data.js).
// Shared helpers reused from explorer/js/charts.js: LLC.tip (tooltip), LLC.fmt, LLC.hash.

(() => {
  const { tip, fmt, hash } = window.LLC;
  const color = (dir) => `var(--${dir})`;
  const fmtScore = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
  const fmtDelta = (d) => (d === 0 ? 'no change' : `${d > 0 ? '+' : '−'}${fmtScore(Math.abs(d))}`);
  const parse = d3.timeParse('%Y-%m-%d');
  const longDate = (s) => d3.timeFormat('%-d %b %Y')(parse(s));
  const monthYear = (s) => d3.timeFormat('%b %Y')(parse(s));
  const pts = (d) => `${fmtScore(Math.abs(d))} point${Math.abs(d) === 1 ? '' : 's'}`;
  const dirWords = (c) => (c.dir === 'same' ? '<span class="eq">the same score</span>' : `<span class="${c.dir === 'higher' ? 'hi' : 'lo'}">${pts(c.delta)} ${c.dir}</span>`);

  const state = { mode: 'all', selected: null, hoverBin: null };
  let D; // { changes, singles, summary, audit }

  const MODES = {
    all: {
      test: () => true,
      annot: (s) => `<b>${Math.round(s.all.higher.pct)}% scored higher, ${Math.round(s.all.lower.pct)}% scored lower.</b> The average change was ${fmtDelta(+s.all.meanDelta.toFixed(1))} points, but lines go both ways at almost every score level.`,
    },
    low: {
      test: (c) => c.first.score < TEMPORAL.LOW_START,
      annot: (s) => `<b>${s.lowStart.n} buildings first scored below 65. ${s.lowStart.higher.n} of them scored higher the next time</b>, by ${s.lowStart.meanDelta.toFixed(1)} points on average. A low score is not always permanent.`,
    },
    high: {
      test: (c) => c.first.score >= TEMPORAL.HIGH_START,
      annot: (s) => `<b>${fmt.n(s.highStart.n)} buildings first scored 95 or higher. ${Math.round(s.highStart.lower.pct)}% of them scored lower the next time.</b> A top score is not a promise that it will stay there.`,
    },
  };

  // ---------------------------------------------------------------- direction bar
  function drawDirection() {
    const s = D.summary.all;
    const parts = [['higher', 'Higher', s.higher], ['same', 'Same', s.same], ['lower', 'Lower', s.lower]];
    d3.select('#dir-bar').selectAll('div').data(parts).join('div')
      .style('flex', (p) => `${p[2].n} 1 0`).style('background', (p) => color(p[0]));
    d3.select('#dir-labels').html(parts.map(([k, label, v]) =>
      `<span><span class="big">${Math.round(v.pct)}%</span><span class="sw" style="background:${color(k)}"></span>${label} · ${fmt.n(v.n)}</span>`).join(''));
  }

  // ---------------------------------------------------------------- slope chart
  const slope = {};
  function drawSlope() {
    const host = document.getElementById('slope');
    host.innerHTML = '';
    const W = Math.min(host.clientWidth || 700, 820);
    const narrow = W < 560;
    const H = narrow ? 420 : 500;
    const m = { top: 48, right: narrow ? 70 : 150, bottom: 24, left: narrow ? 70 : 150 };
    const x0 = m.left, x1 = W - m.right;
    const y = d3.scaleLinear().domain([0, 100]).range([H - m.bottom, m.top]);
    Object.assign(slope, { W, H, x0, x1, y });

    const svg = d3.select(host).append('svg').attr('width', W).attr('height', H).attr('viewBox', `0 0 ${W} ${H}`)
      .attr('role', 'img').attr('aria-labelledby', 'slope-title slope-desc');
    svg.append('title').attr('id', 'slope-title').text('Slope chart: first vs latest RentSafeTO score for each building');
    svg.append('desc').attr('id', 'slope-desc').text('3,215 lines, one per building. 2,071 go up, 942 go down, 202 are flat. The numbers are also in the table below the charts.');

    // recessive grid + the two score axes
    const ticks = [0, 20, 40, 60, 80, 100];
    svg.append('g').attr('class', 'gridlines').selectAll('line').data(ticks).join('line')
      .attr('x1', x0).attr('x2', x1).attr('y1', y).attr('y2', y);
    for (const [x, anchor, dx] of [[x0, 'end', -8], [x1, 'start', 8]]) {
      svg.append('line').attr('x1', x).attr('x2', x).attr('y1', y(0)).attr('y2', y(100)).attr('stroke', 'var(--axis)');
      svg.append('g').selectAll('text').data(ticks).join('text').attr('class', 'axis')
        .attr('x', x + dx).attr('y', (t) => y(t) + 4).attr('text-anchor', anchor).style('fill', 'var(--muted)').text((t) => t);
    }
    const s = D.summary;
    svg.append('text').attr('class', 'axis-title').attr('x', x0).attr('y', 12).attr('text-anchor', 'middle').text('First evaluation');
    svg.append('text').attr('x', x0).attr('y', 27).attr('text-anchor', 'middle').style('fill', 'var(--muted)').text(`${monthYear(s.firstDates[0])}–${monthYear(s.firstDates[1])}`);
    svg.append('text').attr('class', 'axis-title').attr('x', x1).attr('y', 12).attr('text-anchor', 'middle').text('Latest evaluation');
    svg.append('text').attr('x', x1).attr('y', 27).attr('text-anchor', 'middle').style('fill', 'var(--muted)').text(`${monthYear(s.latestDates[0])}–${monthYear(s.latestDates[1])}`);

    // lines: deterministic shuffle so neither direction is systematically painted on top
    const order = [...D.changes].sort((a, b) => hash(a.rsn) - hash(b.rsn));
    slope.lines = svg.append('g').attr('fill', 'none').selectAll('line').data(order, (c) => c.rsn).join('line')
      .attr('x1', x0).attr('x2', x1).attr('y1', (c) => y(c.first.score)).attr('y2', (c) => y(c.latest.score))
      .attr('stroke-width', 1).attr('stroke-linecap', 'round');
    slope.focus = svg.append('g');   // highlighted subgroup is re-drawn here, above the faded rest
    slope.avg = svg.append('g');     // group-average slope + direct labels
    slope.sel = svg.append('g');     // searched / clicked building
    slope.hover = svg.append('g').attr('pointer-events', 'none');

    // hover layer: nearest line to the pointer (lines are 1px — too thin to target directly)
    svg.append('rect').attr('x', x0 - 10).attr('width', x1 - x0 + 20).attr('y', y(100)).attr('height', y(0) - y(100))
      .attr('fill', 'transparent').style('cursor', 'crosshair')
      .on('pointermove', (ev) => {
        const [px, py] = d3.pointer(ev);
        const c = nearest(px, py);
        slope.hover.selectAll('*').remove();
        if (!c) return tip.hide();
        drawBuilding(slope.hover, c, { labels: false });
        const same = D.changes.filter((o) => o !== c && o.first.score === c.first.score && o.latest.score === c.latest.score).length;
        tip.show(tipHtml(c) + (same ? `<br><span class="muted">${fmt.n(same)} other building${same > 1 ? 's' : ''} had the same two scores</span>` : ''), ev);
      })
      .on('pointerleave', () => { slope.hover.selectAll('*').remove(); tip.hide(); })
      .on('click', (ev) => { const c = nearest(...d3.pointer(ev)); if (c) select(c); });
    updateSlope();
  }

  function nearest(px, py) {
    const { x0, x1, y } = slope;
    const t = Math.max(0, Math.min(1, (px - x0) / (x1 - x0)));
    let best = null, bd = 8;
    const test = MODES[state.mode].test;
    for (const c of D.changes) {
      if (!test(c)) continue;
      const cy = y(c.first.score) + (y(c.latest.score) - y(c.first.score)) * t;
      const d = Math.abs(cy - py);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }

  function tipHtml(c) {
    return `<b>${c.address}</b><br>${longDate(c.first.date)}: <b>${fmtScore(c.first.score)}</b><br>${longDate(c.latest.date)}: <b>${fmtScore(c.latest.score)}</b><br>${dirWords(c)}`;
  }

  function drawBuilding(g, c, { labels = true } = {}) {
    const { x0, x1, y } = slope;
    g.append('line').attr('x1', x0).attr('x2', x1).attr('y1', y(c.first.score)).attr('y2', y(c.latest.score))
      .attr('stroke', 'var(--panel)').attr('stroke-width', 6).attr('stroke-linecap', 'round');
    g.append('line').attr('x1', x0).attr('x2', x1).attr('y1', y(c.first.score)).attr('y2', y(c.latest.score))
      .attr('stroke', 'var(--ink)').attr('stroke-width', 2.5).attr('stroke-linecap', 'round');
    for (const [x, v] of [[x0, c.first.score], [x1, c.latest.score]])
      g.append('circle').attr('cx', x).attr('cy', y(v)).attr('r', 5).attr('fill', color(c.dir)).attr('stroke', 'var(--panel)').attr('stroke-width', 2);
    if (!labels) return;
    g.append('text').attr('class', 'direct strong').attr('x', x0 - 28).attr('y', y(c.first.score) + 4).attr('text-anchor', 'end').text(fmtScore(c.first.score));
    g.append('text').attr('class', 'direct strong').attr('x', x1 + 28).attr('y', y(c.latest.score) + 4).text(`${fmtScore(c.latest.score)} (${fmtDelta(c.delta)})`);
  }

  function updateSlope() {
    if (!slope.lines) return;
    const test = MODES[state.mode].test;
    const bin = state.hoverBin;
    const inFocus = (c) => test(c) && (bin == null || binOf(c.delta) === bin);
    const focusing = state.mode !== 'all' || bin != null;
    slope.lines.attr('stroke', (c) => (focusing ? 'var(--faded)' : color(c.dir)))
      .attr('stroke-opacity', focusing ? 0.5 : 0.22);
    // re-draw the focused subset on top at full strength
    const { x0, x1, y } = slope;
    const sub = focusing ? D.changes.filter(inFocus) : [];
    slope.focus.selectAll('line').data(sub, (c) => c.rsn).join('line')
      .attr('x1', x0).attr('x2', x1).attr('y1', (c) => y(c.first.score)).attr('y2', (c) => y(c.latest.score))
      .attr('stroke', (c) => color(c.dir)).attr('stroke-width', sub.length < 100 ? 1.5 : 1)
      .attr('stroke-opacity', sub.length < 100 ? 0.85 : 0.35);

    // average slope for the group in view, directly labelled
    slope.avg.selectAll('*').remove();
    const grp = D.changes.filter(test);
    const a = d3.mean(grp, (c) => c.first.score), b = d3.mean(grp, (c) => c.latest.score);
    const g = slope.avg;
    g.append('line').attr('x1', x0).attr('x2', x1).attr('y1', y(a)).attr('y2', y(b)).attr('stroke', 'var(--panel)').attr('stroke-width', 7).attr('stroke-linecap', 'round');
    g.append('line').attr('x1', x0).attr('x2', x1).attr('y1', y(a)).attr('y2', y(b)).attr('stroke', 'var(--ink)').attr('stroke-width', 2.5).attr('stroke-dasharray', '1 5').attr('stroke-linecap', 'round');
    const narrow = slope.W < 560;
    if (!state.selected) {
      g.append('text').attr('class', 'direct strong').attr('x', x1 + 28).attr('y', y(b) + (state.mode === 'high' ? 16 : 4)).text(narrow ? `avg ${b.toFixed(1)}` : `Average ${a.toFixed(1)} → ${b.toFixed(1)}`);
    }
    // group counts on the right edge, as direct labels (no separate legend needed)
    const sm = state.mode === 'all' ? D.summary.all : state.mode === 'low' ? D.summary.lowStart : D.summary.highStart;
    if (!narrow) {
      // bottom-right is empty in every mode (few latest scores fall below 20)
      const lbl = [['higher', sm.higher, y(12)], ['lower', sm.lower, y(12) + 18]];
      g.selectAll('text.cnt').data(lbl).join('text').attr('class', 'direct cnt').attr('x', x1 + 28).attr('y', (l) => l[2])
        .html((l) => `<tspan style="fill:${color(l[0])}">■</tspan> ${fmt.n(l[1].n)} ${l[0]}`);
    }
    d3.select('#slope-annot').html(MODES[state.mode].annot(D.summary));

    slope.sel.selectAll('*').remove();
    if (state.selected && state.selected.first) drawBuilding(slope.sel, state.selected);
  }

  // ---------------------------------------------------------------- change histogram
  const CLAMP = 30;
  const binOf = (d) => Math.max(-CLAMP, Math.min(CLAMP, d > 0 ? Math.ceil(d) : d < 0 ? Math.floor(d) : 0));
  const hist = {};
  function drawHist() {
    const host = document.getElementById('hist');
    host.innerHTML = '';
    const W = Math.min(host.clientWidth || 700, 820), H = 230;
    const m = { top: 40, right: 12, bottom: 40, left: 44 };
    const keys = d3.range(-CLAMP, CLAMP + 1);
    const x = d3.scaleBand().domain(keys).range([m.left, W - m.right]).paddingInner(0.12);
    const counts = d3.rollup(D.changes, (v) => v.length, (c) => binOf(c.delta));
    const y = d3.scaleLinear().domain([0, d3.max(counts.values())]).nice().range([H - m.bottom, m.top]);
    Object.assign(hist, { x, y, H, m, keys });

    const svg = d3.select(host).append('svg').attr('width', W).attr('height', H).attr('viewBox', `0 0 ${W} ${H}`)
      .attr('role', 'img').attr('aria-label', `Histogram of score change. ${Math.round(D.summary.small.pct)}% of buildings changed by 2 points or less; ${fmt.n(D.summary.bigUp.n)} rose 10 or more; ${fmt.n(D.summary.bigDown.n)} fell 10 or more.`);
    svg.append('g').attr('class', 'gridlines').attr('transform', `translate(${m.left},0)`)
      .call(d3.axisLeft(y).ticks(4).tickSize(-(W - m.left - m.right)).tickFormat(''));
    svg.append('g').attr('class', 'axis').attr('transform', `translate(${m.left},0)`).call(d3.axisLeft(y).ticks(4).tickSize(0)).call((g) => g.select('.domain').remove());
    const tickKeys = [-30, -20, -10, 0, 10, 20, 30];
    svg.append('g').attr('class', 'axis').attr('transform', `translate(0,${H - m.bottom})`)
      .call(d3.axisBottom(x).tickValues(tickKeys).tickSize(3).tickFormat((k) => (k === -CLAMP ? '≤ −30' : k === CLAMP ? '≥ +30' : k > 0 ? `+${k}` : k === 0 ? '0' : `−${-k}`)));
    svg.append('text').attr('x', (m.left + W - m.right) / 2).attr('y', H - 6).attr('text-anchor', 'middle').style('fill', 'var(--ink-2)').text('Points gained or lost (latest − first)');

    const binDir = (k) => (k > 0 ? 'higher' : k < 0 ? 'lower' : 'same');
    const data = keys.map((k) => ({ k, n: counts.get(k) || 0 }));
    hist.bars = svg.append('g').selectAll('rect').data(data).join('rect')
      .attr('x', (d) => x(d.k)).attr('width', x.bandwidth())
      .attr('y', (d) => y(d.n)).attr('height', (d) => y(0) - y(d.n)).attr('rx', Math.min(2, x.bandwidth() / 3))
      .attr('fill', (d) => color(binDir(d.k)));
    hist.overlay = svg.append('g');

    // annotation: bracket over the "barely moved" band (−2 … +2)
    const bx0 = x(-2), bx1 = x(2) + x.bandwidth(), by = m.top - 14;
    svg.append('path').attr('d', `M${bx0},${by + 6}V${by}H${bx1}V${by + 6}`).attr('fill', 'none').attr('stroke', 'var(--ink)');
    const smallTxt = `${Math.round(D.summary.small.pct)}% moved 2 points or less`;
    if (W < 560) svg.append('text').attr('class', 'direct').attr('x', (bx0 + bx1) / 2).attr('y', by - 6).attr('text-anchor', 'middle').text(smallTxt);
    else svg.append('text').attr('class', 'direct').attr('x', bx1 + 6).attr('y', by + 4).text(smallTxt);

    // hit targets span the full column height so thin bars are easy to hover
    svg.append('g').selectAll('rect').data(data).join('rect')
      .attr('x', (d) => x(d.k) - 1).attr('width', x.step()).attr('y', m.top).attr('height', y(0) - m.top).attr('fill', 'transparent')
      .on('pointerenter', (ev, d) => {
        state.hoverBin = d.k; updateSlope(); updateHist();
        const what = d.k === 0 ? 'Same score' : Math.abs(d.k) === CLAMP ? `${d.k > 0 ? 'Rose' : 'Fell'} 30 or more points` : `${d.k > 0 ? 'Rose' : 'Fell'} ${Math.abs(d.k)} point${Math.abs(d.k) === 1 ? '' : 's'}`;
        tip.show(`<b>${what}</b><br>${fmt.n(d.n)} buildings (${fmt.pct((d.n / D.changes.length) * 100)})`, ev);
      })
      .on('pointermove', (ev) => tip.move(ev))
      .on('pointerleave', () => { state.hoverBin = null; tip.hide(); updateSlope(); updateHist(); });
    updateHist();
  }

  function updateHist() {
    if (!hist.bars) return;
    const test = MODES[state.mode].test;
    const subset = state.mode !== 'all';
    hist.bars.attr('fill-opacity', (d) => (subset ? 0.18 : state.hoverBin == null || state.hoverBin === d.k ? 1 : 0.35));
    const { x, y } = hist;
    const sub = subset ? d3.rollup(D.changes.filter(test), (v) => v.length, (c) => binOf(c.delta)) : new Map();
    const data = hist.keys.map((k) => ({ k, n: sub.get(k) || 0 })).filter((d) => d.n);
    hist.overlay.selectAll('rect').data(data).join('rect')
      .attr('x', (d) => x(d.k)).attr('width', x.bandwidth()).attr('y', (d) => y(d.n)).attr('height', (d) => Math.max(2, y(0) - y(d.n)))
      .attr('rx', Math.min(2, x.bandwidth() / 3)).attr('fill', (d) => color(d.k > 0 ? 'higher' : d.k < 0 ? 'lower' : 'same')).attr('pointer-events', 'none');
    // selected building marker
    hist.overlay.selectAll('path.sel').data(state.selected?.first ? [state.selected] : []).join('path').attr('class', 'sel')
      .attr('d', (c) => { const cx = x(binOf(c.delta)) + x.bandwidth() / 2, cy = y(0) + 2; return `M${cx},${cy}l-5,8h10z`; })
      .attr('fill', 'var(--ink)');
  }

  // ---------------------------------------------------------------- building lookup
  let index; // label -> change row or single row
  function buildLookup() {
    index = new Map();
    const all = [...D.changes, ...D.singles];
    const addrCount = d3.rollup(all, (v) => v.length, (r) => r.address);
    for (const r of all) index.set(addrCount.get(r.address) > 1 ? `${r.address} · RSN ${r.rsn}` : r.address, r);
    for (const r of all) index.set(r.rsn, r);
    document.getElementById('bldg-list').innerHTML = [...index.keys()].filter((k) => !/^\d+$/.test(k)).sort()
      .map((k) => `<option value="${k}"></option>`).join('');
    const input = document.getElementById('bldg-search');
    const go = () => {
      const q = input.value.trim().toUpperCase();
      if (!q) return select(null);
      const hit = index.get(q) || index.get(input.value.trim());
      if (hit) select(hit);
      else document.getElementById('readout').innerHTML = `<span class="muted">No RentSafeTO building matches “${input.value.trim()}”. Try the street number and name, e.g. 220 OAK ST. RentSafeTO covers buildings with 3+ storeys and 10+ units.</span>`;
    };
    input.addEventListener('change', go);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  }

  function select(c) {
    state.selected = c;
    const out = document.getElementById('readout');
    if (!c) out.innerHTML = '<span class="muted">Pick an address to see its first score, its latest score, and which way it moved.</span>';
    else if (!c.first) {
      out.innerHTML = `<b>${c.address}</b> has been evaluated only once since June 2023: <b>${fmtScore(c.only.score)}</b> on ${longDate(c.only.date)}. <span class="muted">There is no second score yet, so there is no direction to show.</span>`;
    } else {
      const mid = c.between.length ? ` It was also evaluated on ${c.between.map((e) => `${longDate(e.date)} (${fmtScore(e.score)})`).join(', ')}.` : '';
      const yrs = (c.days / 365.25).toFixed(1);
      out.innerHTML = `<b>${c.address}</b> scored <b>${fmtScore(c.first.score)}</b> on ${longDate(c.first.date)} and <b>${fmtScore(c.latest.score)}</b> on ${longDate(c.latest.date)}: ${dirWords(c)} after ${yrs} years.${mid}`;
      const inp = document.getElementById('bldg-search');
      if (inp.value !== c.address && !inp.value.includes(c.rsn)) inp.value = c.address;
    }
    updateSlope(); updateHist();
  }

  // ---------------------------------------------------------------- table view
  function drawTable() {
    const s = D.summary;
    const row = (label, g) => `<tr><td>${label}</td><td class="num">${fmt.n(g.n)}</td><td class="num">${fmt.pct(g.higher.pct)}</td><td class="num">${fmt.pct(g.same.pct)}</td><td class="num">${fmt.pct(g.lower.pct)}</td><td class="num">${fmtDelta(+g.meanDelta.toFixed(1))}</td></tr>`;
    document.getElementById('table-view').innerHTML = `<table class="data"><caption class="sr-only">Direction of score change by first score</caption>
      <thead><tr><th>First score</th><th class="num">Buildings</th><th class="num">Higher</th><th class="num">Same</th><th class="num">Lower</th><th class="num">Avg change</th></tr></thead>
      <tbody>${row('All buildings', s.all)}${s.byStartBand.map((b) => row(b.label, b)).join('')}</tbody></table>
      <p class="note">Not shown in the charts: ${fmt.n(D.audit.singleEvaluation)} buildings with only one evaluation since June 2023. Rows excluded for a missing score or date: ${D.audit.missingScore.length + D.audit.missingDate.length}. Duplicate evaluation dates within a building: ${D.audit.duplicateDates.length}. Buildings with three evaluations (first and latest compared): ${D.audit.threeOrMore.length}.</p>`;
  }

  // ---------------------------------------------------------------- boot
  function setMode(mode) {
    state.mode = mode;
    document.querySelectorAll('.modes button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
    updateSlope(); updateHist();
  }

  (async function main() {
    const data = await LL.loadAll();
    D = TEMPORAL.build(data.records);
    const checks = TEMPORAL.validate(D);
    console.table(checks);
    document.body.dataset.validation = checks.every((c) => c.ok) ? 'pass' : 'fail';
    const params = new URLSearchParams(location.search);
    drawDirection(); drawSlope(); drawHist(); buildLookup(); drawTable();
    document.querySelectorAll('.modes button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
    if (params.get('mode')) setMode(params.get('mode'));
    if (params.get('rsn') && index.get(params.get('rsn'))) select(index.get(params.get('rsn')));
    let t; window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(() => { drawSlope(); drawHist(); }, 150); });
    document.body.dataset.ready = '1';
  })().catch((e) => {
    console.error(e);
    document.getElementById('slope').innerHTML = '<div class="warnbox">Could not load the CSV files. Run <code>python3 -m http.server</code> from the repo root and open /story/temporal.html.</div>';
  });
})();
