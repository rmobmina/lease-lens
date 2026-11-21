// Tests for "Beyond the Score" and the homepage atlas data, run against the real files.
// Every number the story quotes comes from story/selectors.js; these tests check those numbers
// against independent calculations from the raw CSV rows, and check the story's rules
// (one scoring system at a time, missing ratings never counted, reproducible examples).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as d3 from 'd3';
import { loadData } from './load-data.mjs';

let M, pm, S, sel;
before(async () => {
  const data = await loadData();
  globalThis.d3 = d3;
  const { buildModel } = await import('../dashboard/js/model.js');
  S = await import('../dashboard/js/story/selectors.js');
  sel = await import('../dashboard/js/fingerprint-model.js');
  M = buildModel(data);
  pm = M.byPeriod.cur;
});

test('hook (prologue): the median latest score (current system) is 92, computed from the data', () => {
  const d = S.scoreDistribution(pm);
  const scores = pm.latest.map((r) => r.score).sort((a, b) => a - b);
  assert.equal(d.n, scores.length);
  assert.equal(d.median, d3.median(scores));
  assert.equal(d.median, 92, 'the story text was written for a median of 92; re-check the copy if the data changes');
  assert.ok(d.q1 <= d.median && d.median <= d.q3);
  assert.equal(d3.sum(d.bins, (b) => b.n), d.n, 'the histogram counts every building once');
  assert.ok(pm.latest.every((r) => r.era === 'cur'), 'only the current scoring system');
});

test('Where? (location): the highlighted ward is the highest share among wards with enough buildings', () => {
  const w = S.wardContrast(pm);
  assert.ok(w.top, 'a ward qualifies');
  assert.ok(w.top.n >= S.WARD_MIN_BUILDINGS);
  for (const x of w.wards) if (x.n >= S.WARD_MIN_BUILDINGS) assert.ok(x.share <= w.top.share);
  const inWard = pm.latest.filter((r) => r.ward === w.top.ward);
  assert.equal(w.top.n, inWard.length);
  assert.equal(w.top.low10, inWard.filter((r) => r.score <= pm.t10).length);
  assert.ok(w.top.share > w.city, 'the ward really is above the citywide share');
});

test('What? (problems): category shares count only rated items; N/A and blanks never count as low or as a pass', () => {
  const c = S.categoryShares(pm);
  for (const z of c.zones) {
    assert.ok(z.n > 0 && z.n <= pm.latest.length);
    assert.ok(z.any <= z.n);
    // independent count from the raw ratings
    let n = 0, any = 0;
    for (const r of pm.latest) {
      const rated = z.items.filter((col) => r.ratings[col] != null);
      if (!rated.length) continue;
      n++;
      if (rated.some((col) => r.ratings[col] <= pm.P.poorMax)) any++;
    }
    assert.equal(z.n, n, z.key);
    assert.equal(z.any, any, z.key);
  }
  assert.ok(c.zones[0].share >= c.zones[1].share, 'sorted, so the story names the largest');
});

test('What’s inside a 92? and the aha (building, compare): the example pair follows the documented rule and is not exaggerated', () => {
  const p = S.examplePair(pm);
  const median = S.scoreDistribution(pm).median;
  const [a, b] = sel.sameScorePairs(pm.latest, median, pm.cats)[0];
  assert.equal(p.a.rec.rsn, a.rsn);
  assert.equal(p.b.rec.rsn, b.rsn);
  assert.equal(p.a.rec.score, p.b.rec.score, 'exactly the same score');
  assert.equal(p.a.rec.score, median);
  // low marks recounted from the raw ratings (0 or 1 on the 0–3 scale)
  const lows = (r) => pm.cats.filter((col) => r.ratings[col] != null && r.ratings[col] <= 1).length;
  assert.equal(p.a.lows.length, lows(a));
  assert.equal(p.b.lows.length, lows(b));
  assert.ok(p.a.lows.length > p.b.lows.length, 'the difference the story highlights is real');
  assert.equal(p.a.topZone.poor, d3.max(p.a.profile.zones, (z) => z.poor));
});

