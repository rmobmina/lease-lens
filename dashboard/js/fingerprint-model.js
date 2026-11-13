// Inspection fingerprint: data transformations only (no DOM, no drawing).
//
// What the data says about the 2023+ item ratings (checked against the CSV, see the
// process book in docs/process-book/inspection-fingerprint.md):
//   - Each evaluation (one row = one building on one inspection date) rates up to 50 items.
//   - Values are 0, 1, 2, 3 or "N/A". 3 is the top mark: the proactive score tracks
//     100 × (mean item rating ÷ 3) (r = 0.97 between mean rating and overall score).
//   - "NO OF AREAS EVALUATED" equals the number of items that are not N/A, so N/A means
//     "not assessed / doesn't apply", NOT a low mark. N/A is never counted as a problem here.
//   - The City's open data page doesn't publish words for each value, so we describe ratings
//     by number ("rated 1 of 3") rather than inventing labels such as "failed".
//
// Unit of analysis: each building's LATEST evaluation in the current scoring system
// (the same rule the rest of the dashboard uses). Earlier inspections are not averaged in.

export const SCALE_MAX = 3;
export const LOW_MAX = 1;          // "low mark" = rated 0 or 1, the two lowest marks
export const UNCOMMON_SHARE = 0.05; // a low mark is "uncommon" if < 5% of rated buildings get one on that item

// Five groups a renter can picture. The grouping is ours, based on the item names,
// and every one of the 50 columns is assigned exactly once (checked in itemStats).
export const FP_GROUPS = [
  {
    key: 'outside', short: 'Outside', label: 'Outside the building',
    note: 'Grounds, walls, windows, doors, walkways and parking',
    items: ['EXTERIOR GROUNDS', 'FENCING', 'RETAINING WALLS', 'CATCH BASINS / STORM DRAINAGE', 'BUILDING EXTERIOR', 'WINDOWS',
      'EXTERIOR WALKWAYS', 'EXTERIOR DOORS', 'PARKING AREAS', 'ABANDONED EQUIP./DERELICT VEH.', 'ACCESSORY BUILDINGS', 'CLOTHING DROP BOXES'],
  },
  {
    key: 'shared', short: 'Shared spaces', label: 'Shared indoor spaces',
    note: 'Lobby, hallways, stairwells, laundry, amenities, cleanliness and pests',
    items: ['LOBBY - WALLS AND CEILING', 'LOBBY FLOORS', 'MAIL RECEPTACLES', 'LAUNDRY ROOM', 'POOLS', 'OTHER AMENITIES',
      'INT. HALLWAY - WALLS / CEILING', 'INTERIOR HALLWAY FLOORS', 'STAIRWELL - WALLS AND CEILING', 'STAIRWELL - LANDING AND STEPS',
      'GRAFFITI', 'BUILDING CLEANLINESS', 'COMMON AREA PESTS'],
  },
  {
    key: 'waste', short: 'Garbage', label: 'Garbage and storage',
    note: 'Garbage rooms, chutes, bin areas and storage lockers',
    items: ['EXT. RECEPTACLE STORAGE AREA', 'INT. RECEPTACLE STORAGE AREA', 'GARBAGE/COMPACTOR ROOM', 'CHUTE ROOMS - MAINTENANCE', 'STORAGE AREAS/LOCKERS MAINT.'],
  },
  {
    key: 'systems', short: 'Systems', label: 'Building systems and safety',
    note: 'Elevators, lighting, ventilation, electrical, intercom, guards and handrails',
    items: ['ELEVATOR MAINTENANCE', 'ELEVATOR COSMETICS', 'INT. LOBBY / HALLWAY LIGHTING', 'STAIRWELL LIGHTING', 'COMMON AREA VENTILATION',
      'ELECTRICAL SERVICES / OUTLETS', 'INTERCOM', 'BALCONY GUARDS', 'INT. HANDRAIL / GUARD - SAFETY', 'INT. HANDRAIL / GUARD - MAINT.'],
  },
  {
    key: 'records', short: 'Records', label: 'Records, plans and postings',
    note: 'Paperwork the landlord must keep, and notices tenants should be able to see',
    items: ['TENANT NOTIFICATION BOARD', 'EMERGENCY CONTACT SIGN', 'NUMBERING OF PROPERTY', 'PEST CONTROL LOG', 'MAINTENANCE LOG', 'CLEANING LOG',
      'TENANT SERVICE REQUEST LOG', 'VITAL SERVICE PLAN', 'ELECTRICAL SAFETY PLAN', 'STATE OF GOOD REPAIR PLAN'],
  },
];

