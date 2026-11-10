// LeaseLens app shell. Two layers: the public homepage (#/) and the atlas, a single map of Toronto
// explored by zooming in. Detail grows with scale and intent:
//
//   Toronto (ward choropleth) → neighbourhood (clusters, then buildings) → building (place panel)
//   → inspection (Building X-Ray, the "depth" layer) — plus comparison, story visuals and text pages,
//   which open over the map and close back onto it.
//
// Addresses (every level is a link, and Back/Forward work):
//   #/explore?at=<lat>,<lon>,<zoom>&ward=<code>&b=<RSN>&lens=<id>&sys=pre&show=low10   the map
//   #/xray/<RSN>   #/compare/<RSN>   #/story/<chapter>   #/about   #/help   (#/approach → #/about)
// Old addresses (#/q1…q5, #/building/<RSN>, #/explore/<tab>, #/trends/<tab>, #/fingerprint) redirect.
//
// History: panning and zooming replace the current entry; selecting a ward or a building, opening an
// analysis layer from a link, and going down a level push one. The map is never torn down while a
// deeper level is open, so "Back to map" lands on exactly the same place and zoom.

import { buildModel } from './model.js';
import { tip, esc, titleCase, formatDate, pct, fmt } from './ui.js';
import { renderWards } from './sections/map.js';
import { renderAge } from './sections/age.js';
import { renderProblems } from './sections/problems.js';
import { renderChanges } from './sections/changes.js';
import { renderMovers } from './sections/movers.js';
import { renderPlace } from './sections/building.js';
import { renderFingerprint } from './sections/fingerprint.js';
import { renderXray, disposeXray, loadMassing } from './sections/xray.js';
import { initInfoPopovers } from './components/info-popover.js';
import { createStory } from './story/controller.js';
import { drawVisual } from './story/visuals.js';
import { scoreDistribution } from './story/selectors.js';
import { initHome, showHome } from './home/home.js';
import { animate, DUR } from './motion.js';
import * as Atlas from './atlas/map.js';
import { initSearch } from './atlas/search.js';
import { wardChoropleth, choroplethSummary, encodeExplore, decodeExplore, legacyRoute, footprintLatLngs, SMALL_WARD } from './atlas/logic.js';

const $ = (id) => document.getElementById(id);
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const narrow = () => window.innerWidth <= 760;

// ---- analysis layers: one at a time, beside the map ---------------------------------------------------
// `scale` decides which group is suggested at the current zoom; every layer stays available.
const LENSES = [
  { id: 'distribution', label: 'Score distribution', scale: 'city', render: (ctx) => renderDistribution(ctx) },
  { id: 'wards', label: 'Ward comparison', scale: 'city', citywide: true, render: renderWards },
  { id: 'changes', label: 'Re-inspection changes', scale: 'city', render: (ctx) => renderChanges(ctx, state.changes) },
  { id: 'age', label: 'Building age and score', scale: 'local', render: renderAge },
  { id: 'problems', label: 'Common inspection problems', scale: 'local', render: (ctx) => renderProblems(ctx, state.problems) },
  { id: 'movers', label: 'Biggest score changes', scale: 'local', render: (ctx) => renderMovers(ctx, state.movers) },
];
const lensById = new Map(LENSES.map((l) => [l.id, l]));

const PAGES = { about: 'About', help: 'Help' };

const state = {
  layer: 'home',
  depth: 'map',          // map | xray | compare | story | page
  page: null,
  period: 'cur',
  ward: '',
  selected: null,        // building RSN, shared by the map, the place panel, the X-Ray and the story
  mapShow: 'all',
  lens: null,            // active analysis layer id
  placeTab: 'summary',   // summary | nearby | history
  problems: { group: 'all', showAll: false },
  changes: { start: 'all' },
  movers: { n: 10 },
  fp: { score: 92, pairIndex: 0, a: null, b: null, shownA: null, shownB: null },
  xray: { rsn: null, evalUid: null, zone: null, mode: 'exterior', matchRsn: null },
};
let M = null;
let story = null;
let search = null;
let lastHash = '#/';
let lastRoute = '';
let handled = null;      // the hash the router last handled (hashchange and popstate both fire)
let lastExplore = null;  // the map's address when a deeper level was opened (Back to map returns here)
const chCache = new Map();
const footprints = new Map(); // rsn -> lat/lng rings ([] when the shape is not a reliable match)

// ---- shared context for every view ------------------------------------------------------------------------
function choropleth(era = state.period) {
  if (!chCache.has(era)) chCache.set(era, wardChoropleth(M.byPeriod[era]));
  return chCache.get(era);
}
function context() {
  const pm = M.byPeriod[state.period];
  const inWard = (r) => !state.ward || r.ward === state.ward;
  return {
    pm, ward: state.ward, selected: state.selected, show: state.mapShow,
    latest: pm.latest.filter(inWard), pairs: pm.pairs.filter((p) => inWard(p.b)),
    ch: choropleth(), highlight: app.highlight,
    select, setWard, setFp, setPeriod, findBuilding,
    registerShown: (slot, rsn) => { state.fp[slot === 'a' ? 'shownA' : 'shownB'] = rsn; },
  };
}
// A building's record in the chosen system, else its latest in the other one.
function recOf(rsn) {
  if (!rsn || !M) return null;
  return M.byPeriod[state.period].latestByRsn.get(rsn) ?? M.byPeriod[state.period === 'cur' ? 'pre' : 'cur'].latestByRsn.get(rsn) ?? null;
}

