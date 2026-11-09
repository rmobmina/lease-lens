// Footprint geometry for the Building X-Ray: pure 2D maths on the matched massing rings.
// No Three.js and no DOM, so it runs (and is tested) in Node.
//
// Coordinates are local metres from scripts/build_massing.py: x = east, y = north.
// A ring is a flat array [x0, y0, x1, y1, ...] without a repeated closing point.

export const BUCKETS = 8; // façade orientation bins (45° each) used for the cutaway

export function cleanRing(r) {
  const out = [...r];
  if (out.length >= 4 && out[0] === out.at(-2) && out[1] === out.at(-1)) out.splice(-2, 2);
  return out;
}

// Signed area: positive when counter-clockwise.
export function area(r) {
  let a = 0;
  for (let i = 0; i < r.length; i += 2) { const j = (i + 2) % r.length; a += r[i] * r[j + 1] - r[j] * r[i + 1]; }
  return a / 2;
}

export function pointInRing(x, y, r) {
  let inside = false;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
    const xi = r[i], yi = r[i + 1], xj = r[j], yj = r[j + 1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-12) + xi) inside = !inside;
  }
  return inside;
}

// rings[0] = outer, rings[1..] = holes
export function pointInPoly(x, y, rings) {
  return pointInRing(x, y, rings[0]) && !rings.slice(1).some((h) => pointInRing(x, y, h));
}

// Every wall edge of a polygon with its OUTWARD normal (pointing away from the solid: out of the
// outer ring, and into a courtyard for a hole), its length, angle and orientation bucket.
export function wallEdges(rings) {
  const out = [];
  rings.forEach((r, ri) => {
    const ccw = area(r) > 0;
    for (let i = 0; i < r.length; i += 2) {
      const j = (i + 2) % r.length;
      const ax = r[i], ay = r[i + 1], bx = r[j], by = r[j + 1];
      const len = Math.hypot(bx - ax, by - ay);
      if (len < 0.05) continue;
      const dx = (bx - ax) / len, dy = (by - ay) / len;
      // left of travel is the ring's inside for a CCW ring. Outward from the solid is the ring's
      // outside for the outer ring, and the ring's inside for a hole.
      const leftIsInside = ccw;
      const outwardIsLeft = ri === 0 ? !leftIsInside : leftIsInside;
      const nx = outwardIsLeft ? -dy : dy, ny = outwardIsLeft ? dx : -dx;
      out.push({ ax, ay, bx, by, mx: (ax + bx) / 2, my: (ay + by) / 2, dx, dy, nx, ny, len, ang: Math.atan2(dy, dx), bucket: bucketOf(nx, ny), hole: ri > 0 });
    }
  });
  return out;
}

export function bucketOf(nx, ny) {
  const step = (2 * Math.PI) / BUCKETS;
  return ((Math.round(Math.atan2(ny, nx) / step) % BUCKETS) + BUCKETS) % BUCKETS;
}

// Turn angle at each vertex (radians), used to draw silhouette lines only at real corners.
export function corners(r, minTurn = 0.35) {
  const out = [];
  const n = r.length / 2;
  for (let k = 0; k < n; k++) {
    const p = (k + n - 1) % n, q = (k + 1) % n;
    const ax = r[2 * k] - r[2 * p], ay = r[2 * k + 1] - r[2 * p + 1];
    const bx = r[2 * q] - r[2 * k], by = r[2 * q + 1] - r[2 * k + 1];
    const t = Math.abs(Math.atan2(ax * by - ay * bx, ax * bx + ay * by));
    if (t >= minTurn) out.push([r[2 * k], r[2 * k + 1]]);
  }
  return out;
}

export function convexHull(p) {
  const pts = [...p].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const q of pts) { while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), q) <= 0) lower.pop(); lower.push(q); }
  for (const q of pts.reverse()) { while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), q) <= 0) upper.pop(); upper.push(q); }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

