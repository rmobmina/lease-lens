// Explore atlas: the pure logic behind the semantic-zoom map. No DOM, no Leaflet, no globals except
// d3 (through model.js), so tests/atlas.test.mjs can check every rule against the real data.
//
//   levelFor()        which level of detail a zoom shows (city wards → areas → buildings), with
//                     separate zoom-in and zoom-out thresholds so the map never flickers at a boundary
//   wardChoropleth()  the ward fill: share of each ward's buildings in the citywide lowest 10%
//   clusterBuildings  geographic aggregation for the intermediate level
//   nearby()          the closest evaluated buildings to one building
//   encode/decode     the Explore address (#/explore?at=…&ward=…&b=…&lens=…)
//   footprintLatLngs  a building's 3D Massing footprint, placed back on the map

import { wardLowShares } from '../model.js';

// ---- levels of detail -----------------------------------------------------------------------------
// city: ward choropleth only · area: clusters (counts, low scorers inside) · building: one mark each.
// Zooming IN crosses at 12 and 14; zooming OUT only drops back below 11.5 and 13.5. With the map's
// 0.5 zoom step that is one full step of hysteresis, so wheel or pinch jitter at a threshold never
// switches the layers back and forth.
export const LEVEL_ORDER = ['city', 'area', 'building'];
export const ZOOM = { areaIn: 12, areaOut: 11.5, buildingIn: 14, buildingOut: 13.5, building: 16, max: 19 };

export function levelFor(z, prev = 'city') {
  if (prev === 'building') return z < ZOOM.areaOut ? 'city' : z < ZOOM.buildingOut ? 'area' : 'building';
  if (prev === 'area') return z >= ZOOM.buildingIn ? 'building' : z < ZOOM.areaOut ? 'city' : 'area';
  return z >= ZOOM.buildingIn ? 'building' : z >= ZOOM.areaIn ? 'area' : 'city';
}

// Ward fill fades continuously with zoom (strong at city scale, a faint wash once buildings show),
// so the hand-over from wards to buildings reads as one change of scale rather than a swap.
export function wardFillOpacity(z) {
  const hi = 0.82, lo = 0.1;
  if (z <= 11.5) return hi;
  if (z >= 13.5) return lo;
  return hi + (lo - hi) * ((z - 11.5) / 2);
}

// ---- ward choropleth -------------------------------------------------------------------------------
// Value: the share of a ward's evaluated buildings (latest evaluation, one scoring system) whose score
// is in the CITYWIDE lowest 10% (score ≤ pm.t10, ties included), the project's existing definition
// of a low score (model.js). Classes are relative to the citywide share, so the map answers "is this
// ward above or below the city?" with blue for below, grey for about the same and red for above.
export const RATIO_BREAKS = [0.5, 0.85, 1.15, 1.5];
export const CLASS_LABELS = ['Well below the city', 'Below the city', 'About the same as the city', 'Above the city', 'Well above the city'];
export const SMALL_WARD = 30; // fewer evaluated buildings than this: the share is drawn, but flagged as unstable

export function wardChoropleth(pm) {
  const rows = wardLowShares(pm.latest, pm);
  const low = pm.latest.filter((r) => r.score <= pm.t10).length;
  const city = pm.latest.length ? low / pm.latest.length : 0;
  const classOf = (share) => {
    const k = city ? share / city : 0;
    let c = 0;
    while (c < RATIO_BREAKS.length && k >= RATIO_BREAKS[c]) c++;
    return c;
  };
  const byWard = new Map(rows.map((d) => [d.ward, { ...d, cls: classOf(d.share), small: d.n < SMALL_WARD, rank: 0 }]));
  rows.forEach((d, i) => { byWard.get(d.ward).rank = i + 1; });
  // Legend ranges in actual percentages (the breaks times the citywide share).
  const cuts = RATIO_BREAKS.map((b) => b * city);
  const ranges = CLASS_LABELS.map((label, i) => ({
    cls: i, label, from: i === 0 ? 0 : cuts[i - 1], to: i === cuts.length ? null : cuts[i],
    wards: rows.filter((d) => classOf(d.share) === i).length,
  }));
  return { city, low, n: pm.latest.length, t10: pm.t10, rows, byWard, ranges, classOf };
}

