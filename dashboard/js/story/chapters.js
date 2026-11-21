// "Beyond the Score": seven steps, each one question a first-time renter would ask.
//
// On screen the reader sees only a step counter (1/7), a short question as the heading and a plain answer.
// Underneath, the steps still follow a storytelling arc (CSC316 week 7, after Brent Dykes), kept here as
// `stage` and never shown:
//
//   setting   1  a situation the renter recognizes: you found a place, the building scored 92
//   hook      2  the question the score alone can't answer: most buildings score about the same
//   rising    3  where you look matters (a ward)
//             4  what the inspectors actually found inside one 92
//   aha       5  two buildings, both 92, with different problems: the score can't tell them apart
//   falling   6  and a score is a snapshot: it changes from one inspection to the next
//   next      7  what to check before signing a lease
//
// Every body is a list of short blocks, each with one job: set up the question (a direct answer first), say what
// to notice in the visual, or bridge to the next step. Technical terms are explained the first time they appear.
//
// `depth` is where the step happens ('map', 'xray', 'compare', or 'story' for a full-stage visual); on the
// map, `mapTo` frames it and `reveal` adds its highlight once the camera has arrived. All numbers come from
// story/selectors.js; examples come from the documented rule there.

import { esc, titleCase, pct, fmt } from '../ui.js';
import { zoneByKey } from '../xray-model.js';

const addr = (r) => esc(titleCase(r.address));
const times = (a, b) => {
  const k = a / b;
  return k >= 3 ? `${Math.floor(k)} times` : k >= 2 ? 'more than twice' : k >= 1.5 ? 'about one and a half times' : 'above';
};
// "August 2024": the month is enough for a renter reading a history
const monthYear = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('en-CA', { month: 'long', year: 'numeric' });

// The storytelling arc underneath the steps, in order (not shown to the reader).
export const STAGES = { setting: 'Setting', hook: 'Hook', rising: 'Rising insight', aha: 'Aha', falling: 'Falling action', next: 'Next step' };

