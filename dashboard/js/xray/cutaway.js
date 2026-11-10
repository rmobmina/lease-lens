// Building X-Ray: where the selective cutaway goes. Pure 2D/height maths, no Three.js or DOM, so it
// runs (and is tested) in Node.
//
// The cutaway is ONE box-shaped notch taken out of a corner of the building's main wing, at street
// level, a few storeys high. Everything outside the notch, which is most of the sourced massing, stays
// solid. Inside the notch sits a short stack of illustrative rooms, one per inspection category that has
// a physical place:
//
//   3+ storeys   ground: parking and waste · 1st: building systems · 2nd: shared spaces
//   2 storeys    ground: parking and waste | building systems · 1st: shared spaces
//   1 storey     parking and waste | building systems | shared spaces, side by side
//
// The rooms are generic and identical for every building; only their size follows the real wing. The
// notch can sit at any of the wing's four corners that face the street or a yard (not another wing),
// so the scene can always open the corner facing the reader.
//
// Corner-local frame: origin K at a corner of the wing frame (innerFrame / wingFrames, ~0.45 m inside
// the façade), a = along the wing, inward; b = across the wing, inward. The façade lies at a ≈ −ma and
// b ≈ −mb. The room stack fills a ∈ [−ma, W], b ∈ [−mb, D].

import { pointInPoly } from './footprint.js';

export const SLAB = 0.3;
export const SCENES = ['grounds', 'systems', 'shared'];
const MAX_REACH = 6;       // a corner whose façade is further than this from the frame is not a street corner

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// Size of the notch for a wing frame F and a storey count.
export function notchSize(F, storeys) {
  const L = 2 * F.A, Wd = 2 * F.B;
  // low-rise buildings are opened less along their length: three storeys is all of their height
  const wTarget = storeys >= 5 ? clamp(L * 0.45, 7, 11) : storeys >= 3 ? clamp(L * 0.36, 6.5, 8) : storeys === 2 ? clamp(L * 0.6, 8, 16) : clamp(L * 0.7, 9, 18);
  const W = Math.min(wTarget, L * (storeys >= 3 ? 0.75 : 0.85));
  // shallow on purpose: the rooms are seen through the cut façade, under the storey above, so a deep room
  // would hide its back wall behind its own ceiling
  const D = Math.min(clamp(Wd * 0.4, 3.4, 4.2), Wd * 0.6);
  return { W, D, levels: Math.min(3, Math.max(1, storeys)) };
}

// The scenes in the stack: storey index (0 = ground) and their extent along a. `x0: null` means "from
// the façade" (−ma at the chosen corner).
export function slotsFor(levels, W) {
  if (levels >= 3) return [
    { zone: 'grounds', storey: 0, x0: null, x1: W },
    { zone: 'systems', storey: 1, x0: null, x1: W },
    { zone: 'shared', storey: 2, x0: null, x1: W },
  ];
  if (levels === 2) return [
    { zone: 'grounds', storey: 0, x0: null, x1: W * 0.55 },
    { zone: 'systems', storey: 0, x0: W * 0.55, x1: W },
    { zone: 'shared', storey: 1, x0: null, x1: W },
  ];
  return [
    { zone: 'grounds', storey: 0, x0: null, x1: W * 0.36 },
    { zone: 'systems', storey: 0, x0: W * 0.36, x1: W * 0.68 },
    { zone: 'shared', storey: 0, x0: W * 0.68, x1: W },
  ];
}

// F: main wing frame; bodies: [{rings, base, top}] (data frame); storeys, fh: storeyLayout values;
// base: the main body's base height; prefer: { su, sv } of the corner the default view faces.
export function cutawayPlan({ F, bodies, storeys, fh, base = 0, prefer = { su: 1, sv: 1 } }) {
  const { W, D, levels } = notchSize(F, storeys);
  const yb = base, yt = base + levels * fh - SLAB;
  const solid = bodies.filter((m) => m.base <= yb + 0.5 && m.top >= yt - 0.5);
  const inside = (x, y) => (solid.length ? solid : bodies).some((m) => pointInPoly(x, y, m.rings));
  const corners = [];
  for (const su of [1, -1]) for (const sv of [1, -1]) {
    const K = [F.cx + su * F.A * F.ux + sv * F.B * F.vx, F.cy + su * F.A * F.uy + sv * F.B * F.vy];
    const aHat = [-su * F.ux, -su * F.uy], bHat = [-sv * F.vx, -sv * F.vy];
    const at = (a, b) => [K[0] + aHat[0] * a + bHat[0] * b, K[1] + aHat[1] * a + bHat[1] * b];
    // distance from the frame to the façade, outward along −a (sampled across the notch) and −b
    const reach = (samples, dir) => Math.max(...samples.map((s) => {
      for (let t = 0; t <= MAX_REACH + 2; t += 0.1) {
        const [x, y] = dir === 'a' ? at(-t, s) : at(s, -t);
        if (!inside(x, y)) return t;
      }
      return Infinity;
    }));
    const ma = reach([0.3, D * 0.5, D - 0.3], 'a');
    const mb = reach([0.3, W * 0.5, W - 0.3], 'b');
    corners.push({ key: `${su},${sv}`, su, sv, K, aHat, bHat, ma: Math.min(ma, MAX_REACH), mb: Math.min(mb, MAX_REACH), exposed: ma <= MAX_REACH && mb <= MAX_REACH });
  }
  const pick = corners.find((c) => c.su === prefer.su && c.sv === prefer.sv);
  const home = pick?.exposed ? pick : corners.find((c) => c.exposed) ?? pick;
  return { W, D, levels, yb, yt, fh, slots: slotsFor(levels, W), corners, home: home.key };
}

