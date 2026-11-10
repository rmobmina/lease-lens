// "Beyond the Score": chapter definitions. Each chapter has one headline, one or two sentences,
// one view, one discovery and one next action. The story moves down the same levels as free
// exploration: the city map → a ward → individual buildings → one building's X-Ray → a comparison →
// its history. `depth` is where the chapter happens ('map', 'xray', 'compare', or 'story' for the two
// closing visuals); on the map, `mapTo` frames it and `lens` opens one analysis layer beside it.
// All numbers come from story/selectors.js; examples come from the documented rule there.
//
// Arc: Setting (prologue) → Hook (location) → Rising insights (problems, one building, comparison,
// history) → Aha → Resolution.

import { esc, titleCase, pct, fmt, formatDate, signed } from '../ui.js';
import { zoneByKey } from '../xray-model.js';

const addr = (r) => esc(titleCase(r.address));
const list = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);
const times = (a, b) => {
  const k = a / b;
  return k >= 3 ? `${Math.floor(k)} times` : k >= 2 ? 'more than twice' : k >= 1.5 ? 'about one and a half times' : 'above';
};

export const OPENING = 'Two buildings can have the same RentSafeTO score. Do they tell the same story?';

export const CHAPTERS = [
  {
    id: 'prologue', step: 'Prologue', depth: 'map', lens: 'distribution', mapTo: () => ({ kind: 'city' }),
    title: () => 'Most buildings score highly.',
    text: (D) => `That makes the differences harder to see. Half of Toronto’s ${fmt.n(D.dist.n)} evaluated buildings scored ${D.dist.median} or more at their latest inspection.`,
    discovery: (D) => `The middle half of buildings sit between ${D.dist.q1} and ${D.dist.q3}: a band only ${D.dist.q3 - D.dist.q1} points wide.`,
    next: 'If scores look similar, where should we look next?',
  },
  {
    id: 'location', step: 'Chapter 1', depth: 'map', lens: 'wards', mapTo: () => ({ kind: 'city' }),
    title: () => 'Where lower scores cluster',
    text: () => 'Lower scores are not spread evenly. Red wards hold more than their share of the city’s lowest-scoring buildings; blue wards hold fewer. Select a ward on the map or in the list to zoom in.',
    discovery: (D) => {
      const w = D.ward.top;
      if (!w) return 'No ward has enough evaluated buildings to single out.';
      return `In ${esc(w.name)}, ${w.low10} of ${w.n} evaluated buildings (${pct(w.share)}) are in the city’s lowest 10% of scores: ${times(w.share, D.ward.city)} the citywide share of ${pct(D.ward.city)}.`;
    },
    actions: (D) => (D.ward.top ? [{ id: 'ward', label: `Show ${D.ward.top.name}`, run: (app) => app.setWard(D.ward.top.ward) }] : []),
    annotate: (D) => D.ward.top && { target: `.ward-row[data-ward="${D.ward.top.ward}"]`, text: `${pct(D.ward.top.share)} in the lowest 10%` },
    next: 'But location is only part of the picture.',
  },
  {
    id: 'problems', step: 'Chapter 2', depth: 'map', lens: 'problems',
    apply: (s, D) => { s.problems = { group: 'all', showAll: false }; s.selected = D.pair.a.rec.rsn; },
    mapTo: (D) => ({ kind: 'building', rsn: D.pair.a.rec.rsn }),
    highlight: (D) => new Set(D.cats.zones[0].items),
    title: () => 'Zoom in, and buildings appear',
    text: (D) => `Each mark is now one building. ${addr(D.pair.a.rec)} scored ${D.pair.a.rec.score}, the city’s median. Across Toronto, the same kinds of items are rated low again and again: items in <b>${esc(D.cats.zones[0].label.toLowerCase())}</b> are highlighted in blue.`,
    discovery: (D) => {
      const [z, z2] = D.cats.zones;
      return `${pct(z.share)} of buildings had at least one ${esc(z.label.toLowerCase())} item rated low (0 or 1 of 3), more than any other category; ${esc(z2.label.toLowerCase())} came next at ${pct(z2.share)}.`;
    },
    next: 'What does this look like for one building?',
  },
  {
    id: 'building', step: 'Chapter 3', depth: 'xray',
    apply: (s, D) => { s.selected = D.pair.a.rec.rsn; Object.assign(s.xray, { rsn: null, evalUid: null, zone: null, mode: 'exterior', matchRsn: null }); },
    title: (D) => `${addr(D.pair.a.rec)}, score ${D.pair.a.rec.score}`,
    text: () => 'A building at the median score. Open the cutaway, then focus on a category to see its individual results. The rooms are illustrative, not the real floor plan.',
    discovery: (D) => {
      const a = D.pair.a, z = a.topZone;
      if (!a.lows.length) return `None of its ${a.rated} rated items was rated low.`;
      return `${a.lows.length} of its ${a.rated} rated items were rated low${z ? `, ${z.poor} of them in ${esc(z.label.toLowerCase())}` : ''}.`;
    },
    actions: (D) => [
      { id: 'xray', label: 'Open the cutaway', run: (app) => app.setXray({ mode: 'cutaway' }) },
      ...(D.pair.a.topZone ? [{ id: 'zone', label: `Focus on ${zoneByKey.get(D.pair.a.topZone.key).short.toLowerCase()}`, run: (app) => app.setXray({ zone: D.pair.a.topZone.key, mode: 'focus' }) }] : []),
    ],
    next: 'Would another building with a similar score have the same problems?',
  },
  {
    id: 'compare', step: 'Chapter 4', depth: 'compare',
    apply: (s, D) => { s.period = 'cur'; Object.assign(s.fp, { score: D.pair.score, pairIndex: 0, a: D.pair.a.rec.rsn, b: D.pair.b.rec.rsn }); },
    title: () => 'Same score, different story',
    text: (D) => `${D.pair.sameWard ? `Two buildings in ${esc(D.pair.a.rec.wardName)}` : 'Two buildings'}, both scored ${D.pair.score} at their latest evaluation.`,
    discovery: (D) => {
      const { a, b } = D.pair;
      const n = (x) => (x.lows.length ? `${x.lows.length} item${x.lows.length === 1 ? '' : 's'} rated low` : 'no items rated low');
      return `${addr(a.rec)} had ${n(a)}; ${addr(b.rec)} had ${n(b)}.`;
    },
    next: 'Even these inspection results can change.',
  },
  {
    id: 'history', step: 'Chapter 5', depth: 'xray', focus: '#xr-history',
    apply: (s, D) => { s.selected = D.hist.rsn; Object.assign(s.xray, { rsn: null, evalUid: null, zone: null, mode: 'exterior', matchRsn: null }); },
    title: () => 'Scores change between inspections',
    text: (D) => {
      const h = D.hist;
      const r = D.histRec;
      const pts = h.inEra;
      const line = pts.length >= 2
        ? `${addr(r)} scored ${pts.at(-2).rec.score} on ${formatDate(pts.at(-2).rec.date)} and ${pts.at(-1).rec.score} on ${formatDate(pts.at(-1).rec.date)}.`
        : `${addr(r)} has one evaluation under the current system.`;
      return `${line}${h.otherSystem ? ' Its earlier scores used the 2017 – 2023 system, so they are shown separately and not compared.' : ''}`;
    },
    discovery: (D) => `Across ${fmt.n(D.re.n)} re-inspections under the current system, ${pct(D.re.up / D.re.n)} scored higher and ${pct(D.re.down / D.re.n)} lower. The median change was ${signed(D.re.median)} points.`,
    outline: '#xr-timeline svg',
    next: null, nextLabel: 'See what it adds up to',
  },
  {
    id: 'aha', step: 'The point', depth: 'story', visual: 'fingerprints',
    title: () => 'A RentSafeTO score is a starting point, not the whole story.',
    text: () => 'Location, individual inspection results, and inspection history reveal details the overall score can leave out.',
    discovery: (D) => `Same score of ${D.pair.score}: ${D.pair.a.lows.length} low marks at ${addr(D.pair.a.rec)}, ${D.pair.b.lows.length} at ${addr(D.pair.b.rec)}.`,
    next: null, nextLabel: 'What to check',
  },
  {
    id: 'resolution', step: 'Your turn', depth: 'story', visual: 'steps',
    title: () => 'Before you sign, look beyond the score.',
    text: () => 'Three checks, each one a part of this site.',
    discovery: null,
    next: null, final: { label: 'Explore a building yourself' },
  },
];

export const chapterIndex = (id) => Math.max(0, CHAPTERS.findIndex((c) => c.id === id));
