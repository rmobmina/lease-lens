// Building X-Ray view: one building's inspection, laid out by category on a 3D model of THAT building.
// The exterior comes from the City of Toronto 3D Massing data matched to the address
// (data/massing/<shard>.json, built by scripts/build_massing.py); the interior is illustrative.
// This file handles the page: which inspection to show, the category list, the detail panel,
// provenance, the 2D fallback (no WebGL only), and loading the 3D scene on demand.
// The scene is ../xray/scene.js (Three.js, lazy-loaded); data work is ../xray-model.js.

import { itemLabel, itemProblemRates } from '../model.js';
import { XRAY_ZONES, STATUS, CONCENTRATED, zoneByKey, zoneProfile, buildingEvaluations, timelinePoints, trendSummary, ratingClass } from '../xray-model.js';
import { pct, fmt, esc, titleCase, formatDate, cssVar, signed } from '../ui.js';
import { renderTimeline } from './xray-timeline.js';
import { renderCompare } from './xray-compare.js';

const $ = (id) => document.getElementById(id);
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const SHARDS = 64;                // must match scripts/build_massing.py
const LIST_ORDER = ['exterior', 'shared', 'systems', 'grounds', 'records']; // the façade, the rooms top to bottom, the records sheet
const MODES = ['exterior', 'cutaway', 'focus'];
// Focus with nothing chosen opens the category that needs the most attention (ties: list order)
const STATUS_RANK = { high: 3, some: 2, ok: 1, none: 0 };

let scene3d = null;               // { api, loading, failed }
let wired = false;
let lastCtx = null;
const cityRates = new Map();      // era -> Map(col -> citywide share rated poorly)
const shardCache = new Map();     // shard number -> Promise<{rsn: entry}>
const massing = new Map();        // rsn -> entry (or a fallback entry when loading failed)

// Shared with the map, which draws the same footprint for the selected building.
export function loadMassing(rsn) {
  const k = Number(rsn) % SHARDS;
  if (!shardCache.has(k)) {
    shardCache.set(k, fetch(`data/massing/${k}.json`).then((r) => { if (!r.ok) throw new Error(`massing shard ${k}: ${r.status}`); return r.json(); })
      .catch((e) => { shardCache.delete(k); throw e; }));
  }
  return shardCache.get(k).then((d) => d[rsn] ?? null);
}

// The page is animating into the X-Ray for the next `ms`: hold the heavy 3D work until then.
let stageHoldUntil = 0;
export function holdStage(ms) { stageHoldUntil = performance.now() + ms; }

export function disposeXray() {
  if (scene3d?.api) scene3d.api.dispose();
  scene3d = null;
  const stage = $('xr-stage');
  if (stage) stage.querySelectorAll('.xr-canvas, .xr-labels').forEach((n) => n.remove());
}

export function renderXray(ctx, M, xs) {
  lastCtx = { ctx, M, xs };
  wire();
  const { pm } = ctx;
  const rsn = ctx.selected;
  const all = rsn ? buildingEvaluations(M.data.byRsn.get(rsn) ?? []) : [];
  const empty = $('xr-empty'), main = $('xr-main');
  if (!all.length) {
    main.hidden = true; empty.hidden = false;
    document.body.classList.remove('xr-has-building');
    $('xr-empty-note').textContent = rsn ? 'This building has no usable evaluation in either scoring system.' : '';
    renderSuggestions(ctx, M);
    disposeXray();
    return;
  }
  empty.hidden = true; main.hidden = false;
  document.body.classList.add('xr-has-building');
  if (location.hash.startsWith("#/xray") && location.hash !== `#/xray/${rsn}`) history.replaceState(null, '', `#/xray/${rsn}`);

  // A new building resets the inspection being shown, the comparison and the history selection. Older
  // states (X-Ray / Exploded views) open as the cutaway; the retired "How it works" tab opens the methodology.
  if (xs.rsn !== rsn) Object.assign(xs, { rsn, evalUid: null, matchRsn: null, tab: 'model', items: false, cmpZone: null, tlPick: null });
  if (xs.tab === 'method') { xs.tab = 'model'; requestAnimationFrame(openMethod); }
  if (!MODES.includes(xs.mode)) xs.mode = xs.mode ? 'cutaway' : 'exterior';
  if (xs.mode === 'focus' && !xs.zone) xs.mode = 'cutaway';
  if (!xs.zone) xs.items = false;
  const latestInPeriod = pm.latestByRsn.get(rsn);
  const rec = all.find((r) => r.uid === xs.evalUid) ?? latestInPeriod ?? all.at(-1);
  const isDefault = rec === (latestInPeriod ?? all.at(-1));
  const profile = zoneProfile(rec, M.data.cats[rec.era]);
  const points = timelinePoints(all);
  const prevSame = points.find((p) => p.rec === rec)?.prev ?? null;

  renderHead(rec, pm, isDefault, latestInPeriod, all);
  renderZoneList(profile, xs);
  renderPanel(profile, xs, M, prevSame);
  renderFinding(profile, xs);
  renderLegend();
  const entry = massing.get(rsn);
  if (!entry) {
    loadMassing(rsn)
      .then((e) => massing.set(rsn, e ?? { rsn, storeys: rec.storeys, units: rec.units, provenance: 'unavailable', match: { note: 'This building is not in the geometry file.' } }))
      .catch((err) => { console.warn(err); massing.set(rsn, { rsn, storeys: rec.storeys, units: rec.units, provenance: 'approximate', match: { note: 'The building geometry could not be loaded.' }, loadFailed: true }); })
      .then(() => { if (lastCtx?.xs.rsn === rsn) rerender(); });
  }
  renderProvenance(entry, rec);
  renderBar(rec);
  // One view at a time (tabs), each fitted to the window. Only the visible one is drawn, so its charts
  // measure their real size; the guided story always shows the model.
  if (!TABS.includes(xs.tab) || document.body.classList.contains('is-story')) xs.tab = 'model';
  showTab(xs.tab);
  if (xs.tab === 'model') renderStage(profile, xs, entry);
  else disposeXray();
  if (xs.tab === 'history') renderHistory(points, rec, pm, M, xs);
  if (xs.tab === 'compare') renderCompare($('xr-compare'), {
    rec: latestInPeriod, pm, ctx, M, matchRsn: xs.matchRsn, zone: xs.cmpZone,
    onChoose: (r) => { xs.matchRsn = r; rerender(); },
    onZone: (z) => { xs.cmpZone = z; },
    onOpen: (r) => ctx.select(r, { open: true }),
  });
}

