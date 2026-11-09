// Building X-Ray view: one building's inspection, laid out by category on a 3D model of THAT building.
// The exterior comes from the City of Toronto 3D Massing data matched to the address
// (data/massing/<shard>.json, built by scripts/build_massing.py); the interior is illustrative.
// This file handles the page: which inspection to show, the category list, the detail panel,
// provenance, the 2D fallback (no WebGL only), and loading the 3D scene on demand.
// The scene is ../xray/scene.js (Three.js, lazy-loaded); data work is ../xray-model.js.

import { itemLabel, itemProblemRates } from '../model.js';
import { XRAY_ZONES, STATUS, CONCENTRATED, zoneByKey, zoneProfile, buildingEvaluations, timelinePoints, ratingClass } from '../xray-model.js';
import { pct, fmt, esc, titleCase, formatDate, cssVar } from '../ui.js';
import { renderTimeline } from './xray-timeline.js';
import { renderCompare } from './xray-compare.js';

const $ = (id) => document.getElementById(id);
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const SHARDS = 64;                // must match scripts/build_massing.py
const LIST_ORDER = ['exterior', 'systems', 'shared', 'records', 'grounds']; // top of the building to the bottom

let scene3d = null;               // { api, loading, failed }
let wired = false;
let lastCtx = null;
const cityRates = new Map();      // era -> Map(col -> citywide share rated poorly)
const shardCache = new Map();     // shard number -> Promise<{rsn: entry}>
const massing = new Map();        // rsn -> entry (or a fallback entry when loading failed)

function loadMassing(rsn) {
  const k = Number(rsn) % SHARDS;
  if (!shardCache.has(k)) {
    shardCache.set(k, fetch(`data/massing/${k}.json`).then((r) => { if (!r.ok) throw new Error(`massing shard ${k}: ${r.status}`); return r.json(); })
      .catch((e) => { shardCache.delete(k); throw e; }));
  }
  return shardCache.get(k).then((d) => d[rsn] ?? null);
}

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
    $('xr-empty-note').textContent = rsn ? 'This building has no usable evaluation in either scoring system.' : '';
    renderSuggestions(ctx, M);
    disposeXray();
    return;
  }
  empty.hidden = true; main.hidden = false;
  if (location.hash !== `#/xray/${rsn}`) history.replaceState(null, '', `#/xray/${rsn}`);

  // A new building resets the inspection being shown and the comparison choice.
  if (xs.rsn !== rsn) Object.assign(xs, { rsn, evalUid: null, matchRsn: null });
  const latestInPeriod = pm.latestByRsn.get(rsn);
  const rec = all.find((r) => r.uid === xs.evalUid) ?? latestInPeriod ?? all.at(-1);
  const isDefault = rec === (latestInPeriod ?? all.at(-1));
  const profile = zoneProfile(rec, M.data.cats[rec.era]);
  const points = timelinePoints(all);
  const prevSame = points.find((p) => p.rec === rec)?.prev ?? null;

  renderHead(rec, pm, isDefault, latestInPeriod, all);
  renderZoneList(profile, xs);
  renderPanel(profile, xs, M, prevSame);
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
  renderStage(profile, xs, entry);
  renderTimeline($('xr-timeline'), {
    points, shown: rec, era: pm.era, P: pm.P, systemChange: M.byPeriod.cur.dates[0],
    onPick: (uid) => { xs.evalUid = uid; rerender(); revealStage(); },
  });
  renderCompare($('xr-compare'), {
    rec: latestInPeriod, pm, ctx, M, matchRsn: xs.matchRsn,
    onChoose: (r) => { xs.matchRsn = r; rerender(); },
    onOpen: (r) => ctx.select(r, { open: true }),
  });
  renderMethod();
}

function rerender() { if (lastCtx) renderXray(lastCtx.ctx, lastCtx.M, lastCtx.xs); }

function revealStage() {
  $('xr-stage-card').scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
}

