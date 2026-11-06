// Lease Lens dashboard: state, routing (one view at a time), page-wide filters and linked selection.
// Each view module reads a shared context and draws its own chart.

import { buildModel, wardLowShares, pearson, itemProblemRates, changeSummary, biggestMovers } from './model.js';
import { fmt, tip, esc, titleCase, formatDate, pct, signed } from './ui.js';
import { renderMap, focusOnMap, invalidateMap } from './sections/map.js';
import { renderAge } from './sections/age.js';
import { renderProblems } from './sections/problems.js';
import { renderChanges } from './sections/changes.js';
import { renderMovers } from './sections/movers.js';
import { renderBuilding } from './sections/building.js';
import { renderFingerprint } from './sections/fingerprint.js';

const $ = (id) => document.getElementById(id);
const QUESTIONS = [
  { route: 'q1', short: 'Where' },
  { route: 'q2', short: 'Building age' },
  { route: 'q3', short: 'Common problems' },
  { route: 'q4', short: 'Re-inspections' },
  { route: 'q5', short: 'Biggest changes' },
];

const state = {
  route: 'home',
  period: 'cur',
  ward: '',
  selected: null,       // building RSN
  mapShow: 'all',
  problems: { group: 'all', showAll: false },
  changes: { start: 'all' },
  movers: { n: 10 },
  fp: { score: 92, pairIndex: 0, a: null, b: null, shownA: null, shownB: null },
};
let M; // model

// Context passed to every view: the period model, plus ward-filtered views of it.
function context() {
  const pm = M.byPeriod[state.period];
  const inWard = (r) => !state.ward || r.ward === state.ward;
  return {
    pm,
    ward: state.ward,
    selected: state.selected,
    show: state.mapShow,
    latest: pm.latest.filter(inWard),
    pairs: pm.pairs.filter((p) => inWard(p.b)),
    select,
    setWard,
    setFp,
    setPeriod,
    findBuilding,
    registerShown: (slot, rsn) => { state.fp[slot === 'a' ? 'shownA' : 'shownB'] = rsn; },
  };
}

const RENDER = {
  home: renderHome,
  building: (ctx) => renderBuilding(ctx, M),
  fingerprint: (ctx) => renderFingerprint(ctx, M, state.fp),
  q1: renderMap,
  q2: renderAge,
  q3: (ctx) => renderProblems(ctx, state.problems),
  q4: (ctx) => renderChanges(ctx, state.changes),
  q5: (ctx) => renderMovers(ctx, state.movers),
  about: () => {},
};