// Per item: how every building's latest evaluation rated it.
// Denominator for every share = buildings where the item was rated (N/A and blank excluded).
export function itemStats(latest, cats, labelFn) {
  const known = new Set(FP_GROUPS.flatMap((g) => g.items));
  const groups = FP_GROUPS.map((g) => ({ ...g, items: g.items.filter((c) => cats.includes(c)) }));
  const unassigned = cats.filter((c) => !known.has(c));
  if (unassigned.length) {
    // A future file with new columns still renders; the extra items are shown, not dropped.
    console.warn('Fingerprint: items without a group', unassigned);
    groups.push({ key: 'other', label: 'Other items', note: 'Items added to the data after this view was designed', items: unassigned });
  }
  const stats = new Map();
  for (const g of groups) {
    for (const col of g.items) {
      const dist = [0, 0, 0, 0];
      let na = 0, blank = 0;
      for (const r of latest) {
        const v = r.ratings[col];
        if (v == null) { if (r.naCats.includes(col)) na++; else blank++; continue; }
        if (v >= 0 && v <= SCALE_MAX) dist[v]++;
      }
      const rated = dist[0] + dist[1] + dist[2] + dist[3];
      stats.set(col, {
        col, group: g.key, groupLabel: g.label, label: labelFn(col), official: LL.prettyCat(col),
        dist, rated, na, blank,
        lowShare: rated ? (dist[0] + dist[1]) / rated : 0,       // rated 0 or 1
        belowTopShare: rated ? (rated - dist[3]) / rated : 0,    // rated 2 or lower
        zeroShare: rated ? dist[0] / rated : 0,
      });
    }
    // Stable order inside each group: most often low-rated first, so every fingerprint
    // (and the Toronto overview) puts the same item in the same place.
    g.items.sort((a, b) => stats.get(b).lowShare - stats.get(a).lowShare || stats.get(b).belowTopShare - stats.get(a).belowTopShare || d3.ascending(a, b));
  }
  return { groups, stats };
}

// One building's fingerprint: the latest evaluation laid out on the shared grid.
export function buildingProfile(rec, layout) {
  const groups = layout.groups.map((g) => {
    const items = g.items.map((col) => {
      const s = layout.stats.get(col);
      const rating = rec.ratings[col];
      const status = rating != null ? 'rated' : rec.naCats.includes(col) ? 'na' : 'blank';
      const low = rating != null && rating <= LOW_MAX;
      return { col, rating, status, low, uncommon: low && s.lowShare < UNCOMMON_SHARE, stat: s };
    });
    const rated = items.filter((i) => i.status === 'rated');
    return { key: g.key, label: g.label, note: g.note, items, rated: rated.length, low: rated.filter((i) => i.low).length, belowTop: rated.filter((i) => i.rating < SCALE_MAX).length };
  });
  const all = groups.flatMap((g) => g.items);
  const rated = all.filter((i) => i.status === 'rated');
  return {
    rec, groups,
    rated: rated.length,
    na: all.filter((i) => i.status === 'na').length,
    low: rated.filter((i) => i.low),
    uncommon: rated.filter((i) => i.uncommon),
    belowTop: rated.filter((i) => i.rating < SCALE_MAX).length,
  };
}