const TABS = ['model', 'compare', 'history'];
const PANE = { model: 'xr-pane-model', compare: 'xr-pane-compare', history: 'xr-history' };
let shownTab = null, paneAnim = null;
function showTab(tab) {
  for (const t of TABS) {
    const b = document.querySelector(`[data-xr-tab="${t}"]`);
    b.setAttribute('aria-selected', String(t === tab));
    b.tabIndex = t === tab ? 0 : -1;
    $(PANE[t]).hidden = t !== tab;
  }
  // Switching views crossfades the new one in place: the panes share one fixed area, so nothing jumps.
  if (shownTab && shownTab !== tab && !reducedMotion()) {
    paneAnim?.cancel();
    paneAnim = $(PANE[tab]).animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)' });
  }
  shownTab = tab;
}
function setTab(tab, { focus = false } = {}) {
  if (!lastCtx) return;
  lastCtx.xs.tab = tab;
  rerender();
  if (focus) document.querySelector(`[data-xr-tab="${tab}"]`)?.focus();
}

function rerender() { if (lastCtx) renderXray(lastCtx.ctx, lastCtx.M, lastCtx.xs); }

// ---- header: address, the facts that matter, the score and when it was given -------------------------
function renderHead(rec, pm, isDefault, latestInPeriod, all) {
  $('xr-title').textContent = titleCase(rec.address);
  $('xr-meta').innerHTML = [
    `<span title="Ward ${+rec.ward}">${esc(rec.wardName)}</span>`,
    rec.yearBuilt ? `Built ${rec.yearBuilt}` : 'Year built not recorded',
    rec.storeys ? `${rec.storeys} storeys` : null,
    rec.units ? `${rec.units} units` : null,
  ].filter(Boolean).join('<span class="bx-dot" aria-hidden="true"> · </span>');
  $('xr-score').innerHTML = `<p class="bx-score-line"><span class="visually-hidden">RentSafeTO score </span><span class="bx-score-num">${rec.score}</span><span class="bx-score-of">/ 100</span></p>
    <p class="bx-score-date">Inspected ${formatDate(rec.date)}</p>`;
  // Only what needs saying: an earlier inspection is open, or the shown one is from the other scoring system.
  const notes = [];
  if (!isDefault) notes.push(`<span>Earlier inspection (${all.indexOf(rec) + 1} of ${all.length}).</span> <button type="button" class="link-btn" id="xr-back-latest">Back to the ${latestInPeriod ? 'latest' : 'most recent'} inspection</button>`);
  else if (!latestInPeriod) notes.push(`<span>No evaluation in the ${esc(pm.P.long)}; showing the most recent from the other system.</span>`);
  if (rec.era !== pm.era && latestInPeriod) notes.push(`<span>This inspection uses the ${rec.era === 'cur' ? '2023 – now' : '2017 – 2023'} scoring system.</span>`);
  const note = $('xr-showing');
  note.innerHTML = notes.join(' ');
  note.hidden = !notes.length;
  $('xr-back-latest')?.addEventListener('click', () => { lastCtx.xs.evalUid = null; rerender(); });
}

// ---- inspection explorer: the overall finding, then one row per category -------------------------------
// The list is the keyboard and screen-reader way to choose a category. The chosen row opens in place to show
// what inspectors found; its item-by-item ratings are one step further, on demand.
const countWords = (z) => (z.status === 'none' ? (z.items.length ? 'Not evaluated (all N/A)' : 'Not in this scoring system') : `${z.poor} of ${z.applicable} rated poorly`);
const statusWords = (z) => (z.status === 'none' ? (z.items.length ? 'all items N/A' : 'no items in this scoring system') : z.poor ? `${z.poor} of ${z.applicable} rated poorly` : `None of ${z.applicable} rated poorly`);

// One short finding for a category: what was rated poorly, by name. Never repeats the share.
function zoneFinding(z, era) {
  if (z.status === 'none') return z.items.length ? 'Every item was marked N/A or left blank in this inspection. Missing data is not a pass.'
    : `The ${era === 'pre' ? '2017 – 2023' : '2023 – now'} scoring system has no items in this category. Missing data is not a pass.`;
  const poor = z.items.filter((i) => i.poor).sort((a, b) => a.rating - b.rating).map((i) => esc(itemLabel(i.col)));
  if (!poor.length) return `${esc(STATUS.ok.label)}: every applicable item was rated above the poor range.`;
  const more = poor.length > 2 ? ` and ${poor.length - 2} more` : '';
  return `${esc(STATUS[z.status].label)}. Rated poorly: ${poor.slice(0, 2).join(', ')}${more}.`;
}

function overallFinding(profile) {
  const worst = [...profile.zones].filter((d) => d.poor).sort((a, b) => b.poor - a.poor || (b.share ?? 0) - (a.share ?? 0))[0];
  return {
    head: profile.poor ? `${profile.poor} of ${profile.applicable} items rated poorly` : `None of ${profile.applicable} items rated poorly`,
    sub: worst ? `${worst.poor === profile.poor ? 'All' : 'Most'} in ${esc(zoneByKey.get(worst.key).label.toLowerCase())}` : 'Every applicable item rated above the poor range',
  };
}