// World (data-frame) position of a corner-local point.
export function toWorld(c, a, b) { return [c.K[0] + c.aHat[0] * a + c.bHat[0] * b, c.K[1] + c.aHat[1] * a + c.bHat[1] * b]; }
export function toLocal(c, x, y) {
  const dx = x - c.K[0], dy = y - c.K[1];
  return [dx * c.aHat[0] + dy * c.aHat[1], dx * c.bHat[0] + dy * c.bHat[1]];
}

// The real façade outline inside the notch's plan rectangle, in corner-local coordinates: the
// section lines drawn where the cut meets the building. Segments of every outer ring, clipped to
// a ∈ [−ma − pad, W], b ∈ [−mb − pad, D].
export function facadeInNotch(plan, c, bodies, pad = 1.5) {
  const out = [];
  const r0 = [-c.ma - pad, -c.mb - pad], r1 = [plan.W, plan.D];
  for (const m of bodies) {
    const r = m.rings[0];
    for (let i = 0; i < r.length; i += 2) {
      const j = (i + 2) % r.length;
      const p = toLocal(c, r[i], r[i + 1]), q = toLocal(c, r[j], r[j + 1]);
      const s = clipSegment(p, q, r0, r1);
      if (s && Math.hypot(s[2] - s[0], s[3] - s[1]) > 0.05) out.push(s);
    }
  }
  return out;
}

// Liang–Barsky clip of segment p→q to the box [r0, r1].
export function clipSegment(p, q, r0, r1) {
  let t0 = 0, t1 = 1;
  const d = [q[0] - p[0], q[1] - p[1]];
  for (let k = 0; k < 2; k++) {
    // p_k + t·d_k ≥ r0_k  and  p_k + t·d_k ≤ r1_k, written as  t·P ≤ Q
    for (const [P, Q] of [[-d[k], p[k] - r0[k]], [d[k], r1[k] - p[k]]]) {
      if (Math.abs(P) < 1e-12) { if (Q < 0) return null; continue; }
      const t = Q / P;
      if (P < 0) t0 = Math.max(t0, t); else t1 = Math.min(t1, t);
      if (t0 > t1) return null;
    }
  }
  return [p[0] + d[0] * t0, p[1] + d[1] * t0, p[0] + d[0] * t1, p[1] + d[1] * t1];
}

// Share of the two façades meeting at the corner (the ones the reader sees in the cutaway view) that
// the notch opens: what "mostly intact" means visually.
export function openedFacadeShare(plan, c, F, H) {
  const opened = (plan.W + c.ma + plan.D + c.mb) * (plan.yt - plan.yb);
  const total = (2 * F.A + 2 * c.ma + 2 * F.B + 2 * c.mb) * H;
  return total ? opened / total : 0;
}

// Share of the building's volume the notch removes (for tests and the method note).
export function removedShare(plan, c, bodies) {
  const vol = bodies.reduce((t, m) => t + Math.abs(ringArea(m.rings[0])) * (m.top - m.base), 0);
  const notch = (plan.W + c.ma) * (plan.D + c.mb) * (plan.yt - plan.yb);
  return vol ? notch / vol : 0;
}
function ringArea(r) {
  let a = 0;
  for (let i = 0; i < r.length; i += 2) { const j = (i + 2) % r.length; a += r[i] * r[j + 1] - r[j] * r[i + 1]; }
  return a / 2;
}

// Which corner best faces a horizontal view direction (dx, dy) = from the building toward the camera,
// with hysteresis so the cutaway doesn't flicker between corners while orbiting.
export function facingCorner(plan, dx, dy, current, hysteresis = 0.22) {
  let best = null, bestScore = -Infinity, curScore = -Infinity;
  for (const c of plan.corners) {
    if (!c.exposed) continue;
    // outward direction of the opening: mostly across the long face (−b), partly the end (−a)
    const ox = -(c.bHat[0] * 0.8 + c.aHat[0] * 0.6), oy = -(c.bHat[1] * 0.8 + c.aHat[1] * 0.6);
    const s = (ox * dx + oy * dy) / Math.hypot(ox, oy);
    if (c.key === current) curScore = s;
    if (s > bestScore) { bestScore = s; best = c.key; }
  }
  if (best == null) return current;
  return best !== current && bestScore - curScore < hysteresis ? current : best;
}
