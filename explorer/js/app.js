// App shell: filter state, summary statistics, sketch ideas, tab routing.

const FLAG_EXCLUDABLE = ['created-in-error', 'no-ratings', 'duplicate-rsn-date'];

const S = {
  data: null,
  filtered: [],
  tab: 'explorer',
  selectedRsn: null,
  f: {},
};

const poorThreshold = (era) => (era === 'pre' ? S.f.poorPre : S.f.poorCur);
const isPoor = (rec, col) => { const v = rec.ratings[col]; return v != null && v <= poorThreshold(rec.era); };
const latestPerBuilding = (recs) => {
  const m = new Map();
  for (const r of recs) { const p = m.get(r.rsn); if (!p || r.time > p.time) m.set(r.rsn, r); }
  return [...m.values()];
};
const erasIn = (recs) => ['pre', 'cur'].filter((e) => recs.some((r) => r.era === e));

// ---- filters ---------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const numInputs = {
  year: ['f-year-min', 'f-year-max', 'yearEvaluated'],
  score: ['f-score-min', 'f-score-max', 'score'],
  built: ['f-built-min', 'f-built-max', 'yearBuilt'],
  units: ['f-units-min', 'f-units-max', 'units'],
  storeys: ['f-storeys-min', 'f-storeys-max', 'storeys'],
};

function initFilters() {
  const recs = S.data.records;
  for (const [, [minId, maxId, field]] of Object.entries(numInputs)) {
    const [lo, hi] = d3.extent(recs, (r) => r[field]);
    $(minId).value = lo; $(maxId).value = hi;
    $(minId).dataset.default = lo; $(maxId).dataset.default = hi;
  }
  const wards = [...d3.rollup(recs, (v) => v[0].wardName, (r) => r.ward)].sort();
  $('f-ward').innerHTML = wards.map(([w, n]) => `<label><input type="checkbox" value="${w}" /> ${w} ${n}</label>`).join('');
  const types = [...new Set(recs.map((r) => r.propertyType ?? '(missing)'))].sort();
  $('f-type').innerHTML = types.map((t) => `<label><input type="checkbox" value="${t}" /> ${t}</label>`).join('');
  fillCategorySelect();
  $('f-cat').addEventListener('change', () => { fillRatingSelect(); update(); });

  const deb = debounce(update, 200);
  document.querySelectorAll('#sidebar input, #sidebar select').forEach((e) => {
    if (e.id === 'f-cat') return;
    e.addEventListener(e.type === 'search' || e.type === 'number' ? 'input' : 'change', e.name === 'era' ? () => { fillCategorySelect(); update(); } : deb);
  });
  $('reset').addEventListener('click', () => {
    for (const [, [a, b]] of Object.entries(numInputs)) { $(a).value = $(a).dataset.default; $(b).value = $(b).dataset.default; }
    document.querySelectorAll('#f-ward input, #f-type input').forEach((c) => (c.checked = false));
    document.querySelector('input[name=era][value=both]').checked = true;
    $('f-search').value = ''; $('f-built-missing').checked = true; $('f-latest').checked = false; $('f-noflag').checked = false;
    $('poor-pre').value = 2; $('poor-cur').value = 1;
    fillCategorySelect(); update();
  });
}

function fillCategorySelect() {
  const era = document.querySelector('input[name=era]:checked').value;
  const prev = $('f-cat').value;
  let html = '<option value="">(any — no category filter)</option>';
  for (const e of ['pre', 'cur']) {
    if (era !== 'both' && era !== e) continue;
    html += `<optgroup label="${LL.ERA[e].label} categories">` +
      S.data.catList.filter((c) => c.era === e).map((c) => `<option value="${c.key}">${c.label}</option>`).join('') + '</optgroup>';
  }
  $('f-cat').innerHTML = html;
  if ([...$('f-cat').options].some((o) => o.value === prev)) $('f-cat').value = prev;
  fillRatingSelect();
}
function fillRatingSelect() {
  const key = $('f-cat').value;
  const prev = $('f-catrating').value;
  let html = '';
  if (!key) html = '<option value="any">(choose a category first)</option>';
  else {
    const c = S.data.catByKey.get(key), E = LL.ERA[c.era];
    html = '<option value="any">any (incl. N/A)</option><option value="rated">rated (not N/A)</option><option value="poor">poor (per definition below)</option><option value="notpoor">not poor</option><option value="na">N/A — not applicable</option>';
    for (let v = E.scaleMin; v <= E.scaleMax; v++) html += `<option value="v:${v}">= ${v}</option>`;
  }
  $('f-catrating').innerHTML = html;
  if ([...$('f-catrating').options].some((o) => o.value === prev)) $('f-catrating').value = prev;
  $('f-catrating').disabled = !key;
}

