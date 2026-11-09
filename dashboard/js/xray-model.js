// Building X-Ray: data transformations only (no DOM, no Three.js, no globals).
// Runs in the browser and in Node (tests/xray-model.test.mjs), so it must not use d3 or LL.
//
// What the data says (checked against both CSVs; see docs/building-xray.md):
//   - One CSV row = one evaluation (one building, one date). Buildings are matched by RSN.
//   - 2023 – now: 50 items rated 0–3 (3 = top mark) or "N/A". Poor = 0 or 1.
//   - 2017 – 2023: 20 items rated 1–5 (5 = top mark), "N/A" or blank. Poor = 1 or 2.
//     Both cut-offs come from PERIODS in model.js and match the "Common problems" view.
//   - N/A means the item doesn't apply / wasn't assessed. Blank means nothing was recorded.
//     Neither is ever counted as a pass or as a problem.
//   - There are NO heating or plumbing items in either file, so the X-Ray has none.
//
// The five zones are DATA CATEGORIES drawn on a generic building. A coloured zone says
// "inspectors rated items in this category poorly", never "this part of the building is damaged".

import { PERIODS, EXCLUDED_FLAGS } from './model.js';

// Every item column of each file is assigned to exactly one zone (checked by the tests).
// Order of zones = bottom of the model to the top, except the façade (exterior) which wraps it.
export const XRAY_ZONES = [
  {
    key: 'grounds', label: 'Parking, grounds and waste', short: 'Grounds',
    place: 'An illustrative parking level under the building and a waste enclosure beside it',
    note: 'Parking, the yard, walkways, fencing, drainage and garbage areas.',
    items: {
      cur: ['PARKING AREAS', 'ABANDONED EQUIP./DERELICT VEH.', 'EXTERIOR GROUNDS', 'EXTERIOR WALKWAYS', 'FENCING', 'RETAINING WALLS',
        'CATCH BASINS / STORM DRAINAGE', 'ACCESSORY BUILDINGS', 'CLOTHING DROP BOXES',
        'EXT. RECEPTACLE STORAGE AREA', 'INT. RECEPTACLE STORAGE AREA', 'GARBAGE/COMPACTOR ROOM', 'CHUTE ROOMS - MAINTENANCE'],
      pre: ['PARKING_AREA', 'EXTERIOR_GROUNDS', 'EXTERIOR_WALKWAYS', 'GARBAGE_BIN_STORAGE_AREA', 'GARBAGE_CHUTE_ROOMS'],
    },
  },
  {
    key: 'records', label: 'Safety and records', short: 'Records',
    place: 'A row of record tiles beside the building: an abstract layer, since paperwork has no physical location',
    note: 'Logs, plans and postings the landlord must keep, plus property numbering and emergency contact signs.',
    items: {
      cur: ['EMERGENCY CONTACT SIGN', 'TENANT NOTIFICATION BOARD', 'NUMBERING OF PROPERTY', 'ELECTRICAL SAFETY PLAN', 'VITAL SERVICE PLAN',
        'STATE OF GOOD REPAIR PLAN', 'MAINTENANCE LOG', 'CLEANING LOG', 'PEST CONTROL LOG', 'TENANT SERVICE REQUEST LOG'],
      pre: [], // the 2017 – 2023 system had no record or plan items
    },
  },
  {
    key: 'shared', label: 'Shared spaces', short: 'Shared',
    place: 'Floor plates in the real footprint, with an illustrative corridor and stair',
    note: 'Lobby, hallways, stairwells, handrails, laundry, storage, amenities, cleanliness, pests and graffiti.',
    items: {
      cur: ['LOBBY - WALLS AND CEILING', 'LOBBY FLOORS', 'MAIL RECEPTACLES', 'INT. HALLWAY - WALLS / CEILING', 'INTERIOR HALLWAY FLOORS',
        'STAIRWELL - WALLS AND CEILING', 'STAIRWELL - LANDING AND STEPS', 'INT. HANDRAIL / GUARD - SAFETY', 'INT. HANDRAIL / GUARD - MAINT.',
        'LAUNDRY ROOM', 'STORAGE AREAS/LOCKERS MAINT.', 'POOLS', 'OTHER AMENITIES', 'BUILDING CLEANLINESS', 'COMMON AREA PESTS', 'GRAFFITI'],
      pre: ['ENTRANCE_LOBBY', 'INTERIOR_WALL_CEILING_FLOOR', 'STAIRWELLS', 'INTERNAL_GUARDS_HANDRAILS', 'LAUNDRY_ROOMS',
        'STORAGE_AREAS_LOCKERS', 'OTHER_FACILITIES', 'GRAFFITI'],
    },
  },
  {
    key: 'systems', label: 'Building systems', short: 'Systems',
    place: 'An illustrative elevator core, risers and rooftop mechanical plant',
    note: 'Elevators, lighting, ventilation, electrical services and the intercom. The data has no heating or plumbing items.',
    items: {
      cur: ['ELEVATOR MAINTENANCE', 'ELEVATOR COSMETICS', 'INT. LOBBY / HALLWAY LIGHTING', 'STAIRWELL LIGHTING', 'COMMON AREA VENTILATION',
        'ELECTRICAL SERVICES / OUTLETS', 'INTERCOM'],
      pre: ['ELEVATORS', 'INTERIOR_LIGHTING_LEVELS', 'SECURITY'],
    },
  },
  {
    key: 'exterior', label: 'Exterior envelope', short: 'Exterior',
    place: 'The building’s outer walls and roof (real massing where available)',
    note: 'The building’s outside walls, windows, entrance doors and balcony guards.',
    items: {
      cur: ['BUILDING EXTERIOR', 'WINDOWS', 'EXTERIOR DOORS', 'BALCONY GUARDS'],
      pre: ['EXTERIOR_CLADDING', 'ENTRANCE_DOORS_WINDOWS', 'WATER_PEN_EXT_BLDG_ELEMENTS', 'BALCONY_GUARDS'],
    },
  },
];
export const ZONE_KEYS = XRAY_ZONES.map((z) => z.key);
export const zoneByKey = new Map(XRAY_ZONES.map((z) => [z.key, z]));