// The paired profile (sections/fp-profile.js): one row per area for two buildings, on one shared scale.
//   share   = items rated low ÷ items rated in that area (null if the area wasn't rated: never 0)
//   domain  = one end of scale for both sides, picked so its midpoint is a round number too
//   strong  = the (at most two) areas where the buildings differ most. An area is emphasised only if the
//             low-rated counts differ, so equal rows are never made to look different.
export const PROFILE_DOMAINS = [0.2, 0.4, 0.5, 0.6, 0.8, 1];
export function pairedProfile(pa, pb) {
  const side = (g) => ({ low: g.low, rated: g.rated, share: g.rated ? g.low / g.rated : null, items: g.items });
  const rows = pa.groups.map((ga, i) => ({ key: ga.key, label: ga.label, a: side(ga), b: side(pb.groups[i]) }));
  const max = Math.max(0, ...rows.flatMap((r) => [r.a.share ?? 0, r.b.share ?? 0]));
  const domain = PROFILE_DOMAINS.find((d) => d >= max) ?? 1;
  const gap = (r) => Math.abs((r.a.share ?? 0) - (r.b.share ?? 0));
  const ranked = rows.filter((r) => r.a.low !== r.b.low && gap(r) > 0).sort((x, y) => gap(y) - gap(x) || x.key.localeCompare(y.key));
  const strong = new Set(ranked.slice(0, 2).map((r) => r.key));
  for (const r of rows) r.strong = strong.has(r.key);
  return { rows, domain };
}

// How different two profiles are: sum of rating gaps on items both buildings had rated,
// plus a bonus for low marks that only one of them has. Used only to pick telling examples.
export function profileDistance(a, b, cats) {
  let d = 0;
  for (const c of cats) {
    const x = a.ratings[c], y = b.ratings[c];
    if (x == null || y == null) continue;
    d += Math.abs(x - y) + ((x <= LOW_MAX) !== (y <= LOW_MAX) ? 2 : 0);
  }
  return d;
}

const lowCount = (r, cats) => cats.reduce((n, c) => n + (r.ratings[c] != null && r.ratings[c] <= LOW_MAX ? 1 : 0), 0);
const byRsn = (a, b) => d3.ascending(a.rsn, b.rsn);

// Overall scores held by at least two buildings (so a same-score pair exists).
export function scoreOptions(latest) {
  return d3.rollups(latest, (v) => v.length, (r) => r.score).filter(([, n]) => n >= 2).sort((a, b) => b[0] - a[0]).map(([score, n]) => ({ score, n }));
}

// Example pairs with the SAME overall score: the k-th building with the most low marks
// next to the k-th building with the fewest (ties broken by how different they look).
// Deterministic, so the default view is the same for every reader.
export function sameScorePairs(latest, score, cats) {
  const pool = latest.filter((r) => r.score === score);
  if (pool.length < 2) return [];
  const ranked = pool.map((r) => ({ r, low: lowCount(r, cats) })).sort((a, b) => b.low - a.low || byRsn(a.r, b.r));
  const pairs = [];
  const used = new Set();
  for (const { r: a, low } of ranked) {
    if (used.has(a.rsn)) continue;
    const rest = ranked.filter((x) => !used.has(x.r.rsn) && x.r.rsn !== a.rsn && x.low < low);
    if (!rest.length) break;
    const minLow = d3.min(rest, (x) => x.low);
    const b = d3.greatest(rest.filter((x) => x.low === minLow), (x) => profileDistance(a, x.r, cats))?.r;
    if (!b) break;
    used.add(a.rsn); used.add(b.rsn);
    pairs.push([a, b]);
  }
  return pairs;
}

// For a building chosen by the reader: another building with the same score and the most
// different profile. Falls back to the nearest score (within 1 point) if no exact match.
export function contrastFor(rec, latest, cats) {
  for (const tol of [0, 1]) {
    const pool = latest.filter((r) => r.rsn !== rec.rsn && Math.abs(r.score - rec.score) <= tol);
    if (pool.length) return d3.greatest(pool, (r) => profileDistance(rec, r, cats) - Math.abs(r.score - rec.score) * 10);
  }
  return null;
}

// Headline numbers for the Toronto overview, all computed (never typed in).
export function cityFindings(layout) {
  const items = [...layout.stats.values()].filter((s) => s.rated >= 30);
  const physical = items.filter((s) => s.group !== 'records');
  const records = items.filter((s) => s.group === 'records');
  return {
    belowTop: [...physical].sort((a, b) => b.belowTopShare - a.belowTopShare).slice(0, 4),
    recordsLow: [...records].sort((a, b) => b.lowShare - a.lowShare).slice(0, 2),
  };
}