function renderZoneList(profile, xs) {
  const box = $('xr-zones');
  const byKey = new Map(profile.zones.map((z) => [z.key, z]));
  const f = overallFinding(profile);
  box.innerHTML = `<div class="bx-side-head">
      <h2 class="bx-eyebrow" id="xr-zones-label">Inspection findings <button type="button" class="info-btn" data-info="xray-ratings" aria-label="How poor ratings are counted">i</button></h2>
      <p class="bx-side-finding">${f.head}</p>
      <p class="bx-side-sub">${f.sub}</p>
    </div>
    <ul class="xr-zone-list" aria-labelledby="xr-zones-label">${LIST_ORDER.map((k) => {
      const z = byKey.get(k), meta = zoneByKey.get(k), sel = xs.zone === k;
      return `<li class="xr-zone-row${sel ? ' is-selected' : ''}">
        <button type="button" class="xr-zone" data-zone="${k}" data-status="${z.status}" aria-expanded="${sel}" aria-controls="xr-zone-more-${k}">
          <span class="xr-swatch s-${z.status}" aria-hidden="true"></span>
          <span class="xr-zone-text"><b>${esc(meta.label)}</b><small><span class="visually-hidden">${esc(STATUS[z.status].label)}: </span>${countWords(z)}</small></span>
          <span class="xr-zone-pct">${z.share == null ? '—' : pct(z.share)}</span></button>
        <div class="xr-zone-more" id="xr-zone-more-${k}"${sel ? '' : ' hidden'}>
          ${sel ? `<p>${zoneFinding(z, profile.rec.era)}</p>
          ${z.items.length ? `<button type="button" class="link-btn xr-items-open">View all ${z.items.length} item${z.items.length === 1 ? '' : 's'} <span aria-hidden="true">→</span></button>` : ''}` : ''}
        </div></li>`;
    }).join('')}</ul>`;
  const buttons = [...box.querySelectorAll('.xr-zone')];
  buttons.forEach((b, i) => {
    b.addEventListener('click', () => selectZone(xs.zone === b.dataset.zone ? null : b.dataset.zone));
    b.addEventListener('mouseenter', () => scene3d?.api?.hover(b.dataset.zone));
    b.addEventListener('mouseleave', () => scene3d?.api?.hover(null));
    b.addEventListener('focus', () => scene3d?.api?.hover(b.dataset.zone));
    b.addEventListener('blur', () => scene3d?.api?.hover(null));
    b.addEventListener('keydown', (e) => {
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
      e.preventDefault();
      const j = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (i + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[j].focus();
    });
  });
  box.querySelector('.xr-items-open')?.addEventListener('click', () => showItems(true));
}

// The item list replaces the category list in the side panel (and back), moving focus with it.
function showItems(on) {
  if (!lastCtx) return;
  const xs = lastCtx.xs;
  xs.items = on && !!xs.zone;
  const zone = xs.zone;
  rerender();
  requestAnimationFrame(() => {
    if (xs.items) $('xr-panel').querySelector('.xr-panel-title')?.focus({ preventScroll: true });
    else document.querySelector(`.xr-zone[data-zone="${zone}"]`)?.focus({ preventScroll: true });
  });
}

// One entry point for the list, the labels and the model: choosing a category opens its Focus view;
// clearing it returns to the whole building with the cutaway open.
function selectZone(zone) {
  if (!lastCtx) return;
  const xs = lastCtx.xs;
  const refocus = document.activeElement?.closest?.('.xr-zone') ? document.activeElement.dataset.zone : null;
  xs.zone = zone;
  xs.items = false;
  if (zone) xs.mode = 'focus';
  else if (xs.mode === 'focus') xs.mode = 'cutaway';
  rerender();
  // the list is re-drawn: keep keyboard focus on the row that was used
  if (refocus) document.querySelector(`.xr-zone[data-zone="${refocus}"]`)?.focus({ preventScroll: true });
}

// The finding announced to screen readers when the category in focus changes.
function renderFinding(profile, xs) {
  const z = xs.zone && profile.zones.find((d) => d.key === xs.zone);
  const label = (k) => zoneByKey.get(k).label;
  let text;
  if (z) {
    text = z.status === 'none' ? `<b>${esc(label(z.key))}:</b> not evaluated in this inspection.`
      : `<b>${esc(label(z.key))}:</b> ${z.poor ? `${z.poor} of ${z.applicable} applicable items rated poorly (${pct(z.share)})` : `none of ${z.applicable} applicable items rated poorly`}.`;
  } else {
    const f = overallFinding(profile);
    text = `${f.head}. ${f.sub}.`;
  }
  $('xr-finding').innerHTML = text;
}

function defaultFocus(profile) {
  return [...profile.zones].sort((a, b) => STATUS_RANK[b.status] - STATUS_RANK[a.status] || (b.share ?? 0) - (a.share ?? 0) || LIST_ORDER.indexOf(a.key) - LIST_ORDER.indexOf(b.key))[0]?.key ?? 'shared';
}

// ---- detail panel ---------------------------------------------------------------------------
function ratesFor(M, era) {
  if (!cityRates.has(era)) {
    const pm = M.byPeriod[era];
    cityRates.set(era, new Map(itemProblemRates(pm.latest, pm).map((d) => [d.col, d])));
  }
  return cityRates.get(era);
}

function pips(rating, S) {
  // one pip per point on the scale: "1 of 3" fills one of three, a 0 fills none
  let out = '';
  for (let i = 1; i <= S.max; i++) out += `<span class="pip${rating != null && i <= rating ? ' on' : ''}"></span>`;
  return `<span class="pips r-${ratingClass(rating, S)}" aria-hidden="true">${out}</span>`;
}

function renderPanel(profile, xs, M, prevSame) {
  const box = $('xr-panel');
  const S = profile.scale, rec = profile.rec;
  $('xr-side').dataset.view = xs.items && xs.zone ? 'items' : 'list';
  const z = xs.zone && profile.zones.find((d) => d.key === xs.zone);
  if (!z) {
    box.innerHTML = profile.unmapped.length ? `<p class="xr-warn">${profile.unmapped.length} item(s) in this file have no category yet: ${profile.unmapped.map(esc).join(', ')}.</p>` : '';
    return;
  }
  const meta = zoneByKey.get(z.key);
  const rates = ratesFor(M, rec.era);
  const rated = z.items.filter((i) => i.status === 'rated').sort((a, b) => a.rating - b.rating || itemLabel(a.col).localeCompare(itemLabel(b.col)));
  const na = z.items.filter((i) => i.status === 'na'), blank = z.items.filter((i) => i.status === 'blank');
  const item = (i) => {
    const city = rates.get(i.col);
    const before = prevSame?.ratings[i.col];
    const beforeTxt = !prevSame ? 'No earlier inspection in this scoring system.'
      : before == null ? `Not rated (${prevSame.naCats.includes(i.col) ? 'N/A' : 'blank'}) on ${formatDate(prevSame.date)}.`
        : `Rated ${before} of ${S.max} on ${formatDate(prevSame.date)}.`;
    return `<li class="xr-item${i.poor ? ' is-poor' : ''}"><details>
      <summary><span class="xr-item-name">${esc(itemLabel(i.col))}</span>
        <span class="xr-item-rating">${pips(i.rating, S)}<span class="xr-item-num">${i.rating} of ${S.max}</span>${i.poor ? '<span class="xr-tag">poor</span>' : ''}</span></summary>
      <dl class="xr-item-more">
        <dt>City item name</dt><dd>${esc(LL.prettyCat(i.col))}</dd>
        <dt>Rating</dt><dd>${i.rating} on the ${S.min}–${S.max} scale${i.rating === S.max ? ' (top mark)' : ''}</dd>
        <dt>Previous inspection</dt><dd>${beforeTxt}</dd>
        ${city ? `<dt>Across Toronto</dt><dd>${pct(city.share, 1)} of ${fmt.n(city.rated)} buildings had this item rated poorly in their latest ${rec.era === 'cur' ? '2023 – now' : '2017 – 2023'} evaluation.</dd>` : ''}
      </dl></details></li>`;
  };
  box.innerHTML = `<div class="bx-panel-head">
      <button type="button" class="link-btn bx-back-link" id="xr-items-back"><span aria-hidden="true">←</span> All categories</button>
      <h2 class="xr-panel-title" tabindex="-1"><span class="xr-swatch s-${z.status}" aria-hidden="true"></span>${esc(meta.label)}</h2>
      <p class="bx-side-sub">${countWords(z)} · inspected ${formatDate(rec.date)}</p>
      <p class="xr-panel-note">${esc(meta.note)} <span class="muted">On the model: ${esc(PLACE[z.key])}.</span></p>
    </div>
    ${z.status === 'none' ? `<p class="card-text">${zoneFinding(z, rec.era)}</p>` : ''}
    ${rated.length ? `<ul class="xr-items" aria-label="Items rated in ${esc(meta.label)}">${rated.map(item).join('')}</ul>` : ''}
    ${na.length ? `<p class="card-sub">Not applicable (N/A)</p><p class="xr-na">${na.map((i) => esc(itemLabel(i.col))).join(' · ')}</p>` : ''}
    ${blank.length ? `<p class="card-sub">Not recorded (blank)</p><p class="xr-na">${blank.map((i) => esc(itemLabel(i.col))).join(' · ')}</p>` : ''}
    <p class="xr-scale">Rated ${S.min}–${S.max}, where ${S.max} is the top mark; ${esc(S.text.replace(' on the', ' (on the').replace(' scale', ' scale)'))} counts as rated poorly.</p>`;
  $('xr-items-back').addEventListener('click', () => showItems(false));
}

// where each category appears in the cutaway model (illustrative spaces, not real locations)
const PLACE = {
  exterior: 'the whole façade and roof, outlined in blue',
  shared: 'an illustrative corridor with unit doors and a stair',
  systems: 'an illustrative services room: elevator shaft, air handling, electrical panels and pipes',
  grounds: 'illustrative ground-level parking and a waste room',
  records: 'an abstract inspection sheet beside the building, one tile per record item; paperwork has no place in the building',
};

// ---- legend: one compact key for the model's colours --------------------------------------------------
const LEGEND = { ok: 'None', some: 'Some', high: 'Concentrated', none: 'Not evaluated' };
function renderLegend() {
  $('xr-legend').innerHTML = `<span class="xr-legend-lead">Poor ratings</span>` + ['ok', 'some', 'high', 'none'].map((k) =>
    `<span class="key"><span class="xr-swatch s-${k}" aria-hidden="true"></span>${LEGEND[k]}<span class="visually-hidden"> (${STATUS[k].label})</span></span>`).join('');
}

// ---- top bar (shown in the guided story, where the page header is hidden) + provenance ------------------
function renderBar(rec) {
  $('xr-bar-title').textContent = titleCase(rec.address);
  $('xr-bar-meta').innerHTML = `<span class="xr-bar-score"><b>${rec.score}</b>/100</span><span>${formatDate(rec.date)}</span>`;
}

export const PROVENANCE = {
  massing: { label: 'Actual 3D massing', short: 'City 3D massing' },
  footprint: { label: 'Actual footprint, estimated height', short: 'Footprint + estimated height' },
  approximate: { label: 'Approximate model', short: 'Approximate' },
  unavailable: { label: 'Building geometry unavailable', short: 'No geometry' },
};

function renderProvenance(entry, rec) {
  const box = $('xr-prov');
  if (!entry) { box.innerHTML = '<span class="muted">Loading building geometry…</span>'; return; }
  const p = PROVENANCE[entry.provenance] ?? PROVENANCE.approximate;
  const m = entry.match ?? {};
  let detail;
  if (entry.provenance === 'massing' || entry.provenance === 'footprint') {
    const parts = entry.masses?.length ?? 0;
    detail = `Footprint and height from the City of Toronto 3D Massing (2025), matched to the RentSafeTO address point
      (${m.method === 'contains' ? 'the point falls inside the footprint' : `nearest footprint, ${m.distance_m} m away`}).
      <b>${m.confidence === 'high' ? 'High' : 'Medium'} match confidence.</b>
      Height ${entry.height_m} m${rec.storeys ? ` for ${rec.storeys} registered storeys` : ''}${parts > 1 ? `, ${parts} building parts` : ''}.
      ${m.note ? `<span class="muted">${esc(m.note[0].toUpperCase() + m.note.slice(1))}.</span>` : ''}
      Windows and balconies are a generic pattern spaced by storey, not surveyed features.`;
  } else {
    detail = `${esc(m.note || 'No reliable geometry match.')} The grey hatched block is sized from the registered storeys${rec.units ? ' and units' : ''}; its shape and footprint are <b>not</b> this building's.`;
  }
  // The one visible clarification under the model; the match detail is one ⓘ away (and in the methodology).
  const short = entry.provenance === 'massing' ? 'Exterior massing is sourced; interior details are illustrative.'
    : entry.provenance === 'footprint' ? 'Footprint is sourced, height estimated; interior details are illustrative.'
    : 'Exterior is approximate, not this building’s real shape; interior details are illustrative.';
  $('xr-prov-detail').innerHTML = detail;
  box.innerHTML = `<span class="xr-prov-badge p-${entry.provenance}">${p.label}</span><span class="xr-prov-text">${short}</span>
    <button type="button" class="info-btn" data-info="xray-model" data-info-from="xr-prov-detail" aria-label="Is this the building’s actual interior? Geometry source and limits">i</button>`;
}

// ---- stage: 3D scene (lazy) or 2D diagram (only without WebGL) ---------------------------------------
function readPalette() {
  const c = cssVar;
  const names = ['facade', 'wallInside', 'glass', 'band', 'roof', 'roofEdge', 'parapet', 'penthouse', 'floor', 'slabEdge', 'concrete', 'partition', 'poche',
    'equipment', 'equipmentDark', 'cab', 'car', 'carGlass', 'paint', 'context', 'contextFaded', 'contextEdge', 'contextEdgeFaded', 'ground', 'plinth',
    'base', 'frame', 'door', 'pad', 'paving', 'asphalt', 'trunk', 'foliage',
    'room', 'roomEnd', 'roomFloor', 'trim', 'stair', 'metal', 'runner', 'unitDoor', 'light', 'panel', 'duct', 'pipe', 'bin', 'binAlt',
    'carBody', 'tire', 'board', 'cutLine', 'leader'];
  const kebab = (n) => n.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
  return {
    accent: c('--accent'), sky: c('--xr-sky'), ground: c('--xr-ground'), outline: c('--xr-outline'),
    overlay: { none: c('--xr-none'), ok: c('--xr-ov-ok'), some: c('--xr-some'), high: c('--xr-high') },
    rating: { p3: c('--fp-3'), p2: c('--fp-2'), p1: c('--fp-1'), p0: c('--fp-0'), na: c('--xr-none'), none: c('--xr-none') },
    mat: Object.fromEntries(names.map((n) => [n, c(`--xr-${kebab(n)}`)])),
  };
}

function zoneLabels(profile) {
  const out = {};
  for (const z of profile.zones) {
    const meta = zoneByKey.get(z.key);
    out[z.key] = {
      title: meta.short, name: meta.label, status: z.status,
      // words as well as colour: the status name travels with the count
      sub: { none: 'Not evaluated', ok: `None of ${z.applicable} poor`, some: `Some · ${z.poor} of ${z.applicable} poor`, high: `Concentrated · ${z.poor} of ${z.applicable} poor` }[z.status],
      summary: `${STATUS[z.status].label} · ${statusWords(z)}${z.share != null ? ` (${pct(z.share)})` : ''}`,
    };
  }
  return out;
}

function recordItems(profile) {
  const z = profile.zones.find((d) => d.key === 'records');
  return z.items.map((i) => ({ col: i.col, cls: i.status === 'rated' ? ratingClass(i.rating, profile.scale) : 'na' }));
}

function renderStage(profile, xs, entry) {
  const stage = $('xr-stage');
  const statuses = Object.fromEntries(profile.zones.map((z) => [z.key, z.status]));
  const can3d = webgl();
  const use3d = can3d && !scene3d?.failed;
  $('xr-mode').hidden = !use3d;
  $('xr-stage-card').classList.toggle('is-2d', !use3d);
  $('xr-cam').hidden = !use3d;
  $('xr-focus').disabled = !xs.zone;
  $('xr-all').disabled = !xs.zone;
  $('xr-focus').textContent = xs.zone ? `Frame ${zoneByKey.get(xs.zone).short.toLowerCase()}` : 'Frame category';
  $('xr-stage-card').dataset.mode = xs.mode;
  document.querySelectorAll('input[name="xr-mode"]').forEach((i) => (i.checked = i.value === xs.mode));

  if (!use3d) {
    if (scene3d?.api) disposeXray();
    const why = !can3d ? 'WebGL isn’t available in this browser, so the X-Ray is shown as a flat diagram.'
      : 'The 3D model couldn’t load, so the X-Ray is shown as a flat diagram.';
    drawDiagram(stage, profile, xs, why);
    return;
  }
  stage.querySelector('.xr-diagram')?.remove();

  if (!scene3d) {
    scene3d = { api: null, loading: true, failed: false, key: null, recKey: null };
    const status = document.createElement('p');
    status.className = 'xr-loading';
    status.textContent = 'Loading the 3D model…';
    stage.append(status);
    // Building the scene blocks the page for a moment, so it waits until an opening animation is done.
    const settled = (v) => new Promise((res) => setTimeout(() => res(v), Math.max(0, stageHoldUntil - performance.now())));
    import('../xray/scene.js').then(settled).then((mod) => {
      status.remove();
      if (!scene3d || !document.body.contains(stage)) return; // left the view while loading
      scene3d.api = mod.createXrayScene(stage, {
        palette: readPalette(),
        reducedMotion,
        onSelect: (zone) => selectZone(zone),
        onHover: (zone) => document.querySelectorAll('.xr-zone').forEach((b) => b.classList.toggle('is-hover', b.dataset.zone === zone)),
        onContextLost: () => { disposeXray(); scene3d = { failed: true }; rerender(); },
      });
      scene3d.loading = false;
      rerender();
    }).catch((err) => {
      console.error(err);
      status.remove();
      scene3d = { api: null, loading: false, failed: true };
      rerender();
    });
    return;
  }
  const api = scene3d.api;
  if (!api) return;
  stage.classList.toggle('is-waiting', !entry);
  if (!entry) return;                      // geometry still loading; renderXray re-runs when it arrives
  api.setPalette(readPalette());
  api.setStatuses(statuses);
  api.setLabels(zoneLabels(profile));
  if (scene3d.key !== entry) {
    scene3d.key = entry;
    scene3d.recKey = null;
    try { api.setBuilding(entry); } catch (err) {
      // never leave a blank stage: fall back to the 2D diagram
      console.error(err);
      disposeXray();
      scene3d = { failed: true };
      rerender();
      return;
    }
  }
  const items = recordItems(profile);
  const rk = items.map((i) => i.cls).join();
  if (scene3d.recKey !== rk) { scene3d.recKey = rk; api.setRecords(items); }
  api.setSelected(xs.zone);
  api.setMode(xs.mode);
}

let webglCache = null;
// Warm-up while the page is idle: the WebGL check and the 3D code, so opening an X-Ray never stalls on them.
export function warmXray() {
  const go = () => { webgl(); import('../xray/scene.js').catch(() => {}); };
  if ('requestIdleCallback' in window) requestIdleCallback(go, { timeout: 4000 }); else setTimeout(go, 1500);
}
function webgl() {
  if (webglCache == null) {
    try {
      const c = document.createElement('canvas');
      webglCache = !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
    } catch { webglCache = false; }
  }
  return webglCache;
}

// Flat section drawing: the same zones, for browsers without WebGL (or when the 3D module fails).
function drawDiagram(stage, profile, xs, why) {
  let wrap = stage.querySelector('.xr-diagram');
  if (!wrap) { wrap = document.createElement('div'); wrap.className = 'xr-diagram'; stage.append(wrap); }
  wrap.innerHTML = `<p class="xr-diagram-note">${why} It is a generic section, not this building's shape.</p><div class="xr-diagram-svg"></div>`;
  const box = wrap.querySelector('.xr-diagram-svg');
  const W = 400, H = 330;
  const z = new Map(profile.zones.map((d) => [d.key, d]));
  const fill = (k) => `var(--xr-${z.get(k).status})`;
  const fx = 70, fw = 200, fh = 44, top = 30;
  const shapes = [
    { k: 'systems', x: fx + 70, y: top, w: 80, h: 26 },                 // penthouse
    { k: 'systems', x: fx, y: top + 26, w: fw, h: 14 },                 // roof deck
    ...[0, 1, 2].map((i) => ({ k: 'shared', x: fx, y: top + 40 + i * fh, w: fw, h: fh })),
    { k: 'records', x: fx, y: top + 40 + 3 * fh, w: fw, h: fh },
    { k: 'systems', x: fx + 92, y: top + 40, w: 16, h: 4 * fh },        // elevator core
    { k: 'grounds', x: 10, y: top + 40 + 4 * fh, w: W - 20, h: 6 },      // grade
    { k: 'grounds', x: fx, y: top + 46 + 4 * fh, w: fw, h: 40 },         // parking
  ];
  const svg = d3.select(box).append('svg').attr('viewBox', `0 0 ${W} ${H}`).attr('class', 'xr-diagram-chart')
    .attr('role', 'img').attr('aria-label', `Diagram of the building's inspection categories. ${profile.zones.map((d) => `${zoneByKey.get(d.key).label}: ${STATUS[d.status].label}`).join('. ')}.`);
  const defs = svg.append('defs');
  defs.append('pattern').attr('id', 'xr-hatch').attr('width', 6).attr('height', 6).attr('patternUnits', 'userSpaceOnUse').attr('patternTransform', 'rotate(45)')
    .append('rect').attr('width', 2).attr('height', 6).attr('fill', 'var(--muted)').attr('opacity', 0.5);
  const g = svg.append('g');
  for (const s of shapes) {
    g.append('rect').attr('class', `xr-d-shape${xs.zone === s.k ? ' is-sel' : ''}`).attr('data-zone', s.k)
      .attr('x', s.x).attr('y', s.y).attr('width', s.w).attr('height', s.h).attr('fill', fill(s.k));
    if (z.get(s.k).status === 'none') g.append('rect').attr('x', s.x).attr('y', s.y).attr('width', s.w).attr('height', s.h).attr('fill', 'url(#xr-hatch)').attr('pointer-events', 'none');
  }
  // façade: an outline around the floors, thick enough to click
  const ext = z.get('exterior');
  g.append('rect').attr('class', `xr-d-shape xr-d-facade${xs.zone === 'exterior' ? ' is-sel' : ''}`).attr('data-zone', 'exterior')
    .attr('x', fx - 4).attr('y', top + 26).attr('width', fw + 8).attr('height', 14 + 4 * fh).attr('fill', 'none')
    .style('stroke', xs.zone === 'exterior' ? 'var(--accent)' : `var(--xr-${ext.status})`).style('stroke-width', 7)
    .style('stroke-dasharray', ext.status === 'none' ? '6 4' : null);
  const label = (k, y, side = 'right') => {
    const d = z.get(k), x = side === 'right' ? fx + fw + 12 : fx - 12;
    const t = g.append('text').attr('class', 'xr-d-label').attr('x', x).attr('y', y).attr('text-anchor', side === 'right' ? 'start' : 'end');
    t.append('tspan').attr('font-weight', 650).text(zoneByKey.get(k).short);
    t.append('tspan').attr('x', x).attr('dy', 14).attr('class', 'xr-d-sub').text(d.status === 'none' ? 'not evaluated' : `${d.poor} of ${d.applicable} poor`);
  };
  label('systems', top + 18);
  label('shared', top + 40 + 1.5 * fh);
  label('records', top + 40 + 3.5 * fh);
  label('grounds', top + 66 + 4 * fh);
  label('exterior', top + 40 + 1.5 * fh, 'left');
  g.selectAll('[data-zone]').on('click', function () { const k = this.dataset.zone; selectZone(xs.zone === k ? null : k); });
}

// ---- empty state + wiring -----------------------------------------------------------------------
function renderSuggestions(ctx, M) {
  const pm = ctx.pm;
  const box = $('xr-suggest');
  // Real buildings chosen by rule, so the examples are reproducible: the most poorly rated items,
  // and a building at the median score.
  const lows = (r) => pm.cats.filter((c) => r.ratings[c] != null && r.ratings[c] <= pm.P.poorMax).length;
  const most = [...pm.latest].sort((a, b) => lows(b) - lows(a) || d3.ascending(a.rsn, b.rsn))[0];
  const med = d3.median(pm.latest, (r) => r.score);
  const mid = [...pm.latest].filter((r) => r.score === Math.round(med)).sort((a, b) => d3.ascending(a.rsn, b.rsn))[0];
  box.innerHTML = [most && `<button type="button" class="chip" data-rsn="${most.rsn}">Most items rated poorly: ${esc(titleCase(most.address))}</button>`,
    mid && `<button type="button" class="chip" data-rsn="${mid.rsn}">A typical score (${mid.score}): ${esc(titleCase(mid.address))}</button>`].filter(Boolean).join('');
  box.querySelectorAll('[data-rsn]').forEach((b) => b.addEventListener('click', () => ctx.select(b.dataset.rsn, { open: true })));
}

// ---- history: one headline, one key change, one large timeline ---------------------------------------
const monthYear = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('en-CA', { month: 'short', year: 'numeric' });
const SYS = { cur: '2023 – now system', pre: '2017 – 2023 system' };

function renderHistory(points, rec, pm, M, xs) {
  const t = trendSummary(points, pm.era);
  const other = points.filter((p) => p.era !== pm.era).length;
  let head, sub;
  if (t.kind === 'empty') { head = `No evaluations in the ${esc(pm.P.long)}.`; sub = other ? `${other} in the ${pm.era === 'cur' ? '2017 – 2023' : '2023 – now'} system, shown in grey.` : ''; }
  else if (t.kind === 'single') { head = 'One evaluation in this scoring system.'; sub = `Score ${t.latest.rec.score} · ${monthYear(t.latest.rec.date)}`; }
  else {
    const d = t.latest.delta;
    head = d === 0 ? 'No change since the previous inspection.' : `${d > 0 ? 'Up' : 'Down'} ${Math.abs(d)} point${Math.abs(d) === 1 ? '' : 's'} since the previous inspection.`;
    sub = `${t.latest.prev.score} → ${t.latest.rec.score} · ${monthYear(t.latest.prev.date)} – ${monthYear(t.latest.rec.date)}`;
  }
  $('xr-tl-finding').innerHTML = head;
  $('xr-tl-sub').textContent = sub;
  $('xr-tl-sub').hidden = !sub;
  $('xr-tl-note').innerHTML = other
    ? `<span class="bx-key bx-key-cur" aria-hidden="true"></span>${SYS[pm.era]} <span class="bx-key bx-key-pre" aria-hidden="true"></span>${SYS[pm.era === 'cur' ? 'pre' : 'cur']}: <b>not directly comparable</b>, so never connected.`
    : `All evaluations here use the ${esc(pm.P.long)}. Scores from the other system are not directly comparable.`;

  const pick = points.find((p) => p.rec.uid === xs.tlPick) ?? points.find((p) => p.rec === rec) ?? points.at(-1);
  renderPick(pick, rec);   // first, so the chart measures the room the finished header leaves it
  const box = $('xr-timeline');
  box.innerHTML = '';
  const height = Math.max(200, Math.floor(box.clientHeight || 360));
  renderTimeline(box, {
    points, shown: rec, era: pm.era, P: pm.P, systemChange: M.byPeriod.cur.dates[0], height, summary: false,
    selected: pick.rec.uid, onSelect: (uid) => { xs.tlPick = uid; renderPick(points.find((p) => p.rec.uid === uid), rec); },
  });
}

// The selected evaluation, and the one next step: open it in the Inspection view.
function renderPick(p, shownRec) {
  const box = $('xr-tl-pick');
  if (!p) { box.innerHTML = ''; return; }
  const change = p.delta == null ? 'First in this system' : p.delta === 0 ? `No change since ${monthYear(p.prev.date)}` : `${signed(p.delta)} since ${monthYear(p.prev.date)}`;
  const isShown = p.rec === shownRec;
  box.innerHTML = `<p class="bx-pick-label">Selected evaluation</p>
    <p class="bx-pick-main"><b>${p.rec.score}</b><span> / 100</span> · ${formatDate(p.rec.date)}</p>
    <p class="bx-pick-sub">${SYS[p.era]} · ${change}</p>
    <button type="button" class="btn btn-sm ${isShown ? '' : 'btn-primary'}" id="xr-tl-open">${isShown ? 'View in Inspection' : 'Inspect this evaluation'}</button>`;
  $('xr-tl-open').addEventListener('click', () => {
    const xs = lastCtx.xs;
    if (!isShown) { xs.evalUid = p.rec.uid; xs.zone = null; xs.items = false; if (xs.mode === 'focus') xs.mode = 'cutaway'; }
    setTab('model', { focus: true });
  });
}

// ---- methodology: the full method, one question per section, closed by default ------------------------
function openMethod() {
  const dlg = $('xr-method-dialog');
  if (!dlg || dlg.open) return;
  renderMethod();
  dlg.showModal();
  if (!reducedMotion()) dlg.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 200, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)' });
  dlg.querySelector('summary')?.focus();
}

