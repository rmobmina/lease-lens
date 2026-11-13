// Tests for the Explore atlas (dashboard/js/atlas/), run against the real files: the RentSafeTO CSVs,
// the City ward boundaries and the 3D Massing shards. They check that the map says what the data says
// (choropleth shares, cluster counts, positions) and that the interaction rules hold (zoom hysteresis,
// addresses, legacy links, search order).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as d3 from 'd3';
import { loadData } from './load-data.mjs';

let M, pm, A, wards;
before(async () => {
  const data = await loadData();
  globalThis.d3 = d3;
  globalThis.LLC ??= { fmt: { n: (v) => String(v) }, tip: {}, hash: () => 0 }; // ui.js reads these at import
  const { buildModel } = await import('../dashboard/js/model.js');
  A = await import('../dashboard/js/atlas/logic.js');
  M = buildModel(data);
  pm = M.byPeriod.cur;
  wards = JSON.parse(await readFile(new URL('../dashboard/data/wards/toronto-wards.json', import.meta.url), 'utf8'));
});

// ---- geometry helpers (independent of the app) ------------------------------------------------------
const inRing = (x, y, ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const inMulti = (lon, lat, mp) => mp.some((poly) => inRing(lon, lat, poly[0]) && !poly.slice(1).some((h) => inRing(lon, lat, h)));

// ---- ward boundaries -----------------------------------------------------------------------------------
test('ward boundaries: the City’s 25-ward model, with the same codes as the RentSafeTO records', () => {
  assert.equal(wards.features.length, 25);
  const codes = wards.features.map((f) => f.properties.ward).sort();
  assert.deepEqual(codes, d3.range(1, 26).map((n) => String(n).padStart(2, '0')));
  for (const w of M.wards) assert.ok(codes.includes(w.ward), `RentSafeTO ward ${w.ward} has a boundary`);
  for (const f of wards.features) assert.equal(f.geometry.type, 'MultiPolygon');
});

test('ward boundaries: buildings fall inside the ward the City assigned them (geographic accuracy)', () => {
  const geo = new Map(wards.features.map((f) => [f.properties.ward, f.geometry.coordinates]));
  const mapped = pm.latest.filter((r) => r.lat != null && r.coordSource !== 'derived-from-XY');
  const inside = mapped.filter((r) => inMulti(r.lon, r.lat, geo.get(r.ward)));
  // Address points on a boundary street and the 12 m simplification can put a few just outside.
  assert.ok(inside.length / mapped.length > 0.985, `${inside.length} of ${mapped.length} inside their ward`);
  // and every mapped building is inside SOME ward (nothing is placed in the lake or outside the city)
  const anywhere = mapped.filter((r) => [...geo.values()].some((g) => inMulti(r.lon, r.lat, g)));
  assert.ok(anywhere.length / mapped.length > 0.995);
});

// ---- choropleth ------------------------------------------------------------------------------------------
test('choropleth: each ward’s share is its buildings in the citywide lowest 10%, recomputed from the evaluations', () => {
  const ch = A.wardChoropleth(pm);
  // recomputed here from the kept evaluation records (not through model.js's latest/wardLowShares)
  const latestRaw = new Map();
  for (const r of pm.recs) { const p = latestRaw.get(r.rsn); if (!p || r.time > p.time) latestRaw.set(r.rsn, r); }
  assert.equal(latestRaw.size, pm.latest.length);
  const scores = [...latestRaw.values()].map((r) => r.score).sort(d3.ascending);
  const t10 = Math.floor(d3.quantileSorted(scores, 0.1));
  assert.equal(ch.t10, t10);
  for (const w of M.wards) {
    const inWard = [...latestRaw.values()].filter((r) => r.ward === w.ward);
    const row = ch.byWard.get(w.ward);
    if (!inWard.length) { assert.equal(row, undefined); continue; }
    assert.equal(row.n, inWard.length, `ward ${w.ward} count`);
    assert.equal(row.low10, inWard.filter((r) => r.score <= t10).length, `ward ${w.ward} low count`);
    assert.ok(Math.abs(row.share - row.low10 / row.n) < 1e-12);
  }
  assert.equal(d3.sum(ch.rows, (d) => d.n), pm.latest.filter((r) => r.ward).length, 'every building with a ward counts once');
  assert.ok(Math.abs(ch.city - pm.latest.filter((r) => r.score <= t10).length / pm.latest.length) < 1e-12);
});

test('choropleth: classes are ordered by the share relative to the city, and the legend covers every ward', () => {
  for (const era of ['cur', 'pre']) {
    const ch = A.wardChoropleth(M.byPeriod[era]);
    const sorted = [...ch.rows].sort((a, b) => a.share - b.share);
    for (let i = 1; i < sorted.length; i++) assert.ok(ch.byWard.get(sorted[i].ward).cls >= ch.byWard.get(sorted[i - 1].ward).cls);
    for (const d of ch.rows) {
      const r = ch.ranges[ch.byWard.get(d.ward).cls];
      assert.ok(d.share >= r.from - 1e-12 && (r.to == null || d.share < r.to + 1e-12), `${d.name} sits in its legend range`);
    }
    assert.equal(d3.sum(ch.ranges, (r) => r.wards), ch.rows.length);
    // grey means "about the same as the city": the city's own share falls in the middle class
    assert.equal(ch.classOf(ch.city), 2);
    for (const d of ch.rows) assert.equal(ch.byWard.get(d.ward).small, d.n < A.SMALL_WARD);
  }
});

test('choropleth: the text summary names real wards with their real shares', () => {
  const ch = A.wardChoropleth(pm);
  const s = A.choroplethSummary(ch, (v) => `${Math.round(v * 100)}%`);
  const top = ch.rows.find((d) => d.n >= A.SMALL_WARD);
  assert.ok(s.includes(`${top.name} ${Math.round(top.share * 100)}%`));
  assert.ok(s.includes(`score ${pm.t10} or below`));
});

// ---- levels of detail -----------------------------------------------------------------------------------
test('levels: zoom thresholds use hysteresis, so jitter at a boundary never flips the layers', () => {
  const { ZOOM, levelFor } = A;
  assert.equal(levelFor(10.5), 'city');
  assert.equal(levelFor(ZOOM.areaIn), 'area');
  assert.equal(levelFor(ZOOM.buildingIn), 'building');
  // zooming out from area: stays area until below areaOut
  assert.equal(levelFor(ZOOM.areaIn - 0.25, 'area'), 'area');
  assert.equal(levelFor(ZOOM.areaOut - 0.01, 'area'), 'city');
  // zooming out from building: stays building until below buildingOut
  assert.equal(levelFor(ZOOM.buildingIn - 0.25, 'building'), 'building');
  assert.equal(levelFor(ZOOM.buildingOut - 0.01, 'building'), 'area');
  // zooming in from city: does not switch inside the band
  assert.equal(levelFor(ZOOM.areaIn - 0.25, 'city'), 'city');
  // a pinch that wobbles around 12 produces one switch, not many
  let lvl = 'city', switches = 0;
  for (const z of [11.8, 12.0, 11.9, 12.05, 11.75, 12.1, 11.9]) { const n = levelFor(z, lvl); if (n !== lvl) switches++; lvl = n; }
  assert.equal(switches, 1);
  // ward fill fades monotonically with zoom
  const f = [10, 11.5, 12, 12.5, 13, 13.5, 16].map(A.wardFillOpacity);
  for (let i = 1; i < f.length; i++) assert.ok(f[i] <= f[i - 1]);
  assert.equal(A.wardFillOpacity(11), 1); // solid at the city view
  assert.ok(A.wardFillOpacity(16) < 0.1); // a faint wash among buildings
});

test('clusters: every mapped building is counted exactly once, with its band', () => {
  const pts = pm.latest.map((r) => ({ rsn: r.rsn, lat: r.lat, lon: r.lon, band: r.score <= pm.t10 ? 'low10' : r.score <= pm.t25 ? 'low25' : 'other' }));
  const mapped = pts.filter((p) => p.lat != null);
  for (const z of [12, 12.5, 13, 13.5]) {
    const cl = A.clusterScreen(pts, z);
    assert.equal(d3.sum(cl, (c) => c.n), mapped.length);
    assert.equal(d3.sum(cl, (c) => c.low10), mapped.filter((p) => p.band === 'low10').length);
    assert.equal(new Set(cl.flatMap((c) => c.rsns)).size, mapped.length);
    for (const c of cl) {
      const e = 1e-9; // the mean of identical coordinates can differ from them in the last bit
      assert.ok(c.lat >= c.minLat - e && c.lat <= c.maxLat + e && c.lon >= c.minLon - e && c.lon <= c.maxLon + e, 'a group sits among its own buildings');
    }
  }
});

test('clusters: no two discs overlap on screen, and the view stays uncluttered', () => {
  const pts = pm.latest.map((r) => ({ rsn: r.rsn, lat: r.lat, lon: r.lon, band: 'other' }));
  for (const z of [12, 12.5, 13, 13.5]) {
    const cl = A.clusterScreen(pts, z);
    const xy = cl.map((c) => [...A.mercator(c.lat, c.lon, z), A.clusterDiameter(c.n) / 2]);
    for (let i = 0; i < xy.length; i++) for (let j = i + 1; j < xy.length; j++) {
      const d = Math.hypot(xy[i][0] - xy[j][0], xy[i][1] - xy[j][1]);
      assert.ok(d >= xy[i][2] + xy[j][2], `groups ${i} and ${j} overlap at zoom ${z}`);
    }
  }
  // far fewer groups than the old fixed 1.2 km grid gave at zoom 12 (about 330)
  assert.ok(A.clusterScreen(pts, 12).length < 200);
});

test('clusters: grid cells nest, so a group at z+1 lies inside one group at z', () => {
  const r = pm.latest.filter((x) => x.lat != null).slice(0, 400);
  for (const p of r) {
    for (const zi of [12, 13]) {
      const [ , cx, cy] = A.cellKey(p.lat, p.lon, zi + 1).split(':').map(Number);
      const [ , px, py] = A.cellKey(p.lat, p.lon, zi).split(':').map(Number);
      assert.deepEqual([Math.floor(cx / 2), Math.floor(cy / 2)], [px, py]);
    }
  }
});

test('nearby: closest buildings first, never the building itself, within the radius', () => {
  const r = pm.latest.find((x) => x.lat != null && x.ward === '13');
  const near = A.nearby(r, pm.latest, 5, 1500);
  assert.ok(near.length > 0);
  for (let i = 1; i < near.length; i++) assert.ok(near[i].d >= near[i - 1].d);
  for (const { r: x, d } of near) { assert.notEqual(x.rsn, r.rsn); assert.ok(d <= 1500); assert.equal(x.era, 'cur'); }
  // and nothing closer was skipped
  const all = pm.latest.filter((x) => x.rsn !== r.rsn && x.lat != null).map((x) => A.distanceM(r, x)).sort(d3.ascending);
  assert.deepEqual(near.map((x) => Math.round(x.d)), all.slice(0, near.length).map(Math.round));
  assert.deepEqual(A.nearby({ ...r, lat: null }, pm.latest), []);
});

test('footprints: the massing outline lands back on the building’s own address point', async () => {
  const shard = JSON.parse(await readFile(new URL('../dashboard/data/massing/0.json', import.meta.url), 'utf8'));
  let checked = 0;
  for (const e of Object.values(shard)) {
    if (e.provenance !== 'massing' || e.match?.method !== 'contains') continue;
    const recs = (M.data.byRsn.get(e.rsn) ?? []).filter((r) => r.lat != null);
    const at = recs.reduce((a, r) => (!a || r.time > a.time ? r : a), null);
    if (!at) continue;
    const rings = A.footprintLatLngs(e, at.lat, at.lon);
    assert.ok(rings.length > 0);
    const hit = rings.some((poly) => inRing(at.lat, at.lon, poly[0]));
    assert.ok(hit, `address point of ${e.rsn} inside its reconstructed footprint`);
    if (++checked >= 40) break;
  }
  assert.ok(checked >= 20, `checked ${checked} buildings`);
  assert.deepEqual(A.footprintLatLngs({ provenance: 'approximate' }, 43.7, -79.4), []);
});

// ---- addresses -------------------------------------------------------------------------------------------
test('explore address: encode and decode round-trip; unknown values are ignored', () => {
  const s = { center: [43.66123, -79.38456], zoom: 14.5, ward: '09', selected: '4152711', lens: 'age', period: 'pre', mapShow: 'low10' };
  const h = A.encodeExplore(s);
  assert.equal(h, '#/explore?at=43.6612,-79.3846,14.5&ward=09&b=4152711&lens=age&sys=pre&show=low10');
  const d = A.decodeExplore(h.split('?')[1]);
  assert.deepEqual(d, { view: { center: [43.6612, -79.3846], zoom: 14.5 }, ward: '09', selected: '4152711', lens: 'age', period: 'pre', mapShow: 'low10' });
  assert.equal(A.encodeExplore({ period: 'cur', mapShow: 'all' }), '#/explore');
  assert.deepEqual(A.decodeExplore('at=999,0,12&ward=x&b=abc&lens=nope&sys=2020&show=some'), {});
  assert.equal(A.decodeExplore('at=43.7,-79.4,40').view.zoom, A.ZOOM.max, 'zoom is clamped');
});

test('legacy links land on the same content in the atlas', () => {
  assert.equal(A.legacyRoute('q1'), '#/explore?lens=wards');
  assert.equal(A.legacyRoute('q4'), '#/explore?lens=changes');
  assert.equal(A.legacyRoute('building', '4152711'), '#/explore?b=4152711');
  assert.equal(A.legacyRoute('explore', 'age'), '#/explore?lens=age');
  assert.equal(A.legacyRoute('trends', 'movers'), '#/explore?lens=movers');
  assert.equal(A.legacyRoute('fingerprint', '123'), '#/compare/123');
  assert.equal(A.legacyRoute('explore'), null);
  assert.equal(A.legacyRoute('xray', '1'), null);
});

test('search: address prefix first, then word starts, then anywhere; both scoring systems searchable', async () => {
  const { rankMatches } = await import('../dashboard/js/atlas/search.js');
  const recs = [{ address: '12 BLOOR ST W' }, { address: '200 JAMESON AVE' }, { address: '1200 BAY ST' }, { address: '35 JAMESON AVE' }].map((r) => ({ ...r }));
  assert.deepEqual(rankMatches(recs, 'jameson').map((r) => r.address), ['35 JAMESON AVE', '200 JAMESON AVE']);
  assert.deepEqual(rankMatches(recs, '12').map((r) => r.address), ['12 BLOOR ST W', '1200 BAY ST']);
  assert.deepEqual(rankMatches(recs, '  '), []);
  // every evaluated building can be found by its full address
  const all = [...pm.latest, ...M.byPeriod.pre.latest.filter((r) => !pm.latestByRsn.has(r.rsn))];
  for (const r of all.slice(0, 300)) assert.ok(rankMatches(all, r.address, 50).some((x) => x.rsn === r.rsn), r.address);
});

test('address search: long street words, punctuation and case match the City forms', async () => {
  const { rankMatches, normalizeAddress } = await import('../dashboard/js/atlas/search.js');
  assert.equal(normalizeAddress('  1385 midland avenue '), '1385 MIDLAND AVE');
  assert.equal(normalizeAddress('874 Lawrence Avenue East'), '874 LAWRENCE AVE E');
  const recs = [{ address: '874 LAWRENCE AVE E' }, { address: '1385 MIDLAND AVE' }, { address: '30 DENARDA ST' }, { address: '1385 MIDLAND AVE E' }];
  assert.deepEqual(rankMatches(recs, 'lawrence avenue east').map((r) => r.address), ['874 LAWRENCE AVE E']);
  assert.deepEqual(rankMatches(recs, 'denarda street').map((r) => r.address), ['30 DENARDA ST']);
  // the exact address ranks ahead of a longer one that starts the same way
  assert.deepEqual(rankMatches(recs, '1385 midland ave').map((r) => r.address), ['1385 MIDLAND AVE', '1385 MIDLAND AVE E']);
  assert.deepEqual(rankMatches(recs, 'no such road'), []);
  assert.ok(recs.every((r) => Object.keys(r).length === 1), 'records are not modified');
});
