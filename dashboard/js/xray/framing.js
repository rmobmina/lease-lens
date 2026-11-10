// Building X-Ray: camera fitting. Pure (no Three.js), tested in Node.
//
// Given the points that make up the visible model (footprint corners at the lowest and highest visible
// heights and site elements included), a fixed view direction, the vertical field of
// view, the canvas aspect ratio and a safe area, find the camera position that brings the model as close
// as possible while every point projects inside the safe area. With the orientation fixed, each
// screen-edge constraint is linear in the camera position, and the horizontal and vertical constraints
// separate, so the answer is exact (no iteration): the depth is the tightest of the two axes, and the
// sideways and vertical offsets are centred in their feasible ranges.

// Three.js spherical convention: theta = azimuth about +Y from +Z, phi = polar angle from +Y.
export function viewBasis(theta, phi) {
  const s = Math.sin(phi);
  const f = [-s * Math.sin(theta), -Math.cos(phi), -s * Math.cos(theta)];   // camera -> target
  const rl = Math.hypot(f[2], f[0]) || 1;
  const r = [-f[2] / rl, 0, f[0] / rl];                                      // f × world up
  const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  return { f, r, u };
}

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// points: [[x, y, z]]; insets: fractions of the canvas kept free on each side {l, r, t, b}
// returns { position, target, distance } — target lies on the view axis at the depth of the model centre
export function fitView(points, { theta, phi, fov, aspect, insets = {}, near = 0.5 }) {
  const { f, r, u } = viewBasis(theta, phi);
  const tv = Math.tan((fov * Math.PI) / 360), th = tv * aspect;
  const { l = 0, r: ir = 0, t = 0, b = 0 } = insets;
  const xl = (-1 + 2 * l) * th, xr = (1 - 2 * ir) * th;
  const yb = (-1 + 2 * b) * tv, yt = (1 - 2 * t) * tv;
  let h1 = -Infinity, h2 = Infinity, v1 = -Infinity, v2 = Infinity, fmin = Infinity;
  const c0 = [0, 0, 0];
  for (const p of points) {
    const pr = dot(p, r), pu = dot(p, u), pf = dot(p, f);
    h1 = Math.max(h1, pr - xr * pf); h2 = Math.min(h2, pr - xl * pf);
    v1 = Math.max(v1, pu - yt * pf); v2 = Math.min(v2, pu - yb * pf);
    fmin = Math.min(fmin, pf);
    c0[0] += p[0] / points.length; c0[1] += p[1] / points.length; c0[2] += p[2] / points.length;
  }
  // camera depth along f: as far forward as both axes (and the near plane) allow
  const c = Math.min((h2 - h1) / (xr - xl), (v2 - v1) / (yt - yb), fmin - near);
  const a = (h1 + xr * c + h2 + xl * c) / 2;
  const bb = (v1 + yt * c + v2 + yb * c) / 2;
  const position = [0, 1, 2].map((i) => a * r[i] + bb * u[i] + c * f[i]);
  const distance = Math.max(near * 2, dot(c0, f) - c);
  const target = position.map((x, i) => x + f[i] * distance);
  return { position, target, distance };
}

// where each point lands on screen (0..1, y down) for a camera at `position` looking along (theta, phi)
export function projectAll(points, { position, theta, phi, fov, aspect }) {
  const { f, r, u } = viewBasis(theta, phi);
  const tv = Math.tan((fov * Math.PI) / 360), th = tv * aspect;
  return points.map((p) => {
    const d = [p[0] - position[0], p[1] - position[1], p[2] - position[2]];
    const z = dot(d, f);
    return [(dot(d, r) / (z * th)) * 0.5 + 0.5, -(dot(d, u) / (z * tv)) * 0.5 + 0.5, z];
  });
}

// Keep the camera out of the building. The building is a vertical prism: the convex hull of its footprint
// (Three.js [x, z] pairs, either winding) grown by `margin`, from below ground up to `top + margin`.
// If the camera at `cam` is inside it, return the point where the line of sight from `target` through the
// camera leaves the prism (the camera backs out along its own view line, so the view doesn't swing);
// otherwise return null.
export function pushOutside(target, cam, hull, top, margin = 2) {
  const dx = cam[0] - target[0], dy = cam[1] - target[1], dz = cam[2] - target[2];
  const s = Math.hypot(dx, dy, dz);
  if (s < 1e-6 || hull.length < 3) return null;
  const d = [dx / s, dy / s, dz / s];
  let a = 0;
  for (let i = 0; i < hull.length; i++) { const p = hull[i], q = hull[(i + 1) % hull.length]; a += p[0] * q[1] - q[0] * p[1]; }
  const sg = a > 0 ? 1 : -1;
  let t0 = -Infinity, t1 = Infinity;
  const clip = (nd, rhs) => {                 // constraint along the ray: λ·nd ≤ rhs
    if (Math.abs(nd) < 1e-12) return rhs >= 0;
    if (nd > 0) t1 = Math.min(t1, rhs / nd); else t0 = Math.max(t0, rhs / nd);
    return true;
  };
  for (let i = 0; i < hull.length; i++) {
    const p = hull[i], q = hull[(i + 1) % hull.length];
    const ex = q[0] - p[0], ez = q[1] - p[1], len = Math.hypot(ex, ez);
    if (len < 1e-9) continue;
    const nx = (sg * ez) / len, nz = (-sg * ex) / len;                       // outward normal
    if (!clip(nx * d[0] + nz * d[2], margin - (nx * (target[0] - p[0]) + nz * (target[2] - p[1])))) return null;
  }
  if (!clip(d[1], top + margin - target[1])) return null;
  if (t0 > t1 || !(s > t0 && s < t1)) return null;
  const k = t1 + 0.01;
  return [target[0] + d[0] * k, target[1] + d[1] * k, target[2] + d[2] * k];
}
