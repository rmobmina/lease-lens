// Tests for the Building X-Ray data layer, run against the real RentSafeTO files.
// Run with: npm test   (node --test, no extra dependencies)
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { loadData, rawRows } from './load-data.mjs';
import { PERIODS, EXCLUDED_FLAGS, latestPerBuilding } from '../dashboard/js/model.js';
import {
  XRAY_ZONES, CONCENTRATED, zoneStatus, scaleFor, mappingGaps, zoneProfile, buildingEvaluations,
  timelinePoints, timelineSegments, trendSummary, zoneDifferences, findMatches,
} from '../dashboard/js/xray-model.js';

let data, usable, latestCur, byRsn;
before(async () => {
  data = await loadData();
  globalThis.d3 = (await import('d3')); // latestPerBuilding in model.js uses no d3, but keep parity with the browser
  usable = buildingEvaluations(data.records);
  latestCur = latestPerBuilding(usable.filter((r) => r.era === 'cur'));
  byRsn = new Map();
  for (const r of usable) { if (!byRsn.has(r.rsn)) byRsn.set(r.rsn, []); byRsn.get(r.rsn).push(r); }
});

// ---- mapping -------------------------------------------------------------------------------

test('every item column of both files is mapped to exactly one zone', () => {
  for (const era of ['cur', 'pre']) {
    const cats = data.cats[era];
    const { unmapped, missing } = mappingGaps(cats, era);
    assert.deepEqual(unmapped, [], `${era}: unmapped columns`);
    assert.deepEqual(missing, [], `${era}: mapped names that are not real columns`);
    const all = XRAY_ZONES.flatMap((z) => z.items[era]);
    assert.equal(new Set(all).size, all.length, `${era}: an item is in two zones`);
    assert.equal(all.length, cats.length);
  }
  assert.equal(data.cats.cur.length, 50);
  assert.equal(data.cats.pre.length, 20);
});

test('no heating or plumbing items exist, so none are invented', () => {
  const all = [...data.cats.cur, ...data.cats.pre].join(' ');
  assert.doesNotMatch(all, /HEAT|PLUMB|BOILER|WATER SUPPLY/);
});

// ---- rating scale ------------------------------------------------------------------------

test('rating scales and "poor" cut-offs match the data and the Common problems view', () => {
  for (const era of ['cur', 'pre']) {
    const S = scaleFor(era);
    assert.equal(S.poorMax, PERIODS[era].poorMax);
    const values = new Set(data.records.filter((r) => r.era === era).flatMap((r) => Object.values(r.ratings).filter((v) => v != null)));
    assert.deepEqual([...values].sort(), era === 'cur' ? [0, 1, 2, 3] : [1, 2, 3, 4, 5]);
  }
});

test('N/A and blank cells are never counted as passes or problems', () => {
  for (const r of usable.slice(0, 2000)) {
    const p = zoneProfile(r, data.cats[r.era]);
    for (const z of p.zones) {
      for (const i of z.items) if (i.status !== 'rated') assert.equal(i.poor, false);
      assert.equal(z.applicable, z.items.filter((i) => i.status === 'rated').length);
    }
  }
});

// ---- zone status thresholds ---------------------------------------------------------------------

test('zone status thresholds', () => {
  assert.equal(zoneStatus(0, 0), 'none');
  assert.equal(zoneStatus(10, 0), 'ok');
  assert.equal(zoneStatus(4, 1), 'some', 'one low mark in a 4-item zone is not "concentrated"');
  assert.equal(zoneStatus(16, 3), 'some', '3 of 16 is under 25%');
  assert.equal(zoneStatus(8, CONCENTRATED.minPoor), 'high');
  assert.equal(zoneStatus(4, 2), 'high');
});

// ---- the panel matches the original records ---------------------------------------------------------