function readFilters() {
  const f = {};
  f.era = document.querySelector('input[name=era]:checked').value;
  for (const [k, [a, b]] of Object.entries(numInputs)) {
    f[k] = [$(a).value === '' ? -Infinity : +$(a).value, $(b).value === '' ? Infinity : +$(b).value];
    f[k + 'Full'] = +$(a).value <= +$(a).dataset.default && +$(b).value >= +$(b).dataset.default;
  }
  f.wards = new Set([...document.querySelectorAll('#f-ward input:checked')].map((c) => c.value));
  f.types = new Set([...document.querySelectorAll('#f-type input:checked')].map((c) => c.value));
  f.builtMissing = $('f-built-missing').checked;
  f.search = $('f-search').value.trim().toUpperCase();
  f.cat = $('f-cat').value ? S.data.catByKey.get($('f-cat').value) : null;
  f.catRating = $('f-catrating').value;
  f.poorPre = +$('poor-pre').value;
  f.poorCur = +$('poor-cur').value;
  f.latest = $('f-latest').checked;
  f.noflag = $('f-noflag').checked;
  S.f = f;
}

const inRange = (v, [lo, hi]) => v != null && v >= lo && v <= hi;
function passes(r) {
  const f = S.f;
  if (f.era !== 'both' && r.era !== f.era) return false;
  if (!f.yearFull && !inRange(r.yearEvaluated, f.year)) return false;
  if (f.wards.size && !f.wards.has(r.ward)) return false;
  if (f.types.size && !f.types.has(r.propertyType ?? '(missing)')) return false;
  if (!f.scoreFull && !inRange(r.score, f.score)) return false;
  if (r.yearBuilt == null) { if (!f.builtMissing) return false; }
  else if (!f.builtFull && !inRange(r.yearBuilt, f.built)) return false;
  if (!f.unitsFull && !inRange(r.units, f.units)) return false;
  if (!f.storeysFull && !inRange(r.storeys, f.storeys)) return false;
  if (f.search && !(r.addressRaw.toUpperCase().includes(f.search) || r.rsn.includes(f.search))) return false;
  if (f.cat) {
    if (r.era !== f.cat.era) return false;
    const v = r.ratings[f.cat.col], c = f.cat.col;
    switch (f.catRating) {
      case 'rated': if (v == null) return false; break;
      case 'poor': if (!isPoor(r, c)) return false; break;
      case 'notpoor': if (v == null || isPoor(r, c)) return false; break;
      case 'na': if (!r.naCats.includes(c)) return false; break;
      default: if (f.catRating.startsWith('v:') && v !== +f.catRating.slice(2)) return false;
    }
  }
  if (f.noflag && r.flags.some((x) => FLAG_EXCLUDABLE.includes(x))) return false;
  return true;
}

function update() {
  readFilters();
  let recs = S.data.records.filter(passes);
  if (S.f.latest) recs = latestPerBuilding(recs);
  S.filtered = recs;
  $('era-warning').hidden = erasIn(recs).length < 2;
  renderSummary();
  renderIdeas();
  renderView();
}

