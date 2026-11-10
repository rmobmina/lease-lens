// Explore atlas: the Leaflet map with semantic zoom.
//
//   city      (zoom < 12)  ward choropleth: share of each ward's buildings in the citywide lowest 10%
//   area      (12 – 14)    clusters on a fixed geographic grid; size = buildings, red arc = share in the lowest 10%
//   building  (≥ 14)       one mark per building (canvas), coloured and sized by citywide band
//
// Why Leaflet and not a WebGL map: the data are ~3,600 points and 25 polygons. Leaflet's canvas renderer
// draws that in a few milliseconds, the clusters are a few dozen DOM markers after culling, and the
// existing interactions, tiles and attribution stay as they were. A vector-tile stack would add a large
// dependency without changing what the reader can see.
//
// Level changes use separate zoom-in / zoom-out thresholds (logic.js levelFor) and cross-fade panes;
// the ward fill also fades continuously with zoom, so nothing flickers at a boundary.

import { levelFor, wardFillOpacity, clusterBuildings, cellForZoom, ZOOM } from './logic.js';
import { scoreBand } from '../model.js';
import { tip, esc, titleCase, cssVar, buildingTip, pct } from '../ui.js';

const TORONTO = [43.715, -79.39];
const BOUNDS = [[43.5, -79.75], [43.95, -79.0]];
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

let map = null, H = {};
let level = 'city';
let wardsGeo = null, wardLayer = null, wardBounds = null, wardLabel = null, hoverWard = null;
let clusterLayer = null, bldLayer = null, selLayer = null, renderer = null;
const markers = new Map();           // rsn -> circleMarker
let markerKey = '';                  // period|show the markers were built for
const clusterCache = new Map();      // period|show|cell -> clusters
let D = null;                        // last data: { pm, ward, selected, show, ch, footprint }
let geoReady = null;

// ---- setup ----------------------------------------------------------------------------------------
export function initMap(el, handlers) {
  if (map) return map;
  H = handlers;
  map = L.map(el, {
    preferCanvas: false, zoomSnap: 0.5, zoomDelta: 1, wheelPxPerZoomLevel: 90,
    minZoom: 9.5, maxZoom: ZOOM.max, maxBounds: BOUNDS, maxBoundsViscosity: 0.8,
    zoomControl: false, attributionControl: true, keyboard: true,
    zoomAnimation: !reduced(), fadeAnimation: !reduced(), markerZoomAnimation: !reduced(),
  }).setView(TORONTO, 11);
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  map.attributionControl.setPrefix(false);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors · Wards: <a href="https://open.toronto.ca/dataset/city-wards/">City of Toronto</a>',
    maxZoom: 19, className: 'basemap',
  }).addTo(map);

  for (const [name, z] of [['wards', 350], ['clusters', 450], ['buildings', 460], ['selection', 640]]) {
    const p = map.createPane(name);
    p.style.zIndex = z;
  }
  renderer = L.canvas({ pane: 'buildings', padding: 0.3 });
  bldLayer = L.layerGroup().addTo(map);
  clusterLayer = L.layerGroup().addTo(map);
  selLayer = L.layerGroup().addTo(map);

  map.on('zoomend', onZoom);
  map.on('moveend', () => {
    if (level === 'area') drawClusters();
    H.onView?.(getView());
  });
  map.on('zoom', () => wardLayer?.setStyle(wardStyle)); // continuous ward fade while zooming
  geoReady = fetch('data/wards/toronto-wards.json').then((r) => { if (!r.ok) throw new Error(`wards: ${r.status}`); return r.json(); })
    .then((g) => { wardsGeo = g; buildWards(); return g; })
    .catch((err) => { console.warn('Ward boundaries unavailable', err); H.onWardsFailed?.(err); });
  applyLevel(levelFor(map.getZoom()), true);
  return map;
}

export const wardsLoaded = () => geoReady ?? Promise.resolve();
export const getLevel = () => level;
export const invalidate = () => map?.invalidateSize({ pan: false });
export function getView() {
  if (!map) return null;
  const c = map.getCenter();
  return { center: [c.lat, c.lng], zoom: map.getZoom() };
}

// ---- data ---------------------------------------------------------------------------------------------
// d: { pm, ward, selected, show, ch (wardChoropleth), footprint (lat/lng rings or null) }
export function update(d) {
  const prev = D;
  D = d;
  if (!map) return;
  const key = `${d.pm.era}|${d.show}`;
  if (key !== markerKey) { buildMarkers(); markerKey = key; }
  else if (!prev || prev.selected !== d.selected || prev.ward !== d.ward) styleMarkers();
  if (wardLayer) {
    wardLayer.setStyle(wardStyle);
    if (!prev || prev.ward !== d.ward || prev.ch !== d.ch) labelWard();
  }
  if (level === 'area') drawClusters();
  drawSelection();
}

