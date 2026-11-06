// Data model for the Lease Lens dashboard.
// Takes the normalized records from explorer/js/data.js (LL.loadAll) and derives
// everything the five sections need. No values are altered here: we only choose
// which records answer each question, and every choice is described on the page.

// Same anomaly flags the explorer's "exclude flagged anomalies" option removes.
export const EXCLUDED_FLAGS = ['created-in-error', 'no-ratings', 'duplicate-rsn-date'];

// The 2023 methodology change makes scores from the two files incomparable,
// so every view shows ONE scoring period at a time.
export const PERIODS = {
  cur: { key: 'cur', label: '2023 – present', long: 'current scoring system (2023 – present)', scale: '0–3', poorMax: 1, poorText: '0 or 1 on the 0–3 scale' },
  pre: { key: 'pre', label: '2017 – 2023', long: 'previous scoring system (2017 – 2023)', scale: '1–5', poorMax: 2, poorText: '1 or 2 on the 1–5 scale' },
};

// Readable names for inspection items whose official names are abbreviated.
// The official name is still shown in tooltips.
const FRIENDLY = {
  'EXT. RECEPTACLE STORAGE AREA': 'Outdoor garbage storage area',
  'INT. RECEPTACLE STORAGE AREA': 'Indoor garbage storage area',
  'ABANDONED EQUIP./DERELICT VEH.': 'Abandoned equipment / vehicles',
  'STORAGE AREAS/LOCKERS MAINT.': 'Storage areas and lockers',
  'INT. HALLWAY - WALLS / CEILING': 'Hallway walls and ceilings',
  'INTERIOR HALLWAY FLOORS': 'Hallway floors',
  'INT. LOBBY / HALLWAY LIGHTING': 'Lobby and hallway lighting',
  'INT. HANDRAIL / GUARD - SAFETY': 'Handrails and guards (safety)',
  'INT. HANDRAIL / GUARD - MAINT.': 'Handrails and guards (upkeep)',
  'STAIRWELL - WALLS AND CEILING': 'Stairwell walls and ceilings',
  'STAIRWELL - LANDING AND STEPS': 'Stairwell landings and steps',
  'LOBBY - WALLS AND CEILING': 'Lobby walls and ceilings',
  'CATCH BASINS / STORM DRAINAGE': 'Catch basins and storm drainage',
  'ELECTRICAL SERVICES / OUTLETS': 'Electrical services and outlets',
  'CHUTE ROOMS - MAINTENANCE': 'Garbage chute rooms',
  'GARBAGE/COMPACTOR ROOM': 'Garbage / compactor room',
  'BUILDING EXTERIOR': 'Building exterior',
  INTERNAL_GUARDS_HANDRAILS: 'Interior guards and handrails',
  INTERIOR_WALL_CEILING_FLOOR: 'Interior walls, ceilings and floors',
  WATER_PEN_EXT_BLDG_ELEMENTS: 'Water penetration (exterior)',
  GARBAGE_BIN_STORAGE_AREA: 'Garbage bin storage area',
  ENTRANCE_DOORS_WINDOWS: 'Entrance doors and windows',
  STORAGE_AREAS_LOCKERS: 'Storage areas and lockers',
};
export const itemLabel = (col) => {
  if (FRIENDLY[col]) return FRIENDLY[col];
  const s = LL.prettyCat(col).toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
};

// 2023+ items that check paperwork or postings rather than physical conditions.
// This grouping is ours (based on the item names) and is explained in the section notes.
const RECORD_ITEM = /\b(LOG|PLAN)$|NOTIFICATION BOARD|EMERGENCY CONTACT SIGN|NUMBERING OF PROPERTY/;
export const isRecordItem = (col) => RECORD_ITEM.test(col);

export function latestPerBuilding(recs) {
  const m = new Map();
  for (const r of recs) { const p = m.get(r.rsn); if (!p || r.time > p.time) m.set(r.rsn, r); }
  return [...m.values()];
}

// Consecutive evaluations of the same building (RSN) within one period. Same logic as
// the explorer's pairs() with cross-period pairs excluded.
export function reinspectionPairs(recs) {
  const out = [];
  for (const [, evs] of d3.group(recs, (r) => r.rsn)) {
    const s = [...evs].sort((a, b) => a.time - b.time);
    for (let i = 1; i < s.length; i++) {
      const a = s[i - 1], b = s[i];
      out.push({ rsn: a.rsn, a, b, delta: b.score - a.score, days: (b.time - a.time) / 864e5 });
    }
  }
  return out;
}