// ---- summary ---------------------------------------------------------------
function renderSummary() {
  const recs = S.filtered;
  const blds = latestPerBuilding(recs);
  const scores = recs.map((r) => r.score).filter((v) => v != null);
  const eras = erasIn(recs);
  const stat = (k, v, s = '') => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${s}</div></div>`;
  const perEra = (fn) => eras.length > 1 ? eras.map((e) => `${LL.ERA[e].label}: ${fn(recs.filter((r) => r.era === e))}`).join('<br>') : '';
  const meanS = (rs) => fmt.f1(d3.mean(rs, (r) => r.score));
  const medS = (rs) => fmt.f1(LL.median(rs.map((r) => r.score).filter((v) => v != null)));
  const ages = recs.map((r) => r.age).filter((v) => v != null);
  const flagged = recs.filter((r) => r.flags.some((x) => FLAG_EXCLUDABLE.includes(x))).length;
  $('summary').innerHTML = [
    stat('Buildings (unique RSN)', fmt.n(blds.length)),
    stat('Evaluations', fmt.n(recs.length), `${fmt.f1(recs.length / (blds.length || 1))} per building`),
    stat('Mean score', scores.length ? fmt.f1(d3.mean(scores)) : '–', perEra(meanS)),
    stat('Median score', scores.length ? fmt.f1(LL.median(scores)) : '–', perEra(medS)),
    stat('Lowest / highest', scores.length ? `${d3.min(scores)} / ${d3.max(scores)}` : '–'),
    stat('Avg building age', ages.length ? fmt.f1(d3.mean(ages)) + ' yr' : '–', `at evaluation · ${fmt.n(recs.length - ages.length)} missing year built`),
    stat('Avg units', fmt.f1(d3.mean(blds, (r) => r.units)), 'per building (latest eval)'),
    stat('Avg storeys', fmt.f1(d3.mean(blds, (r) => r.storeys)), 'per building (latest eval)'),
    stat('Flagged records', fmt.n(flagged), S.f.noflag ? 'excluded' : 'included — see Data notes'),
  ].join('');
  $('status').textContent = `${fmt.n(recs.length)} of ${fmt.n(S.data.records.length)} evaluations match`;
}

// ---- sketch ideas ----------------------------------------------------------
function renderIdeas() {
  const recs = S.filtered;
  const out = [];
  const addr = (r) => `<a href="#" data-rsn="${r.rsn}">${r.address}</a>`;
  for (const e of erasIn(recs)) {
    const rs = recs.filter((r) => r.era === e && r.score != null && !r.flags.includes('no-ratings'));
    if (!rs.length) continue;
    const L = LL.ERA[e].label, scores = rs.map((r) => r.score);
    const mean = d3.mean(scores), sd = d3.deviation(scores) || 0;
    const items = [];
    const in85 = scores.filter((s) => s >= 85).length / scores.length * 100;
    items.push(`${fmt.pct(in85)} of evaluations score 85–100; median ${LL.median(scores)}, SD ${fmt.f1(sd)}.`);
    const low = [...rs].sort((a, b) => a.score - b.score).slice(0, 3);
    items.push(`Lowest: ${low.map((r) => `${addr(r)} (${r.score}, ${r.date})`).join('; ')}. ${rs.filter((r) => r.score < mean - 2 * sd).length} evaluations are &gt; 2 SD below the mean.`);
    // wards
    const latest = latestPerBuilding(rs);
    const wards = d3.rollups(latest, (v) => ({ n: v.length, m: d3.mean(v, (r) => r.score), name: v[0].wardName }), (r) => r.ward)
      .filter(([, v]) => v.n >= 15).sort((a, b) => a[1].m - b[1].m);
    if (wards.length >= 4) {
      const all = d3.mean(latest, (r) => r.score);
      const f = ([w, v]) => `${v.name} (${w}): ${fmt.f1(v.m)}, ${fmt.sgn(v.m - all)}`;
      items.push(`Ward averages (latest eval/building, n≥15) range from ${f(wards[0])} to ${f(wards[wards.length - 1])} vs ${fmt.f1(all)} overall.`);
    }
    // decades
    const decs = d3.rollups(rs.filter((r) => r.decade != null), (v) => ({ n: v.length, med: LL.median(v.map((r) => r.score)) }), (r) => r.decade)
      .filter(([, v]) => v.n >= 30).sort((a, b) => a[1].med - b[1].med);
    if (decs.length >= 3) items.push(`Median score by decade built (n≥30) is lowest for the ${decs[0][0]}s (${decs[0][1].med}) and highest for the ${decs.at(-1)[0]}s (${decs.at(-1)[1].med}).`);
    // categories
    const cats = S.data.catList.filter((c) => c.era === e).map((c) => {
      const rated = rs.filter((r) => r.ratings[c.col] != null);
      return { c, n: rated.length, p: rated.length ? rated.filter((r) => isPoor(r, c.col)).length / rated.length * 100 : 0 };
    }).filter((d) => d.n >= 30).sort((a, b) => b.p - a.p);
    if (cats.length) items.push(`Most frequently poor categories: ${cats.slice(0, 4).map((d) => `${d.c.label} ${fmt.pct(d.p)}`).join(', ')}.`);
    // changes (within era)
    const pairs = VIEWS.helpers.pairs(rs, false);
    if (pairs.length >= 5) {
      const up = pairs.filter((p) => p.delta > 0).length / pairs.length * 100;
      const big = [...pairs].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0];
      items.push(`${fmt.n(pairs.length)} consecutive re-evaluation pairs: ${fmt.pct(up)} went up, mean change ${fmt.sgn(d3.mean(pairs, (p) => p.delta))}. Largest swing: ${addr(big.b)} ${big.a.score} → ${big.b.score}.`);
    }
    // high score but poor
    const hiT = e === 'pre' ? 85 : 90;
    const hi = rs.filter((r) => r.score >= hiT);
    const hiPoor = hi.filter((r) => S.data.cats[e].some((c) => isPoor(r, c)));
    if (hi.length) items.push(`${fmt.pct(hiPoor.length / hi.length * 100)} of evaluations scoring ≥${hiT} still have at least one poor category (${fmt.n(hiPoor.length)} of ${fmt.n(hi.length)}).`);
    out.push(`<b>${L}</b> <span class="muted">(${fmt.n(rs.length)} evaluations)</span><ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul>`);
  }
  $('ideas-body').innerHTML = out.join('') || '<i>No records match the current filter.</i>';
  $('ideas-body').querySelectorAll('a[data-rsn]').forEach((a) => a.addEventListener('click', (ev) => { ev.preventDefault(); selectBuilding(a.dataset.rsn); }));
}

// ---- tabs ------------------------------------------------------------------
const TABS = [
  ['explorer', '1 Building explorer'], ['map', '2 Map'], ['dist', '3 Score distribution'], ['age', '4 Age vs score'],
  ['size', '5 Size vs score'], ['problems', '6 Common problems'], ['patterns', '7 Problem patterns'],
  ['changes', '8 Changes over time'], ['hidden', '9 High score, specific problems'], ['table', '10 Raw data'], ['notes', 'Data notes'],
];
function renderTabs() {
  $('tabs').innerHTML = TABS.map(([k, l]) => `<button class="tab ${S.tab === k ? 'active' : ''}" data-tab="${k}">${l}</button>`).join('');
  $('tabs').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { S.tab = b.dataset.tab; renderTabs(); renderView(); }));
}
function renderView() {
  const v = $('view');
  LLC.tip.hide();
  v.innerHTML = '';
  try { VIEWS[S.tab](v); }
  catch (err) { console.error(err); v.innerHTML = `<div class="warnbox">Error rendering view: ${err.message}</div>`; }
}
function selectBuilding(rsn) {
  S.selectedRsn = rsn;
  S.tab = 'explorer';
  renderTabs(); renderView();
  window.scrollTo({ top: $('tabs').offsetTop - 50, behavior: 'smooth' });
}

function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

(async function main() {
  try {
    S.data = await LL.loadAll((m) => ($('status').textContent = m));
  } catch (err) {
    $('view').innerHTML = `<div class="warnbox"><b>Could not load the CSV files.</b> Browsers block <code>fetch</code> from <code>file://</code> pages.
      Run a local server from the repo root: <code>python3 -m http.server 8000</code> then open
      <code>http://localhost:8000/explorer/</code>.<br>(${err.message})</div>`;
    $('status').textContent = 'Load failed';
    return;
  }
  initFilters();
  renderTabs();
  update();
})();

window.APP = { S, isPoor, poorThreshold, latestPerBuilding, erasIn, selectBuilding, FLAG_EXCLUDABLE };