// ---- level of detail ------------------------------------------------------------------------------------
function onZoom() {
  const next = levelFor(map.getZoom(), level);
  if (next !== level) applyLevel(next);
  else if (level === 'building') styleMarkers();
  wardLayer?.setStyle(wardStyle);
  drawSelection();
}

function applyLevel(next, first = false) {
  level = next;
  const c = map.getContainer();
  c.dataset.level = next;
  // Only the city level lets the ward polygons take clicks; deeper levels pass them to the buildings.
  c.classList.toggle('wards-inert', next !== 'city');
  map.getPane('clusters').style.opacity = next === 'area' ? 1 : 0;
  map.getPane('buildings').style.opacity = next === 'building' ? 1 : 0;
  map.getPane('clusters').style.pointerEvents = next === 'area' ? '' : 'none';
  map.getPane('buildings').style.pointerEvents = next === 'building' ? '' : 'none';
  if (next === 'area') drawClusters(); else clusterLayer.clearLayers();
  if (next === 'building') styleMarkers();
  labelWard();
  if (!first) H.onLevel?.(next);
}

// ---- wards ------------------------------------------------------------------------------------------------
const CLASS_VAR = ['--ch-0', '--ch-1', '--ch-2', '--ch-3', '--ch-4'];

function wardStyle(f) {
  const w = f.properties.ward;
  const row = D?.ch?.byWard.get(w);
  const z = map.getZoom();
  const sel = D?.ward === w, other = D?.ward && !sel, hov = hoverWard === w && level === 'city';
  let fo = wardFillOpacity(z);
  if (other) fo *= level === 'city' ? 0.55 : 0.5;
  return {
    pane: 'wards',
    fillColor: row ? cssVar(CLASS_VAR[row.cls]) : cssVar('--ch-none'),
    fillOpacity: row ? fo : fo * 0.5,
    color: sel || hov ? cssVar('--accent') : cssVar('--ward-line'),
    weight: sel ? 3 : hov ? 2.5 : level === 'city' ? 1 : 0.8,
    opacity: sel || hov ? 1 : level === 'city' ? 0.9 : 0.55,
    dashArray: row?.small && !sel && !hov ? '4 3' : null,
  };
}

function buildWards() {
  wardLayer = L.geoJSON(wardsGeo, {
    style: wardStyle,
    pane: 'wards',
    onEachFeature: (f, layer) => {
      layer.on('mouseover', (e) => {
        if (level !== 'city') return;
        hoverWard = f.properties.ward;
        layer.setStyle(wardStyle(f));
        layer.bringToFront();
        tip.show(wardTip(f.properties), e.originalEvent);
      });
      layer.on('mousemove', (e) => { if (level === 'city') tip.move(e.originalEvent); });
      layer.on('mouseout', () => { hoverWard = null; layer.setStyle(wardStyle(f)); tip.hide(); });
      layer.on('click', () => { if (level !== 'city') return; tip.hide(); H.onWard?.(f.properties.ward); });
    },
  }).addTo(map);
  wardBounds = wardLayer.getBounds();
  labelWard();
  H.onWardsReady?.();
}

function wardTip(p) {
  const row = D?.ch?.byWard.get(p.ward);
  if (!row) return `<div class="tt-title">${esc(p.name)}</div><div class="tt-sub">No evaluated buildings in this scoring system.</div>`;
  return `<div class="tt-title">${esc(p.name)} <span class="tt-muted">· Ward ${+p.ward}</span></div>
    <dl><dt>Lowest 10%</dt><dd><b>${pct(row.share)}</b> (${row.low10} of ${row.n})</dd><dt>Citywide</dt><dd>${pct(D.ch.city)}</dd><dt>Median score</dt><dd>${row.median}</dd></dl>
    ${row.small ? '<p class="tt-hint">Fewer than 30 evaluated buildings: a few buildings move this share a lot.</p>' : ''}
    <p class="tt-hint">Click to explore this ward</p>`;
}

// One permanent label: the selected ward's name (never all 25 at once).
function labelWard() {
  if (wardLabel) { wardLabel.remove(); wardLabel = null; }
  if (!wardLayer || !D?.ward || level === 'building') return;
  const layer = wardLayer.getLayers().find((l) => l.feature.properties.ward === D.ward);
  if (!layer) return;
  const row = D.ch?.byWard.get(D.ward);
  wardLabel = L.tooltip({ permanent: true, direction: 'center', className: 'ward-label', pane: 'selection', interactive: false })
    .setLatLng(layer.getBounds().getCenter())
    .setContent(`${esc(layer.feature.properties.name)}${row ? `<small>${pct(row.share)} in lowest 10%</small>` : ''}`)
    .addTo(map);
}