test('every rating shown in the X-Ray equals the raw CSV cell', async () => {
  for (const era of ['cur', 'pre']) {
    const rows = await rawRows(era);
    const byId = new Map(rows.map((r) => [r._id.trim(), r]));
    const recs = usable.filter((r) => r.era === era);
    // every 7th record: a deterministic sample of ~2,400 evaluations
    for (const r of recs.filter((_, i) => i % 7 === 0)) {
      const raw = byId.get(String(r.rowId).trim());
      assert.ok(raw, `row ${r.rowId} not found`);
      assert.equal(raw.RSN.trim(), r.rsn);
      for (const z of zoneProfile(r, data.cats[era]).zones) {
        for (const i of z.items) {
          const cell = (raw[i.col] ?? '').trim();
          if (i.status === 'na') assert.equal(cell.toUpperCase(), 'N/A');
          else if (i.status === 'blank') assert.equal(cell, '');
          else assert.equal(i.rating, Number(cell), `${r.rsn} ${i.col}`);
        }
      }
    }
  }
});

// ---- named cases ---------------------------------------------------------------------------------

test('a building with multiple poorly rated items (875 Kennedy Rd, Sep 2026)', () => {
  const r = usable.find((d) => d.rsn === '4152711' && d.date === '2026-09-28');
  const p = zoneProfile(r, data.cats.cur);
  const direct = data.cats.cur.filter((c) => r.ratings[c] != null && r.ratings[c] <= 1).length;
  assert.ok(direct >= 10);
  assert.equal(p.poor, direct);
  assert.ok(p.zones.some((z) => z.status === 'high'));
});

test('a building with no poorly rated applicable items', () => {
  const r = latestCur.find((d) => data.cats.cur.every((c) => d.ratings[c] == null || d.ratings[c] > 1));
  assert.ok(r, 'expected at least one clean building');
  const p = zoneProfile(r, data.cats.cur);
  assert.equal(p.poor, 0);
  for (const z of p.zones) assert.ok(['ok', 'none'].includes(z.status));
});

test('missing item-level data: 2017–2023 records have no record items, and blanks are reported', () => {
  const r = usable.find((d) => d.era === 'pre');
  const p = zoneProfile(r, data.cats.pre);
  const rec = p.zones.find((z) => z.key === 'records');
  assert.equal(rec.status, 'none');
  assert.equal(rec.share, null, 'missing data has no percentage, not 0%');

  // The only blank cells in either file belong to one evaluation with no ratings at all
  // (RSN 4155384). It is excluded rather than drawn as a building with nothing wrong.
  const blanks = data.records.filter((d) => d.blankCats.length > 0);
  assert.ok(blanks.length >= 1);
  assert.ok(blanks.every((d) => d.flags.includes('no-ratings')));
  assert.ok(!usable.some((d) => d.blankCats.length > 0));

  // Zones where every item is N/A are "not evaluated", with no percentage.
  const allNa = usable.map((d) => zoneProfile(d, data.cats[d.era])).flatMap((p) => p.zones)
    .find((z) => z.items.length > 0 && z.na === z.items.length);
  if (allNa) { assert.equal(allNa.status, 'none'); assert.equal(allNa.share, null); }
});

test('flagged records (created in error, no ratings, duplicates) are left out', () => {
  assert.ok(usable.every((r) => !r.flags.some((f) => EXCLUDED_FLAGS.includes(f))));
  assert.ok(data.records.some((r) => r.flags.includes('created-in-error')));
});

// ---- timeline ------------------------------------------------------------------------------------

test('a building with only one evaluation has no change and a "single" trend', () => {
  const [, evs] = [...byRsn].find(([, e]) => e.length === 1);
  const pts = timelinePoints(evs);
  assert.equal(pts[0].delta, null);
  assert.equal(trendSummary(pts, evs[0].era).kind, 'single');
  assert.equal(timelineSegments(pts).length, 0);
});

test('a building with no evaluations in a system gets an empty trend', () => {
  const [, evs] = [...byRsn].find(([, e]) => e.every((r) => r.era === 'pre'));
  assert.equal(trendSummary(timelinePoints(evs), 'cur').kind, 'empty');
});

