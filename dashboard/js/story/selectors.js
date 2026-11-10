// "Beyond the Score": every number and example in the story, derived from the shared model.
// No DOM and no globals except d3, so the tests can run these against the real data
// (tests/story.test.mjs) and the page can never quote a number the data doesn't support.
//
// Example buildings are chosen by a rule, not by hand:
//   the median latest score (current system), then fingerprint-model's sameScorePairs at that score,
//   first pair = the building with the most low marks next to one with the fewest.
// Anyone can reproduce the choice from the published files.

import { wardLowShares, itemProblemRates, changeSummary } from '../model.js';
import { XRAY_ZONES, zoneProfile, buildingEvaluations, timelinePoints } from '../xray-model.js';
import { sameScorePairs } from '../fingerprint-model.js';

export const WARD_MIN_BUILDINGS = 50; // wards with fewer evaluated buildings are too small to single out

export function scoreDistribution(pm) {
  const scores = pm.latest.map((r) => r.score).sort(d3.ascending);
  const bins = d3.rollups(scores, (v) => v.length, (s) => s).map(([score, n]) => ({ score, n })).sort((a, b) => a.score - b.score);
  return {
    n: scores.length,
    median: d3.median(scores),
    q1: d3.quantileSorted(scores, 0.25),
    q3: d3.quantileSorted(scores, 0.75),
    atOrAboveMedian: scores.filter((s) => s >= d3.median(scores)).length,
    bins,
  };
}

export function wardContrast(pm) {
  const all = wardLowShares(pm.latest, pm);
  const city = pm.latest.filter((r) => r.score <= pm.t10).length / pm.latest.length;
  const top = all.find((w) => w.n >= WARD_MIN_BUILDINGS);
  return { city, top, t10: pm.t10, wards: all };
}

// Share of buildings with at least one low-rated item in each X-Ray category (latest evaluation,
// only buildings where the category had rated items; N/A and blanks never count).
export function categoryShares(pm) {
  const out = XRAY_ZONES.map((z) => ({ key: z.key, label: z.label, note: z.note, items: z.items[pm.era], n: 0, any: 0 }));
  for (const r of pm.latest) {
    const p = zoneProfile(r, pm.cats);
    p.zones.forEach((z, i) => { if (z.applicable) { out[i].n++; if (z.poor) out[i].any++; } });
  }
  out.forEach((d) => (d.share = d.n ? d.any / d.n : null));
  const items = itemProblemRates(pm.latest, pm).filter((d) => d.rated >= 30).sort((a, b) => b.share - a.share);
  return { zones: [...out].sort((a, b) => b.share - a.share), topItem: items[0] };
}

export function examplePair(pm) {
  const { median } = scoreDistribution(pm);
  const pair = sameScorePairs(pm.latest, median, pm.cats)[0];
  if (!pair) return null;
  const describe = (r) => {
    const p = zoneProfile(r, pm.cats);
    const lows = p.zones.flatMap((z) => z.items.filter((i) => i.poor).map((i) => ({ ...i, zone: z.key, zoneLabel: z.label })));
    const byZone = p.zones.filter((z) => z.poor).sort((a, b) => b.poor - a.poor);
    return { rec: r, profile: p, lows, rated: p.applicable, topZone: byZone[0] ?? null };
  };
  return { score: median, a: describe(pair[0]), b: describe(pair[1]), sameWard: pair[0].ward === pair[1].ward };
}

// One building's history in ONE scoring system (the other system is reported, never compared).
export function historyIn(M, rsn, era) {
  const evals = buildingEvaluations(M.data.records.filter((r) => r.rsn === rsn));
  const pts = timelinePoints(evals);
  const inEra = pts.filter((p) => p.era === era);
  return { all: pts, inEra, otherSystem: pts.length - inEra.length, last: inEra.at(-1) ?? null };
}

export function reinspections(pm) {
  return changeSummary(pm.pairs);
}