export function wardBoundsOf(ward) {
  const layer = wardLayer?.getLayers().find((l) => l.feature.properties.ward === ward);
  return layer ? layer.getBounds() : null;
}

// ---- buildings (canvas) ------------------------------------------------------------------------------------
const STYLE = { low10: { radius: 5.5, fo: 0.95 }, low25: { radius: 4.5, fo: 0.9 }, other: { radius: 3.5, fo: 0.7 } };
const ORDER = { other: 0, low25: 1, low10: 2 };
const shownBand = (band, show) => show === 'all' || band === 'low10' || (show === 'low25' && band === 'low25');

function buildMarkers() {
  bldLayer.clearLayers();
  markers.clear();
  const { pm } = D;
  const pts = pm.latest.filter((r) => r.lat != null)
    .map((r) => ({ r, band: scoreBand(r.score, pm) }))
    .sort((a, b) => ORDER[a.band] - ORDER[b.band] || b.r.score - a.r.score); // low scores drawn on top
  for (const { r, band } of pts) {
    const m = L.circleMarker([r.lat, r.lon], { renderer, pane: 'buildings', bubblingMouseEvents: false });
    m._ll = { r, band };
    m.on('mouseover', (e) => { if (level === 'building' && m._ll.on) tip.show(buildingTip(r, '<div class="tt-hint">Click to select</div>'), e.originalEvent); })
      .on('mousemove', (e) => tip.move(e.originalEvent))
      .on('mouseout', () => tip.hide())
      .on('click', () => { if (level !== 'building' || !m._ll.on) return; tip.hide(); H.onBuilding?.(r.rsn); });
    markers.set(r.rsn, m);
    m.addTo(bldLayer);
  }
  styleMarkers();
}

function styleMarkers() {
  if (!D || !markers.size) return;
  const { ward, selected, show } = D;
  const C = { low10: cssVar('--low-10'), low25: cssVar('--low-25'), other: cssVar('--dot'), ring: cssVar('--surface') };
  const big = map.getZoom() >= 16 ? 1.5 : 0;
  for (const m of markers.values()) {
    const { r, band } = m._ll;
    const on = shownBand(band, show) && (!ward || r.ward === ward);
    const dim = selected && r.rsn !== selected;
    m._ll.on = on;
    const s = STYLE[band];
    m.setStyle(on
      ? { radius: s.radius + big, fillColor: C[band], fillOpacity: dim ? s.fo * 0.4 : s.fo, color: C.ring, weight: 1, opacity: dim ? 0.4 : 1 }
      : { radius: 2, fillColor: C.other, fillOpacity: 0.18, weight: 0, opacity: 0 });
  }
}

// Buildings currently on screen (for the keyboard list and the text summary).
export function buildingsInView() {
  if (!map || !D) return [];
  const b = map.getBounds();
  return D.pm.latest.filter((r) => r.lat != null && b.contains([r.lat, r.lon]) && shownBand(scoreBand(r.score, D.pm), D.show) && (!D.ward || r.ward === D.ward));
}

// ---- clusters (DOM markers, culled to the view) ---------------------------------------------------------------
function drawClusters() {
  clusterLayer.clearLayers();
  if (!D || level !== 'area') return;
  const cell = cellForZoom(map.getZoom());
  const key = `${D.pm.era}|${D.show}|${cell}`;
  let cl = clusterCache.get(key);
  if (!cl) {
    const pts = D.pm.latest.map((r) => ({ rsn: r.rsn, lat: r.lat, lon: r.lon, band: scoreBand(r.score, D.pm), ward: r.ward }))
      .filter((p) => shownBand(p.band, D.show));
    cl = clusterBuildings(pts, cell);
    const wardOf = new Map(D.pm.latest.map((r) => [r.rsn, r.ward]));
    for (const c of cl) c.wards = new Set(c.rsns.map((x) => wardOf.get(x)));
    clusterCache.set(key, cl);
  }
  const view = map.getBounds().pad(0.15);
  const anim = !reduced();
  for (const c of cl) {
    if (!view.contains([c.lat, c.lon])) continue;
    const d = Math.round(Math.min(58, 18 + 5 * Math.sqrt(c.n)));
    const share = c.low10 / c.n; // the red arc: share of the group in the lowest 10%
    const out = D.ward && !c.wards.has(D.ward);
    const label = `${c.n} building${c.n === 1 ? '' : 's'}${c.low10 ? `, ${c.low10} in the lowest 10%` : ''}. Select to zoom in.`;
    const icon = L.divIcon({
      className: `cl${out ? ' is-out' : ''}${anim ? ' is-anim' : ''}`,
      iconSize: [d, d],
      html: `<span class="cl-disc" style="--d:${d}px;--p:${share.toFixed(3)}"><b>${c.n}</b></span>`,
    });
    const m = L.marker([c.lat, c.lon], { icon, pane: 'clusters', keyboard: true, title: label, alt: label, riseOnHover: true });
    m.on('click', () => zoomIntoCluster(c));
    m.on('add', () => { const el = m.getElement(); el?.setAttribute('aria-label', label); el?.setAttribute('role', 'button'); });
    m.addTo(clusterLayer);
  }
}