// A sentence that says what the choropleth shows, for screen readers and the "Text summary".
export function choroplethSummary(ch, fmtPct) {
  const solid = ch.rows.filter((d) => d.n >= SMALL_WARD);
  const top = solid.slice(0, 3), bottom = solid.slice(-3).reverse();
  return `Citywide, ${fmtPct(ch.city)} of ${ch.n.toLocaleString('en-CA')} evaluated buildings score in the lowest 10% (score ${ch.t10} or below). `
    + `Highest shares: ${top.map((d) => `${d.name} ${fmtPct(d.share)}`).join(', ')}. `
    + `Lowest shares: ${bottom.map((d) => `${d.name} ${fmtPct(d.share)}`).join(', ')}.`;
}

// ---- geography helpers -------------------------------------------------------------------------------
// Ground metres per degree near Toronto (equirectangular; errors are well under 1% inside the city).
const R = 6378137;
const M_PER_DEG = (R * Math.PI) / 180;
export const metresPerDeg = (lat) => ({ y: M_PER_DEG, x: M_PER_DEG * Math.cos((lat * Math.PI) / 180) });

export function distanceM(a, b) {
  const k = metresPerDeg((a.lat + b.lat) / 2);
  return Math.hypot((a.lon - b.lon) * k.x, (a.lat - b.lat) * k.y);
}

// ---- intermediate level: clusters ------------------------------------------------------------------------
// Buildings are grouped on a fixed geographic grid (not a screen grid), so a cluster does not change
// as the map pans. Each cluster sits at the mean position of its own buildings, so it lands on real
// buildings rather than on a grid corner. Cell size halves from zoom 12 to zoom 13.
export const cellForZoom = (z) => (z < 13 ? 1200 : 600);

export function clusterBuildings(pts, cellM, lat0 = 43.7) {
  const k = metresPerDeg(lat0);
  const cells = new Map();
  for (const p of pts) {
    if (p.lat == null || p.lon == null) continue;
    const key = `${Math.floor((p.lon * k.x) / cellM)}:${Math.floor((p.lat * k.y) / cellM)}`;
    let c = cells.get(key);
    if (!c) { c = { key, n: 0, low10: 0, low25: 0, lat: 0, lon: 0, rsns: [], minLat: 90, maxLat: -90, minLon: 180, maxLon: -180 }; cells.set(key, c); }
    c.n++;
    if (p.band === 'low10') c.low10++;
    if (p.band === 'low25') c.low25++;
    c.lat += p.lat; c.lon += p.lon;
    c.rsns.push(p.rsn);
    c.minLat = Math.min(c.minLat, p.lat); c.maxLat = Math.max(c.maxLat, p.lat);
    c.minLon = Math.min(c.minLon, p.lon); c.maxLon = Math.max(c.maxLon, p.lon);
  }
  return [...cells.values()].map((c) => ({ ...c, lat: c.lat / c.n, lon: c.lon / c.n }));
}

// ---- building level ---------------------------------------------------------------------------------------
// The closest evaluated buildings (same scoring system) to one building, nearest first.
export function nearby(rec, latest, n = 5, maxM = 1500) {
  if (rec?.lat == null) return [];
  return latest
    .filter((r) => r.rsn !== rec.rsn && r.lat != null)
    .map((r) => ({ r, d: distanceM(rec, r) }))
    .filter((x) => x.d <= maxM)
    .sort((a, b) => a.d - b.d || a.r.address.localeCompare(b.r.address))
    .slice(0, n);
}