// ---- routing --------------------------------------------------------------
function parseHash() {
  const [route = '', arg] = location.hash.replace(/^#\/?/, '').split('/');
  return { route: RENDER[route] ? route : 'home', arg };
}
function navigate(hash) {
  if (location.hash === hash) onRoute(); else location.hash = hash;
}
function onRoute() {
  const { route, arg } = parseHash();
  if (route === 'building' && arg && M.byPeriod[state.period].latestByRsn.has(arg)) state.selected = arg;
  if (route === 'fingerprint' && arg && M.byPeriod.cur.latestByRsn.has(arg) && arg !== state.fp.a) Object.assign(state.fp, { a: arg, b: null });
  const changed = route !== state.route;
  state.route = route;
  document.querySelectorAll('.view').forEach((v) => (v.hidden = v.dataset.view !== route));
  document.querySelectorAll('[data-route]').forEach((a) => (a.dataset.route === route ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  closeMenu();
  renderPager();
  renderView();
  // The map is created during the first render, so focus it on the frame after.
  if (route === 'q1') requestAnimationFrame(() => requestAnimationFrame(() => { invalidateMap(); focusOnMap(context()); }));
  if (changed) {
    document.querySelector(`.view[data-view="${route}"]`).scrollTop = 0;
    if (window.innerWidth <= 960) window.scrollTo(0, 0);
    // Move focus to the new heading for screen-reader and keyboard users.
    const h = document.querySelector(`.view[data-view="${route}"] h1:not([hidden])`);
    if (h && document.activeElement?.closest('.nav, .pager, .card, .q-card')) { h.tabIndex = -1; h.focus({ preventScroll: true }); }
  }
  document.title = route === 'home' ? 'Lease Lens' : `${document.querySelector(`[data-route="${route}"] b`)?.textContent ?? 'About'} · Lease Lens`;
}

// Render only the visible view, after layout so charts can measure their space.
function renderView() {
  tip.hide();
  renderSelection();
  requestAnimationFrame(() => {
    try { RENDER[state.route](context()); } catch (err) { console.error(err); }
  });
}

function renderPager() {
  const i = QUESTIONS.findIndex((q) => q.route === state.route);
  $('pager').hidden = i < 0;
  if (i < 0) return;
  const prev = i === 0 ? { route: '', short: 'Overview' } : QUESTIONS[i - 1];
  const next = i === QUESTIONS.length - 1 ? { route: 'building', short: 'Check a building' } : QUESTIONS[i + 1];
  const link = (a, q, dir) => {
    a.href = `#/${q.route}`;
    const num = QUESTIONS.indexOf(q) + 1;
    a.innerHTML = dir === 'prev'
      ? `<span aria-hidden="true">←</span><span><small>Previous · </small>${num ? `${num}. ` : ''}${q.short}</span>`
      : `<span><small>Next · </small>${num ? `${num}. ` : ''}${q.short}</span><span aria-hidden="true">→</span>`;
  };
  link($('pager-prev'), prev, 'prev');
  link($('pager-next'), next, 'next');
  $('pager-dots').innerHTML = QUESTIONS.map((q, j) => `<li><a href="#/${q.route}" aria-label="Question ${j + 1}: ${q.short}" ${j === i ? 'aria-current="step"' : ''}></a></li>`).join('');
}

// ---- views owned by main ------------------------------------------------------
function renderHome(ctx) {
  const { pm, latest, pairs, ward } = ctx;
  const evals = ward ? pm.recs.filter((r) => r.ward === ward).length : pm.recs.length;
  const mean = d3.mean(latest, (r) => r.score), median = d3.median(latest, (r) => r.score);
  const metric = (label, value, sub) => `<div class="metric"><div class="metric-label">${label}</div><div class="metric-value">${value}</div><div class="metric-sub">${sub}</div></div>`;
  $('metrics').innerHTML = [
    metric('Buildings evaluated', fmt.n(latest.length), ward ? `in ${esc(M.wardName.get(ward))}` : 'rental apartment buildings'),
    metric('Average latest score', `${mean.toFixed(1)}<small>/100</small>`, `median ${median} · higher is better`),
    metric('Evaluations', fmt.n(evals), `${(evals / latest.length).toFixed(1)} per building on average`),
    metric('Wards represented', new Set(latest.map((r) => r.ward)).size, ward ? 'ward filter is on' : "of Toronto's 25 wards"),
  ].join('');

  // Each card previews the answer with one number from the current data.
  const wards = wardLowShares(pm.latest, pm);
  const wardRow = ward ? wards.find((w) => w.ward === ward) : wards[0];
  const yb = latest.filter((r) => r.yearBuilt != null);
  const r = pearson(yb, (d) => d.yearBuilt, (d) => d.score);
  const items = itemProblemRates(latest, pm).filter((d) => d.rated >= 30).sort((a, b) => b.share - a.share);
  const ch = changeSummary(pairs);
  const top = biggestMovers(pairs, 1).up[0];
  const cards = [
    { route: 'q1', title: 'Where are the lowest-scoring buildings?', value: wardRow ? pct(wardRow.share) : '–', caption: wardRow ? `of buildings in ${esc(wardRow.name)} are in the city's lowest 10%` : '' },
    { route: 'q2', title: 'Do older buildings score lower?', value: r == null ? '–' : `r = ${r.toFixed(2)}`, caption: 'a weak link between building age and score' },
    { route: 'q3', title: 'What problems are most common?', value: items[0] ? pct(items[0].share) : '–', caption: items[0] ? `of buildings had ${esc(items[0].label.toLowerCase())} rated poorly` : '' },
    { route: 'q4', title: 'Do scores improve when re-inspected?', value: ch.n ? pct(ch.up / ch.n) : '–', caption: 'of re-inspections scored higher than before' },
    { route: 'q5', title: 'Which buildings changed the most?', value: top ? signed(top.delta) : '–', caption: top ? `points at ${esc(titleCase(top.b.address))}, the biggest jump` : '' },
  ];
  if (r != null && Math.abs(r) >= 0.3) cards[1].caption = 'correlation between year built and score';
  $('question-cards').innerHTML = cards.map((c, i) => `
    <a class="q-card" href="#/${c.route}">
      <span class="nav-num" aria-hidden="true">${i + 1}</span>
      <h3>${c.title}</h3>
      <span class="qc-value">${c.value}</span>
      <span class="qc-caption">${c.caption}</span>
      <span class="qc-go">Explore <span aria-hidden="true">→</span></span>
    </a>`).join('');
}

function renderSelection() {
  // Active ward filter, visible from every view and removable in one click.
  const chip = $('ward-chip');
  chip.hidden = !state.ward;
  if (state.ward) {
    chip.innerHTML = `<span class="sel-text">Ward: <b>${esc(M.wardName.get(state.ward))}</b></span>
      <button type="button" class="icon-button" aria-label="Remove ward filter" title="Show all of Toronto">×</button>`;
    chip.querySelector('button').addEventListener('click', () => setWard(''));
  }
  const box = $('selection');
  const r = state.selected && M.byPeriod[state.period].latestByRsn.get(state.selected);
  if (!r) { box.hidden = true; box.innerHTML = ''; return; }
  box.hidden = false;
  box.innerHTML = `<span class="sel-text">Selected: <b>${esc(titleCase(r.address))}</b> · score ${r.score}</span>
    ${state.route !== 'building' ? '<a class="btn btn-primary btn-sm" href="#/building/' + r.rsn + '" style="line-height:30px;text-decoration:none">View report</a>' : ''}
    <button type="button" class="icon-button" aria-label="Clear selected building" title="Clear selection">×</button>`;
  box.querySelector('button').addEventListener('click', () => select(null));
}

function renderMetaNotes() {
  const pm = M.byPeriod[state.period];
  $('period-note').innerHTML = `Evaluations from ${formatDate(pm.dates[0])} to ${formatDate(pm.dates[1])}. The City changed its scoring in 2023, so the two systems are never mixed.`;
  const ex = (e) => M.byPeriod[e].excluded;
  $('data-note').innerHTML = `City of Toronto Open Data,
    <a href="https://open.toronto.ca/dataset/apartment-building-evaluation/" target="_blank" rel="noopener">Apartment Building Evaluations</a>
    (pre-2023 and 2023–current files, ${fmt.n(M.data.records.length)} evaluations in total).
    ${fmt.n(ex('pre').flagged + ex('cur').flagged)} records flagged in the data as created in error, empty of ratings, or duplicated were left out,
    along with ${fmt.n(ex('pre').noScore + ex('cur').noScore)} with no score. Nothing else was removed or changed. Buildings are matched by their City registration number (RSN).`;
}

// ---- interactions -----------------------------------------------------------
function select(rsn, { open = false } = {}) {
  state.selected = rsn;
  if (open && rsn) { navigate(`#/building/${rsn}`); return; }
  if (state.route === 'building' && !rsn) { history.replaceState(null, '', '#/building'); }
  renderView();
}

// Fingerprint state: a patch object, or a function of the current state that returns one.
function setFp(patch, hash) {
  Object.assign(state.fp, typeof patch === 'function' ? patch(state.fp) : patch);
  if (hash && location.hash !== hash) history.replaceState(null, '', hash);
  else if (state.fp.a && state.route === 'fingerprint') history.replaceState(null, '', `#/fingerprint/${state.fp.a}`);
  renderView();
}

function setPeriod(v) {
  const input = document.querySelector(`input[name="period"][value="${v}"]`);
  if (input && !input.checked) { input.checked = true; input.dispatchEvent(new Event('change')); }
}

function setWard(ward) {
  state.ward = ward;
  $('ward').value = ward;
  renderView();
  if (state.route === 'q1') requestAnimationFrame(() => focusOnMap({ ...context(), selected: null }));
}

function findBuilding(text) {
  const v = text.trim().toUpperCase();
  if (!v) return null;
  const latest = M.byPeriod[state.period].latest;
  return latest.find((d) => d.address.toUpperCase() === v) || latest.find((d) => d.address.toUpperCase().startsWith(v)) || latest.find((d) => d.address.toUpperCase().includes(v));
}

function wireControls() {
  const radios = (name, fn) => document.querySelectorAll(`input[name="${name}"]`).forEach((i) => i.addEventListener('change', () => fn(i.value)));
  radios('period', (v) => {
    state.period = v;
    if (state.selected && !M.byPeriod[v].latestByRsn.has(state.selected) && state.route !== 'building') state.selected = null;
    fillSearch(); renderMetaNotes(); renderView();
  });
  radios('map-show', (v) => { state.mapShow = v; renderView(); });
  radios('item-group', (v) => { state.problems.group = v; state.problems.showAll = false; renderView(); });
  radios('change-start', (v) => { state.changes.start = v; renderView(); });
  radios('movers-n', (v) => { state.movers.n = +v; renderView(); });
  $('problem-more').addEventListener('click', () => { state.problems.showAll = !state.problems.showAll; renderView(); });

  $('ward').innerHTML += M.wards.map((w) => `<option value="${w.ward}">${+w.ward} · ${esc(w.name)}</option>`).join('');
  $('ward').addEventListener('change', (e) => setWard(e.target.value));

  // Searching always opens the building report: that's what a renter typing an address wants.
  const wireSearch = (input, button) => {
    const go = () => { const r = findBuilding(input.value); if (r) { input.value = ''; select(r.rsn, { open: true }); } };
    input.addEventListener('change', go);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    button?.addEventListener('click', go);
  };
  wireSearch($('search'));
  wireSearch($('hero-search'), $('hero-go'));

  // ← / → move between the five questions (ignored while typing or using the map).
  document.addEventListener('keydown', (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    if (e.target.closest('input, select, textarea, .leaflet-container')) return;
    const link = $(e.key === 'ArrowLeft' ? 'pager-prev' : 'pager-next');
    if (!$('pager').hidden) { e.preventDefault(); navigate(link.getAttribute('href')); }
  });

  // mobile menu
  $('menu-button').addEventListener('click', () => {
    const open = !$('nav-panel').classList.contains('open');
    $('nav-panel').classList.toggle('open', open);
    $('menu-button').setAttribute('aria-expanded', String(open));
  });

  // theme toggle (remembered per browser; the page still works if storage is blocked)
  const applyTheme = (t) => {
    if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
    const dark = t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    $('theme-toggle').querySelector('span').textContent = dark ? 'Light mode' : 'Dark mode';
  };
  let saved = null;
  try { saved = localStorage.getItem('lease-lens-theme'); } catch { /* storage unavailable */ }
  applyTheme(saved);
  $('theme-toggle').addEventListener('click', () => {
    const dark = document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    const next = dark ? 'light' : 'dark';
    try { localStorage.setItem('lease-lens-theme', next); } catch { /* ignore */ }
    applyTheme(next);
    renderView();
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { applyTheme(document.documentElement.dataset.theme); renderView(); });
}
function closeMenu() {
  $('nav-panel').classList.remove('open');
  $('menu-button').setAttribute('aria-expanded', 'false');
}

function fillSearch() {
  const latest = M.byPeriod[state.period].latest;
  $('building-list').innerHTML = [...latest].sort((a, b) => d3.ascending(a.address, b.address))
    .map((r) => `<option value="${esc(r.address)}">${esc(r.wardName)} · score ${r.score}</option>`).join('');
}

// Re-draw when the available space changes (the map only needs a resize).
function watchResize() {
  let t, last = '';
  new ResizeObserver(() => {
    clearTimeout(t);
    t = setTimeout(() => {
      invalidateMap();
      const s = `${$('stage').clientWidth}x${$('stage').clientHeight}`;
      if (s === last) return;
      last = s;
      if (state.route !== 'q1') renderView();
    }, 150);
  }).observe($('stage'));
}

(async function main() {
  try {
    const data = await LL.loadAll((msg) => ($('status').textContent = msg));
    M = buildModel(data);
  } catch (err) {
    console.error(err);
    $('status').innerHTML = `<span class="error"><b>Couldn't load the data.</b> Start a local server from the project folder
      (<code>python3 -m http.server 8000</code>) and open <code>http://localhost:8000/dashboard/</code>. (${esc(err.message)})</span>`;
    return;
  }
  $('status').textContent = '';
  wireControls();
  fillSearch();
  renderMetaNotes();
  window.addEventListener('hashchange', onRoute);
  onRoute();
  watchResize();
})();