function zoomIntoCluster(c) {
  const z = map.getZoom();
  const b = L.latLngBounds([c.minLat, c.minLon], [c.maxLat, c.maxLon]);
  const fitZ = Math.min(map.getBoundsZoom(b.pad(0.3)), 17);
  const target = Math.max(fitZ, z + 1.5, ZOOM.buildingIn);
  flyTo([c.lat, c.lon], c.n === 1 ? Math.max(target, ZOOM.building) : target);
}

// ---- selection: ring, footprint and one label ------------------------------------------------------------------
function drawSelection() {
  selLayer.clearLayers();
  const rec = D?.selected && (D.pm.latestByRsn.get(D.selected) ?? D.selectedRec);
  if (!rec || rec.lat == null) return;
  const accent = cssVar('--accent');
  const z = map.getZoom();
  if (D.footprint?.length && z >= 15) {
    for (const rings of D.footprint) {
      L.polygon(rings, { pane: 'selection', color: accent, weight: 2.5, fillColor: accent, fillOpacity: 0.18, interactive: false, className: 'sel-footprint' }).addTo(selLayer);
    }
  }
  L.circleMarker([rec.lat, rec.lon], { pane: 'selection', radius: z >= 15 ? 13 : 10, color: accent, weight: 3, fill: false, interactive: false, className: 'sel-ring' }).addTo(selLayer);
  L.circleMarker([rec.lat, rec.lon], { pane: 'selection', radius: 4, color: cssVar('--surface'), weight: 1.5, fillColor: accent, fillOpacity: 1, interactive: false }).addTo(selLayer);
  if (z >= 12) {
    L.tooltip({ permanent: true, direction: 'top', offset: [0, -14], className: 'sel-label', pane: 'selection', interactive: false })
      .setLatLng([rec.lat, rec.lon]).setContent(`${esc(titleCase(rec.address))} <b>${rec.score}</b>`).addTo(selLayer);
  }
}

// ---- camera -------------------------------------------------------------------------------------------------------
// The left rail and the analysis drawer cover part of the map; frame things in the space that is left.
function insets() {
  const i = H.insets?.() ?? { left: 0, right: 0, top: 0, bottom: 0 };
  return { paddingTopLeft: [i.left + 24, i.top + 24], paddingBottomRight: [i.right + 24, i.bottom + 24], ...i };
}
const motion = (o = {}) => (reduced() ? { animate: false } : { animate: true, duration: 0.7, ...o });

function flyTo(latlng, zoom) {
  const i = insets();
  const off = L.point((i.left - i.right) / 2, (i.top - i.bottom) / 2);
  const target = map.unproject(map.project(latlng, zoom).subtract(off), zoom);
  if (reduced()) map.setView(target, zoom, { animate: false }); else map.flyTo(target, zoom, { duration: 0.8 });
}

export function showCity() {
  if (!map) return;
  const i = insets();
  const b = wardBounds ?? L.latLngBounds([43.581, -79.639], [43.855, -79.115]);
  map.flyToBounds(b, { paddingTopLeft: i.paddingTopLeft, paddingBottomRight: i.paddingBottomRight, maxZoom: 11.5, ...motion() });
}

export function showWard(ward) {
  const b = wardBoundsOf(ward);
  if (!b) return;
  const i = insets();
  // Land just inside the cluster level so the ward's buildings start to separate.
  const z = Math.max(ZOOM.areaIn, Math.min(map.getBoundsZoom(b, false, L.point(i.left + i.right + 48, i.top + i.bottom + 48)), 13.5));
  flyTo(b.getCenter(), z);
}

export function showBuilding(rec, zoom = ZOOM.building) {
  if (!map || rec?.lat == null) return;
  flyTo([rec.lat, rec.lon], Math.max(zoom, map.getZoom() >= ZOOM.buildingIn ? map.getZoom() : zoom));
}

export function setView(view, { animate = true } = {}) {
  if (!map || !view) return;
  const cur = map.getCenter();
  if (Math.abs(cur.lat - view.center[0]) < 1e-5 && Math.abs(cur.lng - view.center[1]) < 1e-5 && Math.abs(map.getZoom() - view.zoom) < 0.01) return;
  map.setView(view.center, view.zoom, animate && !reduced() ? { animate: true } : { animate: false });
}

// Restyle after a theme change (canvas and SVG colours come from CSS tokens).
export function restyle() {
  if (!map) return;
  wardLayer?.setStyle(wardStyle);
  styleMarkers();
  drawSelection();
}