function wire() {
  if (wired) return;
  wired = true;
  document.querySelectorAll('input[name="xr-mode"]').forEach((i) => i.addEventListener('change', () => {
    const xs = lastCtx.xs;
    xs.mode = i.value;
    // Focus needs a category: the one that needs the most attention
    if (xs.mode === 'focus' && !xs.zone) {
      const rec = buildingEvaluations(lastCtx.M.data.byRsn.get(xs.rsn) ?? []).find((r) => r.uid === xs.evalUid) ?? lastCtx.ctx.pm.latestByRsn.get(xs.rsn);
      if (rec) xs.zone = defaultFocus(zoneProfile(rec, lastCtx.M.data.cats[rec.era]));
    }
    rerender();
  }));
  $('xr-rot-left').addEventListener('click', () => scene3d?.api?.rotate(-45));
  $('xr-rot-right').addEventListener('click', () => scene3d?.api?.rotate(45));
  $('xr-reset').addEventListener('click', () => scene3d?.api?.reset());
  $('xr-all').addEventListener('click', () => selectZone(null));
  $('xr-focus').addEventListener('click', () => scene3d?.api?.focus(lastCtx?.xs.zone));
  $('xr-back').addEventListener('click', () => $('depth-back').click());
  $('xr-method-open').addEventListener('click', openMethod);
  const dlg = $('xr-method-dialog');
  $('xr-method-close').addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });   // the backdrop
  dlg.addEventListener('close', () => $('xr-method-open').focus({ preventScroll: true }));
  // Tabs: click, or ← → Home End between them (the usual tablist keys).
  const tabs = [...document.querySelectorAll('[data-xr-tab]')];
  tabs.forEach((b) => {
    b.addEventListener('click', () => setTab(b.dataset.xrTab));
    b.addEventListener('keydown', (e) => {
      const i = tabs.indexOf(b);
      const j = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
      if (j == null) return;
      e.preventDefault();
      setTab(tabs[(j + tabs.length) % tabs.length].dataset.xrTab, { focus: true });
    });
  });
  // Esc steps back one level: item ratings → the category list → the whole building.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.defaultPrevented || dlg.open || !lastCtx || $('xr-main').hidden || !document.querySelector('[data-view="xray"]:not([hidden])')) return;
    if (e.target.closest?.('.ll-select, .ll-select-pop, .popover')) return;
    if (lastCtx.xs.items) showItems(false);
    else if (lastCtx.xs.zone) selectZone(null);
  });
}

