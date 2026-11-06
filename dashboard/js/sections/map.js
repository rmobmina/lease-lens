// Q1: Where are the lowest-scoring buildings, and are they geographically clustered?
// Geographic position is the primary encoding; colour only separates the citywide
// lowest 10% and lowest 25% from everything else.

import { scoreBand, wardLowShares } from '../model.js';
import { tip, pct, fmt, esc, buildingTip, legendKey, cssVar, setFinding } from '../ui.js';

let map, layer, selLayer, tiles, fitted = false;
const TORONTO = [43.715, -79.39];

function ensureMap() {
  if (map) return;
  map = L.map('map', { preferCanvas: true, zoomSnap: 0.5, scrollWheelZoom: false }).setView(TORONTO, 10.5);
  // Scroll-zoom only after the user interacts with the map, so the page scrolls normally.
  map.on('click focus', () => map.scrollWheelZoom.enable());
  map.on('mouseout', () => map.scrollWheelZoom.disable());
  layer = L.layerGroup().addTo(map);
  selLayer = L.layerGroup().addTo(map);
}

// OpenStreetMap tiles (as in the explorer), desaturated in CSS so the data stays the loudest layer.
function setTiles() {
  if (tiles) return;
  tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
  }).addTo(map);
}

export function invalidateMap() { map?.invalidateSize(); }

export function renderMap(ctx) {
  const { pm, ward, show, selected } = ctx;
  ensureMap();
  setTiles();
  layer.clearLayers();

  const C = { low10: cssVar('--low-10'), low25: cssVar('--low-25'), other: cssVar('--dot'), ring: cssVar('--surface') };
  const visible = (band) => show === 'all' || band === 'low10' || (show === 'low25' && band === 'low25');
  const STYLE = {
    low10: { radius: 5.5, fillOpacity: 0.95 },
    low25: { radius: 4.5, fillOpacity: 0.9 },
    other: { radius: 3, fillOpacity: 0.5 },
  };
  const order = { other: 0, low25: 1, low10: 2 };
  const pts = pm.latest.filter((r) => r.lat != null)
    .map((r) => ({ r, band: scoreBand(r.score, pm) }))
    .sort((a, b) => order[a.band] - order[b.band] || b.r.score - a.r.score); // low scores drawn on top

  const renderer = L.canvas({ padding: 0.5 });
  for (const { r, band } of pts) {
    const inWard = !ward || r.ward === ward;
    const shown = visible(band) && inWard;
    const m = L.circleMarker([r.lat, r.lon], {
      renderer,
      radius: shown ? STYLE[band].radius : 2,
      fillColor: shown ? C[band] : C.other,
      fillOpacity: shown ? STYLE[band].fillOpacity : 0.18,
      color: C.ring, weight: shown ? 1 : 0, opacity: 1,
      interactive: shown,
    });
    if (shown) {
      m.on('mouseover', (e) => tip.show(buildingTip(r, `<div class="tt-hint">Click to select this building</div>`), e.originalEvent))
        .on('mousemove', (e) => tip.move(e.originalEvent))
        .on('mouseout', () => tip.hide())
        .on('click', () => { tip.hide(); ctx.select(r.rsn, { from: 'map' }); });
    }
    m.addTo(layer);
  }

  // Selected building ring
  selLayer.clearLayers();
  const sel = selected && pm.latestByRsn.get(selected);
  if (sel?.lat != null) {
    L.circleMarker([sel.lat, sel.lon], { radius: 11, color: cssVar('--accent'), weight: 3, fill: false, interactive: false }).addTo(selLayer);
  }

  // Legend with the actual cut-off scores
  const share = (f) => pct(pm.latest.filter(f).length / pm.latest.length);
  document.getElementById('map-legend').innerHTML = [
    legendKey(C.low10, `Lowest 10%: score ${pm.t10} or below`),
    legendKey(C.low25, `Next 15%: ${pm.t10 + 1}–${pm.t25}`),
    show === 'all' ? legendKey(C.other, `Above ${pm.t25}`) : '',
    sel ? `<span class="key"><span class="swatch" style="border:3px solid ${cssVar('--accent')};background:transparent"></span>Selected</span>` : '',
  ].join('');

  // Method note
  const noCoord = pm.latest.filter((r) => r.lat == null).length;
  const derived = pm.latest.filter((r) => r.coordSource === 'derived-from-XY').length;
  document.getElementById('q1-method').innerHTML = `<ul>
    <li>One dot per building, using its most recent evaluation in the ${pm.P.long}.</li>
    <li>“Lowest 10%” and “lowest 25%” are citywide cut-offs on those latest scores (${pm.t10} and ${pm.t25}). Buildings tied at a cut-off are included, so the groups hold ${share((r) => r.score <= pm.t10)} and ${share((r) => r.score <= pm.t25)} of buildings.</li>
    <li>The ward panel shows what share of each ward's buildings fall in the citywide lowest 10%. The vertical tick marks the citywide share.</li>
    <li>${fmt.n(noCoord)} building${noCoord === 1 ? ' has' : 's have'} no coordinates and can't be mapped. ${fmt.n(derived)} position${derived === 1 ? ' was' : 's were'} estimated from the dataset's X/Y grid columns because latitude/longitude were blank.</li>
  </ul>`;

  // First draw: frame all mapped buildings.
  if (!fitted && pts.length) { map.fitBounds(pts.map(({ r }) => [r.lat, r.lon]), { padding: [12, 12] }); fitted = true; }

  renderWardPanel(ctx);
}