// ---- header -------------------------------------------------------------------------------
function renderHead(rec, pm, isDefault, latestInPeriod, all) {
  $('xr-title').textContent = titleCase(rec.address);
  $('xr-meta').innerHTML = [
    `Ward ${+rec.ward} · ${esc(rec.wardName)}`,
    rec.yearBuilt ? `Built ${rec.yearBuilt}` : 'Year built not recorded',
    `${rec.storeys ?? '–'} storeys · ${rec.units ?? '–'} units`,
    `<a href="#/building/${rec.rsn}">Building report</a>`,
  ].map((s) => `<span>${s}</span>`).join('');
  const system = rec.era === 'cur' ? '2023 – now scoring system' : '2017 – 2023 scoring system';
  const notes = [];
  if (!isDefault) notes.push(`<button type="button" class="btn btn-quiet btn-sm" id="xr-back-latest">Back to the ${latestInPeriod ? 'latest' : 'most recent'} inspection</button>`);
  else if (!latestInPeriod) notes.push(`<span class="muted">No evaluation in the ${esc(pm.P.long)}, so the most recent one from the other system is shown.</span>`);
  if (rec.era !== pm.era && latestInPeriod) notes.push(`<span class="muted">This inspection uses a different scoring system from the one chosen in the sidebar.</span>`);
  $('xr-showing').innerHTML = `<span class="xr-showing-main">Showing the inspection of <b>${formatDate(rec.date)}</b> · score <b>${rec.score}</b>/100 · ${system}${all.length > 1 ? ` · ${rec === all.at(-1) ? 'most recent' : `${all.indexOf(rec) + 1} of ${all.length} inspections`}` : ''}</span>${notes.join(' ')}`;
  $('xr-back-latest')?.addEventListener('click', () => { lastCtx.xs.evalUid = null; rerender(); });
}

// ---- category list (the keyboard and screen-reader way to choose a zone) ----------------------
const statusWords = (z) => (z.status === 'none' ? (z.items.length ? 'all items N/A' : 'no items in this scoring system') : z.poor ? `${z.poor} of ${z.applicable} rated poorly` : `None of ${z.applicable} rated poorly`);