// Zone status. "Concentrated" needs BOTH conditions, because the exterior zone has only four
// items: on a proportion alone, a single low mark (1 of 4 = 25%) would already look severe.
export const CONCENTRATED = { minPoor: 2, minShare: 0.25 };
export const STATUS = {
  none: { key: 'none', label: 'Not evaluated', long: 'No applicable items were rated in this inspection' },
  ok: { key: 'ok', label: 'No poor ratings', long: 'Every applicable item was rated above the poor range' },
  some: { key: 'some', label: 'Some poor ratings', long: 'At least one applicable item was rated poorly' },
  high: { key: 'high', label: 'Concentrated poor ratings', long: `${CONCENTRATED.minPoor}+ items and at least ${CONCENTRATED.minShare * 100}% of applicable items rated poorly` },
};

export function zoneStatus(applicable, poor) {
  if (!applicable) return 'none';
  if (!poor) return 'ok';
  return poor >= CONCENTRATED.minPoor && poor / applicable >= CONCENTRATED.minShare ? 'high' : 'some';
}

// Scale of each scoring system. poorMax comes from the dashboard's PERIODS so the
// definition of "poor" can never drift between views.
export function scaleFor(era) {
  return era === 'cur' ? { min: 0, max: 3, poorMax: PERIODS.cur.poorMax, text: PERIODS.cur.poorText }
    : { min: 1, max: 5, poorMax: PERIODS.pre.poorMax, text: PERIODS.pre.poorText };
}

// Colour class shared by both systems: lowest mark, other poor mark, below the top mark, top mark.
export const ratingClass = (v, S) => (v == null ? 'na' : v <= S.poorMax ? (v === S.min ? 'p0' : 'p1') : v === S.max ? 'p3' : 'p2');

// Items in a file that the zone table doesn't cover (a future column), and table items
// the file doesn't have. Both should be empty for the published files.
export function mappingGaps(cats, era) {
  const mapped = XRAY_ZONES.flatMap((z) => z.items[era]);
  return { unmapped: cats.filter((c) => !mapped.includes(c)), missing: mapped.filter((c) => !cats.includes(c)) };
}

// One evaluation laid out by zone. `cats` = the item columns of that record's file.
export function zoneProfile(rec, cats) {
  const S = scaleFor(rec.era);
  const naSet = new Set(rec.naCats ?? []);
  const zones = XRAY_ZONES.map((z) => {
    const items = z.items[rec.era].filter((col) => cats.includes(col)).map((col) => {
      const v = rec.ratings[col];
      const status = v != null ? 'rated' : naSet.has(col) ? 'na' : 'blank';
      return { col, rating: v ?? null, status, poor: v != null && v <= S.poorMax };
    });
    const rated = items.filter((i) => i.status === 'rated');
    const poor = rated.filter((i) => i.poor).length;
    return {
      key: z.key, label: z.label, items,
      applicable: rated.length, poor,
      share: rated.length ? poor / rated.length : null,
      na: items.filter((i) => i.status === 'na').length,
      blank: items.filter((i) => i.status === 'blank').length,
      status: zoneStatus(rated.length, poor),
    };
  });
  const { unmapped } = mappingGaps(cats, rec.era);
  return {
    rec, era: rec.era, scale: S, zones,
    applicable: zones.reduce((n, z) => n + z.applicable, 0),
    poor: zones.reduce((n, z) => n + z.poor, 0),
    unmapped, // shown on the page if ever non-empty, never dropped silently
  };
}