// Placing a 3D Massing entry back on the map. build_massing.py stores every ring in a local frame:
// metres east (x) and north (y) of the footprint's centre, and `point` is the RentSafeTO address point
// in that same frame. So the centre is the address point minus `point`, and each vertex is the centre
// plus its offset. Only ground-level masses are drawn (raised parts sit on top of them).
export function footprintLatLngs(entry, lat, lon) {
  if (!entry?.masses?.length || !Array.isArray(entry.point) || lat == null) return [];
  const k = metresPerDeg(lat);
  const cLat = lat - entry.point[1] / k.y, cLon = lon - entry.point[0] / k.x;
  return entry.masses.filter((m) => !m.roof && m.base === 0 && m.rings?.[0]?.length >= 6).map((m) => m.rings.map((ring) => {
    const out = [];
    for (let i = 0; i < ring.length; i += 2) out.push([cLat + ring[i + 1] / k.y, cLon + ring[i] / k.x]);
    return out;
  }));
}

// ---- address of the Explore view -----------------------------------------------------------------------
// #/explore?at=<lat>,<lon>,<zoom>&ward=<code>&b=<RSN>&lens=<id>&sys=pre&show=low10
// Only what differs from the defaults is written, so a plain #/explore is the city overview.
export const LENS_IDS = ['distribution', 'wards', 'changes', 'age', 'problems', 'movers'];
export const SHOW_IDS = ['all', 'low25', 'low10'];

export function encodeExplore(s) {
  const q = [];
  if (s.center && s.zoom != null) q.push(`at=${s.center[0].toFixed(4)},${s.center[1].toFixed(4)},${+s.zoom.toFixed(2)}`);
  if (s.ward) q.push(`ward=${encodeURIComponent(s.ward)}`);
  if (s.selected) q.push(`b=${encodeURIComponent(s.selected)}`);
  if (s.lens) q.push(`lens=${s.lens}`);
  if (s.period && s.period !== 'cur') q.push(`sys=${s.period}`);
  if (s.mapShow && s.mapShow !== 'all') q.push(`show=${s.mapShow}`);
  return `#/explore${q.length ? `?${q.join('&')}` : ''}`;
}

export function decodeExplore(query = '') {
  const p = new URLSearchParams(query);
  const out = {};
  const at = p.get('at')?.split(',').map(Number);
  if (at?.length === 3 && at.every(Number.isFinite) && Math.abs(at[0]) <= 90 && Math.abs(at[1]) <= 180) out.view = { center: [at[0], at[1]], zoom: Math.max(9, Math.min(ZOOM.max, at[2])) };
  const ward = p.get('ward');
  if (ward && /^\d{2}$/.test(ward)) out.ward = ward;
  const b = p.get('b');
  if (b && /^\d+$/.test(b)) out.selected = b;
  const lens = p.get('lens');
  if (LENS_IDS.includes(lens)) out.lens = lens;
  const sys = p.get('sys');
  if (sys === 'pre' || sys === 'cur') out.period = sys;
  const show = p.get('show');
  if (SHOW_IDS.includes(show)) out.mapShow = show;
  return out;
}

// Addresses from the dashboard-era site keep working: each one lands on the same content in the atlas.
const LEGACY_TABS = { where: 'wards', age: 'age', problems: 'problems', reinspections: 'changes', movers: 'movers' };
export function legacyRoute(route, arg) {
  if (/^q[1-5]$/.test(route)) return `#/explore?lens=${['wards', 'age', 'problems', 'changes', 'movers'][+route[1] - 1]}`;
  if (route === 'home') return '#/';
  if (route === 'fingerprint') return `#/compare${arg ? `/${arg}` : ''}`;
  if (route === 'building') return arg ? `#/explore?b=${arg}` : '#/explore';
  if (route === 'trends') return `#/explore?lens=${arg === 'movers' ? 'movers' : 'changes'}`;
  if (route === 'explore' && arg) return `#/explore${LEGACY_TABS[arg] ? `?lens=${LEGACY_TABS[arg]}` : ''}`;
  return null;
}
