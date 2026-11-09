// Building X-Ray: geometry for ONE building, built from its matched City of Toronto 3D Massing record.
//
//   Exterior (zone "exterior")  real footprints (holes included) extruded to their source heights; rooftop
//                               parts stacked on the roof. Windows and balconies are an ILLUSTRATIVE pattern
//                               spaced by the registered storeys; they are not surveyed façade features.
//   Context                     neighbouring massing within ~110 m, neutral and untextured.
//   Interior (X-Ray only)       a CONCEPTUAL schematic fitted inside the real footprint: floor plates follow
//                               the real outline; corridors, stair, elevator core, mechanical plant, parking and
//                               the records layer are generic and do not represent the actual floor plan.
//
// Local frame from the data: x = metres east, y = metres north. Three.js: X = east, Y = up, Z = south (−north).

const PARKING_DEPTH = 3.4;

export function buildBuilding(THREE, mergeGeometries, entry, mat) {
  const root = new THREE.Group();
  const zones = { exterior: new THREE.Group(), shared: new THREE.Group(), systems: new THREE.Group(), records: new THREE.Group(), grounds: new THREE.Group() };
  const interior = new THREE.Group();
  for (const [k, g] of Object.entries(zones)) { g.name = k; (k === 'exterior' ? root : interior).add(g); }
  root.add(interior);
  const ctxGroup = new THREE.Group();
  root.add(ctxGroup);
  const disposables = [];
  const keep = (g) => { disposables.push(g); return g; };

  // ---- normalise the masses -------------------------------------------------------------------
  const approx = entry.provenance === 'approximate' || !entry.masses?.length;
  let masses = approx ? [syntheticMass(entry)] : entry.masses.map((m) => ({ ...m, rings: m.rings.map(cleanRing) })).filter((m) => m.rings[0].length >= 6);
  if (!masses.length) masses = [syntheticMass(entry)];
  const bodies = masses.filter((m) => !m.roof);
  const main = bodies.reduce((a, b) => (Math.abs(area(b.rings[0])) > Math.abs(area(a.rings[0])) ? b : a), bodies[0] ?? masses[0]);
  const H = Math.max(...bodies.map((m) => m.top));
  const storeys = Math.max(1, Math.round(entry.storeys || H / 3));
  const fh = Math.min(4.5, Math.max(2.5, H / storeys));

  // ---- exterior shell ---------------------------------------------------------------------------
  // walls (one merged mesh) and roofs (flat caps just above each mass, in a darker roofing tone)
  const shellGeo = [], roofGeo = [];
  for (const m of masses) {
    const g = extrude(THREE, m.rings, Math.max(0.3, m.top - m.base));
    g.translate(0, m.base, 0);
    shellGeo.push(g.index ? g.toNonIndexed() : g);
    const c = flat(THREE, m.rings);
    c.translate(0, Math.max(m.top, m.base + 0.3) + 0.03, 0);
    roofGeo.push(c);
  }
  const shell = new THREE.Mesh(keep(mergeGeometries(shellGeo, false)), mat('exterior', 'wall'));
  const roofs = new THREE.Mesh(keep(mergeGeometries(roofGeo, false)), mat('exterior', 'roof'));
  [...shellGeo, ...roofGeo].forEach((g) => g.dispose());
  shell.userData = { zone: 'exterior', edges: 18, shell: true };
  roofs.userData = { zone: 'exterior' };
  shell.castShadow = shell.receiveShadow = roofs.receiveShadow = true;
  zones.exterior.add(shell, roofs);

  // illustrative façade pattern: windows on every storey, balconies on the two longest walls of mid-rises
  const win = [], bal = [], guard = [];
  for (const m of approx ? [] : bodies) {   // no façade pattern on an approximate block: it isn't this building
    const r = m.rings[0];
    const floors = Math.max(1, Math.round((m.top - m.base) / fh));
    const edges = ringEdges(r).filter((e) => e.len >= 2.6);
    const longest = [...edges].sort((a, b) => b.len - a.len).slice(0, 2);
    for (const e of edges) {
      const bays = Math.max(1, Math.floor(e.len / 3.1));
      const bw = e.len / bays;
      const ww = Math.min(1.5, bw * 0.55), wh = Math.min(1.7, fh * 0.55);
      const balconies = storeys >= 5 && longest.includes(e) && e.len > 12;
      for (let f = 0; f < floors; f++) {
        const y = m.base + f * fh;
        if (y + fh > m.top + 0.01) break;
        for (let k = 0; k < bays; k++) {
          const t = (k + 0.5) / bays;
          const px = e.ax + e.dx * e.len * t, py = e.ay + e.dy * e.len * t;
          win.push([px + e.nx * 0.05, y + fh * 0.32 + wh / 2, py + e.ny * 0.05, e.ang, ww, wh, 0.1]);
          if (balconies && f >= 1 && k % 2 === 1) {
            const depth = 1.3;
            bal.push([px + e.nx * (depth / 2), y + 0.08, py + e.ny * (depth / 2), e.ang, bw * 0.78, 0.16, depth]);
            guard.push([px + e.nx * depth, y + 0.6, py + e.ny * depth, e.ang, bw * 0.78, 1.0, 0.05]);
          }
        }
      }
    }
  }
  if (win.length) {
    const windows = instanced(THREE, win, mat('exterior', 'window'));
    windows.userData = { zone: 'exterior', facade: true };
    zones.exterior.add(windows);
  }
  if (bal.length) {
    const b = instanced(THREE, bal, mat('exterior', 'slab'));
    b.castShadow = true;
    b.userData = { zone: 'exterior', facade: true };
    const gd = instanced(THREE, guard, mat('exterior', 'glass'));
    gd.userData = { zone: 'exterior', facade: true };
    zones.exterior.add(b, gd);
  }

  // ---- conceptual interior, fitted inside the main footprint ---------------------------------------
  const F = innerFrame(main.rings[0]);            // centre, long axis u, half sizes A ≥ B (inside the footprint)
  const at = (du, dv) => [F.cx + F.ux * du + F.vx * dv, F.cy + F.uy * du + F.vy * dv];
  const ang = Math.atan2(F.uy, F.ux);
  const box = (list, du, dv, y0, y1, su, sv, a = ang) => { const [x, y] = at(du, dv); list.push([x, (y0 + y1) / 2, y, a, su, y1 - y0, sv]); };

  // floor plates: the REAL outline of every body, one per storey (shared spaces)
  const plates = [];
  for (const m of bodies) {
    const n = Math.max(1, Math.round((m.top - m.base) / fh));
    for (let f = 1; f < n; f++) {
      const g = extrude(THREE, m.rings, 0.22);
      g.translate(0, m.base + f * fh - 0.22, 0);
      plates.push(g);
    }
  }
  if (plates.length) {
    const pm = new THREE.Mesh(keep(mergeGeometries(plates, false)), mat('shared', 'slab'));
    plates.forEach((g) => g.dispose());
    pm.userData = { zone: 'shared', edges: 30 };
    pm.receiveShadow = true;
    zones.shared.add(pm);
  }

  // shared spaces: a corridor with doors and a stair on every storey
  const corrW = Math.min(2.0, F.B * 0.5), runL = F.A * 2 * 0.92;
  const strip = [], walls = [], doors = [], steps = [], rails = [];
  const stairL = Math.min(6, F.A * 0.45), stairW = Math.min(2.8, F.B * 0.8);
  for (let f = 0; f < storeys; f++) {
    const y = f * fh;
    if (y + 1 > H) break;
    box(strip, stairL / 2, 0, y + 0.01, y + 0.05, runL - stairL, corrW);
    for (const side of [-1, 1]) {
      // walls cut at 1.3 m so the corridor reads from above; a door opening every ~4.5 m
      const segs = Math.max(1, Math.floor((runL - stairL) / 4.5));
      const segL = (runL - stairL) / segs;
      for (let s = 0; s < segs; s++) {
        const du = -runL / 2 + stairL + segL * (s + 0.5) + 0.55;
        box(walls, du, side * corrW / 2, y, y + 1.3, segL - 1.1, 0.12);
        box(doors, du - segL / 2 + 0.05, side * (corrW / 2 + 0.04), y, y + 2.05, 0.9, 0.05);
      }
    }
    // stair: two flights per storey at the end of the corridor, with a handrail
    const n = 9, rise = fh / 2 / n, run = stairL / n;
    for (let s = 0; s < n; s++) {
      box(steps, -runL / 2 + run * (s + 0.5), -stairW / 4, y, y + rise * (s + 1), run, stairW / 2 - 0.05);
      box(steps, -runL / 2 + stairL - run * (s + 0.5), stairW / 4, y + fh / 2, y + fh / 2 + rise * (s + 1), run, stairW / 2 - 0.05);
    }
    box(rails, -runL / 2 + stairL / 2, 0, y + fh / 2 + 0.9, y + fh / 2 + 0.95, stairL, 0.05);
  }
  add(zones.shared, instanced(THREE, strip, mat('shared', 'tint')), 'shared', true);
  add(zones.shared, instanced(THREE, walls, mat('shared', 'wall')), 'shared');
  add(zones.shared, instanced(THREE, doors, mat('shared', 'dark')), 'shared');
  add(zones.shared, instanced(THREE, steps, mat('shared', 'slab')), 'shared');
  add(zones.shared, instanced(THREE, rails, mat('shared', 'dark')), 'shared');

  // building systems: elevator core with risers, rooftop mechanical plant
  const sys = [], sysTint = [], pipes = [], plant = [];
  const coreU = F.A * 0.25, coreV = -(corrW / 2 + Math.min(1.4, F.B * 0.35));
  const coreS = Math.min(2.4, F.B * 0.6);
  box(sysTint, coreU, coreV, -PARKING_DEPTH, H + 0.4, coreS, coreS);
  box(sys, coreU, coreV, H * 0.35, H * 0.35 + 2.2, coreS * 0.7, coreS * 0.7);           // cab
  for (const k of [0, 1, 2]) {
    const [x, y] = at(coreU + coreS / 2 + 0.35 + k * 0.3, coreV);
    pipes.push([x, (H - PARKING_DEPTH) / 2, y, 0, 0.16, H + PARKING_DEPTH, 0.16]);
  }
  const roofY = H;
  box(plant, coreU, coreV, roofY, roofY + 2.6, coreS + 2.2, coreS + 1.6);                // machine room
  const rtuN = Math.max(1, Math.min(4, Math.floor(F.A / 6)));
  for (let i = 0; i < rtuN; i++) box(plant, -F.A * 0.6 + i * (F.A * 1.0 / rtuN), F.B * 0.45, roofY, roofY + 1.3, 2.4, 1.6);
  const core = instanced(THREE, sysTint, mat('systems', 'tint'));
  add(zones.systems, core, 'systems', true);
  add(zones.systems, instanced(THREE, sys, mat('systems', 'dark')), 'systems');
  add(zones.systems, instanced(THREE, plant, mat('systems', 'wall')), 'systems', true);
  const pipeMesh = new THREE.InstancedMesh(keep(new THREE.CylinderGeometry(0.5, 0.5, 1, 10)), mat('systems', 'tint'), pipes.length);
  pipes.forEach((p, i) => pipeMesh.setMatrixAt(i, compose(THREE, p)));
  add(zones.systems, pipeMesh, 'systems');
  const fans = [];
  for (let i = 0; i < rtuN; i++) { const [x, y] = at(-F.A * 0.6 + i * (F.A * 1.0 / rtuN), F.B * 0.45); fans.push([x, roofY + 1.38, y, 0, 1.1, 0.16, 1.1]); }
  const fanMesh = new THREE.InstancedMesh(keep(new THREE.CylinderGeometry(0.5, 0.5, 1, 18)), mat('systems', 'dark'), fans.length);
  fans.forEach((p, i) => fanMesh.setMatrixAt(i, compose(THREE, p)));
  add(zones.systems, fanMesh, 'systems');

  // parking, grounds and waste: one parking level under the main footprint, waste enclosure outside
  const pk = extrude(THREE, main.rings, 0.3);
  pk.translate(0, -PARKING_DEPTH - 0.3, 0);
  const pkSlab = new THREE.Mesh(keep(pk), mat('grounds', 'tint'));
  pkSlab.userData = { zone: 'grounds', edges: 30 };
  pkSlab.receiveShadow = true;
  zones.grounds.add(pkSlab);
  const cols = [], cars = [], cabins = [], lines = [];
  const colStep = 7.5;
  for (let du = -F.A + 2; du <= F.A - 2; du += colStep) {
    for (const dv of [-F.B * 0.55, F.B * 0.55]) box(cols, du, dv, -PARKING_DEPTH, 0, 0.45, 0.45);
    for (const dv of [-F.B * 0.78, F.B * 0.78]) {
      for (const off of [1.5, 4.2]) {
        if (du + off > F.A - 1) continue;
        box(cars, du + off, dv, -PARKING_DEPTH + 0.2, -PARKING_DEPTH + 0.75, 1.8, 4.2, ang);
        box(cabins, du + off, dv + (dv > 0 ? 0.3 : -0.3), -PARKING_DEPTH + 0.75, -PARKING_DEPTH + 1.2, 1.6, 2.2, ang);
        box(lines, du + off + 1.35, dv, -PARKING_DEPTH + 0.01, -PARKING_DEPTH + 0.03, 0.1, 4.8);
      }
    }
  }
  add(zones.grounds, instanced(THREE, cols, mat('grounds', 'slab')), 'grounds');
  add(zones.grounds, instanced(THREE, cars, mat('grounds', 'dark')), 'grounds');
  add(zones.grounds, instanced(THREE, cabins, mat('grounds', 'glass')), 'grounds');
  add(zones.grounds, instanced(THREE, lines, mat('grounds', 'paint')), 'grounds');
  const south = F.vy <= 0 ? 1 : -1;     // side of the long axis that faces the default (southern) camera
  const out = outsideAlong(bodies, F, F.ux * (F.ux >= 0 ? 1 : -1), F.uy * (F.ux >= 0 ? 1 : -1), 2.5); // waste enclosure past the east end
  const bins = [];
  const wa = Math.atan2(F.uy, F.ux);
  for (const [du, w, h, d] of [[-1.1, 1.6, 1.3, 1.1], [0.9, 1.6, 1.3, 1.1], [0, 4.6, 1.6, 0.15]]) {
    bins.push([out[0] + F.ux * du + (d === 0.15 ? -F.vx * 0.9 : 0), h / 2, out[1] + F.uy * du + (d === 0.15 ? -F.vy * 0.9 : 0), wa, w, h, d === 0.15 ? 0.15 : d]);
  }
  add(zones.grounds, instanced(THREE, bins, mat('grounds', 'dark')), 'grounds', true);

  // safety and records: an abstract documentation layer, NOT a place in the building
  const recAt = outside(bodies, F, south, 4.5);
  const records = { at: recAt, ang: wa, group: zones.records };

  // ---- context ------------------------------------------------------------------------------
  if (entry.context?.length) {
    const cg = entry.context.map((c) => { const g = extrude(THREE, [cleanRing(c.r)], Math.max(0.5, c.t - c.b)); g.translate(0, c.b, 0); return g; });
    const cm = new THREE.Mesh(keep(mergeGeometries(cg, false)), mat(null, 'context'));
    cg.forEach((g) => g.dispose());
    cm.castShadow = cm.receiveShadow = true;
    cm.userData = { edges: 25, context: true };
    ctxGroup.add(cm);
  }

  // ---- bounds, anchors -------------------------------------------------------------------------
  const bb = new THREE.Box3().setFromObject(zones.exterior);
  const sphere = bb.getBoundingSphere(new THREE.Sphere());
  const corner = farthestCorner(main.rings[0]);
  const T = (x, y, h) => new THREE.Vector3(x, h, -y);
  const anchors = {
    exterior: T(corner[0], corner[1], H * 0.62),
    systems: T(...at(coreU, coreV), roofY + 2.6),
    shared: T(...at(-runL / 2 + stairL / 2, 0), Math.min(H * 0.5, fh * Math.floor(storeys / 2)) + 1),
    records: T(recAt[0], recAt[1], 2.4),
    grounds: T(...at(F.A * 0.6, 0), -PARKING_DEPTH + 1),
  };
  return {
    root, zones, interior, context: ctxGroup, anchors, records, approx, H, storeys, fh,
    bounds: { box: bb, sphere, axis: Math.atan2(F.uy, F.ux) },
    dispose() { disposables.forEach((g) => g.dispose()); root.traverse((o) => { if (o.isInstancedMesh) o.dispose(); }); },
  };

  function add(group, mesh, zone, edges = false) {
    if (!mesh) return;
    mesh.userData = { zone, edges: edges ? 30 : 0 };
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  function instanced(THREE, list, material) {
    if (!list.length) return null;
    const m = new THREE.InstancedMesh(keep(new THREE.BoxGeometry(1, 1, 1)), material, list.length);
    list.forEach((p, i) => m.setMatrixAt(i, compose(THREE, p)));
    m.instanceMatrix.needsUpdate = true;
    return m;
  }
}

// The record tiles change with the inspection shown, so they are rebuilt separately.
// One upright plate per record item, coloured by its ACTUAL rating class (scene supplies the material).
export function buildRecordTiles(THREE, rec, items, tileMat, plinthMat) {
  const g = new THREE.Group();
  const n = Math.max(items.length, 1);
  const step = 1.25, w = 1.0, h = 1.5;
  const span = (n - 1) * step;
  const ux = Math.cos(rec.ang), uy = Math.sin(rec.ang);
  const geos = [];
  const tile = new THREE.BoxGeometry(w, h, 0.08);
  items.forEach((it, i) => {
    const d = -span / 2 + i * step;
    const m = new THREE.Mesh(tile, tileMat(it));
    m.position.set(rec.at[0] + ux * d, 0.35 + h / 2, -(rec.at[1] + uy * d));
    m.rotation.y = rec.ang;
    m.userData = { zone: 'records', item: it.col, tile: true };
    m.castShadow = true;
    g.add(m);
  });
  const plinth = new THREE.Mesh(new THREE.BoxGeometry(span + 1.6, 0.3, 1.1), plinthMat);
  plinth.position.set(rec.at[0], 0.15, -rec.at[1]);
  plinth.rotation.y = rec.ang;
  plinth.userData = { zone: 'records', edges: 30 };
  plinth.receiveShadow = true;
  g.add(plinth);
  geos.push(tile, plinth.geometry);
  g.userData.dispose = () => geos.forEach((x) => x.dispose());
  return g;
}

// ---- helpers ---------------------------------------------------------------------------------------
function compose(THREE, [x, y, z, a, sx, sy, sz]) {
  const m = new THREE.Matrix4();
  // `a` is an angle in the data frame (from east, counter-clockwise looking down); Three's Z points south
  return m.compose(new THREE.Vector3(x, y, -z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), a), new THREE.Vector3(sx, sy, sz));
}

