// The selective cutaway (dashboard/js/xray/cutaway.js): where the notch goes, how big it is and what it
// exposes, checked on synthetic shapes and on the real massing of the test buildings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanRing, wingFrames, innerFrame, storeyLayout, pointInPoly } from '../dashboard/js/xray/footprint.js';
import { cutawayPlan, notchSize, slotsFor, toWorld, facadeInNotch, clipSegment, removedShare, openedFacadeShare, facingCorner, SCENES } from '../dashboard/js/xray/cutaway.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const entryOf = (rsn) => JSON.parse(readFileSync(path.join(root, `dashboard/data/massing/${Number(rsn) % 64}.json`), 'utf8'))[rsn];

function planFor(entry) {
  const bodies = entry.masses.filter((m) => !m.roof).map((m) => ({ ...m, rings: m.rings.map(cleanRing) }));
  const S = storeyLayout(entry, bodies);
  const w = wingFrames(S.main.rings);
  const F = w.length ? w[0] : innerFrame(S.main.rings);
  return { plan: cutawayPlan({ F, bodies, storeys: S.storeys, fh: S.fh, base: S.main.base }), bodies, S, F };
}

// the brief's test buildings, plus a 51-storey tower
const CASES = { 4152727: '1 Antrim Cres', 4152576: '10 Glen Everest Rd', 4250622: '1A Vermont Ave', 4152711: '875 Kennedy Rd', 4575691: '25 Selby St' };

test('every storey count gets the three room scenes, without overlap, inside the notch', () => {
  for (const levels of [1, 2, 3]) {
    const W = 10;
    const slots = slotsFor(levels, W);
    assert.deepEqual(slots.map((s) => s.zone).sort(), [...SCENES].sort());
    for (const s of slots) {
      assert.ok(s.storey >= 0 && s.storey < levels);
      assert.ok(s.x1 <= W + 1e-9 && (s.x0 ?? -Infinity) < s.x1);
    }
    for (const a of slots) for (const b of slots) {
      if (a === b || a.storey !== b.storey) continue;
      const overlap = Math.min(a.x1, b.x1) - Math.max(a.x0 ?? -Infinity, b.x0 ?? -Infinity);
      assert.ok(overlap <= 1e-9, `slots ${a.zone} and ${b.zone} overlap at ${levels} storeys`);
    }
  }
  assert.equal(slotsFor(3, 10).find((s) => s.zone === 'grounds').storey, 0, 'parking and waste at ground level');
});

test('the notch is shallow, fits the wing, and never exposes more than three storeys', () => {
  for (const [A, B, n] of [[40, 8, 12], [5, 4, 3], [12, 9, 1], [30, 12, 51]]) {
    const { W, D, levels } = notchSize({ A, B }, n);
    assert.ok(W <= 2 * A * 0.85 + 1e-9 && W >= 2, `W ${W}`);
    assert.ok(D <= 4.2 + 1e-9 && D <= 2 * B * 0.6 + 1e-9, `D ${D}`);
    assert.ok(levels <= 3 && levels <= Math.max(1, n));
  }
});

test('segment clipping', () => {
  assert.deepEqual(clipSegment([-5, 0], [5, 0], [-1, -1], [1, 1]), [-1, 0, 1, 0]);
  assert.equal(clipSegment([-5, 5], [5, 5], [-1, -1], [1, 1]), null);
  assert.deepEqual(clipSegment([0, 0], [0.5, 0.5], [-1, -1], [1, 1]), [0, 0, 0.5, 0.5]);
});

test('the opening follows the reader to the facing corner, with hysteresis', () => {
  const F = { cx: 0, cy: 0, ux: 1, uy: 0, vx: 0, vy: 1, A: 15, B: 6 };
  const bodies = [{ rings: [[-15.5, -6.5, 15.5, -6.5, 15.5, 6.5, -15.5, 6.5]], base: 0, top: 20 }];
  const plan = cutawayPlan({ F, bodies, storeys: 6, fh: 3, prefer: { su: 1, sv: -1 } });
  assert.equal(plan.home, '1,-1');
  assert.ok(plan.corners.every((c) => c.exposed), 'a plain slab has four street corners');
  // camera to the south-east: the south-east corner (su = +1 east, sv = −1 south)
  assert.equal(facingCorner(plan, 0.5, -1, '1,-1'), '1,-1');
  // camera due north: switch to a northern corner
  assert.match(facingCorner(plan, 0, 1, '1,-1'), /,1$/);
  // camera just past due south: stay put (hysteresis)
  assert.equal(facingCorner(plan, -0.05, -1, '1,-1'), '1,-1');
});

