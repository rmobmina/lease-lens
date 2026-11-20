// "Beyond the Score": chapter definitions, laid out as a data storyboard (CSC316 week 7, after Brent Dykes):
//
//   Setting          background: every rental building gets one number, and renters mostly see only that
//   Hook             the first surprising insight: nearly every building scores in the 90s
//   Rising insights  one question per frame, each narrowing things down toward the aha:
//                    Where? (a ward) → When? (scores change) → What? (the problems inspectors find) →
//                    What's inside a 92? (one building)
//   Aha              the main message in one sentence: the score can't tell two buildings apart; the inspection can
//   Next step        what the reader should do: three checks before signing
//
// The story was written backwards from the aha (Seth Godin: "Begin there and work backwards"); each frame's last
// sentence raises the question the next frame answers. `stage` names the storyboard stage (shown in the caption
// and on its arc), `question` the question a rising insight answers.
//
// `depth` is where the chapter happens ('map', 'xray', 'compare', or 'story' for a full-stage visual); on the map,
// `mapTo` frames it. All numbers come from story/selectors.js; examples come from the documented rule there.

import { esc, titleCase, pct, fmt } from '../ui.js';
import { zoneByKey } from '../xray-model.js';

const addr = (r) => esc(titleCase(r.address));
const times = (a, b) => {
  const k = a / b;
  return k >= 3 ? `${Math.floor(k)} times` : k >= 2 ? 'more than twice' : k >= 1.5 ? 'about one and a half times' : 'above';
};

// The storyboard stages, in order, with the caption's label for each.
export const STAGES = { setting: 'Setting', hook: 'Hook', rising: 'Rising insight', aha: 'Aha', next: 'Next step' };

// Each chapter (a storyboard frame): one headline that states the finding, one short narration (holding the
// single finding), one visual focus, at most one chapter action, and optionally one detail view.
//   stage    'setting' | 'hook' | 'rising' | 'aha' | 'next'
//   question (rising insights) the one question this frame answers
//   depth    where the chapter happens: 'map' (the atlas), 'xray', 'compare', or 'story' (a full-stage visual)
//   via      a map position to travel through first (the building chapter flies to the building, then opens its X-Ray)
//   detail   { lens, label }: one analysis layer, opened only on request, closed back into the chapter
//   steps    chapter actions shown one at a time (each reveals the next)
export const CHAPTERS = [
  {
    id: 'setting', stage: 'setting', depth: 'map',
    mapTo: () => ({ kind: 'city' }),
    title: () => 'Every rental building gets one number',
    text: (D) => `Under RentSafeTO, City inspectors evaluate Toronto’s apartment buildings and score each one out of 100. These are the ${fmt.n(D.dist.n)} buildings evaluated under the current system. For most renters, that score is all they see.`,
  },
  {
    id: 'prologue', stage: 'hook', depth: 'story', visual: 'distribution',
    title: (D) => `Half of them scored ${D.dist.median} or more`,
    text: (D) => `The middle half sit in a band only ${D.dist.q3 - D.dist.q1} points wide (${D.dist.q1}–${D.dist.q3}). If most buildings score this high, what does a ${D.dist.median} actually tell you about a place to live?`,
  },
  {
    id: 'location', stage: 'rising', question: () => 'Where?', depth: 'map',
    apply: (s, D) => { if (D.ward.top) s.ward = D.ward.top.ward; },
    mapTo: (D) => (D.ward.top ? { kind: 'ward', ward: D.ward.top.ward, city: true } : { kind: 'city' }),
    title: () => 'Lower scores cluster in some wards',
    text: (D) => {
      const w = D.ward.top;
      if (!w) return 'Lower scores are not spread evenly across the city’s wards.';
      return `In ${esc(w.name)}, ${w.low10} of ${w.n} evaluated buildings are in the city’s lowest-scoring 10%: ${pct(w.share)}, ${times(w.share, D.ward.city)} the citywide ${pct(D.ward.city)}. Red wards hold more than their share; blue wards fewer.`;
    },
    detail: { lens: 'wards', label: 'Compare all wards' },
  },
  {
    id: 'history', stage: 'rising', question: () => 'When?', depth: 'story', visual: 'history',
    apply: (s, D) => { s.selected = D.hist.rsn; },
    title: () => 'A score can change at the next inspection',
    text: (D) => {
      const pts = D.hist.inEra, r = D.histRec;
      const line = pts.length >= 2 ? `${addr(r)} went from ${pts.at(-2).rec.score} to ${pts.at(-1).rec.score} between inspections.` : `${addr(r)} has one evaluation under the current system.`;
      return `${line} Across ${fmt.n(D.re.n)} re-inspections, ${pct(D.re.up / D.re.n)} scored higher and ${pct(D.re.down / D.re.n)} lower. A score describes inspection day.`;
    },
    detail: { lens: 'changes', label: 'All re-inspections' },
  },
  {
    id: 'problems', stage: 'rising', question: () => 'What?', depth: 'story', visual: 'categories',
    apply: (s) => { s.problems = { group: 'all', page: 0 }; },
    highlight: (D) => new Set(D.cats.zones[0].items),
    title: () => 'The same problems keep coming up',
    text: (D) => {
      const [z, z2] = D.cats.zones;
      return `${esc(z.label)} came up most: ${pct(z.share)} of buildings had at least one item there rated low (0 or 1 of 3). ${esc(z2.label)} came next. But a building’s score doesn’t say which of these problems it has.`;
    },
    detail: { lens: 'problems', label: 'See every item' },
  },
  {
    id: 'building', stage: 'rising', question: (D) => `What’s inside a ${D.pair.a.rec.score}?`, depth: 'xray',
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
    id: 'compare', stage: 'aha', depth: 'compare',
    apply: (s, D) => { s.period = 'cur'; Object.assign(s.fp, { score: D.pair.score, pairIndex: 0, a: D.pair.a.rec.rsn, b: D.pair.b.rec.rsn }); },
    title: () => 'The score can’t tell them apart. The inspection can.',
    text: (D) => {
      const { a, b } = D.pair;
      const n = (x) => (x.lows.length ? `${x.lows.length} item${x.lows.length === 1 ? '' : 's'} rated low` : 'none rated low');
      return `${D.pair.sameWard ? `Two buildings in ${esc(a.rec.wardName)}` : 'Two buildings'}, both scored ${D.pair.score}. ${addr(a.rec)} had ${n(a)}; ${addr(b.rec)} had ${n(b)}.`;
    },
    detail: { toggle: 'story-items', label: 'Show every item' },
  },
  {
    id: 'resolution', stage: 'next', depth: 'story', visual: 'steps',
    title: () => 'Before you sign, look past the score',
    text: () => 'Check where the building sits, which way its score is moving, and what its inspection actually found.',
    final: { label: 'Explore a building yourself' },
  },
];

// Older chapter addresses still land somewhere sensible.
const ALIAS = { aha: 'compare' };   // the aha frame
export const chapterIndex = (id) => Math.max(0, CHAPTERS.findIndex((c) => c.id === (ALIAS[id] ?? id)));