function cleanRing(r) {
  const out = [...r];
  if (out.length >= 4 && out[0] === out.at(-2) && out[1] === out.at(-1)) out.splice(-2, 2);
  return out;
}

function extrude(THREE, rings, depth) {
  const toPts = (r) => { const p = []; for (let i = 0; i < r.length; i += 2) p.push(new THREE.Vector2(r[i], r[i + 1])); return p; };
  const shape = new THREE.Shape(toPts(rings[0]));
  for (const h of rings.slice(1)) if (h.length >= 6) shape.holes.push(new THREE.Path(toPts(h)));
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  g.rotateX(-Math.PI / 2);
  return g;
}

function flat(THREE, rings) {
  const toPts = (r) => { const p = []; for (let i = 0; i < r.length; i += 2) p.push(new THREE.Vector2(r[i], r[i + 1])); return p; };
  const shape = new THREE.Shape(toPts(rings[0]));
  for (const h of rings.slice(1)) if (h.length >= 6) shape.holes.push(new THREE.Path(toPts(h)));
  const g = new THREE.ShapeGeometry(shape);
  g.rotateX(-Math.PI / 2);
  return g;
}

function area(r) {
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

function ringEdges(r) {
  const out = [];
  for (let i = 0; i < r.length; i += 2) {
    const j = (i + 2) % r.length;
    const ax = r[i], ay = r[i + 1], bx = r[j], by = r[j + 1];
    const len = Math.hypot(bx - ax, by - ay);
    if (len < 1e-6) continue;
    const dx = (bx - ax) / len, dy = (by - ay) / len;
    let nx = dy, ny = -dx;
    const mx = (ax + bx) / 2, my = (ay + by) / 2;
    if (pointInRing(mx + nx * 0.3, my + ny * 0.3, r)) { nx = -nx; ny = -ny; }
    out.push({ ax, ay, dx, dy, nx, ny, len, ang: Math.atan2(dy, dx) });
  }
  return out;
}

// Largest useful rectangle for the schematic: the minimum-area oriented box of the footprint's
// convex hull, shrunk until its corners and edge midpoints are inside the real footprint.
function innerFrame(r) {
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
  if (B > A) { [ux, uy, vx, vy, A, B] = [vx, vy, -ux, -uy, B, A]; [best.u, best.v] = [best.v, -best.u]; }
  const cx = best.u * ux + best.v * vx, cy = best.u * uy + best.v * vy;
  const inside = (s, ox = 0, oy = 0) => [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 1], [0, -1], [1, 0], [-1, 0]]
    .every(([i, j]) => pointInRing(cx + ox + (ux * A * i + vx * B * j) * s, cy + oy + (uy * A * i + vy * B * j) * s, r));
  let s = 0.82;
  while (s > 0.3 && !inside(s)) s -= 0.04;
  // irregular shapes: the box may not fit around the centre; try shifting it toward the bulk of the shape
  let ox = 0, oy = 0;
  if (!inside(s)) {
    const c = pts.reduce((m, p) => [m[0] + p[0] / pts.length, m[1] + p[1] / pts.length], [0, 0]);
    ox = c[0] - cx; oy = c[1] - cy;
  }
  return { cx: cx + ox, cy: cy + oy, ux, uy, vx, vy, A: Math.max(4, A * s), B: Math.max(3, B * s) };
}