test('When? (history): history is reported within one scoring system; the other system is never compared', () => {
  const p = S.examplePair(pm);
  for (const r of [p.a.rec, p.b.rec]) {
    const h = S.historyIn(M, r.rsn, 'cur');
    assert.ok(h.inEra.every((x) => x.era === 'cur'));
    for (const x of h.inEra) if (x.prev) assert.equal(x.prev.era, 'cur', 'change measured within the same system');
    assert.equal(h.inEra.length + h.otherSystem, h.all.length);
  }
  const re = S.reinspections(pm);
  assert.equal(re.n, pm.pairs.length);
  assert.ok(pm.pairs.every((x) => x.a.era === 'cur' && x.b.era === 'cur'));
  assert.equal(re.up + re.down + re.same, re.n);
});

test('homepage atlas data: well-formed, inside its box, rentals point at real footprints', async () => {
  const doc = JSON.parse(await readFile(new URL('../dashboard/data/hero/toronto-hero.json', import.meta.url)));
  assert.equal(doc.v, 1);
  assert.equal(doc.frame.length, 4);
  assert.ok(doc.b.length > 1000 && doc.r.length > 100 && doc.s.length > 0);
  const [[x0, y0], [x1, y1]] = doc.bbox;
  for (const b of doc.b) {
    assert.ok(b[0] >= 4 && b[0] < 700, 'height in metres');
    assert.equal((b.length - 2) % 2, 0);
    assert.ok(b[2] >= x0 - 5 && b[2] <= x1 + 5 && b[3] >= y0 - 5 && b[3] <= y1 + 5, 'first vertex inside the box');
  }
  const rsns = new Set(M.data.records.map((r) => r.rsn));
  for (const r of doc.rent) {
    assert.ok(rsns.has(r.rsn), `${r.rsn} is a RentSafeTO building`);
    assert.ok(r.b.length && r.b.every((i) => Number.isInteger(i) && i >= 0 && i < doc.b.length));
  }
  assert.ok(doc.sources.some((s) => /3D Massing/.test(s)) && doc.sources.some((s) => /Centreline/.test(s)));
});

test('the story is seven questions, with the storytelling arc underneath: setting → hook → rising → one aha → falling → next step', async () => {
  globalThis.LLC ??= { fmt: { n: String }, hash: () => 0, tip: {} };   // ui.js expects the explorer's chart helpers (a browser global)
  const { CHAPTERS, STAGES, chapterIndex } = await import('../dashboard/js/story/chapters.js');
  assert.equal(CHAPTERS.length, 7, 'seven steps (the counter reads 1/7 … 7/7)');
  const order = Object.keys(STAGES);
  const stages = CHAPTERS.map((c) => c.stage);
  for (let i = 1; i < stages.length; i++) assert.ok(order.indexOf(stages[i]) >= order.indexOf(stages[i - 1]), `stages in order: ${stages.join(' → ')}`);
  for (const st of order) assert.ok(stages.includes(st), `has a ${st} step`);
  assert.equal(stages.filter((s) => s === 'aha').length, 1, 'exactly one aha');
  const D = { dist: { median: 92 }, pair: { a: { rec: { score: 92 } } } };
  for (const c of CHAPTERS) {
    const t = c.title(D);
    assert.match(t, /\?$/, `${c.id}: the heading is a question ("${t}")`);
    assert.ok(t.split(/\s+/).length <= 10, `${c.id}: a short question heading ("${t}")`);
  }
  assert.equal(CHAPTERS[chapterIndex('aha')].stage, 'aha', 'the old #/story/aha address opens the aha step');
  assert.equal(CHAPTERS[chapterIndex('problems')].id, 'building', 'the retired problems step lands on the inspection step');
  assert.ok(CHAPTERS.at(-1).final, 'the last step ends with an action');
});

test('story caption: a compact step counter, and no visible stage labels or storyline graphic', async () => {
  const src = await readFile(new URL('../dashboard/js/story/controller.js', import.meta.url), 'utf8');
  // every helper the caption calls must be defined in the controller (a missing one crashes the story at run time)
  for (const fn of ['reserveCopy']) {
    if (new RegExp(`\\b${fn}\\(`).test(src)) assert.match(src, new RegExp(`(function ${fn}\\(|const ${fn} = )`), `controller.js calls ${fn}() but does not define it`);
  }
  assert.match(src, /class="sc-count"[^>]*><b>\$\{index \+ 1\}<\/b>\/\$\{n\}/, 'the caption shows the step counter (1/7)');
  assert.match(src, /Step \$\{index \+ 1\} of \$\{n\}/, 'screen readers hear "Step 1 of 7"');
  assert.doesNotMatch(src, /sc-stage|sc-arc|stageLabel/, 'no stage label or storyline graphic in the caption');
});