function renderMethod() {
  const box = $('xr-method');
  const sec = (title, body, open = false) => `<details class="disclosure"${open ? ' open' : ''}><summary>${title}</summary><div class="disclosure-body">${body}</div></details>`;
  const row = (z) => `<tr><th scope="row">${esc(z.label)}</th><td>${z.items.cur.map((c) => esc(LL.prettyCat(c))).join(', ')}</td><td>${z.items.pre.length ? z.items.pre.map((c) => esc(LL.prettyCat(c))).join(', ') : '<span class="muted">none</span>'}</td></tr>`;
  const here = $('xr-prov-detail').innerHTML.trim();
  box.innerHTML = `<p class="bx-dialog-lede">How the Building Explorer turns the City’s records into the views you see. Open a section to read it.</p>
  <div class="disclosures">
  ${sec('Building geometry', `<p><b>Exterior: real geometry where it exists.</b> The outer shape and height come from the City of Toronto's 3D Massing data (2025, Open Government Licence – Toronto), matched to the RentSafeTO address point. A footprint is used only if the point is inside it, or it is the clear nearest within 15 m, and its height must fit the registered storeys (2.3–4.8 m per storey). Otherwise the building is drawn as a hatched approximate block and labelled so.</p>
    <p>Windows, balconies, the entrance, the garage door and the rooftop plant are a generic pattern scaled to the building's height, not surveyed features; the base, paths and trees are a neutral setting, not the real lot.</p>
    ${here ? `<p><b>This building:</b> ${here}</p>` : ''}`)}
  ${sec('Illustrative interiors', `<p>Exterior geometry is based on available building data. Interior spaces are illustrative and do not represent the actual floor plan.</p>
    <p><b>Cutaway</b> opens one corner of the building at street level, a box a few storeys high, and keeps the rest of the sourced massing solid. Inside is the same short stack of generic rooms for every building: ground-level parking and a waste room, a services room (elevator shaft, air handling, electrical panels, pipes) and a corridor with unit doors and a stair. Only their size follows the real wing; the slabs around them follow the real outline. While you orbit, the opening moves to the street corner facing you.</p>
    <p><b>Focus</b> outlines one category's room in blue and dims the others. Each room's floor carries a light tint of the category's status. The rooms show the kind of space inspectors look at, never where a problem is: nothing in them is drawn damaged, and results are never assigned to a floor, unit or room.</p>
    <p><b>Colour shows categories, not locations.</b> A tinted part means inspectors rated items in that category poorly. It doesn't mean that part of the real building is damaged, and the records tiles beside the building are an abstract layer: paperwork has no place in the building. Category status is not a certified safety-risk score.</p>`)}
  ${sec('Inspection categories', `<p>LeaseLens groups the City's inspection items into five categories. The grouping is ours, based on the item names; the City publishes the items, not the groups.</p>
    <p><b>Category status.</b> Share rated poorly = poorly rated items ÷ applicable (rated) items in the category. <i>No poor ratings</i>: none. <i>Some poor ratings</i>: at least one. <i>Concentrated</i>: at least ${CONCENTRATED.minPoor} items and at least ${CONCENTRATED.minShare * 100}% of applicable items, both required because the exterior category has only four items. <i>Not evaluated</i>: no applicable items. Missing data is never shown as a pass.</p>
    <p><b>No heating or plumbing.</b> RentSafeTO's open data has no heating, plumbing or water items, so the X-Ray doesn't show any.</p>
    <div class="fp-table-scroll"><table class="xr-map-table"><caption>Which inspection items belong to each category</caption>
      <thead><tr><th scope="col">Category</th><th scope="col">2023 – now items</th><th scope="col">2017 – 2023 items</th></tr></thead>
      <tbody>${XRAY_ZONES.map(row).join('')}</tbody></table></div>`)}
  ${sec('Rating definitions', `<p><b>Rated poorly</b> means 0 or 1 on the 0–3 scale (2023 – now) or 1 or 2 on the 1–5 scale (2017 – 2023), the same rule as the Common problems view.</p>
    <p>N/A items don't apply and are never counted; blank items were not recorded. Neither is ever treated as a pass or as a problem.</p>`)}
  ${sec('Scoring systems', `<p><b>One inspection at a time.</b> The Inspection view shows one evaluation (by default the latest in the scoring system chosen in Layers). Select any point in the history and choose <i>Inspect this evaluation</i> to see that inspection instead.</p>
    <p><b>History.</b> The City changed its scoring system in 2023. Points are connected only within one scoring system, and change is measured only against the previous evaluation in the same system. The two systems use different items and scales and are never compared.</p>`)}
  ${sec('Building comparisons', `<p><b>Compare</b> uses latest evaluations from the same scoring system only. It looks for the same overall score first, then within 1, then within 2 points (labelled), and lists the most different inspection profiles first. With a ward filter on, matches come from that ward when there are any.</p>
    <p>Each category is compared on the same 0–100% scale: the share of its applicable items rated poorly in each building.</p>`)}
  ${sec('Data sources', `<p>Scores, dates and item ratings are actual records from the City of Toronto's Apartment Building Evaluations (RentSafeTO) open data. Building shapes come from the City's 3D Massing data. Nothing is estimated, adjusted or invented, and the two scoring systems are never mixed.</p>
    <p><a href="#/about">About the data</a> has sources, licences and limitations.</p>`)}
  </div>`;
  box.querySelectorAll('a[href^="#"]').forEach((a) => a.addEventListener('click', () => $('xr-method-dialog').close()));
}