// A rectangle for the illustrative layout: the minimum-area oriented box of the footprint's hull,
// shrunk (and if needed shifted toward the shape's bulk) until its corners and edge midpoints are
// inside the real footprint. u is the long axis; A ≥ B are half sizes.
export function innerFrame(rings) {
  const r = rings[0];
  const pts = [];
  for (let i = 0; i < r.length; i += 2) pts.push([r[i], r[i + 1]]);
  const hull = convexHull(pts);
  let best = null;
  for (let i = 0; i < hull.length; i++) {
    const [ax, ay] = hull[i], [bx, by] = hull[(i + 1) % hull.length];
    const L = Math.hypot(bx - ax, by - ay);
    if (L < 1e-6) continue;
    const ux = (bx - ax) / L, uy = (by - ay) / L, vx = -uy, vy = ux;
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const [x, y] of hull) { const u = x * ux + y * uy, v = x * vx + y * vy; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
    const a = (u1 - u0) * (v1 - v0);
    if (!best || a < best.a) best = { a, ux, uy, vx, vy, u: (u0 + u1) / 2, v: (v0 + v1) / 2, A: (u1 - u0) / 2, B: (v1 - v0) / 2 };
  }
  let { ux, uy, vx, vy, A, B } = best;
  let cx = best.u * ux + best.v * vx, cy = best.u * uy + best.v * vy;
  if (B > A) { [ux, uy, vx, vy, A, B] = [vx, vy, -ux, -uy, B, A]; }
  const fits = (s, ox, oy) => [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 1], [0, -1], [1, 0], [-1, 0], [0, 0]]
    .every(([i, j]) => pointInPoly(ox + (ux * A * i + vx * B * j) * s, oy + (uy * A * i + vy * B * j) * s, rings));
  const centroid = pts.reduce((m, p) => [m[0] + p[0] / pts.length, m[1] + p[1] / pts.length], [0, 0]);
  for (const [ox, oy] of [[cx, cy], centroid]) {
    for (let s = 0.86; s >= 0.3; s -= 0.04) {
      if (fits(s, ox, oy)) return { cx: ox, cy: oy, ux, uy, vx, vy, A: Math.max(3, A * s), B: Math.max(2.5, B * s), fitted: true };
    }
  }
  return { cx, cy, ux, uy, vx, vy, A: Math.max(3, A * 0.3), B: Math.max(2.5, B * 0.3), fitted: false };
}