test('multiple evaluations: change is only measured within one scoring system', () => {
  const [, evs] = [...byRsn].find(([, e]) => e.some((r) => r.era === 'pre') && e.filter((r) => r.era === 'cur').length >= 2);
  const pts = timelinePoints(evs);
  const firstCur = pts.find((p) => p.era === 'cur');
  assert.equal(firstCur.delta, null, 'first 2023+ score is not compared with a 2017–2023 score');
  for (const p of pts) if (p.prev) assert.equal(p.prev.era, p.era);
  for (const s of timelineSegments(pts)) assert.ok(s.points.every((p) => p.era === s.era));
  assert.ok(pts.every((p, i) => i === 0 || pts[i - 1].rec.time <= p.rec.time), 'sorted by date');
});

test('a building whose score declined (875 Kennedy Rd: 91 → 75)', () => {
  const pts = timelinePoints(byRsn.get('4152711'));
  const t = trendSummary(pts, 'cur');
  assert.equal(t.kind, 'down');
  assert.equal(t.latest.delta, 75 - 91);
});

test('a building whose score improved', () => {
  const [, evs] = [...byRsn].find(([, e]) => { const t = trendSummary(timelinePoints(e), 'cur'); return t.kind === 'up'; });
  const t = trendSummary(timelinePoints(evs), 'cur');
  assert.ok(t.latest.delta > 0);
  assert.equal(t.latest.delta, t.latest.rec.score - t.latest.prev.score);
});

// ---- same score, different story ---------------------------------------------------------------------

test('matches share the exact score, the scoring system, and exclude the building itself', () => {
  const r = latestCur.find((d) => d.score === 92);
  const { tolerance, matches } = findMatches(r, latestCur, data.cats.cur);
  assert.equal(tolerance, 0);
  assert.ok(matches.length > 10);
  for (const m of matches) {
    assert.equal(m.rec.score, 92);
    assert.equal(m.rec.era, 'cur');
    assert.notEqual(m.rec.rsn, r.rsn);
  }
  // most different first, and deterministic
  for (let i = 1; i < matches.length; i++) assert.ok(matches[i - 1].distance >= matches[i].distance);
  assert.deepEqual(findMatches(r, latestCur, data.cats.cur).matches.map((m) => m.rec.rsn), matches.map((m) => m.rec.rsn));
});

test('two buildings with the same score but different inspection profiles exist', () => {
  const r = latestCur.find((d) => d.score === 92);
  const { base, matches } = findMatches(r, latestCur, data.cats.cur);
  const top = matches[0];
  const diffs = zoneDifferences(base, top.profile);
  assert.equal(top.rec.score, r.score);
  assert.ok(Math.abs(diffs[0].gap) > 0, 'the most different match differs in at least one zone');
  assert.ok(base.poor !== top.profile.poor || diffs.some((d) => d.gap !== 0));
});

test('falls back to a labelled tolerance when no building has the same score', () => {
  const counts = new Map();
  for (const r of latestCur) counts.set(r.score, (counts.get(r.score) ?? 0) + 1);
  const r = latestCur.find((d) => counts.get(d.score) === 1 && [1, 2].some((k) => counts.has(d.score - k) || counts.has(d.score + k)));
  assert.ok(r, 'a uniquely scored building exists');
  const { tolerance, matches } = findMatches(r, latestCur, data.cats.cur);
  assert.ok(tolerance > 0);
  for (const m of matches) assert.ok(Math.abs(m.scoreGap) <= tolerance && m.scoreGap !== 0);
});

test('profiles from different scoring systems are never compared', () => {
  const a = zoneProfile(usable.find((r) => r.era === 'cur'), data.cats.cur);
  const b = zoneProfile(usable.find((r) => r.era === 'pre'), data.cats.pre);
  assert.throws(() => zoneDifferences(a, b));
  const pre = usable.filter((r) => r.era === 'pre');
  const { matches } = findMatches(latestCur[0], [...latestCur, ...pre], data.cats.cur);
  assert.ok(matches.every((m) => m.rec.era === 'cur'));
});
