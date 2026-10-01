// The exploratory views. Each VIEWS[name](container) renders from APP.S.filtered.

const UI = {
  map: { color: 'score', size: 'fixed', points: 'latest', cat: '' },
  dist: { bin: 2, unit: 'evals' },
  age: { x: 'yearBuilt', jitter: true },
  problems: { sort: 'pct' },
  patterns: { era: null, by: 'decade' },
  changes: { cross: false, topN: 10 },
  hidden: { pre: 85, cur: 90, minPoor: 1 },
  table: { cols: null, sort: 'score', asc: true, page: 0, q: '' },
};

const eraLabel = (e) => LL.ERA[e].label;
const pill = (e) => `<span class="pill ${e}">${eraLabel(e)}</span>`;
const poorDef = () => `poor = rating ≤ ${APP.S.f.poorPre} (pre-2023, 1–5 scale) or ≤ ${APP.S.f.poorCur} (2023+, 0–3 scale)`;
const recTip = (r) => `<b>${r.address}</b> ${pill(r.era)}<br>RSN ${r.rsn} · Ward ${r.ward} ${r.wardName ?? ''}<br>Score <b>${r.score ?? '–'}</b> · evaluated ${r.date}<br>Built ${r.yearBuilt ?? 'missing'} · ${r.storeys ?? '–'} storeys · ${r.units ?? '–'} units<br>${r.propertyType ?? ''}${r.flags.length ? `<br><span class="muted">flags: ${r.flags.join(', ')}</span>` : ''}`;
const decadeKey = (r) => (r.decade == null ? null : r.decade < 1900 ? 1890 : r.decade);
const decadeLabel = (d) => (d === 1890 ? 'pre-1900' : `${d}s`);
const STOREY_BANDS = [[3, 3, '3'], [4, 4, '4'], [5, 6, '5–6'], [7, 10, '7–10'], [11, 15, '11–15'], [16, 25, '16–25'], [26, 999, '26+']];
const UNIT_BANDS = [[0, 19, '<20'], [20, 49, '20–49'], [50, 99, '50–99'], [100, 199, '100–199'], [200, 399, '200–399'], [400, 1e9, '400+']];
const band = (bands, v) => (v == null ? null : bands.find(([a, b]) => v >= a && v <= b)?.[2] ?? null);

function controls(parent, html) { const c = el('div', { class: 'controls' }, html); parent.appendChild(c); return c; }
function onCtl(c, sel, fn) { c.querySelectorAll(sel).forEach((e) => e.addEventListener('change', () => { fn(e); APP_render(); })); }
function APP_render() { document.querySelector(`#tabs .tab.active`)?.click(); }
function linkify(root) {
  root.querySelectorAll('[data-rsn]').forEach((a) => a.addEventListener('click', (ev) => { ev.preventDefault(); APP.selectBuilding(a.dataset.rsn); }));
}
function emptyMsg(parent, msg = 'No evaluations match the current filters.') { parent.appendChild(el('div', { class: 'warnbox' }, msg)); }

function pairs(recs, includeCross) {
  const out = [];
  for (const [, evs] of d3.group(recs, (r) => r.rsn)) {
    const s = [...evs].filter((r) => r.score != null).sort((a, b) => a.time - b.time);
    for (let i = 1; i < s.length; i++) {
      const a = s[i - 1], b = s[i];
      if (!includeCross && a.era !== b.era) continue;
      out.push({ rsn: a.rsn, a, b, delta: b.score - a.score, days: (b.time - a.time) / 864e5, type: a.era === b.era ? a.era : 'cross' });
    }
  }
  return out;
}
function catStats(recs, era) {
  return APP.S.data.catList.filter((c) => c.era === era).map((c) => {
    const E = LL.ERA[era];
    const counts = {}; for (let v = E.scaleMin; v <= E.scaleMax; v++) counts[v] = 0;
    let rated = 0, poor = 0, na = 0, blank = 0;
    const vals = [];
    for (const r of recs) {
      const v = r.ratings[c.col];
      if (v == null) { if (r.naCats.includes(c.col)) na++; else blank++; continue; }
      rated++; counts[v] = (counts[v] || 0) + 1; vals.push(v);
      if (APP.isPoor(r, c.col)) poor++;
    }
    return { c, rated, poor, na, blank, counts, pct: rated ? (poor / rated) * 100 : 0, sd: vals.length > 1 ? d3.deviation(vals) : 0, mean: d3.mean(vals) };
  });
}
function ratingLegend(parent, era) {
  const E = LL.ERA[era];
  legend(parent, d3.range(E.scaleMin, E.scaleMax + 1).map((v) => ({ color: RATING_COLORS[era][v], label: `${v}${v <= APP.poorThreshold(era) ? ' (poor)' : ''}` })), true);
}
function haversine(a, b) {
  const R = 6371, toR = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toR, dLon = (b.lon - a.lon) * toR;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toR) * Math.cos(b.lat * toR) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// =====================================================================
