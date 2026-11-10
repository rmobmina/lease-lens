// "Beyond the Score": chapter definitions. One discovery, one visual focus, one clear action per chapter. The story moves down the same levels as free
// exploration: the city map → a ward → individual buildings → one building's X-Ray → a comparison →
// its history. `depth` is where the chapter happens ('map', 'xray', 'compare', or 'story' for the two
// closing visuals); on the map, `mapTo` frames it and `lens` opens one analysis layer beside it.
// All numbers come from story/selectors.js; examples come from the documented rule there.
//
// Arc: Setting (prologue) → Hook (location) → Rising insights (problems, one building, comparison,
// history) → Aha → Resolution.

import { esc, titleCase, pct, fmt } from '../ui.js';
import { zoneByKey } from '../xray-model.js';

const addr = (r) => esc(titleCase(r.address));
const list = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);
const times = (a, b) => {
  const k = a / b;
  return k >= 3 ? `${Math.floor(k)} times` : k >= 2 ? 'more than twice' : k >= 1.5 ? 'about one and a half times' : 'above';
};

// Each chapter: one headline, one short narration (30–50 words, holding the single finding), one
// visual focus, at most one chapter action, and optionally one detail view the reader can open.
//   depth   where the chapter happens: 'map' (the atlas), 'xray', 'compare', or 'story' (a full-stage visual)
//   via     a map position to travel through first, so the move into the next level starts where the
//           thing is (the building chapter flies to the building on the map, then opens its X-Ray)
//   detail  { lens, label }: one analysis layer, opened only on request, closed back into the chapter
//   steps   chapter actions shown one at a time (each reveals the next)
export const CHAPTERS = [
  {
    id: 'prologue', depth: 'story', visual: 'distribution',
    title: () => 'Most buildings score highly.',
    text: (D) => `Half of Toronto’s ${fmt.n(D.dist.n)} evaluated buildings scored ${D.dist.median} or more. The middle half sit between ${D.dist.q1} and ${D.dist.q3}: a band only ${D.dist.q3 - D.dist.q1} points wide, where real differences are easy to miss.`,
  },
  {
    id: 'location', depth: 'map',
    apply: (s, D) => { if (D.ward.top) s.ward = D.ward.top.ward; },
    mapTo: (D) => (D.ward.top ? { kind: 'ward', ward: D.ward.top.ward, city: true } : { kind: 'city' }),
    title: () => 'Where lower scores cluster',
    text: (D) => {
      const w = D.ward.top;
      if (!w) return 'Lower scores are not spread evenly across the city’s wards.';
      return `In ${esc(w.name)}, ${w.low10} of ${w.n} evaluated buildings are in the city’s lowest-scoring 10%: ${pct(w.share)}, ${times(w.share, D.ward.city)} the citywide ${pct(D.ward.city)}. Red wards hold more than their share; blue wards fewer.`;
    },
    detail: { lens: 'wards', label: 'Compare all wards' },
  },
  {
    id: 'problems', depth: 'story', visual: 'categories',
    apply: (s) => { s.problems = { group: 'all', showAll: false }; },
    highlight: (D) => new Set(D.cats.zones[0].items),
    title: () => 'What the score hides',
    text: (D) => {
      const [z, z2] = D.cats.zones;
      return `The same kinds of problems come up again and again. ${pct(z.share)} of buildings had at least one ${esc(z.label.toLowerCase())} item rated low (0 or 1 of 3), more than any other category; ${esc(z2.label.toLowerCase())} came next.`;
    },
    detail: { lens: 'problems', label: 'See every item' },
  },
  {
    id: 'building', depth: 'xray',
    apply: (s, D) => { s.selected = D.pair.a.rec.rsn; Object.assign(s.xray, { rsn: null, evalUid: null, zone: null, mode: 'exterior', matchRsn: null }); },
    via: (D) => ({ kind: 'building', rsn: D.pair.a.rec.rsn }),
    title: (D) => `${addr(D.pair.a.rec)}, score ${D.pair.a.rec.score}`,
    text: (D) => {
      const a = D.pair.a, z = a.topZone;
      if (!a.lows.length) return `A building at the city’s median score. None of its ${a.rated} rated items was rated low.`;
      return `A building at the city’s median score. Inside the number: ${a.lows.length} of its ${a.rated} rated items were rated low${z ? `, ${z.poor} of them in ${esc(z.label.toLowerCase())}` : ''}.`;
    },
    steps: (D) => [
      { id: 'cutaway', label: 'Open the cutaway', run: (app) => app.setXray({ mode: 'cutaway' }) },
      ...(D.pair.a.topZone ? [{ id: 'zone', label: `Focus on ${zoneByKey.get(D.pair.a.topZone.key).short.toLowerCase()}`, run: (app) => app.setXray({ zone: D.pair.a.topZone.key, mode: 'focus' }) }] : []),
    ],
  },
  {
    id: 'compare', depth: 'compare',
    apply: (s, D) => { s.period = 'cur'; Object.assign(s.fp, { score: D.pair.score, pairIndex: 0, a: D.pair.a.rec.rsn, b: D.pair.b.rec.rsn }); },
    title: () => 'Same score, different story',
    text: (D) => {
      const { a, b } = D.pair;
      const n = (x) => (x.lows.length ? `${x.lows.length} item${x.lows.length === 1 ? '' : 's'} rated low` : 'none rated low');
      return `${D.pair.sameWard ? `Two buildings in ${esc(a.rec.wardName)}` : 'Two buildings'}, both scored ${D.pair.score}. ${addr(a.rec)} had ${n(a)}; ${addr(b.rec)} had ${n(b)}.`;
    },
  },
  {
    id: 'history', depth: 'story', visual: 'history',
    apply: (s, D) => { s.selected = D.hist.rsn; },
    title: () => 'Scores change between inspections',
    text: (D) => {
      const pts = D.hist.inEra, r = D.histRec;
      const line = pts.length >= 2 ? `${addr(r)} went from ${pts.at(-2).rec.score} to ${pts.at(-1).rec.score} between inspections.` : `${addr(r)} has one evaluation under the current system.`;
      return `${line} Across ${fmt.n(D.re.n)} re-inspections, ${pct(D.re.up / D.re.n)} scored higher and ${pct(D.re.down / D.re.n)} lower.`;
    },
    detail: { lens: 'changes', label: 'All re-inspections' },
  },
  {
    id: 'resolution', depth: 'story', visual: 'steps',
    title: () => 'A score is a starting point, not the whole story.',
    text: () => 'Before you sign, check where the building sits, what its inspection found, and which way its score is moving.',
    final: { label: 'Explore a building yourself' },
  },
];

// Older chapter addresses still land somewhere sensible.
const ALIAS = { aha: 'resolution' };
export const chapterIndex = (id) => Math.max(0, CHAPTERS.findIndex((c) => c.id === (ALIAS[id] ?? id)));