// Approximate model when there is no reliable footprint: a rectangle sized from units and storeys,
// always drawn hatched and labelled as not sourced.
// Wings of a footprint: up to `max` large rectangles inscribed in the outline, aligned with its dominant
// wall direction, largest first. An L-shaped building gets two wings, a U three, a plain slab one, so
// the illustrative corridors follow the real plan shape. Returns innerFrame-style frames (u = long axis).
export function wingFrames(rings, { max = 3, minSide = 6 } = {}) {
  // candidate axes: the dominant wall direction (modulo 90°), the minimum-area box, the longest walls
  let sx = 0, sy = 0;
  const edges = wallEdges(rings).filter((e) => !e.hole);
  for (const e of edges) { const a = Math.atan2(e.dy, e.dx) * 4; sx += Math.cos(a) * e.len; sy += Math.sin(a) * e.len; }
  const cands = [Math.atan2(sy, sx) / 4];
  const F = innerFrame(rings);
  cands.push(Math.atan2(F.uy, F.ux));
  for (const e of [...edges].sort((a, b) => b.len - a.len).slice(0, 3)) cands.push(e.ang);
  let best = null;
  for (const th of cands) {
    if (best && best.ths.some((t) => Math.abs(Math.sin(2 * (t - th))) < 0.02)) continue;  // same axis set
    const w = wingsAlong(rings, th, max, minSide);
    const a = w.reduce((t, x) => t + x.area, 0);
    if (!best || a > best.a + 1e-6) best = { a, w, ths: [...(best?.ths ?? []), th] };
    else best.ths.push(th);
  }
  return best ? best.w : [];
}
function wingsAlong(rings, th, max, minSide) {
  const r = rings[0];
  const ux = Math.cos(th), uy = Math.sin(th), vx = -uy, vy = ux;
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (let i = 0; i < r.length; i += 2) {
    const u = r[i] * ux + r[i + 1] * uy, v = r[i] * vx + r[i + 1] * vy;
    u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
  }
  const cell = Math.min(1.5, Math.max(0.4, Math.max(u1 - u0, v1 - v0) / 90));
  const nu = Math.max(1, Math.ceil((u1 - u0) / cell)), nv = Math.max(1, Math.ceil((v1 - v0) / cell));
  const free = new Uint8Array(nu * nv);
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const u = u0 + (i + 0.5) * cell, v = v0 + (j + 0.5) * cell;
    free[j * nu + i] = pointInPoly(u * ux + v * vx, u * uy + v * vy, rings) ? 1 : 0;
  }
  const wings = [];
  while (wings.length < max) {
    const R = largestRect(free, nu, nv);
    if (!R) break;
    const A = (R.i1 - R.i0) * cell, B = (R.j1 - R.j0) * cell;
    if (Math.min(A, B) < minSide || (wings.length && A * B < Math.max(40, wings[0].area * 0.12))) break;
    for (let j = R.j0; j < R.j1; j++) for (let i = R.i0; i < R.i1; i++) free[j * nu + i] = 0;
    const cu = u0 + ((R.i0 + R.i1) / 2) * cell, cv = v0 + ((R.j0 + R.j1) / 2) * cell;
    const cx = cu * ux + cv * vx, cy = cu * uy + cv * vy;
    const hA = A / 2 - 0.45, hB = B / 2 - 0.45;                      // clear of the façade wall
    wings.push(hA >= hB
      ? { cx, cy, ux, uy, vx, vy, A: hA, B: hB, area: A * B, fitted: true }
      : { cx, cy, ux: vx, uy: vy, vx: -ux, vy: -uy, A: hB, B: hA, area: A * B, fitted: true });
  }
  return wings;
}
// largest all-ones rectangle in a binary grid (histogram method), as half-open cell ranges
function largestRect(g, nu, nv) {
  const h = new Int32Array(nu);
  let best = null;
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) h[i] = g[j * nu + i] ? h[i] + 1 : 0;
    const st = [];
    for (let i = 0; i <= nu; i++) {
      const hi = i < nu ? h[i] : 0;
      let start = i;
      while (st.length && st[st.length - 1][1] >= hi) {
        const [s, sh] = st.pop();
        const a = sh * (i - s);
        if (sh && (!best || a > best.a)) best = { a, i0: s, i1: i, j0: j - sh + 1, j1: j + 1 };
        start = s;
      }
      st.push([start, hi]);
    }
  }
  return best;
}

export function syntheticMass(entry) {
  const s = Math.max(1, entry.storeys || 3);
  const perFloor = Math.max(220, Math.min(2600, ((entry.units || 20) / s) * 95));
  const w = Math.sqrt(perFloor * 1.9), d = perFloor / w;
  const top = entry.height_m || s * 3;
  return { rings: [[-w / 2, -d / 2, w / 2, -d / 2, w / 2, d / 2, -w / 2, d / 2]], base: 0, top, roof: false, synthetic: true };
}

// Storey layout shared by geometry and labels.
export function storeyLayout(entry, bodies) {
  const main = bodies.reduce((a, b) => (Math.abs(area(b.rings[0])) > Math.abs(area(a.rings[0])) ? b : a), bodies[0]);
  const H = Math.max(...bodies.map((m) => m.top));
  const storeys = Math.max(1, Math.round(entry.storeys || main.top / 3));
  const fh = Math.min(4.6, Math.max(2.4, main.top / storeys));
  const levels = (m) => Math.max(1, Math.round((m.top - m.base) / fh));
  const baseLevel = (m) => Math.round(m.base / fh);
  return { main, H, storeys, fh, levels, baseLevel, topLevel: (m) => baseLevel(m) + levels(m) };
}