// Every usable evaluation of one building, oldest first, across both scoring systems.
// "Usable" = the same rule as the rest of the dashboard: not flagged, has a score and a date.
export function buildingEvaluations(records) {
  return records
    .filter((r) => r.score != null && r.time != null && !r.flags.some((f) => EXCLUDED_FLAGS.includes(f)))
    .sort((a, b) => a.time - b.time || (a.uid < b.uid ? -1 : 1));
}

// Timeline points. Change is measured only against the previous evaluation in the SAME
// scoring system; the first evaluation in each system has no change (null), never 0.
export function timelinePoints(evals) {
  const lastIn = {};
  return evals.map((r) => {
    const prev = lastIn[r.era] ?? null;
    lastIn[r.era] = r;
    return { rec: r, era: r.era, prev, delta: prev ? r.score - prev.score : null };
  });
}

// Lines are drawn only between consecutive evaluations of the same system.
export function timelineSegments(points) {
  const out = [];
  for (const era of ['pre', 'cur']) {
    const p = points.filter((d) => d.era === era);
    if (p.length >= 2) out.push({ era, points: p });
  }
  return out;
}

export function trendSummary(points, era) {
  const p = points.filter((d) => d.era === era);
  if (!p.length) return { kind: 'empty', n: 0 };
  if (p.length === 1) return { kind: 'single', n: 1, latest: p[0] };
  const latest = p.at(-1);
  return { kind: latest.delta > 0 ? 'up' : latest.delta < 0 ? 'down' : 'same', n: p.length, latest, first: p[0], total: latest.rec.score - p[0].rec.score };
}

// How different two profiles are, zone by zone (same scoring system only).
// Returns zones sorted by the absolute gap in poor-rated share, largest first.
export function zoneDifferences(pa, pb) {
  if (pa.era !== pb.era) throw new Error('Profiles from different scoring systems cannot be compared');
  return pa.zones.map((za, i) => {
    const zb = pb.zones[i];
    const comparable = za.share != null && zb.share != null;
    return { key: za.key, label: za.label, a: za, b: zb, comparable, gap: comparable ? zb.share - za.share : null };
  }).sort((x, y) => (y.comparable - x.comparable) || Math.abs(y.gap ?? 0) - Math.abs(x.gap ?? 0) || ZONE_KEYS.indexOf(x.key) - ZONE_KEYS.indexOf(y.key));
}

// Sum of absolute share gaps over zones both buildings had rated. Used only to order matches.
export function profileDistance(pa, pb) {
  return zoneDifferences(pa, pb).reduce((s, d) => s + (d.comparable ? Math.abs(d.gap) : 0), 0);
}

// Same score, different story: buildings to compare with `rec`.
// 1. Only the same scoring system (pool must already be one period's latest evaluations).
// 2. Identical overall score first; if none, the smallest tolerance in `tolerances` with a match.
// 3. The selected building itself is excluded.
// 4. Ordered by how different their zone profile is (most different first), then RSN, so the
//    order is the same for every reader.
export const MATCH_TOLERANCES = [0, 1, 2];
export function findMatches(rec, pool, cats, tolerances = MATCH_TOLERANCES) {
  const base = zoneProfile(rec, cats);
  for (const tol of tolerances) {
    const cands = pool.filter((r) => r.rsn !== rec.rsn && r.era === rec.era && Math.abs(r.score - rec.score) <= tol);
    if (!cands.length) continue;
    const matches = cands.map((r) => {
      const profile = zoneProfile(r, cats);
      return { rec: r, profile, distance: profileDistance(base, profile), scoreGap: r.score - rec.score };
    }).sort((a, b) => Math.abs(a.scoreGap) - Math.abs(b.scoreGap) || b.distance - a.distance || (a.rec.rsn < b.rec.rsn ? -1 : 1));
    return { tolerance: tol, base, matches };
  }
  return { tolerance: null, base, matches: [] };
}