const VIEWS = {
  helpers: { pairs, catStats },

  // ---- 1. Building explorer ------------------------------------------
  explorer(root) {
    const S = APP.S;
    const c0 = card(root, 'Building explorer', 'Search all buildings (ignores sidebar filters). Comparisons below use the <b>currently filtered</b> data, same period as the selected evaluation.');
    const opts = [...S.data.byRsn].map(([rsn, evs]) => `<option value="${evs.at(-1).address} — RSN ${rsn}">`).join('');
    const ctl = controls(c0, `<input id="bsearch" list="blist" placeholder="Type an address or RSN…" style="min-width:340px" /><datalist id="blist">${opts}</datalist>
      <button id="b-low">Lowest score in filter</button><button id="b-rand">Random from filter</button>`);
    const pick = (v) => {
      const m = v.match(/RSN (\d+)/) || v.match(/^(\d{6,})$/);
      let rsn = m?.[1];
      if (!rsn) { const r = S.data.records.find((r) => r.addressRaw.toUpperCase().includes(v.trim().toUpperCase())); rsn = r?.rsn; }
      if (rsn && S.data.byRsn.has(rsn)) APP.selectBuilding(rsn);
    };
    ctl.querySelector('#bsearch').addEventListener('change', (e) => pick(e.target.value));
    ctl.querySelector('#bsearch').addEventListener('keydown', (e) => { if (e.key === 'Enter') pick(e.target.value); });
    ctl.querySelector('#b-low').addEventListener('click', () => { const r = d3.least(S.filtered.filter((r) => r.score != null && !r.flags.includes('no-ratings')), (r) => r.score); if (r) APP.selectBuilding(r.rsn); });
    ctl.querySelector('#b-rand').addEventListener('click', () => { const r = S.filtered[Math.floor(Math.random() * S.filtered.length)]; if (r) APP.selectBuilding(r.rsn); });

    if (!S.selectedRsn) { c0.appendChild(el('p', { class: 'hint' }, 'Pick a building to see its profile, history, category ratings, and how it compares to its ward and nearby buildings. You can also click points in other views.')); return; }
    const evs = S.data.byRsn.get(S.selectedRsn);
    const last = evs.at(-1);
    const addrs = [...new Set(evs.map((r) => r.addressRaw))];
    const info = card(root, `${last.address} <span class="muted">RSN ${last.rsn}</span>`);
    info.appendChild(el('dl', { class: 'kv' }, [
      ['Address(es) in data', addrs.join(' · ')], ['Ward', `${last.ward} ${last.wardName}`], ['Property type', last.propertyType],
      ['Year built', last.yearBuilt ?? 'missing'], ['Storeys / units', `${last.storeys} / ${last.units}`],
      ['Year registered', last.yearRegistered ?? 'missing'], ['Coordinates', last.lat != null ? `${last.lat.toFixed(5)}, ${last.lon.toFixed(5)} (${last.coordSource})` : 'missing'],
      ['Evaluations', `${evs.length} — ${evs.filter((r) => r.era === 'pre').length} pre-2023, ${evs.filter((r) => r.era === 'cur').length} 2023+`],
      ['Flags', [...new Set(evs.flatMap((r) => r.flags))].join(', ') || 'none'],
    ].map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')));

    // history
    const hc = card(root, 'Evaluation history');
    encoding(hc, { mark: 'one dot = one evaluation; lines connect evaluations within the same period', x: 'evaluation date', y: 'overall score (0–100)', color: 'period (blue = pre-2023, orange = 2023+). Dashed gap = scoring methodology change' });
    {
      const f = frame(hc, { height: 220 });
      const x = d3.scaleTime().domain([new Date('2017-06-01'), new Date('2026-12-31')]).range([0, f.w]);
      const y = d3.scaleLinear().domain([0, 100]).range([f.h, 0]);
      axes(f, x, y, { xLabel: 'Evaluation date', yLabel: 'Score' });
      const cut = x(new Date('2023-06-01'));
      f.g.append('line').attr('x1', cut).attr('x2', cut).attr('y1', 0).attr('y2', f.h).attr('stroke', 'var(--muted)').attr('stroke-dasharray', '3 3');
      f.g.append('text').attr('x', cut + 4).attr('y', 10).text('new methodology →');
      for (const e of ['pre', 'cur']) {
        const pts = evs.filter((r) => r.era === e && r.score != null);
        f.g.append('path').datum(pts).attr('fill', 'none').attr('stroke', eraColor(e)).attr('stroke-width', 2).attr('d', d3.line().x((r) => x(r.time)).y((r) => y(r.score)));
        const dots = f.g.selectAll(null).data(pts).join('circle').attr('cx', (r) => x(r.time)).attr('cy', (r) => y(r.score)).attr('r', 5).attr('fill', eraColor(e)).attr('stroke', 'var(--surface)').attr('stroke-width', 2);
        bindTip(dots, recTip);
        f.g.selectAll(null).data(pts).join('text').attr('x', (r) => x(r.time)).attr('y', (r) => y(r.score) - 9).attr('text-anchor', 'middle').text((r) => r.score);
      }
    }

    // ratings of a chosen evaluation
    const rc = card(root, 'Inspection category ratings');
    const sel = controls(rc, `<label>Evaluation <select id="b-eval">${evs.map((r, i) => `<option value="${i}" ${i === evs.length - 1 ? 'selected' : ''}>${r.date} · ${eraLabel(r.era)} · score ${r.score}</option>`).join('')}</select></label>`);
    const body = el('div'); rc.appendChild(body);
    const drawEval = () => {
      body.innerHTML = '';
      const ev = evs[+sel.querySelector('#b-eval').value];
      const E = LL.ERA[ev.era];
      const peers = S.filtered.filter((r) => r.era === ev.era);
      const wardPeers = peers.filter((r) => r.ward === ev.ward);
      const cats = S.data.catList.filter((c) => c.era === ev.era);
      const pctPoor = (rs, col) => { const rated = rs.filter((r) => r.ratings[col] != null); return rated.length ? (rated.filter((r) => APP.isPoor(r, col)).length / rated.length) * 100 : null; };
      encoding(body, { mark: 'one bar = one inspection category in this evaluation', x: `bar length = rating (${E.scaleMin}–${E.scaleMax}); N/A = category not applicable to this building`, y: 'category (file order)', color: 'rating value (red = low/poor, blue = high)', other: `right-hand text: % of filtered ${eraLabel(ev.era)} evaluations rated poor in this ward / citywide (${poorDef()})` });
      ratingLegend(body, ev.era);
      const rowH = 15, W = Math.min(body.clientWidth || 800, 900), lw = 220, bw = W - lw - 200;
      const svg = d3.select(body).append('svg').attr('width', W).attr('height', cats.length * rowH + 24);
      const x = d3.scaleLinear().domain([0, E.scaleMax]).range([0, bw]);
      svg.append('text').attr('x', lw + bw + 28).attr('y', 11).text('ward % poor · city % poor');
      cats.forEach((c, i) => {
        const yy = 18 + i * rowH, v = ev.ratings[c.col];
        svg.append('text').attr('x', lw - 6).attr('y', yy + 10).attr('text-anchor', 'end').text(c.label).style('font-weight', APP.isPoor(ev, c.col) ? 700 : 400);
        if (v == null) svg.append('text').attr('x', lw + 2).attr('y', yy + 10).text(ev.naCats.includes(c.col) ? 'N/A' : '(blank)').style('fill', 'var(--muted)');
        else {
          const r = svg.append('rect').attr('x', lw).attr('y', yy + 2).attr('height', rowH - 4).attr('width', Math.max(3, x(v))).attr('rx', 2).attr('fill', RATING_COLORS[ev.era][v]);
          bindTip(r, () => `<b>${c.label}</b><br>rating ${v} of ${E.scaleMax}${APP.isPoor(ev, c.col) ? ' — <b>poor</b>' : ''}`);
          svg.append('text').attr('x', lw + Math.max(3, x(v)) + 4).attr('y', yy + 10).text(v);
        }
        svg.append('text').attr('x', lw + bw + 28).attr('y', yy + 10).text(`${fmt.pct(pctPoor(wardPeers, c.col))} · ${fmt.pct(pctPoor(peers, c.col))}`).style('fill', 'var(--muted)');
      });

      // comparison: ward distribution + nearby
      const latestPeers = APP.latestPerBuilding(peers.filter((r) => r.score != null));
      const latestWard = latestPeers.filter((r) => r.ward === ev.ward);
      const pr = (rs) => (rs.length ? (rs.filter((r) => r.score < ev.score).length / rs.length) * 100 : null);
      const cc = el('div', { class: 'grid2' }); body.appendChild(cc);
      const left = el('div'); cc.appendChild(left);
      const right = el('div'); cc.appendChild(right);
      left.appendChild(el('h4', {}, `Compared with ward ${ev.ward} (${eraLabel(ev.era)}, latest evaluation per building)`));
      left.appendChild(el('p', { class: 'hint' }, `Scores higher than ${fmt.pct(pr(latestWard))} of ${fmt.n(latestWard.length)} ward buildings and ${fmt.pct(pr(latestPeers))} of ${fmt.n(latestPeers.length)} filtered buildings citywide. Ward median ${LL.median(latestWard.map((r) => r.score)) ?? '–'}.`));
      encoding(left, { mark: 'bar = count of ward buildings in a 2-point score bin', x: 'overall score', y: 'number of buildings', other: 'solid line = this evaluation' });
      if (latestWard.length) histogram(left, latestWard.map((r) => r.score), { color: eraColor(ev.era), height: 180, refLines: [{ v: ev.score, label: 'this building', dash: 'none' }] });
      else emptyMsg(left, 'No buildings from this ward in the current filter.');

      right.appendChild(el('h4', {}, 'Nearest 12 buildings (same period, current filter)'));
      if (ev.lat == null) emptyMsg(right, 'This building has no coordinates.');
      else {
        const near = latestPeers.filter((r) => r.rsn !== ev.rsn && r.lat != null).map((r) => ({ r, d: haversine(ev, r) })).sort((a, b) => a.d - b.d).slice(0, 12);
        const rows = [{ r: ev, d: 0, self: true }, ...near];
        encoding(right, { mark: 'one dot = one building (latest evaluation)', x: 'overall score', y: 'building, sorted by distance from the selected building', color: 'filled = selected building' });
        const f = frame(right, { height: rows.length * 18 + 50, margin: { left: 190 } });
        const x = d3.scaleLinear().domain([Math.min(50, d3.min(rows, (d) => d.r.score)), 100]).range([0, f.w]);
        const y = d3.scaleBand().domain(rows.map((d) => d.r.rsn)).range([0, f.h]).padding(0.3);
        axes(f, x, y, { xLabel: 'Overall score', yGrid: false, yFormat: (k) => { const d = rows.find((d) => d.r.rsn === k); return `${d.r.address.slice(0, 22)} ${d.self ? '' : `(${d.d.toFixed(2)} km)`}`; } });
        const dots = f.g.selectAll(null).data(rows).join('circle').attr('cx', (d) => x(d.r.score)).attr('cy', (d) => y(d.r.rsn) + y.bandwidth() / 2).attr('r', (d) => (d.self ? 6 : 4.5))
          .attr('fill', (d) => (d.self ? eraColor(ev.era) : 'var(--surface)')).attr('stroke', eraColor(ev.era)).attr('stroke-width', 2).style('cursor', 'pointer')
          .on('click', (e, d) => APP.selectBuilding(d.r.rsn));
        bindTip(dots, (d) => recTip(d.r) + (d.self ? '' : `<br>${d.d.toFixed(2)} km away · ${fmt.sgn(d.r.score - ev.score)} vs selected`));
        const nm = d3.mean(near, (d) => d.r.score);
        f.g.append('line').attr('x1', x(nm)).attr('x2', x(nm)).attr('y1', 0).attr('y2', f.h).attr('stroke', 'var(--muted)').attr('stroke-dasharray', '4 3');
        f.g.append('text').attr('x', x(nm) + 3).attr('y', -3).text(`nearby mean ${fmt.f1(nm)}`);
      }
    };
    sel.querySelector('#b-eval').addEventListener('change', drawEval);
    drawEval();
  },

  // ---- 2. Map ------------------------------------------------------------
  map(root) {
    const S = APP.S, U = UI.map;
    if (VIEWS._map) { VIEWS._map.remove(); VIEWS._map = null; }
    const c = card(root, 'Toronto map');
    const catOpts = S.data.catList.filter((x) => APP.erasIn(S.filtered).includes(x.era)).map((x) => `<option value="${x.key}" ${U.cat === x.key ? 'selected' : ''}>${eraLabel(x.era)}: ${x.label}</option>`).join('');
    const ctl = controls(c, `<label>Colour by <select id="m-color">
        <option value="score">Overall score</option><option value="pct">Score percentile within its period</option><option value="era">Period</option><option value="type">Property type</option><option value="cat">Category rating →</option></select></label>
      <label>Category <select id="m-cat">${catOpts}</select></label>
      <label>Size <select id="m-size"><option value="fixed">fixed</option><option value="units">number of units</option></select></label>
      <label>Points <select id="m-points"><option value="latest">latest filtered evaluation per building</option><option value="all">every evaluation</option></select></label>`);
    ctl.querySelector('#m-color').value = U.color; ctl.querySelector('#m-size').value = U.size; ctl.querySelector('#m-points').value = U.points;
    if (!U.cat && S.f.cat) U.cat = S.f.cat.key;
    if (U.cat) ctl.querySelector('#m-cat').value = U.cat;
    U.cat = ctl.querySelector('#m-cat').value;
    onCtl(ctl, 'select', (e) => { const k = { 'm-color': 'color', 'm-size': 'size', 'm-points': 'points', 'm-cat': 'cat' }[e.id]; U[k] = e.value; });

    let pts = U.points === 'latest' ? APP.latestPerBuilding(S.filtered) : S.filtered;
    const noCoord = pts.filter((r) => r.lat == null).length;
    const derived = pts.filter((r) => r.coordSource === 'derived-from-XY').length;
    pts = pts.filter((r) => r.lat != null);
    const eras = APP.erasIn(pts);
    let colorFn, legendItems, colorDesc;
    const cat = S.data.catByKey.get(U.cat);
    if (U.color === 'score') {
      if (eras.length > 1) c.appendChild(el('div', { class: 'warnbox' }, 'Both periods shown with a single raw-score scale — pre-2023 scores run ~20 points lower by method. Consider “Score percentile within its period”.'));
      const sc = pts.map((r) => r.score).sort(d3.ascending);
      const dom = [d3.quantileSorted(sc, 0.05) ?? 0, d3.quantileSorted(sc, 0.5) ?? 50, sc.at(-1) ?? 100];
      const s = divergingScale(dom);
      colorFn = (r) => s(r.score);
      legendItems = [dom[0], (dom[0] + dom[1]) / 2, dom[1], (dom[1] + dom[2]) / 2, dom[2]].map((v) => ({ color: s(v), label: (v === dom[0] ? '≤' : '') + Math.round(v) }));
      colorDesc = `overall score, diverging around the median of shown points (${dom[1]}); red = lower, blue = higher; clamped at 5th percentile (${dom[0]})`;
    } else if (U.color === 'pct') {
      const s = divergingScale([0, 50, 100]);
      colorFn = (r) => s(r.scorePctInEra);
      legendItems = [0, 25, 50, 75, 100].map((v) => ({ color: s(v), label: `${v}th pct` }));
      colorDesc = 'percentile rank of the score among ALL evaluations in the same period (computed on unfiltered data)';
    } else if (U.color === 'era') {
      colorFn = (r) => eraColor(r.era);
      legendItems = ['pre', 'cur'].map((e) => ({ color: eraColor(e), label: eraLabel(e) }));
      colorDesc = 'period / file';
    } else if (U.color === 'type') {
      const types = ['PRIVATE', 'TCHC', 'SOCIAL HOUSING'], cols = ['#2a78d6', '#eb6834', '#1baf7a'];
      colorFn = (r) => cols[types.indexOf(r.propertyType)] ?? '#999';
      legendItems = types.map((t, i) => ({ color: cols[i], label: t }));
      colorDesc = 'property type';
    } else {
      if (!cat) { emptyMsg(c, 'Choose a category.'); return; }
      colorFn = (r) => (r.era !== cat.era ? 'transparent' : r.ratings[cat.col] == null ? '#bbb' : RATING_COLORS[cat.era][r.ratings[cat.col]]);
      const E = LL.ERA[cat.era];
      legendItems = [...d3.range(E.scaleMin, E.scaleMax + 1).map((v) => ({ color: RATING_COLORS[cat.era][v], label: `${v}${v <= APP.poorThreshold(cat.era) ? ' poor' : ''}` })), { color: '#bbb', label: 'N/A' }];
      colorDesc = `rating for “${cat.label}” (${eraLabel(cat.era)}); points from the other period are hidden`;
      pts = pts.filter((r) => r.era === cat.era);
    }
    const sizeFn = U.size === 'units' ? (() => { const s = d3.scaleSqrt().domain([0, 800]).range([2, 14]); return (r) => s(r.units ?? 0); })() : () => 4;
    encoding(c, { mark: U.points === 'latest' ? 'one circle = one building (its latest evaluation in the filter)' : 'one circle = one evaluation (buildings overlap)', x: 'longitude', y: 'latitude', color: colorDesc, size: U.size === 'units' ? 'number of units (area ∝ units)' : 'fixed', other: 'lower scores are drawn on top so low-scoring clusters stay visible' });
    legend(c, legendItems);
    c.appendChild(el('p', { class: 'hint' }, `${fmt.n(pts.length)} points plotted · ${fmt.n(noCoord)} records without any coordinates not shown · ${fmt.n(derived)} positions derived from X/Y (see Data notes). Click a point to open it in the building explorer.`));
    const mdiv = el('div', { id: 'map' }); c.appendChild(mdiv);
    const map = L.map(mdiv, { preferCanvas: true }).setView([43.715, -79.39], 11);
    VIEWS._map = map;
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap contributors', maxZoom: 19 }).addTo(map);
    const renderer = L.canvas({ padding: 0.5 });
    [...pts].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).forEach((r) => {
      const col = colorFn(r);
      L.circleMarker([r.lat, r.lon], { renderer, radius: sizeFn(r), color: '#333', weight: 0.4, fillColor: col, fillOpacity: 0.85 })
        .bindTooltip(recTip(r), { sticky: true }).on('click', () => APP.selectBuilding(r.rsn)).addTo(map);
    });
  },

  // ---- 3. Distribution ------------------------------------------------------
  dist(root) {
    const S = APP.S, U = UI.dist;
    const c = card(root, 'Score distribution', 'Is the distribution concentrated between ~85 and 100? Shaded band = 85–100.');
    const ctl = controls(c, `<label>Bin width <select id="d-bin"><option>1</option><option>2</option><option>5</option></select></label>
      <label>Unit <select id="d-unit"><option value="evals">every evaluation</option><option value="latest">latest evaluation per building</option></select></label>`);
    ctl.querySelector('#d-bin').value = U.bin; ctl.querySelector('#d-unit').value = U.unit;
    onCtl(ctl, 'select', (e) => { if (e.id === 'd-bin') U.bin = +e.value; else U.unit = e.value; });
    const recs = (U.unit === 'latest' ? APP.latestPerBuilding(S.filtered) : S.filtered).filter((r) => r.score != null);
    encoding(c, { mark: `one bar = number of ${U.unit === 'latest' ? 'buildings' : 'evaluations'} in a ${U.bin}-point score bin`, x: 'overall score (0–100)', y: 'count', color: 'period (one panel per period because methods differ)', other: 'dashed lines = mean and median; shaded band = 85–100' });
    const eras = APP.erasIn(recs);
    if (!eras.length) return emptyMsg(c);
    const ranges = [[0, 49], [50, 64], [65, 74], [75, 84], [85, 89], [90, 94], [95, 100]];
    const tbl = [];
    for (const e of eras) {
      const v = recs.filter((r) => r.era === e).map((r) => r.score);
      const mean = d3.mean(v), med = LL.median(v);
      c.appendChild(el('h4', {}, `${eraLabel(e)} — n = ${fmt.n(v.length)}, mean ${fmt.f1(mean)}, median ${med}, SD ${fmt.f1(d3.deviation(v) || 0)}, min ${d3.min(v)}, max ${d3.max(v)}`));
      histogram(c, v, { binWidth: U.bin, color: eraColor(e), highlight: [85, 101], refLines: [{ v: mean, label: `mean ${fmt.f1(mean)}` }, { v: med, label: `median ${med}`, dy: 14, dash: '1 3' }] });
      tbl.push([e, ranges.map(([a, b]) => v.filter((s) => s >= a && s <= b).length), v.length]);
    }
    const t = card(root, 'Share of evaluations in score ranges');
    t.appendChild(el('table', { class: 'data' }, `<tr><th>Period</th>${ranges.map(([a, b]) => `<th>${a}–${b}</th>`).join('')}<th>85–100</th><th>n</th></tr>` +
      tbl.map(([e, cs, n]) => `<tr><td>${pill(e)}</td>${cs.map((k) => `<td>${fmt.pct((k / n) * 100)} <span class="muted">(${fmt.n(k)})</span></td>`).join('')}<td><b>${fmt.pct(((cs[4] + cs[5] + cs[6]) / n) * 100)}</b></td><td>${fmt.n(n)}</td></tr>`).join('')));
    if (eras.includes('pre')) t.appendChild(el('p', { class: 'hint' }, 'Pre-2023 file also has RESULTS_OF_SCORE: ≤50 “Building Audit”, 51–65 re-evaluate in 1 year, 66–85 in 2 years, 86–100 in 3 years (verified against the data).'));
  },

  // ---- 4. Age vs score --------------------------------------------------------
  age(root) {
    const S = APP.S, U = UI.age;
    const recs = S.filtered.filter((r) => r.score != null);
    const missing = recs.filter((r) => r.yearBuilt == null).length;
    const c = card(root, 'Building age vs score', `${fmt.n(missing)} evaluations with missing year built are not plotted.`);
    const ctl = controls(c, `<label>x-axis <select id="a-x"><option value="yearBuilt">year built</option><option value="age">age at evaluation (years)</option></select></label>
      <label><input type="checkbox" id="a-j" ${U.jitter ? 'checked' : ''}/> jitter (±0.5 yr, ±0.5 pt) to reduce overplotting</label>`);
    ctl.querySelector('#a-x').value = U.x;
    onCtl(ctl, 'select,input', (e) => { if (e.id === 'a-x') U.x = e.value; else U.jitter = e.checked; });
    const pts = recs.filter((r) => r[U.x] != null);
    if (!pts.length) return emptyMsg(c);
    const eras = APP.erasIn(pts);
    encoding(c, { mark: 'one dot = one evaluation', x: U.x === 'age' ? 'building age at evaluation = evaluation year − year built' : 'year built', y: 'overall score', color: 'period', other: 'semi-transparent so dense areas look darker' });
    legend(c, eras.map((e) => ({ color: eraColor(e), label: eraLabel(e) })));
    scatter(c, pts, { x: (r) => r[U.x], y: (r) => r.score, xDomain: d3.extent(pts, (r) => r[U.x]), color: (r) => eraColor(r.era), xLabel: U.x === 'age' ? 'Age at evaluation (years)' : 'Year built', tipFn: recTip, onClick: (r) => APP.selectBuilding(r.rsn), jitterX: U.jitter ? 1 : 0, jitterY: U.jitter ? 1 : 0, r: 2.2, opacity: 0.35 });
    const b = card(root, 'Score by decade built');
    encoding(b, { mark: 'one box per decade × period: line = median, box = interquartile range, whisker = 1.5×IQR', x: 'decade built (pre-1900 grouped)', y: 'overall score', color: 'period', other: 'faded = fewer than 5 evaluations; hover for n' });
    legend(b, eras.map((e) => ({ color: eraColor(e), label: eraLabel(e) })));
    const decs = [...new Set(pts.map(decadeKey))].filter((d) => d != null).sort();
    const g = d3.group(pts, decadeKey, (r) => r.era);
    boxplot(b, { groups: decs.map((d) => ({ key: d, label: decadeLabel(d) })), series: eras.map((e) => ({ key: e, label: eraLabel(e), color: eraColor(e) })), values: (d, e) => (g.get(d)?.get(e) ?? []).map((r) => r.score), xLabel: 'Decade built' });
    const t = el('table', { class: 'data' });
    t.innerHTML = `<tr><th>Decade</th>${eras.map((e) => `<th>${eraLabel(e)} n</th><th>median</th><th>mean</th>`).join('')}</tr>` + decs.map((d) => `<tr><td>${decadeLabel(d)}</td>${eras.map((e) => { const v = (g.get(d)?.get(e) ?? []).map((r) => r.score); return `<td>${fmt.n(v.length)}</td><td>${v.length ? LL.median(v) : '–'}</td><td>${v.length ? fmt.f1(d3.mean(v)) : '–'}</td>`; }).join('')}</tr>`).join('');
    b.appendChild(t);
  },

  // ---- 5. Size vs score -------------------------------------------------------
  size(root) {
    const S = APP.S;
    const recs = S.filtered.filter((r) => r.score != null);
    if (!recs.length) return emptyMsg(root);
    const eras = APP.erasIn(recs);
    const medOverlay = (bands, acc, xs0) => (f, xs, ys) => {
      for (const e of eras) {
        const rows = bands.map(([a, b, l]) => { const v = recs.filter((r) => r.era === e && acc(r) >= a && acc(r) <= b).map((r) => r.score); return v.length >= 5 ? { x: xs0(a, b), m: LL.median(v), n: v.length, l } : null; }).filter(Boolean);
        f.g.append('path').datum(rows).attr('fill', 'none').attr('stroke', eraColor(e)).attr('stroke-width', 2.5).attr('d', d3.line().x((d) => xs(d.x)).y((d) => ys(d.m)));
        const dd = f.g.selectAll(null).data(rows).join('circle').attr('cx', (d) => xs(d.x)).attr('cy', (d) => ys(d.m)).attr('r', 5).attr('fill', eraColor(e)).attr('stroke', 'var(--surface)').attr('stroke-width', 2);
        bindTip(dd, (d) => `${eraLabel(e)} · ${d.l}<br>median ${d.m} (n = ${fmt.n(d.n)})`);
      }
    };
    const grid = el('div', { class: 'grid2' }); root.appendChild(grid);
    const c1 = card(grid, 'Number of units vs score');
    const c2 = card(grid, 'Number of storeys vs score');
    encoding(c1, { mark: 'small dot = one evaluation; large dots + line = median score per unit band (n ≥ 5)', x: 'confirmed units (log scale)', y: 'overall score', color: 'period' });
    legend(c1, eras.map((e) => ({ color: eraColor(e), label: eraLabel(e) })));
    scatter(c1, recs, { x: (r) => r.units, y: (r) => r.score, xLog: true, xDomain: [8, 900], color: (r) => eraColor(r.era), xLabel: 'Units (log)', tipFn: recTip, onClick: (r) => APP.selectBuilding(r.rsn), r: 2, opacity: 0.25, jitterY: 1,
      overlay: medOverlay(UNIT_BANDS, (r) => r.units, (a, b) => Math.sqrt(Math.max(a, 10) * Math.min(b, 800))) });
    encoding(c2, { mark: 'small dot = one evaluation; large dots + line = median score per storey band (n ≥ 5)', x: 'confirmed storeys (jittered ±0.4)', y: 'overall score', color: 'period' });
    legend(c2, eras.map((e) => ({ color: eraColor(e), label: eraLabel(e) })));
    scatter(c2, recs, { x: (r) => r.storeys, y: (r) => r.score, xDomain: [0, d3.max(recs, (r) => r.storeys) + 1], color: (r) => eraColor(r.era), xLabel: 'Storeys', tipFn: recTip, onClick: (r) => APP.selectBuilding(r.rsn), r: 2, opacity: 0.25, jitterX: 0.8, jitterY: 1,
      overlay: medOverlay(STOREY_BANDS, (r) => r.storeys, (a, b) => (a + Math.min(b, 40)) / 2) });
    const c3 = card(root, 'Score by storey band');
    encoding(c3, { mark: 'box per storey band × period (median, IQR, 1.5×IQR whiskers)', x: 'storey band', y: 'overall score', color: 'period' });
    const g = d3.group(recs, (r) => band(STOREY_BANDS, r.storeys), (r) => r.era);
    boxplot(c3, { groups: STOREY_BANDS.map(([, , l]) => ({ key: l, label: l })), series: eras.map((e) => ({ key: e, label: eraLabel(e), color: eraColor(e) })), values: (b, e) => (g.get(b)?.get(e) ?? []).map((r) => r.score), xLabel: 'Storeys', height: 260 });
  },

  // ---- 6. Common problems -----------------------------------------------------
  problems(root) {
    const S = APP.S, U = UI.problems;
    const eras = APP.erasIn(S.filtered);
    const top = card(root, 'Common inspection problems', `${poorDef()}. Categories differ completely between the two periods, so each period gets its own chart.`);
    const ctl = controls(top, `<label>Sort by <select id="p-sort"><option value="pct">% poor (of rated)</option><option value="poor">count poor</option><option value="mean">mean rating (low first)</option><option value="sd">variation (SD of rating)</option><option value="na">% N/A</option><option value="file">file order</option></select></label>`);
    ctl.querySelector('#p-sort').value = U.sort;
    onCtl(ctl, 'select', (e) => (U.sort = e.value));
    if (!eras.length) return emptyMsg(top);
    for (const e of eras) {
      const recs = S.filtered.filter((r) => r.era === e);
      let st = catStats(recs, e);
      const sorters = { pct: (a, b) => b.pct - a.pct, poor: (a, b) => b.poor - a.poor, mean: (a, b) => a.mean - b.mean, sd: (a, b) => b.sd - a.sd, na: (a, b) => b.na - a.na, file: () => 0 };
      st = [...st].sort(sorters[U.sort]);
      const c = card(root, `${eraLabel(e)} — ${fmt.n(recs.length)} evaluations`);
      encoding(c, { mark: 'one stacked bar = one inspection category', x: 'share of evaluations where the category was rated (N/A excluded), split by rating value', y: 'category (sorted by the chosen measure)', color: 'rating value (red = low/poor, blue = high)', other: 'right-hand text: % poor · n rated · % N/A (not applicable)' });
      ratingLegend(c, e);
      const E = LL.ERA[e], rowH = 17, W = Math.min(c.clientWidth || 900, 980), lw = 220, bw = W - lw - 210;
      const svg = d3.select(c).append('svg').attr('width', W).attr('height', st.length * rowH + 30);
      const x = d3.scaleLinear().domain([0, 1]).range([0, bw]);
      svg.append('g').attr('class', 'axis').attr('transform', `translate(${lw},${st.length * rowH + 4})`).call(d3.axisBottom(x).ticks(5).tickFormat(d3.format('.0%')));
      st.forEach((d, i) => {
        const yy = i * rowH;
        svg.append('text').attr('x', lw - 6).attr('y', yy + 12).attr('text-anchor', 'end').text(d.c.label);
        let acc = 0;
        for (let v = E.scaleMin; v <= E.scaleMax; v++) {
          const share = d.rated ? d.counts[v] / d.rated : 0;
          if (share > 0) {
            const r = svg.append('rect').attr('x', lw + x(acc)).attr('y', yy + 2).attr('width', Math.max(0, x(share) - 1)).attr('height', rowH - 4).attr('fill', RATING_COLORS[e][v]);
            bindTip(r, () => `<b>${d.c.label}</b><br>rating ${v}: ${fmt.n(d.counts[v])} (${fmt.pct(share * 100)} of rated)<br>poor: ${fmt.n(d.poor)} (${fmt.pct(d.pct)})<br>rated ${fmt.n(d.rated)} · N/A ${fmt.n(d.na)}${d.blank ? ` · blank ${d.blank}` : ''}<br>mean ${fmt.f1(d.mean)} · SD ${d3.format('.2f')(d.sd)}`);
          }
          acc += share;
        }
        svg.append('text').attr('x', lw + bw + 8).attr('y', yy + 12).text(`${fmt.pct(d.pct)} poor · n ${fmt.n(d.rated)} · N/A ${fmt.pct((d.na / recs.length) * 100)}`).style('font-weight', i < 5 && U.sort === 'pct' ? 700 : 400);
      });
    }
  },

  // ---- 7. Problem patterns ---------------------------------------------------
  patterns(root) {
    const S = APP.S, U = UI.patterns;
    const eras = APP.erasIn(S.filtered);
    const c = card(root, 'Problem patterns', `Share of rated evaluations with a poor rating, by group. ${poorDef()}.`);
    if (!eras.length) return emptyMsg(c);
    if (!eras.includes(U.era)) U.era = eras.includes('cur') ? 'cur' : 'pre';
    const ctl = controls(c, `<label>Period <select id="h-era">${eras.map((e) => `<option value="${e}">${eraLabel(e)}</option>`).join('')}</select></label>
      <label>Group columns by <select id="h-by"><option value="decade">decade built</option><option value="ward">ward</option><option value="type">property type</option><option value="storeys">storey band</option><option value="units">unit band</option><option value="year">evaluation year</option></select></label>`);
    ctl.querySelector('#h-era').value = U.era; ctl.querySelector('#h-by').value = U.by;
    onCtl(ctl, 'select', (e) => { if (e.id === 'h-era') U.era = e.value; else U.by = e.value; });
    const recs = S.filtered.filter((r) => r.era === U.era);
    const keyFns = {
      decade: [(r) => decadeKey(r), decadeLabel, 'decade built'],
      ward: [(r) => r.ward, (k) => `${k} ${recs.find((r) => r.ward === k)?.wardName ?? ''}`, 'ward'],
      type: [(r) => r.propertyType, (k) => k, 'property type'],
      storeys: [(r) => band(STOREY_BANDS, r.storeys), (k) => `${k} storeys`, 'storey band'],
      units: [(r) => band(UNIT_BANDS, r.units), (k) => `${k} units`, 'unit band'],
      year: [(r) => r.yearEvaluated, (k) => String(k), 'evaluation year'],
    };
    const [kf, lf, lname] = keyFns[U.by];
    const order = U.by === 'storeys' ? STOREY_BANDS.map((b) => b[2]) : U.by === 'units' ? UNIT_BANDS.map((b) => b[2]) : null;
    const groups = d3.group(recs, kf);
    const colKeys = [...groups.keys()].filter((k) => k != null).sort(order ? (a, b) => order.indexOf(a) - order.indexOf(b) : d3.ascending);
    const st = catStats(recs, U.era).sort((a, b) => b.pct - a.pct);
    const cellFn = (catKey, gk) => {
      const col = S.data.catByKey.get(catKey).col;
      const rated = (groups.get(gk) ?? []).filter((r) => r.ratings[col] != null);
      const poor = rated.filter((r) => APP.isPoor(r, col)).length;
      return { n: rated.length, poor, value: rated.length ? (poor / rated.length) * 100 : null };
    };
    let maxV = 0;
    for (const s of st) for (const k of colKeys) { const cc = cellFn(s.c.key, k); if (cc.n >= 10) maxV = Math.max(maxV, cc.value); }
    encoding(c, { mark: 'one cell = one inspection category × one group', x: `${lname} (column)`, y: 'inspection category, sorted by overall % poor (highest at top)', color: '% of rated evaluations in that cell with a poor rating (light = few, dark red = many)', other: 'hatched = fewer than 10 rated evaluations; empty outline = none' });
    c.appendChild(el('p', { class: 'hint' }, `Groups (evaluations): ${colKeys.map((k) => `${lf(k)}: ${fmt.n(groups.get(k).length)}`).join(' · ')}${groups.has(null) || groups.has(undefined) ? ` · missing: ${fmt.n((groups.get(null) ?? groups.get(undefined)).length)} (not shown)` : ''}`));
    const holder = el('div', { style: 'overflow-x:auto' }); c.appendChild(holder);
    heatmap(holder, { rows: st.map((s) => ({ key: s.c.key, label: `${s.c.label} (${fmt.pct(s.pct)})` })), cols: colKeys.map((k) => ({ key: k, label: lf(k) })), cell: cellFn, maxV });
  },

  // ---- 8. Changes over time ---------------------------------------------------
  changes(root) {
    const S = APP.S, U = UI.changes;
    const c = card(root, 'Evaluation changes over time', 'Consecutive evaluations of the same building, matched by <b>RSN</b> (building registration number), sorted by evaluation date.');
    const ctl = controls(c, `<label><input type="checkbox" id="c-cross" ${U.cross ? 'checked' : ''}/> include pairs that cross the 2023 methodology change (not comparable!)</label>
      <label>Show top <select id="c-n"><option>5</option><option>10</option><option>15</option><option>25</option></select></label>`);
    ctl.querySelector('#c-n').value = U.topN;
    onCtl(ctl, 'input,select', (e) => { if (e.id === 'c-cross') U.cross = e.checked; else U.topN = +e.value; });
    if (S.f.latest) c.appendChild(el('div', { class: 'warnbox' }, '“Only latest evaluation per building” is on, so no pairs exist. Turn it off in the sidebar.'));
    const ps = pairs(S.filtered, U.cross);
    // evaluations per building
    const per = d3.rollups(S.filtered, (v) => v.length, (r) => r.era, (r) => r.rsn);
    c.appendChild(el('p', { class: 'hint' }, 'Evaluations per building in the filter: ' + per.map(([e, m]) => `${eraLabel(e)} — ` + d3.rollups(m, (v) => v.length, ([, n]) => n).sort((a, b) => a[0] - b[0]).map(([n, k]) => `${n}×: ${fmt.n(k)} bldgs`).join(', ')).join(' | ')));
    if (!ps.length) return emptyMsg(c, 'No re-evaluation pairs in the current filter.');
    const types = [...new Set(ps.map((p) => p.type))];
    const stats = el('div', { class: 'summary' }); c.appendChild(stats);
    stats.innerHTML = types.map((t) => {
      const v = ps.filter((p) => p.type === t);
      const up = v.filter((p) => p.delta > 0).length, dn = v.filter((p) => p.delta < 0).length;
      return `<div class="stat"><div class="k">${t === 'cross' ? 'Cross-period pairs' : eraLabel(t) + ' pairs'}</div><div class="v">${fmt.n(v.length)}</div><div class="s">${fmt.n(new Set(v.map((p) => p.rsn)).size)} buildings<br>↑ ${fmt.pct((up / v.length) * 100)} · ↓ ${fmt.pct((dn / v.length) * 100)} · = ${fmt.pct(((v.length - up - dn) / v.length) * 100)}<br>mean ${fmt.sgn(d3.mean(v, (p) => p.delta))} · median ${fmt.sgn(LL.median(v.map((p) => p.delta)))}<br>median gap ${fmt.n(Math.round(LL.median(v.map((p) => p.days))))} days</div></div>`;
    }).join('');

    const grid = el('div', { class: 'grid2' }); root.appendChild(grid);
    const h = card(grid, 'Distribution of score changes');
    const sc = card(grid, 'Earlier score vs change');
    encoding(h, { mark: 'one bar = count of re-evaluation pairs in a 2-point change bin', x: 'score change (later − earlier)', y: 'number of pairs', color: 'red = decline, blue = improvement, gray = no change' });
    {
      const d = ps.map((p) => p.delta);
      const ext = Math.max(10, d3.max(d, Math.abs));
      const f = frame(h, { height: 240 });
      const x = d3.scaleLinear().domain([-ext, ext]).range([0, f.w]);
      const bins = d3.bin().domain([-ext, ext + 1]).thresholds(d3.range(-ext, ext + 1, 2))(d);
      const y = d3.scaleLinear().domain([0, d3.max(bins, (b) => b.length)]).nice().range([f.h, 0]);
      axes(f, x, y, { xLabel: 'Score change', yLabel: 'Pairs' });
      const bars = f.g.selectAll(null).data(bins).join('rect').attr('x', (b) => x(b.x0) + 1).attr('width', (b) => Math.max(0, x(b.x1) - x(b.x0) - 2)).attr('y', (b) => y(b.length)).attr('height', (b) => f.h - y(b.length))
        .attr('fill', (b) => (b.x1 <= 0 ? '#e34948' : b.x0 > 0 ? '#2a78d6' : '#b9b8b0'));
      bindTip(bars, (b) => `change ${b.x0} to ${b.x1 - 1}: <b>${fmt.n(b.length)}</b> pairs`);
    }
    encoding(sc, { mark: 'one dot = one re-evaluation pair', x: 'earlier evaluation score', y: 'score change (later − earlier)', color: 'period of the pair (purple = crosses methodology change)', other: 'useful to check whether low scorers tend to rise (regression to the mean)' });
    {
      const col = (p) => (p.type === 'cross' ? '#4a3aa7' : eraColor(p.type));
      const ext = Math.max(10, d3.max(ps, (p) => Math.abs(p.delta)));
      scatter(sc, ps, { x: (p) => p.a.score, y: (p) => p.delta, xDomain: [d3.min(ps, (p) => p.a.score), 100], yDomain: [-ext, ext], color: col, xLabel: 'Earlier score', yLabel: 'Change', r: 2.5, opacity: 0.4, jitterX: 1, jitterY: 1,
        tipFn: (p) => `<b>${p.b.address}</b><br>${p.a.date}: ${p.a.score} → ${p.b.date}: ${p.b.score} (${fmt.sgn(p.delta)})`, onClick: (p) => APP.selectBuilding(p.rsn),
        overlay: (f, xs, ys) => f.g.append('line').attr('x1', 0).attr('x2', f.w).attr('y1', ys(0)).attr('y2', ys(0)).attr('stroke', 'var(--ink)') });
    }

    const sorted = [...ps].sort((a, b) => b.delta - a.delta);
    const best = sorted.slice(0, U.topN), worst = sorted.slice(-U.topN).reverse();
    const sl = card(root, `Slopegraph — ${U.topN} largest improvements and ${U.topN} largest declines`);
    encoding(sl, { mark: 'one line = one building’s consecutive pair of evaluations', x: 'earlier evaluation (left) → later evaluation (right)', y: 'overall score', color: 'blue = improved, red = declined', other: 'labels on the right = address and change' });
    {
      const rows = [...best, ...worst];
      const W = Math.min(sl.clientWidth || 900, 900), H = 460, m = { t: 20, b: 30, l: 60, r: 280 };
      const svg = d3.select(sl).append('svg').attr('width', W).attr('height', H);
      const x = d3.scalePoint().domain(['earlier', 'later']).range([m.l, W - m.r]);
      const y = d3.scaleLinear().domain([d3.min(rows, (p) => Math.min(p.a.score, p.b.score)) - 2, 100]).range([H - m.b, m.t]);
      svg.append('g').attr('class', 'axis').attr('transform', `translate(${m.l - 10},0)`).call(d3.axisLeft(y));
      ['earlier', 'later'].forEach((k) => svg.append('text').attr('x', x(k)).attr('y', H - 8).attr('text-anchor', 'middle').text(k + ' evaluation'));
      const lines = svg.selectAll(null).data(rows).join('line').attr('x1', x('earlier')).attr('x2', x('later')).attr('y1', (p) => y(p.a.score)).attr('y2', (p) => y(p.b.score))
        .attr('stroke', (p) => (p.delta >= 0 ? '#2a78d6' : '#e34948')).attr('stroke-width', 2).attr('opacity', 0.75).style('cursor', 'pointer').on('click', (e, p) => APP.selectBuilding(p.rsn));
      bindTip(lines, (p) => `<b>${p.b.address}</b> (${p.type === 'cross' ? 'cross-period' : eraLabel(p.type)})<br>${p.a.date}: ${p.a.score} → ${p.b.date}: ${p.b.score}<br>change ${fmt.sgn(p.delta)}`);
      // de-overlapped right labels
      const lab = rows.map((p) => ({ p, y: y(p.b.score) })).sort((a, b) => a.y - b.y);
      for (let i = 1; i < lab.length; i++) if (lab[i].y - lab[i - 1].y < 11) lab[i].y = lab[i - 1].y + 11;
      svg.selectAll(null).data(lab).join('text').attr('x', x('later') + 8).attr('y', (d) => d.y + 4).text((d) => `${d.p.b.address.slice(0, 30)} ${fmt.sgn(d.p.delta)}`).style('fill', (d) => (d.p.delta >= 0 ? '#2a78d6' : '#e34948'));
    }
    const tables = el('div', { class: 'grid2' }); root.appendChild(tables);
    const tbl = (title, rows) => {
      const t = card(tables, title);
      t.appendChild(el('table', { class: 'data' }, `<tr><th>Address</th><th>Period</th><th>Earlier</th><th>Later</th><th>Change</th></tr>` +
        rows.map((p) => `<tr class="clickable" data-rsn="${p.rsn}"><td>${p.b.address}</td><td>${p.type === 'cross' ? 'cross' : eraLabel(p.type)}</td><td>${p.a.date} · ${p.a.score}</td><td>${p.b.date} · ${p.b.score}</td><td><b>${fmt.sgn(p.delta)}</b></td></tr>`).join('')));
      linkify(t);
    };
    tbl('Largest improvements', best);
    tbl('Largest declines', worst);
  },

  // ---- 9. High score but specific problems ------------------------------------
  hidden(root) {
    const S = APP.S, U = UI.hidden;
    const c = card(root, 'High overall score, but poor in specific categories', `Can a good overall score hide specific maintenance issues? ${poorDef()}.`);
    const ctl = controls(c, `<label>High score ≥ (pre-2023) <input type="number" id="x-pre" value="${U.pre}" style="width:60px"/></label>
      <label>High score ≥ (2023+) <input type="number" id="x-cur" value="${U.cur}" style="width:60px"/></label>
      <label>with at least <input type="number" id="x-min" value="${U.minPoor}" min="1" style="width:50px"/> poor categories</label>`);
    onCtl(ctl, 'input', (e) => { U[{ 'x-pre': 'pre', 'x-cur': 'cur', 'x-min': 'minPoor' }[e.id]] = +e.value; });
    const eras = APP.erasIn(S.filtered);
    if (!eras.length) return emptyMsg(c);
    for (const e of eras) {
      const cats = S.data.cats[e];
      const recs = S.filtered.filter((r) => r.era === e && r.score != null && !r.flags.includes('no-ratings')).map((r) => ({ r, poorCats: cats.filter((col) => APP.isPoor(r, col)) }));
      const hi = recs.filter((d) => d.r.score >= U[e]);
      const flagged = hi.filter((d) => d.poorCats.length >= U.minPoor);
      const ec = card(root, `${eraLabel(e)}: ${fmt.n(flagged.length)} of ${fmt.n(hi.length)} high-scoring evaluations (${fmt.pct(hi.length ? (flagged.length / hi.length) * 100 : 0)}) have ≥ ${U.minPoor} poor categor${U.minPoor === 1 ? 'y' : 'ies'}`);
      const grid = el('div', { class: 'grid2' }); ec.appendChild(grid);
      const left = el('div'); grid.appendChild(left);
      const right = el('div'); grid.appendChild(right);
      encoding(left, { mark: 'one dot = one evaluation', x: 'overall score', y: 'number of poor-rated categories in that evaluation (jittered)', color: `period; shaded area = score ≥ ${U[e]} and ≥ ${U.minPoor} poor categories` });
      scatter(left, recs, { x: (d) => d.r.score, y: (d) => d.poorCats.length, xDomain: [d3.min(recs, (d) => d.r.score), 100], yDomain: [0, Math.max(5, d3.max(recs, (d) => d.poorCats.length) + 1)], color: eraColor(e), xLabel: 'Overall score', yLabel: 'Poor categories', r: 2.2, opacity: 0.35, jitterX: 0.8, jitterY: 0.6,
        tipFn: (d) => recTip(d.r) + `<br><b>${d.poorCats.length} poor:</b> ${d.poorCats.map(LL.prettyCat).join(', ')}`, onClick: (d) => APP.selectBuilding(d.r.rsn),
        overlay: (f, xs, ys) => f.g.insert('rect', ':first-child').attr('x', xs(U[e])).attr('width', f.w - xs(U[e])).attr('y', 0).attr('height', ys(U.minPoor - 0.5)).attr('fill', 'var(--warnbg)') });
      const counts = d3.rollups(flagged.flatMap((d) => d.poorCats), (v) => v.length, (x) => x).sort((a, b) => b[1] - a[1]).slice(0, 15);
      encoding(right, { mark: 'one bar = one category', x: `share of high-scoring evaluations (score ≥ ${U[e]}) with this category rated poor`, y: 'category (top 15)', color: 'single colour (period)' });
      if (counts.length) {
        const f = frame(right, { height: counts.length * 18 + 50, margin: { left: 200 } });
        const x = d3.scaleLinear().domain([0, d3.max(counts, (d) => d[1]) / hi.length]).nice().range([0, f.w]);
        const y = d3.scaleBand().domain(counts.map((d) => d[0])).range([0, f.h]).padding(0.2);
        axes(f, x, y, { xFormat: d3.format('.1~%'), yFormat: LL.prettyCat, yGrid: false });
        const bars = f.g.selectAll(null).data(counts).join('rect').attr('x', 0).attr('y', (d) => y(d[0])).attr('height', y.bandwidth()).attr('width', (d) => x(d[1] / hi.length)).attr('fill', eraColor(e)).attr('rx', 2);
        bindTip(bars, (d) => `<b>${LL.prettyCat(d[0])}</b><br>${fmt.n(d[1])} of ${fmt.n(hi.length)} high-scoring evaluations (${fmt.pct((d[1] / hi.length) * 100)})`);
      }
      const list = [...flagged].sort((a, b) => b.poorCats.length - a.poorCats.length || b.r.score - a.r.score).slice(0, 50);
      const tw = el('div', { class: 'tablewrap', style: 'max-height:300px;margin-top:8px' });
      tw.innerHTML = `<table class="data"><tr><th>Address</th><th>Date</th><th>Score</th><th># poor</th><th>Poor categories</th></tr>${list.map((d) => `<tr class="clickable" data-rsn="${d.r.rsn}"><td>${d.r.address}</td><td>${d.r.date}</td><td>${d.r.score}</td><td>${d.poorCats.length}</td><td style="white-space:normal">${d.poorCats.map(LL.prettyCat).join(', ')}</td></tr>`).join('')}</table>`;
      ec.appendChild(el('h4', {}, 'Top 50 (most poor categories first)'));
      ec.appendChild(tw);
      linkify(tw);
    }
  },

  // ---- 10. Raw data table ---------------------------------------------------
  table(root) {
    const S = APP.S, U = UI.table;
    const base = [
      ['era', 'Period', (r) => eraLabel(r.era)], ['rsn', 'RSN', (r) => r.rsn], ['address', 'Address', (r) => r.addressRaw], ['ward', 'Ward', (r) => r.ward], ['wardName', 'Ward name', (r) => r.wardName],
      ['propertyType', 'Type', (r) => r.propertyType], ['yearBuilt', 'Year built', (r) => r.yearBuilt], ['age', 'Age at eval', (r) => r.age], ['storeys', 'Storeys', (r) => r.storeys], ['units', 'Units', (r) => r.units],
      ['date', 'Evaluated', (r) => r.date], ['yearEvaluatedRaw', 'YEAR EVALUATED (raw)', (r) => r.yearEvaluatedRaw], ['yearRegistered', 'Year registered', (r) => r.yearRegistered],
      ['score', 'Score', (r) => r.score], ['scorePctInEra', 'Score pct in period', (r) => (r.scorePctInEra != null ? +r.scorePctInEra.toFixed(1) : null)],
      ['proactive', 'Proactive score', (r) => r.proactive], ['reactive', 'Reactive score', (r) => r.reactive], ['resultsOfScore', 'Results of score', (r) => r.resultsOfScore],
      ['nAreas', 'Areas evaluated', (r) => r.nAreas], ['nPoor', '# poor categories', (r) => S.data.cats[r.era].filter((c) => APP.isPoor(r, c)).length],
      ['evalIndex', 'Eval # for bldg', (r) => r.evalIndex], ['evalCount', 'Evals for bldg', (r) => r.evalCount],
      ['lat', 'Lat', (r) => r.lat?.toFixed(6) ?? null], ['lon', 'Lon', (r) => r.lon?.toFixed(6) ?? null], ['coordSource', 'Coord source', (r) => r.coordSource], ['grid', 'Grid', (r) => r.grid], ['flags', 'Flags', (r) => r.flags.join(' ')],
    ];
    const catCols = S.data.catList.map((c) => [c.key, `${c.era === 'pre' ? 'P' : 'C'}: ${c.label}`, (r) => (r.era !== c.era ? '' : r.ratings[c.col] ?? (r.naCats.includes(c.col) ? 'N/A' : null))]);
    const all = [...base, ...catCols];
    U.cols ??= new Set(['era', 'rsn', 'address', 'ward', 'propertyType', 'yearBuilt', 'storeys', 'units', 'date', 'score', 'nPoor', 'flags']);
    const c = card(root, `Raw data — ${fmt.n(S.filtered.length)} filtered evaluations`, 'Click a header to sort; click a row to open the building. Category columns: P = pre-2023 (1–5), C = 2023+ (0–3); blank = category not in that period.');
    const ctl = controls(c, `<input type="search" id="t-q" placeholder="search any visible column…" value="${U.q}" style="min-width:260px"/> <button id="t-csv">Download filtered CSV</button>`);
    const det = el('details', {}, `<summary>Choose columns (${U.cols.size} shown)</summary>`);
    const ch = el('div', { class: 'cols-chooser' }, all.map(([k, l]) => `<label><input type="checkbox" value="${k}" ${U.cols.has(k) ? 'checked' : ''}/> ${l}</label>`).join(''));
    det.appendChild(ch); c.appendChild(det);
    ch.querySelectorAll('input').forEach((i) => i.addEventListener('change', () => { i.checked ? U.cols.add(i.value) : U.cols.delete(i.value); APP_render(); }));
    const cols = all.filter(([k]) => U.cols.has(k));
    const holder = el('div'); c.appendChild(holder);
    const draw = () => {
      const q = U.q.toUpperCase();
      let rows = S.filtered.map((r) => ({ r, v: cols.map(([, , f]) => f(r)) }));
      if (q) rows = rows.filter((x) => x.v.some((v) => v != null && String(v).toUpperCase().includes(q)));
      const si = cols.findIndex(([k]) => k === U.sort);
      if (si >= 0) rows.sort((a, b) => { const x = a.v[si], y = b.v[si]; if (x == null || x === '') return 1; if (y == null || y === '') return -1; return (U.asc ? 1 : -1) * (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))); });
      const pages = Math.max(1, Math.ceil(rows.length / 100)); U.page = Math.min(U.page, pages - 1);
      const page = rows.slice(U.page * 100, U.page * 100 + 100);
      holder.innerHTML = `<div class="controls"><button id="t-prev">‹ prev</button> page ${U.page + 1} / ${pages} (${fmt.n(rows.length)} rows) <button id="t-next">next ›</button></div>
        <div class="tablewrap"><table class="data"><tr>${cols.map(([k, l]) => `<th data-k="${k}">${l}${U.sort === k ? (U.asc ? ' ▲' : ' ▼') : ''}</th>`).join('')}</tr>
        ${page.map((x) => `<tr class="clickable" data-rsn="${x.r.rsn}">${x.v.map((v) => `<td>${v == null ? '<span class="muted">—</span>' : v}</td>`).join('')}</tr>`).join('')}</table></div>`;
      holder.querySelectorAll('th').forEach((th) => th.addEventListener('click', () => { if (U.sort === th.dataset.k) U.asc = !U.asc; else { U.sort = th.dataset.k; U.asc = true; } draw(); }));
      holder.querySelector('#t-prev').onclick = () => { U.page = Math.max(0, U.page - 1); draw(); };
      holder.querySelector('#t-next').onclick = () => { U.page = Math.min(pages - 1, U.page + 1); draw(); };
      linkify(holder);
      return rows;
    };
    let current = draw();
    ctl.querySelector('#t-q').addEventListener('input', (e) => { U.q = e.target.value; U.page = 0; current = draw(); });
    ctl.querySelector('#t-csv').addEventListener('click', () => {
      const csv = d3.csvFormatRows([cols.map(([, l]) => l), ...current.map((x) => x.v.map((v) => (v == null ? '' : v)))]);
      const a = el('a', { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: 'lease-lens-filtered.csv' });
      a.click();
    });
  },

  // ---- Data notes --------------------------------------------------------------
  notes(root) {
    const S = APP.S, D = S.data;
    const recs = D.records;
    const c = card(root, 'Data notes — what is in the files and what this tool does to them');
    const pre = D.profile.pre.columns, cur = D.profile.cur.columns;
    const norm = (s) => s.replace(/_/g, ' ').replace(/WARDNAME/, 'WARDNAME');
    const curSet = new Set(cur);
    const sameMeaning = pre.filter((p) => curSet.has(norm(p)) || curSet.has(p));
    const flagCounts = d3.rollups(recs.flatMap((r) => r.flags.map((f) => [r.era, f])), (v) => v.length, ([e]) => e, ([, f]) => f);
    const byEra = (e) => recs.filter((r) => r.era === e);
    const rsnPre = new Set(byEra('pre').map((r) => r.rsn)), rsnCur = new Set(byEra('cur').map((r) => r.rsn));
    const both = [...rsnPre].filter((r) => rsnCur.has(r)).length;
    c.innerHTML += `
<h4>Files</h4>
<table class="data"><tr><th></th><th>Pre-2023</th><th>2023–current</th></tr>
<tr><td>Rows (evaluations)</td><td>${fmt.n(D.profile.pre.rows)}</td><td>${fmt.n(D.profile.cur.rows)}</td></tr>
<tr><td>Columns</td><td>${pre.length}</td><td>${cur.length}</td></tr>
<tr><td>Unique buildings (RSN)</td><td>${fmt.n(rsnPre.size)}</td><td>${fmt.n(rsnCur.size)}</td></tr>
<tr><td>Evaluation dates</td><td>${d3.min(byEra('pre'), (r) => r.date)} – ${d3.max(byEra('pre'), (r) => r.date)}</td><td>${d3.min(byEra('cur'), (r) => r.date)} – ${d3.max(byEra('cur'), (r) => r.date)}</td></tr>
<tr><td>Score column</td><td>SCORE</td><td>CURRENT BUILDING EVAL SCORE (= PROACTIVE BUILDING SCORE + CURRENT REACTIVE SCORE)</td></tr>
<tr><td>Score mean / median</td><td>${fmt.f1(d3.mean(byEra('pre'), (r) => r.score))} / ${LL.median(byEra('pre').map((r) => r.score))}</td><td>${fmt.f1(d3.mean(byEra('cur'), (r) => r.score))} / ${LL.median(byEra('cur').map((r) => r.score))}</td></tr>
<tr><td>Inspection categories</td><td>${D.cats.pre.length}, rated 1–5</td><td>${D.cats.cur.length}, rated 0–3</td></tr>
<tr><td>Extra fields</td><td>RESULTS_OF_SCORE</td><td>PROACTIVE BUILDING SCORE, CURRENT REACTIVE SCORE</td></tr></table>
<p>${fmt.n(both)} buildings appear in both files (same RSN); ${fmt.n(rsnPre.size - both)} only pre-2023; ${fmt.n(rsnCur.size - both)} only 2023+. No RSN + date appears in both files.</p>

<h4>Shared descriptive fields (same meaning, different spelling: underscores vs spaces)</h4>
<p>${sameMeaning.map((p) => `<code>${p}</code>`).join(', ')}</p>
<p><b>Only in pre-2023:</b> ${pre.filter((p) => !curSet.has(norm(p)) && !curSet.has(p)).map((p) => `<code>${p}</code>`).join(', ')}</p>
<p><b>Only in 2023–current:</b> ${cur.filter((p) => !pre.some((q) => norm(q) === p || q === p)).map((p) => `<code>${p}</code>`).join(', ')}</p>
<p class="hint">Note: a few category names look shared (GRAFFITI, EXTERIOR GROUNDS, EXTERIOR WALKWAYS, BALCONY GUARDS) but are rated on different scales under different rules; this tool keeps every category period-specific.</p>

<h4>Can the files be combined?</h4>
<p><b>Yes for building attributes</b> (RSN, address, ward, type, year built, storeys, units, coordinates are consistent per RSN), and both are stacked here as one list of evaluations with a <code>period</code> tag.
<b>No for scores and ratings without care</b>: the scoring method changed in 2023 (pre-2023 median ~74, 2023+ median ~91). A building's change from 2022 to 2024 is mostly the methodology. The tool keeps them in separate panels and warns when both are mixed.</p>

<h4>Identifier</h4>
<p><b>RSN</b> (registration number) is the building identifier. Within the pre-2023 file every RSN has one address; across files 4 RSNs show address text changes (e.g. “70 WILSON PARK RD--CLOSED”, renumbered corner buildings), which is why matching uses RSN and never address text. Buildings are evaluated repeatedly: pre-2023 mostly 3–4 times, 2023+ mostly twice.</p>

<h4>Calculated / transformed fields</h4>
<ul>
<li><b>yearEvaluated</b> = year of EVALUATION COMPLETED ON. The raw YEAR_EVALUATED in pre-2023 is blank for 2,009 rows and differs from the date year for ~1,900 rows (looks like a program-cycle year); one 2023+ row has “202510”. Raw value kept as a separate column.</li>
<li><b>age</b> = yearEvaluated − YEAR BUILT; <b>decade</b> = floor(YEAR BUILT / 10)×10 (pre-1900 grouped in views).</li>
<li><b>ward</b> zero-padded to 2 digits.</li>
<li><b>Ratings</b>: values trimmed (2023+ file has values like “ 3”), “N/A” = not applicable (kept distinct from blank). Every rating column is kept.</li>
<li><b>Poor rating</b> (adjustable in sidebar): pre-2023 ≤ 2 of 5; 2023+ ≤ 1 of 3 (0 also occurs, ${fmt.n(recs.filter((r) => r.era === 'cur' && Object.values(r.ratings).includes(0)).length)} evaluations).</li>
<li><b>Coordinates</b>: ${fmt.n(recs.filter((r) => r.coordSource === 'derived-from-XY').length)} records have X/Y but no LATITUDE/LONGITUDE; their lat/lon is estimated with a least-squares affine fit of lat/lon on X/Y (fit on ${fmt.n(D.coordFitN)} records; typical error well under 100 m). ${fmt.n(recs.filter((r) => r.coordSource === 'missing').length)} records have no coordinates at all.</li>
<li><b>scorePctInEra</b> = percentile rank of a score among all evaluations in the same period (unfiltered).</li>
<li><b>address</b> (display) strips “** CREATED IN ERROR **” and “--CLOSED”; the raw address is kept and searchable.</li>
<li><b>Re-evaluation pairs</b> = consecutive evaluations of the same RSN sorted by date; cross-period pairs excluded unless asked.</li>
</ul>
<p class="hint">2023+ CURRENT BUILDING EVAL SCORE equals PROACTIVE + REACTIVE in all but one row. The proactive score is a weighted average of ratings (it cannot be exactly reproduced from the columns); pre-2023 SCORE ≈ sum of ratings / (5 × areas evaluated) × 100.</p>

<h4>Flags (records are kept; flags are shown everywhere)</h4>
<table class="data"><tr><th>Period</th><th>Flag</th><th>Records</th></tr>${flagCounts.flatMap(([e, fs]) => fs.map(([f, n]) => `<tr><td>${eraLabel(e)}</td><td>${f}</td><td>${fmt.n(n)}</td></tr>`)).join('')}</table>
<p class="hint">“Exclude flagged anomalies” in the sidebar removes only created-in-error, no-ratings (one pre-2023 row with score 0 and all ratings blank) and duplicate RSN+date rows.</p>

<h4>Missing values per column</h4>
${['pre', 'cur'].map((e) => {
      const rows = D.profile[e].columns.map((col) => { const v = byEra(e).map((r) => (r.raw[col] ?? '').trim()); return [col, v.filter((x) => x === '').length, v.filter((x) => x.toUpperCase() === 'N/A').length]; }).filter(([, b, n]) => b || n);
      return `<details><summary>${eraLabel(e)}: ${rows.length} columns with blanks or N/A</summary><table class="data"><tr><th>Column</th><th>blank</th><th>N/A</th></tr>${rows.map(([col, b, n]) => `<tr><td>${col}</td><td>${fmt.n(b)}</td><td>${fmt.n(n)}</td></tr>`).join('')}</table></details>`;
    }).join('')}`;
  },
};
window.VIEWS = VIEWS;