// Each step: one question as the heading, one short answer, one visual focus, at most one step action and
// optionally one detail view.
//   stage    the arc stage underneath (see above)
//   depth    'map' (the atlas), 'xray', 'compare', or 'story' (a full-stage visual)
//   mapTo    how the map is framed; reveal: state set once the map has arrived (the highlight)
//   via      a map position to travel through first (the X-Ray step flies to the building, then opens it)
//   detail   { lens, label }: one analysis layer, opened only on request, closed back into the step
//   steps    step actions shown one at a time (each reveals the next)
//   text     (D) => [blocks]: one short paragraph each
export const CHAPTERS = [
  {
    id: 'setting', stage: 'setting', depth: 'map',
    mapTo: () => ({ kind: 'city' }),
    title: () => 'What does a building’s score tell you?',
    // the apartment leads; which buildings the map covers is in the caption's ⓘ (content/info.js, story)
    text: (D) => [
      `Say you’ve found an apartment you like. Its building scored ${D.dist.median} out of 100.`,
      'That’s its RentSafeTO score: how the building did on the City’s inspection of its shared spaces and records.',
      'What would you want to know before booking a viewing?',
    ],
  },
  {
    id: 'prologue', stage: 'hook', depth: 'story', visual: 'distribution',
    title: (D) => `How does a ${D.dist.median} compare with other buildings?`,
    text: (D) => [
      `It’s right in the middle: half of all ${fmt.n(D.dist.n)} buildings scored ${D.dist.median} or more.`,
      `Notice how the bars bunch up on the right. The middle half of buildings sit between ${D.dist.q1} and ${D.dist.q3}, a band just ${D.dist.q3 - D.dist.q1} points wide.`,
      'With scores this close, the number alone can’t tell buildings apart. So where else can you look?',
    ],
  },
  {
    id: 'location', stage: 'rising', depth: 'map',
    mapTo: (D) => (D.ward.top ? { kind: 'ward', ward: D.ward.top.ward, city: true } : { kind: 'city' }),
    reveal: (s, D) => { if (D.ward.top) s.ward = D.ward.top.ward; },
    title: () => 'Does it matter where you look?',
    text: (D) => {
      const w = D.ward.top;
      const notice = 'Notice the colours: red wards have more than their share of low scores, blue wards fewer.';
      if (!w) return ['Yes. Low scores are not spread evenly across the city’s wards.', notice];
      return [
        `Yes. In ${esc(w.name)}, ${w.low10} of ${w.n} evaluated buildings (${pct(w.share)}) are in the city’s lowest-scoring 10%, with a score of ${D.ward.t10} or below. That’s ${times(w.share, D.ward.city)} the citywide ${pct(D.ward.city)}.`,
        notice,
        'Next, look inside one building.',
      ];
    },
    detail: { lens: 'wards', label: 'Compare all wards' },
  },
  {
    id: 'building', stage: 'rising', depth: 'xray',
    apply: (s, D) => { s.selected = D.pair.a.rec.rsn; Object.assign(s.xray, { rsn: null, evalUid: null, zone: null, mode: 'exterior' }); },
    via: (D) => ({ kind: 'building', rsn: D.pair.a.rec.rsn }),
    title: () => 'What did inspectors actually find?',
    text: (D) => {
      const a = D.pair.a, z = a.topZone;
      const lead = `${addr(a.rec)} scored ${a.rec.score}, the city’s middle score. Inspectors rate each item out of 3, and a 0 or 1 counts as low.`;
      const bridge = `Would another ${a.rec.score} look the same?`;
      if (!a.lows.length) return [lead, `Here, none of its ${a.rated} rated items was low.`, bridge];
      const where = z ? ` Notice where they cluster: ${z.poor} are in ${esc(z.label.toLowerCase())}${z.key === 'records' ? ', the plans, logs and notices a landlord must keep' : ''}.` : '';
      return [lead, `Here, ${a.lows.length} of its ${a.rated} rated items were low.${where}`, bridge];
    },
    steps: (D) => [
      { id: 'cutaway', label: 'Open the cutaway', run: (app) => app.setXray({ mode: 'cutaway' }) },
      ...(D.pair.a.topZone ? [{ id: 'zone', label: `Focus on ${zoneByKey.get(D.pair.a.topZone.key).short.toLowerCase()}`, run: (app) => app.setXray({ zone: D.pair.a.topZone.key, mode: 'focus' }) }] : []),
    ],
    detail: { lens: 'problems', label: 'Citywide problems' },
  },
  {
    id: 'compare', stage: 'aha', depth: 'compare',
    apply: (s, D) => { s.period = 'cur'; Object.assign(s.fp, { score: D.pair.score, pairIndex: 0, a: D.pair.a.rec.rsn, b: D.pair.b.rec.rsn }); },
    title: () => 'Can two buildings with the same score have different problems?',
    text: (D) => {
      const { a, b } = D.pair;
      const n = (x) => (x.lows.length ? `${x.lows.length} item${x.lows.length === 1 ? '' : 's'}` : 'no items');
      const where = D.pair.sameWard ? `, both in ${esc(a.rec.wardName)},` : '';
      const oneSided = !a.lows.length !== !b.lows.length;
      return [
        `Yes. ${addr(a.rec)} and ${addr(b.rec)}${where} both scored ${D.pair.score}.`,
        `Notice the red bars${oneSided ? `: they appear for ${a.lows.length ? 'the first' : 'the second'} building only` : ''}. Inspectors rated ${n(a)} low at the first and ${n(b)} at the second.`,
        'The score can’t tell these two apart, but the inspection can.',
      ];
    },
    detail: { toggle: 'story-items', label: 'Show every item' },
  },
  {
    id: 'history', stage: 'falling', depth: 'story', visual: 'history',
    apply: (s, D) => { s.selected = D.hist.rsn; },
    title: () => 'Has the score changed over time?',
    text: (D) => {
      const pts = D.hist.inEra, r = D.histRec;
      const line = pts.length >= 2
        ? `Often, yes. ${addr(r)} scored ${pts.at(-2).rec.score} in ${monthYear(pts.at(-2).rec.date)}, then ${pts.at(-1).rec.score} in ${monthYear(pts.at(-1).rec.date)}.`
        : `${addr(r)} has one evaluation under the current system, so there’s no change to see yet.`;
      return [
        line,
        'Notice the dashed line: scores from the system used before 2023 are shown but never joined to newer ones, because the two systems measure different things.',
        `Across ${fmt.n(D.re.n)} re-inspections (a building’s next evaluation), ${pct(D.re.up / D.re.n)} scored higher and ${pct(D.re.down / D.re.n)} lower. A score is a snapshot.`,
      ];
    },
    detail: { lens: 'changes', label: 'All re-inspections' },
  },
  {
    id: 'resolution', stage: 'next', depth: 'story', visual: 'steps',
    title: () => 'What should you check before signing a lease?',
    text: () => [
      'Three things the score alone won’t tell you: how the building’s ward compares with the city, which way its score is moving, and which items inspectors rated low.',
      'Each check below links to the part of LeaseLens that answers it. Start with a building you’re considering.',
    ],
    final: { label: 'Explore a building yourself' },
  },
];

// Older step addresses still land somewhere sensible.
const ALIAS = { aha: 'compare', problems: 'building' };   // the aha frame; the citywide problems chart is now step 4's detail
export const chapterIndex = (id) => Math.max(0, CHAPTERS.findIndex((c) => c.id === (ALIAS[id] ?? id)));