export function focusOnMap(ctx, { fly = true } = {}) {
  if (!map) return;
  const { pm, ward, selected } = ctx;
  const sel = selected && pm.latestByRsn.get(selected);
  if (sel?.lat != null && fly) { map.flyTo([sel.lat, sel.lon], 15, { duration: 0.8 }); return; }
  if (ward) {
    const pts = pm.latest.filter((r) => r.ward === ward && r.lat != null).map((r) => [r.lat, r.lon]);
    if (pts.length) map.flyToBounds(pts, { padding: [30, 30], duration: 0.8, maxZoom: 14 });
  } else map.flyToBounds(pm.latest.filter((r) => r.lat != null).map((r) => [r.lat, r.lon]), { padding: [12, 12], duration: 0.8 });
}

function renderWardPanel(ctx) {
  const { pm, ward } = ctx;
  const rows = wardLowShares(pm.latest, pm);
  const city = pm.latest.filter((r) => r.score <= pm.t10).length / pm.latest.length;
  const max = Math.max(city, d3.max(rows, (d) => d.share)) * 1.05;
  const el = document.getElementById('ward-chart');
  el.innerHTML = rows.map((d) => `
    <button type="button" class="ward-row ${d.ward === ward ? 'active' : ''}" data-ward="${d.ward}" aria-pressed="${d.ward === ward}"
      aria-label="Ward ${+d.ward} ${esc(d.name)}: ${d.low10} of ${d.n} buildings (${pct(d.share)}) in the lowest 10%"
      title="${d.low10} of ${d.n} buildings · median score ${d.median}">
      <span class="name">${esc(d.name)}</span>
      <span class="track" aria-hidden="true"><span class="fill" style="width:${(d.share / max) * 100}%"></span><span class="city" style="left:${(city / max) * 100}%"></span></span>
      <span class="val">${pct(d.share)}</span>
    </button>`).join('');
  let foot = el.parentElement.querySelector('.ward-foot');
  if (!foot) { foot = document.createElement('div'); foot.className = 'ward-foot'; el.parentElement.appendChild(foot); }
  foot.innerHTML = `<span class="city-key" aria-hidden="true"></span> Citywide: ${pct(city)} of buildings are in the lowest 10%`;
  el.querySelectorAll('.ward-row').forEach((b) => b.addEventListener('click', () => ctx.setWard(b.dataset.ward === ward ? '' : b.dataset.ward)));

  // Key finding
  const low = pm.latest.filter((r) => r.score <= pm.t10);
  if (ward) {
    const d = rows.find((x) => x.ward === ward);
    setFinding('q1-takeaway', d && {
      value: pct(d.share),
      caption: `of buildings in ${esc(d.name)} are in Toronto's lowest-scoring 10%`,
      text: `That's ${d.low10} of ${d.n} buildings, compared with ${pct(city)} citywide. This ward ranks ${rows.indexOf(d) + 1} of ${rows.length}.`,
    });
    return;
  }
  const top3 = rows.slice(0, 3);
  const top3Low = d3.sum(top3, (d) => d.low10), top3N = d3.sum(top3, (d) => d.n);
  setFinding('q1-takeaway', {
    value: `${(top3[0].share / city).toFixed(1)}×`,
    caption: `the citywide rate of low scorers, in ${esc(top3[0].name)}`,
    text: `Low scorers are <b>not spread evenly</b>. The three highest wards (${top3.map((d) => esc(d.name)).join(', ')}) have ${pct(top3N / pm.latest.length)} of all buildings but ${pct(top3Low / low.length)} of the lowest-scoring ones.`,
  });
}
