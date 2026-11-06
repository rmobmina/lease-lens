// Temporal chapter — data transformation only (no DOM, no drawing).
// Input: the normalized records from explorer/js/data.js (LL.loadAll), reused unchanged.
// Output: one "change" row per building, plus counts used for copy, annotations and validation.
//
// Definitions (documented in docs/temporal-chapter.md):
// - Same building      = same RSN (registration number). Never matched by address.
// - Comparable period  = the 2023–current file only. Pre-2023 scores use a different method
//                        (20 categories rated 1–5 vs 50 rated 0–3), so crossing the change would
//                        mostly measure the method, not the building.
// - First evaluation   = earliest EVALUATION COMPLETED ON date for that RSN in the 2023+ file.
// - Latest evaluation  = most recent date. Ties on date would be flagged, not resolved silently.
// - Eligible           = RSN has >= 2 evaluations with a score and a date.
// - Direction          = sign of (latest − first). "Same" means exactly equal.

const TEMPORAL = (() => {
  const ERA_KEY = 'cur';
  const LOW_START = 65;   // "initially scored below 65" subgroup
  const HIGH_START = 95;  // "initially scored 95 or higher" subgroup

  function direction(delta) { return delta > 0 ? 'higher' : delta < 0 ? 'lower' : 'same'; }

  function build(records) {
    const audit = { rowsInPeriod: 0, missingScore: [], missingDate: [], duplicateDates: [], createdInError: [], buildingsInPeriod: 0, singleEvaluation: 0, threeOrMore: [] };
    const inPeriod = records.filter((r) => r.era === ERA_KEY);
    audit.rowsInPeriod = inPeriod.length;

    // Rows we cannot place in time or on the scale are excluded from pairs but listed, never dropped silently.
    const usable = [];
    for (const r of inPeriod) {
      if (r.flags.includes('created-in-error')) { audit.createdInError.push(r.uid); continue; }
      if (r.score == null) { audit.missingScore.push(r.uid); continue; }
      if (!r.date) { audit.missingDate.push(r.uid); continue; }
      usable.push(r);
    }

    const byRsn = d3.group(usable, (r) => r.rsn);
    audit.buildingsInPeriod = byRsn.size;
    const changes = [], singles = [];
    for (const [rsn, evs] of byRsn) {
      evs.sort((a, b) => d3.ascending(a.time, b.time) || d3.ascending(a.uid, b.uid));
      const dates = evs.map((e) => e.date);
      if (new Set(dates).size !== dates.length) audit.duplicateDates.push(rsn);
      if (evs.length < 2) { singles.push({ rsn, address: evs[0].address, only: evs[0] }); continue; }
      if (evs.length > 2) audit.threeOrMore.push(rsn);
      const first = evs[0], latest = evs[evs.length - 1];
      const delta = +(latest.score - first.score).toFixed(1);
      changes.push({
        rsn,
        address: latest.address,
        ward: latest.wardName,
        first: { score: first.score, date: first.date },
        latest: { score: latest.score, date: latest.date },
        between: evs.slice(1, -1).map((e) => ({ score: e.score, date: e.date })),
        delta,
        dir: direction(delta),
        days: Math.round((latest.time - first.time) / 864e5),
      });
    }
    audit.singleEvaluation = singles.length;
    return { changes, singles, audit, summary: summarize(changes) };
  }

  function share(rows, pred) { const n = rows.filter(pred).length; return { n, pct: rows.length ? (n / rows.length) * 100 : 0 }; }

  function summarizeGroup(rows) {
    return {
      n: rows.length,
      higher: share(rows, (c) => c.dir === 'higher'),
      same: share(rows, (c) => c.dir === 'same'),
      lower: share(rows, (c) => c.dir === 'lower'),
      meanDelta: d3.mean(rows, (c) => c.delta),
      medianDelta: d3.median(rows, (c) => c.delta),
    };
  }

  function summarize(changes) {
    const bands = [[0, 65, 'Below 65'], [65, 75, '65–74'], [75, 85, '75–84'], [85, 95, '85–94'], [95, 101, '95–100']];
    return {
      all: summarizeGroup(changes),
      lowStart: summarizeGroup(changes.filter((c) => c.first.score < LOW_START)),
      highStart: summarizeGroup(changes.filter((c) => c.first.score >= HIGH_START)),
      small: share(changes, (c) => Math.abs(c.delta) <= 2),
      bigUp: share(changes, (c) => c.delta >= 10),
      bigDown: share(changes, (c) => c.delta <= -10),
      byStartBand: bands.map(([lo, hi, label]) => ({ label, ...summarizeGroup(changes.filter((c) => c.first.score >= lo && c.first.score < hi)) })),
      firstDates: d3.extent(changes, (c) => c.first.date),
      latestDates: d3.extent(changes, (c) => c.latest.date),
      medianDays: d3.median(changes, (c) => c.days),
    };
  }

  // Asserted against the figures quoted in the story copy. Logged to the console on load.
  function validate(result) {
    const s = result.summary.all, lo = result.summary.lowStart;
    const checks = [
      ['buildings evaluated at least twice = 3,215', s.n === 3215],
      ['higher ≈ 64%', Math.round(s.higher.pct) === 64],
      ['lower ≈ 29%', Math.round(s.lower.pct) === 29],
      ['same ≈ 6%', Math.round(s.same.pct) === 6],
      ['higher + same + lower = n', s.higher.n + s.same.n + s.lower.n === s.n],
      ['mean change ≈ +3.4', Math.abs(s.meanDelta - 3.4) < 0.05],
      ['started below 65 = 61', lo.n === 61],
      ['of those, ≈ 97% higher', Math.round(lo.higher.pct) === 97],
      ['of those, mean change ≈ +29.5', Math.abs(lo.meanDelta - 29.5) < 0.05],
      ['no duplicate evaluation dates within a building', result.audit.duplicateDates.length === 0],
    ];
    return checks.map(([label, ok]) => ({ label, ok }));
  }

  return { build, validate, direction, LOW_START, HIGH_START };
})();

window.TEMPORAL = TEMPORAL;