// ---- routing ------------------------------------------------------------------------------------------------
function parseHash() {
  const h = location.hash.replace(/^#\/?/, '');
  const [path, query = ''] = h.split('?');
  const [route = '', arg] = path.split('/');
  return { route, arg: arg ? decodeURIComponent(arg) : undefined, query };
}
function navigate(hash) {
  if (location.hash === hash) onRoute(); else location.hash = hash;
}
function routeIfChanged() { if (location.hash !== handled) onRoute(); }

function onRoute() {
  handled = location.hash;
  const { route, arg, query } = parseHash();
  const leg = legacyRoute(route, arg);
  if (leg) { history.replaceState(null, '', leg); onRoute(); return; }

  // Layer A: the public homepage
  if (!route) {
    story?.leave();
    closeDepth();
    setLayer('home');
    document.querySelectorAll('.atlas-nav [aria-current]').forEach((a) => a.removeAttribute('aria-current'));
    document.title = 'LeaseLens · Toronto rental building data';
    lastHash = location.hash || '#/'; lastRoute = '';
    return;
  }

  // Layer B: the atlas
  setLayer('work');
  if (!M && !PAGES[route]) return; // routed again once the data has loaded

  if (route === 'story') {
    const from = lastRoute === 'explore' && state.depth === 'map' ? exploreHash() : lastHash;
    lastHash = location.hash; lastRoute = 'story';
    story.enter(arg, from.startsWith('#/story') ? undefined : from);
    document.title = 'Beyond the Score · LeaseLens';
    markNav();
    requestAnimationFrame(Atlas.invalidate);
    return;
  }
  const wasStory = story?.active();
  story?.leave();
  if (wasStory) requestAnimationFrame(Atlas.invalidate);

  lastHash = location.hash; lastRoute = route;
  if (route === 'explore') { applyExplore(decodeExplore(query)); return; }
  if (route === 'xray') {
    if (arg && M.data.byRsn.has(arg)) state.selected = arg;
    openDepth('xray');
    return;
  }
  if (route === 'compare') {
    if (arg && M.byPeriod.cur.latestByRsn.has(arg) && arg !== state.fp.a) Object.assign(state.fp, { a: arg, b: null });
    openDepth('compare');
    return;
  }
  if (PAGES[route]) { openDepth('page', route); return; }
  history.replaceState(null, '', '#/explore');
  onRoute();
}

// The map's state comes from its address, so links, reloads and Back/Forward all agree.
function applyExplore(q) {
  const periodChanged = (q.period ?? 'cur') !== state.period;
  state.period = q.period ?? 'cur';
  state.ward = q.ward && M.wardName.has(q.ward) ? q.ward : '';
  state.selected = q.selected && M.data.byRsn.has(q.selected) ? q.selected : null;
  state.lens = q.lens ?? null;
  state.mapShow = q.mapShow ?? 'all';
  if (periodChanged) { state.xray.evalUid = null; fillSearch(); renderMetaNotes(); }
  syncControls();
  const wasDeep = state.depth !== 'map';
  closeDepth();
  renderMapLevel();
  if (q.view) Atlas.setView(q.view, { animate: !wasDeep });
  else if (state.selected && recOf(state.selected)?.lat != null) Atlas.showBuilding(recOf(state.selected));
  else if (state.ward) Atlas.wardsLoaded().then(() => Atlas.showWard(state.ward));
  else Atlas.wardsLoaded().then(() => Atlas.showCity());
  const r = recOf(state.selected);
  document.title = `${r ? `${titleCase(r.address)} · ` : state.ward ? `${M.wardName.get(state.ward)} · ` : ''}Explore · LeaseLens`;
  lastExplore = location.hash;
  markNav();
}

function exploreHash() {
  return encodeExplore({ ...(Atlas.getView() ?? {}), ward: state.ward, selected: state.selected, lens: state.lens, period: state.period, mapShow: state.mapShow });
}
const onMapRoute = () => parseHash().route === 'explore' && state.depth === 'map' && !story?.active();
// Write the current view into the current history entry (no new entry).
function commitView() {
  if (onMapRoute()) history.replaceState(history.state, '', exploreHash());
  $('nav-explore').setAttribute('href', state.depth === 'map' && onMapRoute() ? exploreHash() : (lastExplore ?? '#/explore'));
}
function pushExplore() {
  if (story?.active()) return;
  const h = exploreHash();
  if (location.hash !== h) history.pushState(null, '', h);
  handled = location.hash;
  lastHash = location.hash;
  lastExplore = h;
}

function setLayer(layer) {
  if (layer === 'home') showHome(); // lazy: mounts the homepage atlas once
  if (state.layer === layer && $('app').hidden === (layer === 'home')) return;
  state.layer = layer;
  document.body.dataset.layer = layer;
  $('home').hidden = layer !== 'home';
  $('app').hidden = layer !== 'work';
  window.scrollTo(0, 0);
  closeMenus();
  if (layer === 'work') { ensureMap(); requestAnimationFrame(() => { Atlas.invalidate(); if (themeStale) { themeStale = false; Atlas.restyle(); } }); }
}

function markNav() {
  const cur = story?.active() ? 'story' : state.depth === 'page' ? state.page : 'explore';
  document.querySelectorAll('.atlas-nav [data-route]').forEach((a) => (a.dataset.route === cur ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
}

// ---- the map ---------------------------------------------------------------------------------------------------
let viewTimer = 0;
function ensureMap() {
  Atlas.initMap($('map'), {
    insets: mapInsets,
    onBuilding: (rsn) => select(rsn, { fly: false }),
    onWard: (w) => setWard(w),
    onLevel: () => { if (M && state.depth === 'map') renderChrome(); },
    onView: () => {
      clearTimeout(viewTimer);
      viewTimer = setTimeout(() => { if (!M) return; commitView(); if (state.depth === 'map') { renderInView(); renderSummary(); } }, 220);
    },
    onWardsReady: () => { if (M) renderMapLevel(); },
    onWardsFailed: () => { if (M) renderLegend(); },
  });
}

// The rails cover part of the map; flights frame things in the space that is left.
function mapInsets() {
  const box = $('stage').getBoundingClientRect();
  const r = (el) => (el && !el.hidden && el.offsetParent ? el.getBoundingClientRect() : null);
  const cap = story?.active() ? r($('story-panel')) : null; // the story caption is an obstruction too
  if (narrow()) {
    const sheet = [r($('place')), r($('lens')), cap].filter(Boolean).map((b) => box.bottom - b.top);
    return { left: 0, right: 0, top: (r($('title-card'))?.bottom ?? box.top) - box.top, bottom: Math.max(0, ...sheet) };
  }
  const left = [r($('title-card')), r($('place')), cap].filter(Boolean).reduce((w, b) => Math.max(w, b.right - box.left), 0);
  const lens = r($('lens'));
  return { left, right: lens ? box.right - lens.left : 0, top: 0, bottom: 0 };
}

function renderMapLevel() {
  if (!M) return;
  const ctx = context();
  const sel = recOf(state.selected);
  Atlas.update({ pm: ctx.pm, ward: state.ward, selected: state.selected, show: state.mapShow, ch: ctx.ch, footprint: footprints.get(state.selected) ?? null, selectedRec: sel });
  if (state.selected && !footprints.has(state.selected)) loadFootprint(state.selected);
  renderChrome();
}

// The selected building's real outline, from the same City 3D Massing match the X-Ray uses. Only
// reliable matches ('massing' or 'footprint' provenance) are drawn; anything else draws nothing.
function loadFootprint(rsn) {
  footprints.set(rsn, null);
  const recs = (M.data.byRsn.get(rsn) ?? []).filter((r) => r.lat != null);
  const at = recs.reduce((a, r) => (!a || r.time > a.time ? r : a), null);
  if (!at) { footprints.set(rsn, []); return; }
  loadMassing(rsn).then((e) => {
    footprints.set(rsn, e && ['massing', 'footprint'].includes(e.provenance) ? footprintLatLngs(e, at.lat, at.lon) : []);
  }).catch(() => footprints.set(rsn, [])).then(() => { if (state.selected === rsn && state.depth === 'map') renderMapLevel(); });
}

// Re-rendering a panel must not drop keyboard focus: remember the focused control and find it again.
function keepFocus(fn) {
  const a = document.activeElement;
  const host = a?.closest('#place, #lens-options, #legend, #in-view');
  const key = host && (a.id ? `#${a.id}` : ['data-act', 'data-tab', 'data-rsn', 'data-lens', 'value'].map((k) => (a.hasAttribute(k) ? `[${k}="${a.getAttribute(k)}"]` : '')).join(''));
  fn();
  if (key && !host.contains(document.activeElement)) (host.querySelector(key) ?? (host.id === 'place' ? $('place-title') : null))?.focus({ preventScroll: true });
}

function renderChrome() {
  if (!M) return;
  keepFocus(renderChromeNow);
}
// The place panel opens out of the selected building (or ward) on the map and closes back into it.
// One 'panel' animation at a time (motion.js): opening something else mid-way simply takes over.
let placeId = '', placeOpener = null;
let presentSeq = 0; // story chapters: only the newest one may finish its moves
function placeOrigin() {
  const r = state.selected && (M.byPeriod[state.period].latestByRsn.get(state.selected) ?? M.anyByRsn?.get(state.selected));
  if (r?.lat != null) return Atlas.clientPointOf(r.lat, r.lon);
  const b = state.ward && Atlas.wardBoundsOf(state.ward);
  if (b) { const c = b.getCenter(); return Atlas.clientPointOf(c.lat, c.lng); }
  return null;
}
function originStyle(el, pt) {
  const r = el.getBoundingClientRect();
  el.style.transformOrigin = pt ? `${Math.round(pt.x - r.left)}px ${Math.round(pt.y - r.top)}px` : '0 50%';
}
function placeIn(el) {
  originStyle(el, placeOrigin());
  animate('panel', {
    duration: DUR.panel,
    step: (e) => { el.style.opacity = String(e); el.style.transform = `scale(${0.94 + 0.06 * e})`; },
    done: () => { el.style.opacity = ''; el.style.transform = ''; el.style.transformOrigin = ''; },
  });
}
function placeOut(el, html, rect, pt) {
  // the content is already gone: shrink a copy back toward where it came from
  const ghost = document.createElement('aside');
  ghost.className = 'card place place-ghost';
  ghost.setAttribute('aria-hidden', 'true');
  ghost.inert = true;
  ghost.innerHTML = html;
  Object.assign(ghost.style, { position: 'fixed', left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`, margin: 0, zIndex: 850, pointerEvents: 'none' });
  document.body.append(ghost);
  originStyle(ghost, pt);
  animate('panel', {
    duration: DUR.micro + 40,
    step: (e) => { ghost.style.opacity = String(1 - e); ghost.style.transform = `scale(${1 - 0.06 * e})`; },
    done: () => ghost.remove(),
  });
}

function renderChromeNow() {
  const ctx = context();
  renderCrumbs($('crumbs'));
  renderTitle();
  const place = $('place');
  const wasOpen = !place.hidden, before = wasOpen ? { html: place.innerHTML, rect: place.getBoundingClientRect(), pt: placeOrigin.last } : null;
  const focusWasInPlace = place.contains(document.activeElement);
  renderPlace($('place'), ctx, M, {
    tab: state.placeTab,
    onClose: () => (state.selected ? select(null) : setWard('')),
    onTab: (t) => { state.placeTab = t; renderChrome(); },
    onInspect: (rsn, uid) => { state.xray.evalUid = uid ?? null; goDeep(`#/xray/${rsn}`); },
    onSelect: (rsn) => select(rsn, { focus: true }),
    onPeriod: (e) => setPeriod(e),
    onLens: (id) => setLens(id),
  });
  renderLegend();
  renderLensMenu();
  renderLens(ctx);
  renderInView();
  renderSummary();
  document.body.classList.toggle('has-place', !$('place').hidden);
  $('title-card').classList.toggle('is-compact', !$('place').hidden);
  const id = place.hidden ? '' : state.selected ? `b${state.selected}` : `w${state.ward}`;
  if (id !== placeId && state.depth === 'map') { // deeper levels set the panel aside; that is not a close
    if (id) {
      if (!placeId) placeOpener = document.activeElement !== document.body && !place.contains(document.activeElement) ? document.activeElement : null;
      placeIn(place);
      placeOrigin.last = placeOrigin();
    } else if (before && !reducedMotion()) {
      placeOut(place, before.html, before.rect, before.pt ?? null);
    }
    // closing returns focus to whatever opened it (the search box, a list) or to the map
    if (!id && focusWasInPlace) (placeOpener?.isConnected && !placeOpener.closest('[hidden]') ? placeOpener : $('map')).focus({ preventScroll: true });
    placeId = id;
  } else if (id) placeOrigin.last = placeOrigin();
  document.body.classList.toggle('has-lens', !$('lens').hidden);
  // In the story, a chapter's detail view opens above whatever the chapter shows (map, chart or X-Ray).
  const detail = !!story?.active() && !$('lens').hidden;
  document.body.classList.toggle('story-detail', detail);
  if (state.depth !== 'map') $('rail-right').inert = !detail;
}

function renderTitle() {
  const sub = {
    city: 'Zoom in to see how inspection results vary.',
    area: 'Keep zooming to separate the groups.',
    building: 'Select a building to see its score.',
  }[Atlas.getLevel()];
  $('atlas-sub').textContent = sub;
}

// Toronto › Ward › Building (› Inspection, in the depth bar)
function renderCrumbs(el, tail) {
  const r = recOf(state.selected);
  const ward = r?.ward ?? state.ward;
  const items = [`<li><button type="button" class="crumb" data-crumb="city">Toronto</button></li>`];
  if (ward) items.push(`<li><button type="button" class="crumb" data-crumb="ward" data-ward="${ward}" ${!r && !tail ? 'aria-current="location"' : ''}>${esc(M.wardName.get(ward) ?? `Ward ${+ward}`)}</button></li>`);
  if (r) items.push(tail ? `<li><button type="button" class="crumb" data-crumb="building">${esc(titleCase(r.address))}</button></li>` : `<li><span aria-current="location">${esc(titleCase(r.address))}</span></li>`);
  if (tail) items.push(`<li><span aria-current="location">${esc(tail)}</span></li>`);
  el.innerHTML = items.join('');
  el.querySelectorAll('[data-crumb]').forEach((b) => b.addEventListener('click', () => {
    const c = b.dataset.crumb;
    if (c === 'city') { toMap(() => { state.selected = null; state.ward = ''; pushExplore(); Atlas.showCity(); renderMapLevel(); }); }
    if (c === 'ward') { const w = b.dataset.ward; toMap(() => { state.selected = null; state.ward = w; pushExplore(); Atlas.showWard(w); renderMapLevel(); }); }
    if (c === 'building') backToMap();
  }));
}
// Run a map change, leaving the story or a deeper level first (the change itself pushes the entry).
function toMap(fn) {
  if (story?.active()) { story.leave(); requestAnimationFrame(Atlas.invalidate); }
  closeDepth();
  fn();
  markNav();
}

function renderLegend() {
  // Minimal by design: a title, the key, and one quiet line. How to read it, the scoring-system note and
  // the small-ward rule sit behind the ⓘ; a text description is one click away.
  const el = $('legend');
  const pm = M.byPeriod[state.period];
  const level = Atlas.getLevel();
  const ch = choropleth();
  const head = (title, info, label) => `<div class="legend-head"><p class="legend-title">${title}</p>
    <button type="button" class="info-btn" data-info="${info}" aria-label="${label}">i</button></div>`;
  let body = '';
  if (level === 'city') {
    const rl = (r) => (r.cls === 0 ? `under ${pct(r.to)}` : r.to == null ? `${pct(r.from)} or more` : `${pct(r.from)}–${pct(r.to)}`);
    const cityCls = ch.classOf(ch.city);
    body = `${head('Buildings in the lowest 10%', 'map-wards', 'How to read the ward map')}
      <ol class="ch-scale">${[...ch.ranges].reverse().map((r) => `<li><span class="ch-sw" style="background:var(--ch-${r.cls})"></span><span>${rl(r)}</span>${r.cls === cityCls ? `<span class="ch-city">Toronto ${pct(ch.city)}</span>` : ''}</li>`).join('')}</ol>`;
  } else if (level === 'area') {
    body = `${head('Groups of buildings', 'map-areas', 'How to read the groups')}
      <p class="cl-key"><span class="cl-disc" style="--d:28px;--p:0.25" aria-hidden="true"><b>12</b></span>
        <span>Buildings in the group. <span class="red-ink">Red</span>: share in the lowest 10%.</span></p>`;
  } else {
    const key = (v, label, r) => `<li><span class="dot-key" style="--k:var(${v});--r:${r}px"></span>${label}</li>`;
    body = `${head('Latest score', 'map-buildings', 'How to read the building marks')}
      <ul class="dot-keys">${key('--low-10', `${pm.t10} or below <small>lowest 10%</small>`, 11)}${key('--low-25', `${pm.t10 + 1}–${pm.t25}`, 9)}${state.mapShow === 'all' ? key('--dot', `Above ${pm.t25}`, 7) : ''}</ul>`;
  }
  el.innerHTML = `${body}<p class="legend-foot"><span>${esc(pm.P.label)} system</span>
    <button type="button" class="link-btn" id="describe-btn" aria-expanded="false" aria-controls="describe-text">Describe</button></p>
    <p class="legend-text" id="describe-text" hidden>${esc(level === 'city' ? choroplethSummary(ch, (v) => pct(v)) : $('map-summary').textContent)}</p>`;
  $('describe-btn').addEventListener('click', (e) => {
    const t = $('describe-text'); t.hidden = !t.hidden; e.currentTarget.setAttribute('aria-expanded', String(!t.hidden));
  });
}

// A text equivalent of the map for screen readers: what level is showing and what it says.
let lastSummary = '';
function renderSummary() {
  const level = Atlas.getLevel();
  const ch = choropleth();
  let s;
  if (level === 'city') s = `Showing Toronto's 25 wards. ${choroplethSummary(ch, (v) => pct(v))}`;
  else {
    const v = Atlas.buildingsInView();
    const low = v.filter((r) => r.score <= M.byPeriod[state.period].t10).length;
    s = `${level === 'area' ? 'Showing groups of nearby buildings' : 'Showing individual buildings'}: ${fmt.n(v.length)} in view, ${fmt.n(low)} of them in the lowest 10%.`;
  }
  if (s !== lastSummary) { $('map-summary').textContent = s; lastSummary = s; }
}

// The keyboard route to the buildings on screen (lowest scores first).
function renderInView() {
  const box = $('in-view');
  const level = Atlas.getLevel();
  if (level === 'city' || state.selected) { box.hidden = true; return; }
  const v = Atlas.buildingsInView().sort((a, b) => a.score - b.score || a.address.localeCompare(b.address));
  box.hidden = false;
  $('in-view-sum').textContent = `${fmt.n(v.length)} building${v.length === 1 ? '' : 's'} in view${v.length > 10 ? ', lowest scores first' : ''}`;
  const pm = M.byPeriod[state.period];
  $('in-view-list').innerHTML = v.slice(0, 10).map((r) => `<li><button type="button" data-rsn="${r.rsn}"><span class="nl-name">${esc(titleCase(r.address))}</span>
    <span class="nl-km">${esc(r.wardName)}</span><span class="nl-score ${r.score <= pm.t10 ? 'low10' : r.score <= pm.t25 ? 'low25' : 'other'}">${r.score}</span></button></li>`).join('');
  $('in-view-list').querySelectorAll('[data-rsn]').forEach((b) => b.addEventListener('click', () => select(b.dataset.rsn, { focus: true })));
}

// ---- analysis layers ----------------------------------------------------------------------------------------------
function renderLensMenu() {
  const level = Atlas.getLevel();
  const localFirst = level !== 'city' || state.ward;
  const groups = [
    { key: 'city', title: 'Citywide patterns' },
    { key: 'local', title: state.ward ? `In ${M.wardName.get(state.ward)}` : 'Neighbourhood detail' },
  ];
  if (localFirst) groups.reverse();
  const opt = (l) => `<label class="lens-opt"><input type="radio" name="lens" value="${l.id}" ${state.lens === l.id ? 'checked' : ''} /><span>${esc(l.label)}</span></label>`;
  $('lens-options').innerHTML = `<label class="lens-opt"><input type="radio" name="lens" value="" ${!state.lens ? 'checked' : ''} /><span>None</span></label>`
    + groups.map((g, i) => `<p class="lens-group">${esc(g.title)}${i === 0 ? ' <small>suggested at this zoom</small>' : ''}</p>${LENSES.filter((l) => l.scale === g.key).map(opt).join('')}`).join('');
  $('lens-options').querySelectorAll('input').forEach((i) => i.addEventListener('change', () => setLens(i.value || null)));
  $('lens-btn').classList.toggle('is-on', !!state.lens);
}

function renderLens(ctx) {
  const box = $('lens');
  const l = state.lens && lensById.get(state.lens);
  box.hidden = !l;
  if (!l) return;
  $('lens-title').textContent = l.label;
  const ward = state.ward ? M.wardName.get(state.ward) : '';
  $('lens-scope').textContent = `${l.citywide ? 'All wards' : ward || 'All of Toronto'} · ${ctx.pm.P.label} system`;
  box.querySelectorAll('.lens-view').forEach((s) => (s.hidden = s.dataset.lens !== l.id));
  requestAnimationFrame(() => { try { l.render(ctx); } catch (err) { console.error(err); } });
}

function renderDistribution(ctx) {
  const el = $('dist-chart');
  if (!ctx.latest.length) { el.innerHTML = '<p class="empty">No evaluated buildings here in this scoring system.</p>'; return; }
  drawVisual('distribution', el, { dist: { ...scoreDistribution({ latest: ctx.latest }), label: ctx.pm.P.long } });
}

function setLens(id, { focus = false } = {}) {
  state.lens = id && lensById.has(id) ? id : null;
  if (!story?.active()) commitView();
  renderChrome();
  if (focus && state.lens) $('lens-title').focus({ preventScroll: true });
}

// ---- deeper levels ------------------------------------------------------------------------------------------------------
// Going down from the map: remember exactly where the map is, then cross-fade into the level.
function goDeep(hash) {
  commitView();
  lastExplore = exploreHash();
  const run = () => { history.pushState({ fromMap: true }, '', hash); onRoute(); };
  if (!document.startViewTransition || reducedMotion()) run();
  else { document.documentElement.classList.add('vt-depth'); document.startViewTransition(run).finished.finally(() => document.documentElement.classList.remove('vt-depth')); }
}

function backToMap() {
  if (history.state?.fromMap) { history.back(); return; }
  navigate(lastExplore ?? encodeExplore({ ward: state.ward, selected: state.selected, lens: state.lens, period: state.period, mapShow: state.mapShow }));
}

function openDepth(kind, page = null, after) {
  const prev = state.depth, prevPage = state.page;
  if (prev === 'xray' && kind !== 'xray') disposeXray();
  state.depth = kind; state.page = page;
  document.body.dataset.depth = kind;
  $('depth').hidden = false;
  for (const id of ['map-wrap', 'rail-left', 'rail-right']) $(id).inert = true;
  if (document.body.classList.contains('story-detail')) $('rail-right').inert = false;
  const view = kind === 'page' ? page : kind;
  $('depth-body').querySelectorAll('.view').forEach((v) => (v.hidden = v.dataset.view !== view));
  tip.hide();
  closeMenus();
  const r = recOf(state.selected);
  const tail = { xray: 'Inspection', compare: 'Same score, different story', story: 'Beyond the Score', page: PAGES[page] }[kind];
  if (M) renderCrumbs($('depth-crumbs'), tail);
  $('depth-back').hidden = kind === 'story';
  markNav();
  document.title = `${kind === 'xray' && r ? `X-Ray: ${titleCase(r.address)}` : tail} · LeaseLens`;
  if (prev !== kind || prevPage !== page) $('depth').scrollTop = 0;
  if (M && (kind === 'xray' || kind === 'compare')) {
    requestAnimationFrame(() => {
      try { kind === 'xray' ? renderXray(context(), M, state.xray) : renderFingerprint(context(), M, state.fp); } catch (err) { console.error(err); }
      if (after) requestAnimationFrame(after);
    });
  } else if (after) requestAnimationFrame(after);
  // Going down a level moves focus to its heading (the story keeps focus in its own panel).
  if ((prev !== kind || prevPage !== page) && !story?.active()) {
    // after the view has rendered (the X-Ray shows either its empty state or the building)
    setTimeout(() => {
      const h = [...$('depth-body').querySelectorAll(`.view[data-view="${view}"] h1`)].find((x) => x.offsetParent);
      if (h && state.depth === kind) { h.tabIndex = -1; h.focus({ preventScroll: true }); }
    }, 60);
  }
}

function closeDepth() {
  if (state.depth === 'map') return;
  if (state.depth === 'xray') disposeXray();
  state.depth = 'map'; state.page = null;
  document.body.dataset.depth = 'map';
  $('depth').hidden = true;
  for (const id of ['map-wrap', 'rail-left', 'rail-right']) $(id).inert = false;
  requestAnimationFrame(Atlas.invalidate);
}

// ---- interactions ---------------------------------------------------------------------------------------------------------
function select(rsn, { fly = true, focus = false, open = false } = {}) {
  if (rsn && state.depth === 'xray') { navigate(`#/xray/${rsn}`); return; }
  if (state.depth !== 'map' && !story?.active()) {
    // from the comparison or a page: back onto the map, with this building selected
    navigate(encodeExplore({ selected: rsn, lens: state.lens, period: state.period, mapShow: state.mapShow })); // no view: it flies there
    return;
  }
  if (open && rsn) { goDeep(`#/xray/${rsn}`); return; }
  const r = recOf(rsn);
  if (!story?.active()) commitView();
  state.selected = rsn;
  state.placeTab = 'summary';
  if (r && state.ward && r.ward !== state.ward) state.ward = ''; // the building's own ward becomes the context
  pushExplore();
  renderMapLevel();
  if (r && fly) Atlas.showBuilding(r);
  if (r) document.title = `${titleCase(r.address)} · Explore · LeaseLens`;
  if (focus && rsn) requestAnimationFrame(() => $('place-title')?.focus({ preventScroll: true }));
  if (!rsn && document.activeElement === document.body) $('atlas-h1').focus({ preventScroll: true });
}

function setWard(ward, { fly = true } = {}) {
  if (!story?.active()) commitView();
  state.ward = ward;
  state.selected = null;
  pushExplore();
  renderMapLevel();
  if (fly) ward ? Atlas.showWard(ward) : Atlas.showCity();
  syncControls();
}

// Fingerprint state: a patch object, or a function of the current state that returns one.
function setFp(patch, hash) {
  Object.assign(state.fp, typeof patch === 'function' ? patch(state.fp) : patch);
  if (!story?.active()) {
    if (hash && location.hash !== hash) history.replaceState(history.state, '', hash);
    else if (state.fp.a && state.depth === 'compare') history.replaceState(history.state, '', `#/compare/${state.fp.a}`);
  }
  if (state.depth === 'compare') renderFingerprint(context(), M, state.fp);
}

function setPeriod(v) {
  const input = document.querySelector(`input[name="period"][value="${v}"]`);
  if (input && !input.checked) { input.checked = true; input.dispatchEvent(new Event('change')); }
}

function findBuilding(text) {
  const v = text.trim().toUpperCase();
  if (!v) return null;
  const latest = M.byPeriod[state.period].latest;
  return latest.find((d) => d.address.toUpperCase() === v) || latest.find((d) => d.address.toUpperCase().startsWith(v)) || latest.find((d) => d.address.toUpperCase().includes(v));
}

// Re-render whatever is showing (theme change, period change, story state).
function render(after) {
  if (!M) return;
  tip.hide();
  if (state.depth === 'map') { renderMapLevel(); if (after) requestAnimationFrame(after); }
  else openDepth(state.depth, state.page, after);
}

// Form controls always mirror the state (the story changes state without the reader touching them).
function syncControls() {
  const check = (name, v) => document.querySelectorAll(`input[name="${name}"]`).forEach((i) => (i.checked = i.value === String(v ?? '')));
  check('period', state.period);
  check('map-show', state.mapShow);
  check('item-group', state.problems.group);
  check('change-start', state.changes.start);
  check('movers-n', state.movers.n);
  check('lens', state.lens);
  $('ward').value = state.ward;
}

function renderMetaNotes() {
  const pm = M.byPeriod[state.period];
  $('period-note').innerHTML = `Evaluations from ${formatDate(pm.dates[0])} to ${formatDate(pm.dates[1])}.`;
  const ex = (e) => M.byPeriod[e].excluded;
  $('data-note').innerHTML = `City of Toronto Open Data,
    <a href="https://open.toronto.ca/dataset/apartment-building-evaluation/" target="_blank" rel="noopener">Apartment Building Evaluations</a>
    (pre-2023 and 2023–current files, ${fmt.n(M.data.records.length)} evaluations in total).
    ${fmt.n(ex('pre').flagged + ex('cur').flagged)} records flagged in the data as created in error, empty of ratings, or duplicated were left out,
    along with ${fmt.n(ex('pre').noScore + ex('cur').noScore)} with no score. Nothing else was removed or changed. Buildings are matched by their City registration number (RSN).
    Building shapes: City of Toronto <a href="https://open.toronto.ca/dataset/3d-massing/" target="_blank" rel="noopener">3D Massing</a>; ward boundaries: <a href="https://open.toronto.ca/dataset/city-wards/" target="_blank" rel="noopener">City Wards</a>; streets and shoreline: <a href="https://open.toronto.ca/dataset/toronto-centreline-tcl/" target="_blank" rel="noopener">Toronto Centreline</a>. All under the Open Government Licence – Toronto.`;
}

// Search covers every evaluated building: the chosen system first, then buildings only in the other one.
let searchSource = [];
function fillSearch() {
  const pm = M.byPeriod[state.period], other = M.byPeriod[state.period === 'cur' ? 'pre' : 'cur'];
  searchSource = [...pm.latest, ...other.latest.filter((r) => !pm.latestByRsn.has(r.rsn))];
}

function wireControls() {
  const radios = (name, fn) => document.querySelectorAll(`input[name="${name}"]`).forEach((i) => i.addEventListener('change', () => fn(i.value)));
  radios('period', (v) => {
    state.period = v;
    state.xray.evalUid = null; // the X-Ray follows the scoring system unless a point is picked again
    fillSearch(); renderMetaNotes();
    if (!story?.active()) commitView();
    render();
  });
  radios('map-show', (v) => { state.mapShow = v; if (!story?.active()) commitView(); render(); });
  radios('item-group', (v) => { state.problems.group = v; state.problems.showAll = false; renderLens(context()); });
  radios('change-start', (v) => { state.changes.start = v; renderLens(context()); });
  radios('movers-n', (v) => { state.movers.n = +v; renderLens(context()); });
  $('problem-more').addEventListener('click', () => { state.problems.showAll = !state.problems.showAll; renderLens(context()); });
  $('lens-close').addEventListener('click', () => {
    setLens(null);
    (story?.active() ? document.querySelector('#story-panel [data-act=detail]') : $('lens-btn'))?.focus();
  });

  $('ward').innerHTML += M.wards.map((w) => `<option value="${w.ward}">${+w.ward} · ${esc(w.name)}</option>`).join('');
  $('ward').addEventListener('change', (e) => toMap(() => setWard(e.target.value)));

  search = initSearch($('search'), $('search-list'), {
    source: () => searchSource,
    describe: (r) => `${esc(r.wardName)} · ${r.era === state.period ? `score ${r.score}` : `evaluated ${r.date.slice(0, 4)}, other scoring system`}`,
    // In the X-Ray, another address opens its X-Ray; everywhere else it is selected on the map.
    onPick: (r) => {
      if (state.depth === 'xray' && !story?.active()) { navigate(`#/xray/${r.rsn}`); return; }
      toMap(() => select(r.rsn, { focus: true }));
    },
  });
  $('depth-back').addEventListener('click', backToMap);
}

// ---- shell: menus, keys, theme -------------------------------------------------------------------------------------------
const MENUS = [['lens-btn', 'lens-menu'], ['layers-btn', 'layers-panel']];
function closeMenus(except) {
  for (const [b, p] of MENUS) if (p !== except) { $(p).hidden = true; $(b).setAttribute('aria-expanded', 'false'); }
  $('atlas-nav').classList.remove('open');
  $('menu-button').setAttribute('aria-expanded', 'false');
  document.querySelectorAll('details.menu[open]').forEach((d) => (d.open = false));
}

let themeStale = false; // theme changed while the map was hidden

function wireShell() {
  for (const [b, p] of MENUS) {
    $(b).addEventListener('click', () => {
      const open = $(p).hidden;
      closeMenus(p);
      $(p).hidden = !open;
      $(b).setAttribute('aria-expanded', String(open));
      if (open) $(p).querySelector('input:checked, input, select, button')?.focus();
    });
  }
  $('menu-button').addEventListener('click', () => {
    const open = !$('atlas-nav').classList.contains('open');
    $('atlas-nav').classList.toggle('open', open);
    $('menu-button').setAttribute('aria-expanded', String(open));
  });
  $('atlas-nav').addEventListener('click', (e) => {
    const a = e.target.closest('a');
    if (!a) return;
    closeMenus();
    // "Explore" from a deeper level goes back to the map as it was.
    if (a.dataset.route === 'explore' && state.depth !== 'map' && !story?.active()) { e.preventDefault(); backToMap(); }
  });
  // close pop-up panels on an outside click
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.pop-panel, .tool, .info-btn, .popover')) for (const [b, p] of MENUS) if (!$(p).hidden) { $(p).hidden = true; $(b).setAttribute('aria-expanded', 'false'); }
    document.querySelectorAll('details.menu[open]').forEach((d) => { if (!d.contains(e.target) || e.target.closest('.menu-item')) d.open = false; });
  });
  // Escape: close the innermost thing first (menu → panel → selection → ward), never moving the map.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.defaultPrevented || state.layer !== 'work') return;
    const d = document.querySelector('details.menu[open]');
    if (d) { d.open = false; d.querySelector('summary').focus(); e.preventDefault(); return; }
    for (const [b, p] of MENUS) if (!$(p).hidden) { $(p).hidden = true; $(b).setAttribute('aria-expanded', 'false'); $(b).focus(); e.preventDefault(); return; }
    if (state.depth !== 'map' || story?.active() || e.target.closest('input, select, textarea, .popover')) return;
    if (state.selected) { select(null); e.preventDefault(); }
    else if (state.ward) { setWard('', { fly: false }); e.preventDefault(); }
  });

  // Theme toggle: one visible button in the homepage header and one in the atlas bar, kept in sync.
  // Its label names the mode it switches TO. Remembered per browser; works if storage is blocked.
  const toggles = [...document.querySelectorAll('[data-theme-toggle]')];
  const isDark = () => (document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches);
  const applyTheme = (t) => {
    if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
    const dark = isDark();
    for (const b of toggles) {
      b.dataset.mode = dark ? 'dark' : 'light';
      b.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
      b.title = dark ? 'Switch to light mode' : 'Switch to dark mode';
      b.querySelector('.tt-label').textContent = dark ? 'Light' : 'Dark';
    }
    document.dispatchEvent(new CustomEvent('themechange'));
  };
  let saved = null;
  try { saved = localStorage.getItem('lease-lens-theme'); } catch { /* storage unavailable */ }
  applyTheme(saved);
  // The map can only be redrawn while it is on screen; a toggle on the homepage waits until it is.
  const restyle = () => {
    if (document.body.dataset.layer !== 'work') { themeStale = true; return; }
    themeStale = false; Atlas.restyle(); render();
  };
  for (const b of toggles) b.addEventListener('click', () => {
    const next = isDark() ? 'light' : 'dark';
    try { localStorage.setItem('lease-lens-theme', next); } catch { /* ignore */ }
    applyTheme(next);
    restyle();
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { applyTheme(document.documentElement.dataset.theme); restyle(); });

  // Entering from the homepage: a short crossfade where the browser supports it. The hero drawing and the
  // map share a transition name, so the drawing settles into the map's box (a shared box, not a camera
  // move: the two use different projections).
  document.addEventListener('click', (e) => {
    // From the homepage (its links or the shared header), the map opens with the drawing settling into it.
    const a = e.target.closest('#home a[href^="#/"]') ?? (state.layer === 'home' ? e.target.closest('.site-bar a[href^="#/"]:not(.wordmark)') : null);
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    enterWorkspace(a.getAttribute('href'));
  });
}