function periodModel(all, era) {
  const inEra = all.filter((r) => r.era === era);
  const flagged = inEra.filter((r) => r.flags.some((f) => EXCLUDED_FLAGS.includes(f)));
  const noScore = inEra.filter((r) => r.score == null && !flagged.includes(r));
  const recs = inEra.filter((r) => r.score != null && !flagged.includes(r));
  const latest = latestPerBuilding(recs);
  const sorted = latest.map((r) => r.score).sort(d3.ascending);
  // "Lowest 10% / 25%" cut-offs are citywide and computed on each building's latest score.
  // Ties at the cut-off are included, so the actual share is reported alongside.
  const t10 = Math.floor(d3.quantileSorted(sorted, 0.1));
  const t25 = Math.floor(d3.quantileSorted(sorted, 0.25));
  return {
    era, P: PERIODS[era], recs, latest, t10, t25,
    latestByRsn: new Map(latest.map((r) => [r.rsn, r])),
    pairs: reinspectionPairs(recs),
    excluded: { flagged: flagged.length, noScore: noScore.length },
    dates: d3.extent(recs, (r) => r.date),
    cats: null, // filled in by buildModel
  };
}

export function buildModel(data) {
  const byPeriod = { cur: periodModel(data.records, 'cur'), pre: periodModel(data.records, 'pre') };
  for (const e of ['cur', 'pre']) byPeriod[e].cats = data.cats[e];
  const wards = d3.rollups(data.records.filter((r) => r.ward), (v) => v[0].wardName, (r) => r.ward)
    .sort((a, b) => d3.ascending(a[0], b[0])).map(([ward, name]) => ({ ward, name }));
  return { data, byPeriod, wards, wardName: new Map(wards.map((w) => [w.ward, w.name])) };
}

export const scoreBand = (score, pm) => (score <= pm.t10 ? 'low10' : score <= pm.t25 ? 'low25' : 'other');

// ---- per-question summaries -------------------------------------------------

export function wardLowShares(latest, pm) {
  return d3.rollups(latest, (v) => ({
    n: v.length,
    low10: v.filter((r) => r.score <= pm.t10).length,
    median: d3.median(v, (r) => r.score),
    name: v[0].wardName,
  }), (r) => r.ward)
    .map(([ward, s]) => ({ ward, ...s, share: s.low10 / s.n }))
    .sort((a, b) => b.share - a.share || d3.ascending(a.ward, b.ward));
}

export function pearson(pts, x, y) {
  if (pts.length < 3) return null;
  const mx = d3.mean(pts, x), my = d3.mean(pts, y);
  let sxy = 0, sxx = 0, syy = 0;
  for (const p of pts) { const dx = x(p) - mx, dy = y(p) - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null;
}

export function decadeMedians(pts, minN) {
  return d3.rollups(pts, (v) => ({ n: v.length, median: d3.median(v, (r) => r.score) }), (r) => Math.floor(r.yearBuilt / 10) * 10)
    .filter(([d, s]) => d >= 1900 && s.n >= minN)
    .map(([decade, s]) => ({ decade, ...s }))
    .sort((a, b) => a.decade - b.decade);
}

// Share of buildings (latest evaluation) where each inspection item was rated poor.
// Denominator = buildings where that item was rated; N/A ("doesn't apply") is excluded.
export function itemProblemRates(latest, pm) {
  return pm.cats.map((col) => {
    let rated = 0, poor = 0;
    for (const r of latest) {
      const v = r.ratings[col];
      if (v == null) continue;
      rated++;
      if (v <= pm.P.poorMax) poor++;
    }
    return { col, label: itemLabel(col), official: LL.prettyCat(col), record: pm.era === 'cur' && isRecordItem(col), rated, poor, share: rated ? poor / rated : 0 };
  }).filter((d) => d.rated > 0);
}

export function changeSummary(pairs) {
  const n = pairs.length;
  const up = pairs.filter((p) => p.delta > 0).length;
  const down = pairs.filter((p) => p.delta < 0).length;
  return {
    n, up, down, same: n - up - down,
    buildings: new Set(pairs.map((p) => p.rsn)).size,
    median: n ? d3.median(pairs, (p) => p.delta) : null,
    medianDays: n ? d3.median(pairs, (p) => p.days) : null,
  };
}

// One row per building: its single largest increase (or decrease) between consecutive evaluations.
export function biggestMovers(pairs, n) {
  const pick = (better) => {
    const best = new Map();
    for (const p of pairs) {
      if (better(p.delta, 0) <= 0) continue;
      const cur = best.get(p.rsn);
      if (!cur || better(p.delta, cur.delta) > 0 || (p.delta === cur.delta && p.b.time > cur.b.time)) best.set(p.rsn, p);
    }
    return [...best.values()].sort((a, b) => better(a.delta, b.delta) * -1 || d3.ascending(a.b.address, b.b.address)).slice(0, n);
  };
  return { up: pick((a, b) => a - b), down: pick((a, b) => b - a) };
}