function renderZoneList(profile, xs) {
  const box = $('xr-zones');
  const byKey = new Map(profile.zones.map((z) => [z.key, z]));
  box.innerHTML = `<p class="card-label" id="xr-zones-label">Inspection categories</p>
    <ul class="xr-zone-list" aria-labelledby="xr-zones-label">${LIST_ORDER.map((k) => {
      const z = byKey.get(k), meta = zoneByKey.get(k);
      return `<li><button type="button" class="xr-zone" data-zone="${k}" data-status="${z.status}" aria-pressed="${xs.zone === k}">
        <span class="xr-swatch s-${z.status}" aria-hidden="true"></span>
        <span class="xr-zone-text"><b>${esc(meta.label)}</b><small>${esc(STATUS[z.status].label)} · ${statusWords(z)}</small></span>
        <span class="xr-zone-pct">${z.share == null ? '—' : pct(z.share)}</span></button></li>`;
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
}

function selectZone(zone) {
  if (!lastCtx) return;
  lastCtx.xs.zone = zone;
  rerender();
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
  const scaleText = `Items are rated ${S.min}–${S.max}, where ${S.max} is the top mark. LeaseLens counts ${S.text.replace(' on the', ' (on the').replace(' scale', ' scale)')} as <b>rated poorly</b>, the same rule as the Common problems view. N/A means the item doesn't apply and is never counted.`;
  const z = xs.zone && profile.zones.find((d) => d.key === xs.zone);
  if (!z) {
    box.innerHTML = `<p class="card-label">Inspection of ${formatDate(rec.date)}</p>
      <h2 class="xr-panel-title">${profile.poor ? `${profile.poor} of ${profile.applicable} items rated poorly` : `None of ${profile.applicable} items rated poorly`}</h2>
      <p class="card-text">Select a category in the list or on the model to see every item inspectors rated in it.</p>
      <p class="xr-scale">${scaleText}</p>
      ${profile.unmapped.length ? `<p class="xr-warn">${profile.unmapped.length} item(s) in this file have no category yet: ${profile.unmapped.map(esc).join(', ')}.</p>` : ''}`;
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
  box.innerHTML = `<p class="card-label">Inspection category</p>
    <h2 class="xr-panel-title"><span class="xr-swatch s-${z.status}" aria-hidden="true"></span>${esc(meta.label)}</h2>
    <p class="xr-panel-note">${esc(meta.note)} <span class="muted">On the model: ${esc(meta.place.toLowerCase())}.</span></p>
    <dl class="xr-stats">
      <div><dt>Inspected</dt><dd>${formatDate(rec.date)}</dd></div>
      <div><dt>Applicable items</dt><dd>${z.applicable}</dd></div>
      <div><dt>Rated poorly</dt><dd>${z.poor}</dd></div>
      <div><dt>Share rated poorly</dt><dd>${z.share == null ? '—' : pct(z.share)}</dd></div>
    </dl>
    <p class="xr-status-line s-${z.status}"><b>${esc(STATUS[z.status].label)}.</b> ${esc(STATUS[z.status].long)}.</p>
    ${z.status === 'none' ? `<p class="card-text">${z.items.length ? 'Every item in this category was marked N/A or left blank in this inspection.' : `The ${rec.era === 'pre' ? '2017 – 2023' : '2023 – now'} scoring system has no items in this category, so there is nothing to show. Missing data is not a pass.`}</p>` : ''}
    ${rated.length ? `<ul class="xr-items" aria-label="Items rated in ${esc(meta.label)}">${rated.map(item).join('')}</ul>` : ''}
    ${na.length ? `<p class="card-sub">Not applicable (N/A)</p><p class="xr-na">${na.map((i) => esc(itemLabel(i.col))).join(' · ')}</p>` : ''}
    ${blank.length ? `<p class="card-sub">Not recorded (blank)</p><p class="xr-na">${blank.map((i) => esc(itemLabel(i.col))).join(' · ')}</p>` : ''}
    <p class="xr-scale">${scaleText}</p>`;
}

// ---- legend -----------------------------------------------------------------------------------
function renderLegend() {
  $('xr-legend').innerHTML = ['ok', 'some', 'high', 'none'].map((k) =>
    `<span class="key"><span class="xr-swatch s-${k}" aria-hidden="true"></span>${STATUS[k].label}</span>`).join('') +
    `<span class="xr-legend-note">“Concentrated” = ${CONCENTRATED.minPoor}+ items and ${CONCENTRATED.minShare * 100}%+ of the category's applicable items rated poorly.</span>`;
}

// ---- top bar + provenance ------------------------------------------------------------------------
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
  box.innerHTML = `<span class="xr-prov-badge p-${entry.provenance}">${p.label}</span><span class="xr-prov-text">${detail}</span>`;
}

// ---- stage: 3D scene (lazy) or 2D diagram (only without WebGL) ---------------------------------------
function readPalette() {
  const c = cssVar;
  return {
    accent: c('--accent'), edge: c('--xr-edge'), ground: c('--xr-ground'), contextEdge: c('--xr-context-edge'),
    status: { none: c('--xr-none'), ok: c('--xr-ok'), some: c('--xr-some'), high: c('--xr-high') },
    statusEdge: { none: c('--xr-edge'), ok: c('--xr-edge'), some: c('--xr-some'), high: c('--xr-high') },
    rating: { p3: c('--fp-3'), p2: c('--fp-2'), p1: c('--fp-1'), p0: c('--fp-0'), na: c('--xr-none'), none: c('--xr-none') },
    mat: {
      wall: c('--xr-wall'), roof: c('--xr-roof'), slab: c('--xr-slab'), dark: c('--xr-dark'), window: c('--xr-window'), glass: c('--xr-glass'),
      paint: c('--xr-paint'), context: c('--xr-context'), ground: c('--xr-ground'),
    },
  };
}