export function enterWorkspace(hash) {
  const swap = () => { history.pushState(null, '', hash); onRoute(); };
  if (!document.startViewTransition || reducedMotion()) { swap(); return; }
  document.documentElement.classList.add('vt-enter');
  const t = document.startViewTransition(swap);
  t.finished.finally(() => document.documentElement.classList.remove('vt-enter'));
}

// The map resizes with its box; the open analysis layer redraws for its new width.
function watchResize() {
  let t, last = '';
  new ResizeObserver(() => {
    clearTimeout(t);
    t = setTimeout(() => {
      Atlas.invalidate();
      const s = `${$('stage').clientWidth}x${$('stage').clientHeight}`;
      if (s === last || $('app').hidden) return;
      last = s;
      if (state.depth === 'map' && state.lens) renderLens(context());
      else if (state.depth === 'xray' || state.depth === 'compare') render();
    }, 150);
  }).observe($('stage'));
}

// ---- the interface the story controller uses ----------------------------------------------------------------------------------
const app = {
  get M() { return M; },
  state,
  highlight: null,
  navigate,
  render,
  syncControls,
  setWard: (w) => setWard(w),
  // One chapter: which level it happens at, how the map is framed and what runs after it is drawn.
  // Each call supersedes the previous one: work still pending from an earlier chapter (a flight that
  // was to end in the X-Ray, a chart waiting to draw) is dropped, so fast Next/Back never stacks up.
  //   via: travel through the map first (fly to the building), then go down into its level from there.
  present({ depth, mapTo, via, after }) {
    const seq = ++presentSeq;
    const live = () => seq === presentSeq && story?.active();
    const done = after && (() => { if (live()) after(); });
    const frame = (to) => Atlas.wardsLoaded().then(() => {
      if (!live() || !to) return;
      if (to.kind === 'city') Atlas.showCity();
      if (to.kind === 'ward') Atlas.showWard(to.ward, { city: !!to.city });
      if (to.kind === 'building') { const r = recOf(to.rsn); if (r) Atlas.showBuilding(r); }
    });
    if (depth === 'map') {
      closeDepth();
      renderMapLevel();
      frame(mapTo);
      if (done) setTimeout(done, reducedMotion() ? 80 : 900);
      return;
    }
    if (via && state.depth !== depth && !reducedMotion()) {
      closeDepth();
      renderMapLevel();
      frame(via);
      setTimeout(() => {
        if (!live()) return;
        const run = () => openDepth(depth, null, done);
        if (!document.startViewTransition) run();
        else { document.documentElement.classList.add('vt-depth'); document.startViewTransition(run).finished.finally(() => document.documentElement.classList.remove('vt-depth')); }
      }, 1150);
      return;
    }
    openDepth(depth, null, done);
  },
  // The one detail view a chapter offers (an analysis layer), opened only on request.
  openDetail(id) { setLens(id); if (id) requestAnimationFrame(() => $('lens-title')?.focus({ preventScroll: true })); },
  inspect: (rsn, uid) => { state.xray.evalUid = uid ?? null; navigate(`#/xray/${rsn}`); },
};

(async function main() {
  initInfoPopovers();
  wireShell();
  initHome({ onPick: (r) => enterWorkspace(`#/explore?b=${r.rsn}`) });
  window.addEventListener('hashchange', routeIfChanged);
  window.addEventListener('popstate', routeIfChanged);
  onRoute(); // the homepage never waits for the inspection data

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
  story = createStory(app);
  wireControls();
  fillSearch();
  renderMetaNotes();
  watchResize();
  document.body.dataset.ready = '1';
  if (state.layer === 'work') onRoute();
})();