for (const [rsn, name] of Object.entries(CASES)) {
  test(`${name}: notch at a street corner, inside the real footprint, most of the massing intact`, () => {
    const e = entryOf(rsn);
    assert.equal(e.provenance, 'massing', name);
    const { plan, bodies, S, F } = planFor(e);
    const home = plan.corners.find((c) => c.key === plan.home);
    assert.ok(home.exposed, 'the default corner faces the street or a yard, not another wing');
    assert.ok(home.ma < 4 && home.mb < 4, 'the frame corner sits just inside the façade');
    // the room stack lies inside the building
    for (const [a, b] of [[0.2, 0.2], [plan.W - 0.2, 0.2], [0.2, plan.D - 0.2], [plan.W - 0.2, plan.D - 0.2], [plan.W / 2, plan.D / 2]]) {
      const [x, y] = toWorld(home, a, b);
      assert.ok(bodies.some((m) => pointInPoly(x, y, m.rings)), `${name}: room point (${a.toFixed(1)}, ${b.toFixed(1)}) inside the footprint`);
    }
    // at most three storeys from the ground, and the rest of the massing stays (70–85%+ intact)
    assert.ok(plan.yb <= S.main.base + 1e-9 && plan.yt <= S.main.base + 3 * S.fh);
    const share = removedShare(plan, home, bodies);
    assert.ok(share > 0 && share <= 0.3, `${name}: removes ${(share * 100).toFixed(1)}% of the volume`);
    // visually: the two façades the reader faces stay at least ~70% intact
    const open = openedFacadeShare(plan, home, F, S.H);
    assert.ok(open > 0.01 && open <= 0.3, `${name}: opens ${(open * 100).toFixed(1)}% of the facing façades`);
    if (S.storeys > 30) assert.ok(open < 0.05, 'a tower keeps its silhouette: only a sliver at the base is opened');
    // section lines lie on the real façade, inside the notch's plan rectangle
    const segs = facadeInNotch(plan, home, bodies);
    assert.ok(segs.length >= 1, 'the cut meets the façade');
    for (const [a0, b0, a1, b1] of segs) for (const [a, b] of [[a0, b0], [a1, b1]]) {
      assert.ok(a <= plan.W + 1e-6 && b <= plan.D + 1e-6 && a >= -home.ma - 1.5 - 1e-6 && b >= -home.mb - 1.5 - 1e-6);
    }
  });
}

test('a usable corner fits the real plan: its corner point is inside and most of the room stack is too', async () => {
  const { MIN_FIT } = await import('../dashboard/js/xray/cutaway.js');
  for (const rsn of Object.keys(CASES)) {
    const { plan, bodies } = planFor(entryOf(rsn));
    for (const c of plan.corners.filter((x) => x.exposed)) {
      assert.ok(bodies.some((m) => pointInPoly(c.K[0], c.K[1], m.rings)), `${rsn} ${c.key}: corner inside`);
      assert.ok(c.fit >= MIN_FIT, `${rsn} ${c.key}: fit ${c.fit}`);
    }
  }
});

test('tapered and triangular plans get a corner that fits them', () => {
  // a trapezoid (16 m wide tapering to 8 m over 26 m) and a right triangle (30 × 22 m)
  for (const rings of [[[0, -8, 26, -4, 26, 4, 0, 8]], [[0, 0, 30, 0, 0, 22]]]) {
    const bodies = [{ rings, base: 0, top: 18 }];
    const F = wingFrames(rings)[0] ?? innerFrame(rings);
    const plan = cutawayPlan({ F, bodies, storeys: 6, fh: 3 });
    const home = plan.corners.find((c) => c.key === plan.home);
    assert.ok(home.exposed && home.fit >= 0.8, `fit ${home.fit}`);
    assert.ok(plan.corners.every((c) => !c.exposed || pointInPoly(c.K[0], c.K[1], rings)));
  }
});

test('room floors are the footprint clipped to the room, not its rectangle', async () => {
  const { _test: { clipToRect, polyArea } } = await import('../dashboard/js/xray/rooms.js');
  // a right triangle over a 10 × 10 room: half the room is outside the building
  const tri = [[0, 0], [10, 0], [0, 10]];
  const floor = clipToRect(tri, 0, 10, 0, 10);
  assert.equal(Math.abs(polyArea(floor)), 50);
  // an L-shaped (concave) plan clipped to a room straddling its inner corner
  const L = [[0, 0], [10, 0], [10, 4], [4, 4], [4, 10], [0, 10]];
  assert.equal(Math.abs(polyArea(clipToRect(L, 2, 8, 2, 8))), 6 * 2 + 2 * 4);
});