function convexHull(p) {
  const pts = [...p].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const q of pts) { while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), q) <= 0) lower.pop(); lower.push(q); }
  for (const q of pts.reverse()) { while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), q) <= 0) upper.pop(); upper.push(q); }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

// A point outside every body, searching outward from the frame centre along ±v (then ±u).
function outside(bodies, F, side, margin = 3) {
  const dirs = [[F.vx * side, F.vy * side], [F.ux * side, F.uy * side], [-F.vx * side, -F.vy * side], [-F.ux * side, -F.uy * side]];
  for (const [dx, dy] of dirs) {
    for (let d = 2; d < 200; d += 1) {
      const x = F.cx + dx * d, y = F.cy + dy * d;
      if (!bodies.some((m) => pointInRing(x, y, m.rings[0]))) return [x + dx * margin, y + dy * margin];
    }
  }
  return [F.cx + 30, F.cy];
}

function outsideAlong(bodies, F, dx, dy, margin) {
  for (let d = 2; d < 300; d += 1) {
    const x = F.cx + dx * d, y = F.cy + dy * d;
    if (!bodies.some((m) => pointInRing(x, y, m.rings[0]))) return [x + dx * margin, y + dy * margin];
  }
  return [F.cx + dx * 30, F.cy + dy * 30];
}

function farthestCorner(r) {
  let best = [r[0], r[1]], d = -1;
  for (let i = 0; i < r.length; i += 2) { const q = r[i] + r[i + 1] * 0.6; if (q > d) { d = q; best = [r[i], r[i + 1]]; } }
  return best;
}

// Approximate model: a rectangle sized from units and storeys, clearly flagged as not sourced.
function syntheticMass(entry) {
  const s = Math.max(1, entry.storeys || 3);
  const perFloor = Math.max(220, Math.min(2600, ((entry.units || 20) / s) * 95));
  const w = Math.sqrt(perFloor * 1.9), d = perFloor / w;
  const top = entry.height_m || s * 3;
  return { rings: [[-w / 2, -d / 2, -w / 2, d / 2, w / 2, d / 2, w / 2, -d / 2]], base: 0, top, roof: false, synthetic: true };
}