function zoneLabels(profile) {
  const out = {};
  for (const z of profile.zones) {
    const meta = zoneByKey.get(z.key);
    out[z.key] = {
      title: meta.short, name: meta.label, status: z.status,
      sub: z.status === 'none' ? 'not evaluated' : z.poor ? `${z.poor} of ${z.applicable} poor` : 'no poor ratings',
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
  $('xr-all').hidden = !xs.zone;
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
    import('../xray/scene.js').then((mod) => {
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

function wire() {
  if (wired) return;
  wired = true;
  document.querySelectorAll('input[name="xr-mode"]').forEach((i) => i.addEventListener('change', () => { lastCtx.xs.mode = i.value; rerender(); }));
  $('xr-rot-left').addEventListener('click', () => scene3d?.api?.rotate(-45));
  $('xr-rot-right').addEventListener('click', () => scene3d?.api?.rotate(45));
  $('xr-reset').addEventListener('click', () => scene3d?.api?.reset());
  $('xr-all').addEventListener('click', () => selectZone(null));
  $('xr-method-open').addEventListener('click', () => { const d = $('xr-method-box'); d.open = true; d.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' }); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && lastCtx?.xs.zone && !$('xr-main').hidden && document.querySelector('[data-view="xray"]:not([hidden])')) selectZone(null);
  });
}

function renderMethod() {
  if ($('xr-method').dataset.done) return;
  $('xr-method').dataset.done = '1';
  const row = (z) => `<tr><th scope="row">${esc(z.label)}</th><td>${z.items.cur.map((c) => esc(LL.prettyCat(c))).join(', ')}</td><td>${z.items.pre.length ? z.items.pre.map((c) => esc(LL.prettyCat(c))).join(', ') : '<span class="muted">none</span>'}</td></tr>`;
  $('xr-method').innerHTML = `<ul>
    <li><b>Exterior: real geometry where it exists.</b> The outer shape and height come from the City of Toronto's 3D Massing data (2025, Open Government Licence – Toronto), matched to the RentSafeTO address point. A footprint is used only if the point is inside it, or it is the clear nearest within 15 m, and its height must fit the registered storeys (2.3–4.8 m per storey). Otherwise the building is drawn as a hatched approximate block and labelled so. The match type and confidence are shown under the model.</li>
    <li><b>Interior: illustrative.</b> Exterior geometry is based on available building data. Interior spaces are illustrative and do not represent the actual floor plan. Floor plates follow the real outline; the corridor, stair, elevator core, rooftop plant and parking level are generic. Windows and balconies are a generic pattern, not surveyed façade features.</li>
    <li><b>Colour shows categories, not locations.</b> A tinted part means inspectors rated items in that category poorly. It doesn't mean that part of the real building is damaged, and the records tiles beside the building are an abstract layer: paperwork has no place in the building. Category status is not a certified safety-risk score.</li>
    <li><b>One inspection at a time.</b> The X-Ray shows one evaluation (by default the latest in the scoring system chosen in the sidebar). Pick any point in the history to see that inspection instead.</li>
    <li><b>Rated poorly</b> means 0 or 1 on the 0–3 scale (2023 – now) or 1 or 2 on the 1–5 scale (2017 – 2023), the same rule as the Common problems view. N/A items don't apply and are never counted; blank items were not recorded.</li>
    <li><b>Category status.</b> Share rated poorly = poorly rated items ÷ applicable (rated) items in the category. <i>No poor ratings</i>: none. <i>Some poor ratings</i>: at least one. <i>Concentrated</i>: at least ${CONCENTRATED.minPoor} items and at least ${CONCENTRATED.minShare * 100}% of applicable items, both required because the exterior category has only four items. <i>Not evaluated</i>: no applicable items. Missing data is never shown as a pass.</li>
    <li><b>No heating or plumbing.</b> RentSafeTO's open data has no heating, plumbing or water items, so the X-Ray doesn't show any.</li>
    <li><b>Same score, different story</b> compares latest evaluations from the same scoring system only. It looks for the same overall score first, then within 1, then within 2 points (labelled), and lists the most different profiles first. With a ward filter on, matches come from that ward when there are any.</li>
    <li><b>History.</b> Points are connected only within one scoring system, and change is measured only against the previous evaluation in the same system. The two systems use different items and scales and are never compared.</li>
  </ul>
  <div class="fp-table-scroll"><table class="xr-map-table"><caption>Which inspection items belong to each category</caption>
    <thead><tr><th scope="col">Category</th><th scope="col">2023 – now items</th><th scope="col">2017 – 2023 items</th></tr></thead>
    <tbody>${XRAY_ZONES.map(row).join('')}</tbody></table></div>`;
}
