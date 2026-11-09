// Building X-Ray: Three.js geometry for ONE building.
//
//   SOURCED       The outer walls follow the footprints and heights of the City of Toronto 3D Massing parts
//                 matched to this address (holes, wings and rooftop parts included). Neighbouring massing
//                 within ~110 m is drawn as neutral context.
//   ILLUSTRATIVE  The façade detail (windows, frames, floor bands, pilasters, base course, entrance canopy,
//                 garage door, balconies, parapets) is a regular pattern spaced by the registered storeys and
//                 scaled to the building's height class. Everything inside — slabs (real outline, illustrative
//                 storey height), corridors along each wing of the real plan, unit walls, stair, elevator
//                 shaft, columns, rooftop plant and the parking level — is a conceptual layout fitted inside
//                 the real footprint. The site (presentation base, walkway, driveway, trees) is a neutral
//                 setting. None of it is the building's actual design or floor plan.
//
// Structure (neutral materials) and data highlights (translucent "overlay" volumes per inspection category)
// are separate objects, so the data never recolours the architecture.
//
// Façade walls are grouped into 8 orientation buckets so the scene can cut away the walls facing the
// camera, and are built storey by storey so the exploded view keeps each floor's walls and windows with
// its slab. Floor-level objects carry a level index so the scene can separate floors.
//
// Frames: data x = east, y = north. Three.js X = east, Y = up, Z = south (= −north).

import { BUCKETS, cleanRing, area, pointInPoly, wallEdges, corners, convexHull, innerFrame, wingFrames, syntheticMass, storeyLayout } from './footprint.js';

export const PARKING_DEPTH = 3.2;
const WALL = 0.3;      // façade thickness
const SLAB = 0.3;      // floor slab thickness
const PLAN_CUT = 1.35; // interior walls are drawn cut at this height, like a plan section

// façade pattern by height class: bay width, window width [share of bay, cap], window height [share of storey, cap]
const TIERS = {
  low:   { bay: 3.8, ww: [0.48, 1.5], wh: [0.52, 1.55], pilasters: false, balconies: false },
  mid:   { bay: 3.2, ww: [0.56, 1.7], wh: [0.58, 1.8], pilasters: true, balconies: true },
  tower: { bay: 2.9, ww: [0.72, 2.1], wh: [0.68, 2.05], pilasters: true, balconies: true },
};

export function buildBuilding(THREE, entry, mat) {
  const own = [];
  const keep = (g) => { own.push(g); return g; };
  const unit = keep(new THREE.BoxGeometry(1, 1, 1));
  const root = new THREE.Group();
  const facadeRoot = new THREE.Group(), roofRoot = new THREE.Group(), interior = new THREE.Group(), site = new THREE.Group(), ctxRoot = new THREE.Group();
  root.add(facadeRoot, roofRoot, interior, site, ctxRoot);
  const explodables = [];
  const overlays = { exterior: [], shared: [], systems: [], records: [], grounds: [] };
  const pickables = [];

  // ---- masses ---------------------------------------------------------------------------------------
  const approx = entry.provenance === 'approximate' || entry.provenance === 'unavailable' || !entry.masses?.length;
  let masses = approx ? [syntheticMass(entry)]
    : entry.masses.map((m) => ({ ...m, rings: m.rings.map(cleanRing).filter((r) => r.length >= 6) })).filter((m) => m.rings.length && m.top > m.base);
  if (!masses.length) masses = [syntheticMass(entry)];
  let bodies = masses.filter((m) => !m.roof);
  if (!bodies.length) bodies = masses;
  const rooftop = masses.filter((m) => !bodies.includes(m));
  const S = storeyLayout(entry, bodies);
  const { main, fh } = S;
  const T = (x, y, h) => new THREE.Vector3(x, h, -y);
  const tierName = S.storeys <= 4 ? 'low' : S.storeys <= 12 ? 'mid' : 'tower';
  const tier = TIERS[tierName];

  // wings of each body (L-, T- and U-shaped plans get one corridor per wing); the main wing carries the
  // stair, the elevator core and the rooftop plant, and orients the site
  const wingsOf = new Map(bodies.map((m) => { const w = wingFrames(m.rings); return [m, w.length ? w : [innerFrame(m.rings)]]; }));
  const F = wingsOf.get(main)[0];
  const sideDir = F.vy <= 0 ? 1 : -1;
  const sx = F.vx * sideDir, sy = F.vy * sideDir;                 // toward the street-facing (southern) side
  const sgn = F.uy * sx - F.ux * sy >= 0 ? 1 : -1;                // the end the default camera sees
  const ex = F.ux * sgn, ey = F.uy * sgn;
  const view = (() => { const dx = sx + 0.8 * ex, dy = sy + 0.8 * ey, l = Math.hypot(dx, dy); return { dx: dx / l, dy: dy / l }; })();
  const wa = Math.atan2(F.uy, F.ux);

  const coverOf = (m, e) => {
    const px = e.mx + e.nx * 0.4, py = e.my + e.ny * 0.4;
    return bodies.filter((o) => o !== m && o.base <= m.base + 0.5 && pointInPoly(px, py, o.rings)).reduce((t, o) => Math.max(t, o.top), -Infinity);
  };
  // entrance on the street side, near the middle; garage door on the visible end
  let entrance = null, garage = null;
  if (!approx && main.base < 0.5) {
    let best = -Infinity, bestG = -Infinity;
    for (const e of wallEdges(main.rings)) {
      if (e.hole || coverOf(main, e) > 0.5) continue;
      const front = e.nx * sx + e.ny * sy, end = e.nx * ex + e.ny * ey;
      const du = (e.mx - F.cx) * F.ux + (e.my - F.cy) * F.uy;
      if (e.len >= 5 && front > 0.55) { const sc = e.len * front - Math.abs(du) * 0.35; if (sc > best) { best = sc; entrance = e; } }
      if (e.len >= 4.2 && end > 0.7 && e.len > bestG) { bestG = e.len; garage = e; }
    }
    if (garage === entrance) garage = null;
  }

  // ---- façade: wall panels, windows, frames, bands — per orientation bucket, per storey ----------------
  const KINDS = ['panels', 'glass', 'bands', 'base', 'frames', 'doors'];
  const fac = Array.from({ length: BUCKETS }, () => ({ ...Object.fromEntries(KINDS.flatMap((k) => [[k, []], [k + 'Lv', []]])), sum: [0, 0, 0, 0] }));
  const add = (b, kind, item, level) => { b[kind].push(item); b[kind + 'Lv'].push(level); };
  const parapets = [];
  const outline = [];
  for (const m of bodies) {
    const nLev = S.levels(m), L0 = S.baseLevel(m);
    const edges = wallEdges(m.rings);
    const longest = [...edges].filter((e) => !e.hole).sort((a, b) => b.len - a.len).slice(0, 2);
    for (const e of edges) {
      // a wall shared with a touching part is inside the building: skip it, or start it above the lower part
      const cover = coverOf(m, e);
      if (cover >= m.top - 0.3) continue;
      const pb = Math.max(m.base, cover);
      const b = fac[e.bucket];
      const out = Math.atan2(e.nx, -e.ny);               // the box's local +Z face is the outside, −Z the inside
      b.sum[0] += e.mx * e.len; b.sum[1] += e.my * e.len; b.sum[2] += e.len; b.sum[3] = Math.max(b.sum[3], m.top);
      parapets.push({ item: [e.mx - e.nx * 0.13, m.top + 0.42, e.my - e.ny * 0.13, e.ang, e.len + 0.26, 0.84, 0.26], level: S.topLevel(m) });
      const bays = !approx && e.len >= 2.4 ? Math.max(1, Math.floor(e.len / tier.bay)) : 0;
      const bw = bays ? e.len / bays : 0;
      const ww = Math.min(tier.ww[1], bw * tier.ww[0]), wh = Math.min(tier.wh[1], fh * tier.wh[0]);
      const balconies = tier.balconies && nLev >= 5 && longest.includes(e) && e.len > 12;
      const pilasters = tier.pilasters && e.len > (tierName === 'tower' ? 8 : 14) && bays >= 4;
      const isEntry = e === entrance, isGarage = e === garage;
      for (let f = 0; f < nLev; f++) {
        const y0 = m.base + f * fh, y1 = f === nLev - 1 ? m.top : y0 + fh, lvl = L0 + f;
        const ya = Math.max(y0, pb);
        if (y1 - ya < 0.05) continue;
        add(b, 'panels', [e.mx - e.nx * WALL / 2, (ya + y1) / 2, e.my - e.ny * WALL / 2, out, e.len + WALL, y1 - ya, WALL], lvl);
        if (approx || y0 < pb - 0.01 || y0 + fh > m.top + 0.05) continue;
        const ground = f === 0 && y0 < 0.5;
        if (f > 0) add(b, 'bands', [e.mx + e.nx * 0.05, y0, e.my + e.ny * 0.05, e.ang, e.len + 0.1, 0.24, 0.14], lvl);
        if (ground) add(b, 'base', [e.mx + e.nx * 0.04, 0.36, e.my + e.ny * 0.04, e.ang, e.len + 0.08, 0.72, 0.1], lvl);
        for (let k = 0; k < bays; k++) {
          const t = (k + 0.5) / bays;
          const x = e.ax + e.dx * e.len * t, y = e.ay + e.dy * e.len * t;
          if (ground && ((isEntry && Math.hypot(x - entrance.mx, y - entrance.my) < 2.2 + ww / 2) || (isGarage && Math.hypot(x - garage.mx, y - garage.my) < 2.4 + ww / 2))) continue;
          const sill = y0 + Math.max(0.6, (fh - wh) * 0.58);
          // glazing passes through the wall, so windows read from inside the cutaway too
          add(b, 'glass', [x - e.nx * (WALL / 2 - 0.03), sill + wh / 2, y - e.ny * (WALL / 2 - 0.03), e.ang, ww, wh, WALL + 0.12], lvl);
          add(b, 'bands', [x + e.nx * 0.08, sill - 0.05, y + e.ny * 0.08, e.ang, ww + 0.24, 0.08, 0.18], lvl);   // sill
          add(b, 'bands', [x + e.nx * 0.06, sill + wh + 0.06, y + e.ny * 0.06, e.ang, ww + 0.16, 0.1, 0.14], lvl); // lintel
          if (ww > 1.3) add(b, 'frames', [x - e.nx * (WALL / 2 - 0.03), sill + wh / 2, y - e.ny * (WALL / 2 - 0.03), e.ang, 0.07, wh, WALL + 0.16], lvl);
          if (balconies && f >= 1 && k % 2 === 1) {
            add(b, 'bands', [x + e.nx * 0.75, y0 + 0.09, y + e.ny * 0.75, e.ang, bw * 0.82, 0.18, 1.5], lvl);
            add(b, 'glass', [x + e.nx * 1.47, y0 + 0.66, y + e.ny * 1.47, e.ang, bw * 0.82, 0.95, 0.05], lvl);
          }
        }
        if (pilasters) {
          for (let k = 2; k < bays; k += 2) {
            const x = e.ax + e.dx * bw * k, y = e.ay + e.dy * bw * k;
            add(b, 'bands', [x + e.nx * 0.09, (y0 + y1) / 2, y + e.ny * 0.09, e.ang, 0.34, y1 - y0, 0.18], lvl);
          }
        }
        if (ground && isEntry) {
          const dh = Math.min(2.5, fh - 0.35), ch = Math.min(fh - 0.12, dh + 0.5);
          const px = entrance.mx, py = entrance.my;
          add(b, 'glass', [px - e.nx * (WALL / 2 - 0.03), dh / 2, py - e.ny * (WALL / 2 - 0.03), e.ang, 2.4, dh, WALL + 0.12], lvl);
          add(b, 'frames', [px - e.nx * (WALL / 2 - 0.03), dh / 2, py - e.ny * (WALL / 2 - 0.03), e.ang, 0.08, dh, WALL + 0.16], lvl);
          add(b, 'bands', [px + e.nx * 0.06, dh + 0.08, py + e.ny * 0.06, e.ang, 2.7, 0.16, 0.16], lvl);
          add(b, 'bands', [px + e.nx * 1.0, ch, py + e.ny * 1.0, e.ang, 4.4, 0.2, 2.0], lvl);                       // canopy
        }
        if (ground && isGarage) {
          add(b, 'doors', [garage.mx + e.nx * 0.02, 1.2, garage.my + e.ny * 0.02, e.ang, Math.min(3.4, e.len - 0.8), 2.4, WALL + 0.06], lvl);
          add(b, 'bands', [garage.mx + e.nx * 0.06, 2.48, garage.my + e.ny * 0.06, e.ang, Math.min(3.8, e.len - 0.4), 0.16, 0.16], lvl);
        }
      }
    }
    // silhouette lines: top and base outlines, verticals at real corners
    for (const r of m.rings) {
      for (let i = 0; i < r.length; i += 2) {
        const j = (i + 2) % r.length;
        for (const h of [m.base, m.top]) outline.push(r[i], h, -r[i + 1], r[j], h, -r[j + 1]);
      }
      for (const [x, y] of corners(r)) outline.push(x, m.base, -y, x, m.top, -y);
    }
  }
  const buckets = [];
  fac.forEach((b, i) => {
    if (!b.panels.length) return;
    const g = new THREE.Group();
    const a = (i * 2 * Math.PI) / BUCKETS;
    const wallMat = mat(approx ? 'facadeApprox' : 'facade', i), inMat = mat('wallInside', i);
    const kinds = [['panels', [wallMat, wallMat, wallMat, wallMat, wallMat, inMat]], ['glass', mat('glass', i)], ['bands', mat('band', i)],
      ['base', mat('base', i)], ['frames', mat('frame', i)], ['doors', mat('door', i)]];
    for (const [kind, material] of kinds) {
      const mesh = instanced(b[kind], material);
      if (!mesh) continue;
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.userData = { zone: 'exterior', facade: true };
      pickables.push(mesh);
      g.add(mesh);
      explodables.push(track(mesh, b[kind + 'Lv']));
    }
    facadeRoot.add(g);
    const c = b.sum[2] ? [b.sum[0] / b.sum[2], b.sum[1] / b.sum[2]] : [0, 0];
    buckets.push({ index: i, group: g, normal: new THREE.Vector3(Math.cos(a), 0, -Math.sin(a)), anchor: T(c[0] + Math.cos(a) * 0.5, c[1] + Math.sin(a) * 0.5, b.sum[3] * 0.62), length: b.sum[2] });
  });
  const outlineGeo = keep(new THREE.BufferGeometry());
  outlineGeo.setAttribute('position', new THREE.Float32BufferAttribute(outline, 3));
  const outlineLines = new THREE.LineSegments(outlineGeo, mat('outline'));
  outlineLines.raycast = () => {};
  facadeRoot.add(outlineLines);

  // exploded view: faint dashed verticals at the real corners tie the separated floors together
  const guideCorners = [];
  for (const m of bodies) for (const [x, y] of corners(m.rings[0])) if (guideCorners.length < 28) guideCorners.push({ x, z: -y, m });
  const guideGeo = keep(new THREE.BufferGeometry());
  guideGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(Math.max(1, guideCorners.length) * 6), 3));
  const guides = new THREE.LineSegments(guideGeo, mat('guide'));
  guides.raycast = () => {};
  guides.frustumCulled = false;
  guides.visible = false;
  root.add(guides);

  // ---- roof: slab + membrane, parapets, rooftop parts (lifts away in X-Ray) ----------------------------
  for (const m of bodies) {
    const roof = new THREE.Mesh(keep(extrude(THREE, m.rings, 0.4)), [mat('roof'), mat('roofEdge')]);
    roof.position.y = m.top - 0.4;
    roof.castShadow = roof.receiveShadow = true;
    roof.userData = { zone: 'exterior' };
    pickables.push(roof);
    roofRoot.add(roof);
    explodables.push({ obj: roof, level: S.topLevel(m), y0: roof.position.y, roof: true });
  }
  addInstanced(roofRoot, parapets.map((p) => p.item), mat('parapet'), parapets.map((p) => p.level), { roof: true, zone: 'exterior' });
  for (const m of rooftop) {
    const pent = new THREE.Mesh(keep(extrude(THREE, m.rings, m.top - m.base)), [mat('roof'), approx ? mat('facadeApprox', 0) : mat('penthouse')]);
    pent.position.y = m.base;
    pent.castShadow = pent.receiveShadow = true;
    pent.userData = { zone: 'exterior' };
    pickables.push(pent);
    roofRoot.add(pent);
    explodables.push({ obj: pent, level: Math.round(m.base / fh), y0: m.base, roof: true });
  }

  // ---- illustrative interior -------------------------------------------------------------------------
  const L = { cols: [], parts: [], steps: [], posts: [], cab: [], ovShared: [], ovSystems: [], ovGrounds: [], cars: [], cabins: [], paint: [], plant: [], fans: [], bulk: [] };
  const lv = Object.fromEntries(Object.keys(L).map((k) => [k, []]));
  const push = (k, item, level) => { L[k].push(item); lv[k].push(level); };
  let anchorShared = null, anchorSystems = null, anchorGrounds = null;
  const roofTop = S.topLevel(main);
  const plantH = Math.min(2.6, Math.max(1.4, S.H * 0.12));    // rooftop plant scaled to the building
  let plantTop = main.top;

  for (const m of bodies) {
    const big = Math.abs(area(m.rings[0])) >= 80 && m.top - m.base >= 2.2;
    const nLev = S.levels(m), L0 = S.baseLevel(m);
    // slabs: one extrusion of the REAL outline, instanced once per storey
    const ys = [], levels = [];
    for (let f = 0; f < nLev; f++) { ys.push(m.base + f * fh - SLAB); levels.push(L0 + f); }
    const slabs = new THREE.InstancedMesh(keep(extrude(THREE, m.rings, SLAB)), [mat('floor'), mat('slabEdge')], ys.length);
    ys.forEach((y, i) => slabs.setMatrixAt(i, new THREE.Matrix4().makeTranslation(0, y, 0)));
    slabs.castShadow = slabs.receiveShadow = true;
    structure(slabs);
    interior.add(slabs);
    explodables.push(track(slabs, levels));
    if (!big) continue;

    wingsOf.get(m).forEach((W, wi) => {
      const isMain = m === main && wi === 0;
      const at = (du, dv) => [W.cx + W.ux * du + W.vx * dv, W.cy + W.uy * du + W.vy * dv];
      const ang = Math.atan2(W.uy, W.ux);
      const box = (k, du, dv, y0, y1, su, sv, level) => { const [x, y] = at(du, dv); push(k, [x, (y0 + y1) / 2, y, ang, su, y1 - y0, sv], level); };
      const corrW = Math.min(1.8, W.B * 0.42);
      const stairL = isMain ? Math.min(5.6, W.A * 0.5) : 0, stairW = Math.min(2.8, W.B * 0.75);
      const u0 = -W.A, u1 = W.A;
      const coreS = Math.min(2.4, W.B * 0.55);
      const coreU = W.A * 0.3, coreV = -(corrW / 2 + coreS / 2 + 0.15);
      const blocked = (du, dv) => isMain && ((Math.abs(du - coreU) < coreS / 2 + 0.7 && dv < 0 && dv > coreV - coreS / 2 - 0.3) || du < u0 + stairL + 0.3);
      const inside = (du, dv) => { const [x, y] = at(du, dv); return pointInPoly(x, y, m.rings); };

      for (let f = 0; f < nLev; f++) {
        const y = m.base + f * fh, lvl = L0 + f, hh = fh - SLAB;
        // corridor floor (data overlay: shared spaces), and the lobby on the ground floor
        box('ovShared', (u0 + stairL + u1) / 2, 0, y + 0.01, y + 0.06, u1 - u0 - stairL, corrW, lvl);
        if (f === 0 && m.base === 0 && isMain) box('ovShared', W.A * -0.1, W.B * 0.45, y + 0.01, y + 0.07, W.A * 0.7, W.B * 0.8, lvl);
        // corridor walls (plan cut) with door openings, and unit demising walls out to the façade
        const run = u1 - u0 - stairL;
        const bays = Math.max(1, Math.round(run / 6.5));
        const bay = run / bays;
        for (const side of [-1, 1]) {
          for (let k = 0; k < bays; k++) {
            const du = u0 + stairL + bay * (k + 0.5);
            if (blocked(du, side * corrW / 2)) continue;
            box('parts', du + 0.55, side * corrW / 2, y, y + PLAN_CUT, bay - 1.1, 0.14, lvl);
            const wall = u0 + stairL + bay * k;
            if (k > 0 && !blocked(wall, side * (corrW / 2 + 1)) && inside(wall, side * W.B)) {
              const len = W.B - corrW / 2;
              box('parts', wall, side * (corrW / 2 + len / 2), y, y + PLAN_CUT, 0.14, len, lvl);
            }
          }
        }
        for (let du = u0 + stairL + 1; du <= u1 - 0.5; du += 7.2) {
          for (const side of [-1, 1]) if (!blocked(du, side * (corrW / 2 + 0.35))) box('cols', du, side * (corrW / 2 + 0.35), y, y + hh, 0.42, 0.42, lvl);
        }
        if (!isMain) continue;
        // stair: enclosure (data overlay: shared), two flights and a landing per storey
        box('ovShared', u0 + stairL / 2, 0, y + 0.02, y + hh - 0.05, stairL, stairW, lvl);
        const n = 9, rise = fh / 2 / n, runS = (stairL - 1.2) / n;
        for (let s = 0; s < n; s++) {
          box('steps', u0 + 1.2 + runS * (s + 0.5), -stairW / 4, y + rise * s, y + rise * (s + 1), runS, stairW / 2 - 0.08, lvl);
          box('steps', u0 + 1.2 + (stairL - 1.2) - runS * (s + 0.5), stairW / 4, y + fh / 2 + rise * s, y + fh / 2 + rise * (s + 1), runS, stairW / 2 - 0.08, lvl);
        }
        box('steps', u0 + 0.6, 0, y + fh / 2 - 0.2, y + fh / 2, 1.2, stairW, lvl);
        // elevator shaft: corner posts (structure) + shaft volume (data overlay: building systems)
        box('ovSystems', coreU, coreV, y, y + fh, coreS, coreS, lvl);
        for (const [a, b] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) box('posts', coreU + a * coreS / 2, coreV + b * coreS / 2, y, y + fh, 0.16, 0.16, lvl);
        if (f === Math.floor(nLev / 2)) box('cab', coreU, coreV, y + 0.1, y + 2.3, coreS * 0.72, coreS * 0.72, lvl);
      }

      if (m === main) {
        // parking bays under every wing of the main body
        const pd = -PARKING_DEPTH;
        box('ovGrounds', 0, 0, pd + 0.01, pd + 0.06, W.A * 2, W.B * 2, -1);
        for (let du = -W.A + 1.6; du <= W.A - 1.6; du += 2.7) {
          for (const dv of [-W.B * 0.62, W.B * 0.62]) {
            if (W.B < 4.5 || !inside(du, dv * 1.25)) continue;
            if (Math.abs(Math.round(du * 7 + dv)) % 5 !== 0) {   // leave some bays empty
              box('cars', du, dv, pd + 0.18, pd + 0.78, 1.85, 4.3, -1);
              box('cabins', du, dv + (dv > 0 ? 0.25 : -0.25), pd + 0.78, pd + 1.25, 1.6, 2.2, -1);
            }
            box('paint', du + 1.35, dv, pd + 0.01, pd + 0.03, 0.1, 4.9, -1);
          }
        }
        for (let du = -W.A + 2; du <= W.A - 2; du += 7.2) for (const dv of [-W.B * 0.3, W.B * 0.3]) box('cols', du, dv, pd, -SLAB, 0.5, 0.5, -1);
      }
      if (!isMain) return;
      anchorShared = { pos: T(...at((u0 + stairL + u1) / 2, 0), m.base + Math.floor(nLev / 2) * fh + 1.2), level: L0 + Math.floor(nLev / 2) };
      anchorGrounds = { pos: T(...at(W.A * 0.45, 0), -PARKING_DEPTH + 1.2), level: -1 };

      // rooftop plant (systems) — sits on the roof and lifts with it, sized to the building
      const ry = m.top;
      // each piece of plant gets its own translucent "building systems" shell, so the roof itself stays solid
      const pk = (k, du, dv, h, su, sv) => {
        const [x, y] = at(du, dv);
        push(k, [x, ry + h / 2, y, ang, su, h, sv], roofTop);
        if (k === 'plant') push('ovSystems', [x, ry + h / 2 + 0.1, y, ang, su + 0.7, h + 0.45, sv + 0.7], roofTop);
        plantTop = Math.max(plantTop, ry + h + 0.35);
      };
      pk('plant', coreU, coreV, plantH, coreS + 1.8, coreS + 1.4);
      if (tierName !== 'low') pk('bulk', u0 + stairL / 2, 0, Math.min(2.4, plantH), stairL + 0.4, stairW + 0.4);   // stair bulkhead
      const rtu = Math.max(1, Math.min(4, Math.floor(W.A / 5)));
      const uh = Math.min(1.3, plantH * 0.7);
      for (let i = 0; i < rtu; i++) {
        const du = -W.A * 0.55 + (i * W.A * 1.1) / rtu, dv = W.B * 0.45;
        pk('plant', du, dv, uh, 2.4, 1.6);
        const [x, y] = at(du, dv);
        push('fans', [x, ry + uh + 0.08, y, 0, 1.1, 0.16, 1.1], roofTop);
      }
      anchorSystems = { pos: T(...at(coreU, coreV), ry + plantH + 0.2), level: roofTop, roof: true };
    });

    if (m === main) {
      // parking slab (real outline) and low perimeter walls
      const pd = -PARKING_DEPTH;
      const pkSlab = new THREE.Mesh(keep(extrude(THREE, m.rings, SLAB)), [mat('concrete'), mat('slabEdge')]);
      pkSlab.position.y = pd - SLAB;
      pkSlab.receiveShadow = true;
      structure(pkSlab);
      interior.add(pkSlab);
      for (const e of wallEdges(m.rings)) push('parts', [e.mx - e.nx * 0.12, pd + 0.5, e.my - e.ny * 0.12, e.ang, e.len, 1.0, 0.24], -1);
    }
  }

  addInstanced(interior, L.cols, mat('concrete'), lv.cols, { structure: true });
  addInstanced(interior, L.parts, [mat('partition'), mat('partition'), mat('poche'), mat('partition'), mat('partition'), mat('partition')], lv.parts, { structure: true });
  addInstanced(interior, L.steps, mat('concrete'), lv.steps, { structure: true });
  addInstanced(interior, L.posts, mat('concrete'), lv.posts, { structure: true });
  addInstanced(interior, L.cab, mat('cab'), lv.cab, { structure: true });
  addInstanced(interior, L.cars, mat('car'), lv.cars, { structure: true });
  addInstanced(interior, L.cabins, mat('carGlass'), lv.cabins, { structure: true });
  addInstanced(interior, L.paint, mat('paint'), lv.paint, { structure: true });
  addInstanced(roofRoot, L.plant, mat('equipment'), lv.plant, { roof: true, zone: 'systems' });
  addInstanced(roofRoot, L.bulk, mat('penthouse'), lv.bulk, { roof: true, zone: 'exterior' });
  if (L.fans.length) addInstanced(roofRoot, L.fans, mat('equipmentDark'), lv.fans, { roof: true, zone: 'systems', geometry: keep(new THREE.CylinderGeometry(0.5, 0.5, 1, 20)) });
  overlay('shared', L.ovShared, lv.ovShared, interior);
  const sysPairs = L.ovSystems.map((it, i) => [it, lv.ovSystems[i]]);
  const shaft = sysPairs.filter((p) => p[1] !== roofTop), plantZone = sysPairs.filter((p) => p[1] === roofTop);
  overlay('systems', shaft.map((p) => p[0]), shaft.map((p) => p[1]), interior);
  overlay('systems', plantZone.map((p) => p[0]), plantZone.map((p) => p[1]), roofRoot, true);
  overlay('grounds', L.ovGrounds, lv.ovGrounds, interior);

  // ---- site: presentation base, walkway, driveway, waste enclosure, records position, trees ------------
  // The base's top sits just below the ground floor (−0.02 m) so it never shows inside the cutaway; the
  // surrounding ground is at −0.4 m, and neighbouring massing is extended down to meet it.
  const allPts = [];
  for (const m of bodies.concat(rooftop)) for (let i = 0; i < m.rings[0].length; i += 2) allPts.push([m.rings[0][i], m.rings[0][i + 1]]);
  // extents of the building in the main wing's frame (u along the wing, v across), relative to its centre
  let pu0 = Infinity, pu1 = -Infinity, pv0 = Infinity, pv1 = -Infinity;
  for (const [x, y] of allPts) {
    const du = (x - F.cx) * F.ux + (y - F.cy) * F.uy, dv = (x - F.cx) * F.vx + (y - F.cy) * F.vy;
    pu0 = Math.min(pu0, du); pu1 = Math.max(pu1, du); pv0 = Math.min(pv0, dv); pv1 = Math.max(pv1, dv);
  }
  const ring8 = (b) => [[b, 0], [-b, 0], [0, b], [0, -b], [b * 0.7, b * 0.7], [-b * 0.7, b * 0.7], [b * 0.7, -b * 0.7], [-b * 0.7, -b * 0.7]];
  const inBuilding = (x, y, buf = 0) => bodies.some((m) => pointInPoly(x, y, m.rings) || (buf > 0 && ring8(buf).some(([dx, dy]) => pointInPoly(x + dx, y + dy, m.rings))));
  const ctxRings = (entry.context ?? []).map((c) => cleanRing(c.r)).filter((r) => r.length >= 6);
  const inContext = (x, y, buf = 0) => ctxRings.some((r) => [[0, 0], ...(buf ? ring8(buf) : [])].some(([dx, dy]) => pointInPoly(x + dx, y + dy, [r])));
  // margins hold the walkway (street side, +s), the driveway and the records layer (ends)
  const streetIsV1 = sideDir > 0;
  const M = { u0: pu0 - 8, u1: pu1 + 8, v0: pv0 - (streetIsV1 ? 5 : 8), v1: pv1 + (streetIsV1 ? 8 : 5) };
  const padAt = (du, dv) => [F.cx + F.ux * du + F.vx * dv, F.cy + F.uy * du + F.vy * dv];
  const [padX, padY] = padAt((M.u0 + M.u1) / 2, (M.v0 + M.v1) / 2);
  const pad = flat([padX, -0.195, padY, wa, M.u1 - M.u0, 0.35, M.v1 - M.v0], mat('pad'));   // a model base, 35 cm thick
  site.add(pad);
  const toPadEdge = (x, y, dx, dy) => {             // distance from (x, y) along (dx, dy) to the edge of the base
    let d = 0;
    for (; d < 200; d += 0.25) {
      const px = x + dx * d, py = y + dy * d;
      const du = (px - F.cx) * F.ux + (py - F.cy) * F.uy, dv = (px - F.cx) * F.vx + (py - F.cy) * F.vy;
      if (du < M.u0 || du > M.u1 || dv < M.v0 || dv > M.v1) break;
    }
    return Math.max(0, d - 0.1);
  };
  const keepOut = [];                                // segments trees stay clear of: [x0, y0, x1, y1, radius]
  if (entrance) {
    const len = toPadEdge(entrance.mx, entrance.my, entrance.nx, entrance.ny);
    site.add(flat([entrance.mx + entrance.nx * len / 2, 0, entrance.my + entrance.ny * len / 2, entrance.ang, 2.4, 0.04, len], mat('paving')));
    site.add(flat([entrance.mx + entrance.nx * 1.4, 0.02, entrance.my + entrance.ny * 1.4, entrance.ang, 5.0, 0.06, 2.8], mat('paving')));
    keepOut.push([entrance.mx, entrance.my, entrance.mx + entrance.nx * len, entrance.my + entrance.ny * len, 3.4]);
  }
  let wastePos = null, wasteAng = wa;
  if (garage) {
    const len = toPadEdge(garage.mx, garage.my, garage.nx, garage.ny);
    site.add(flat([garage.mx + garage.nx * len / 2, -0.005, garage.my + garage.ny * len / 2, garage.ang, 5.2, 0.03, len], mat('asphalt')));
    keepOut.push([garage.mx, garage.my, garage.mx + garage.nx * len, garage.my + garage.ny * len, 4.2]);
    // waste enclosure beside the driveway, toward the back of the building
    let bx = garage.dx, by = garage.dy;
    if (bx * sx + by * sy > 0) { bx = -bx; by = -by; }
    for (const side of [1, -1]) {
      const x = garage.mx + garage.nx * 2.2 + bx * side * 4.9, y = garage.my + garage.ny * 2.2 + by * side * 4.9;
      if (!inBuilding(x, y, 2.6) && !inContext(x, y)) { wastePos = [x, y]; wasteAng = garage.ang; break; }
    }
  }
  if (!wastePos) wastePos = outsideAlong(bodies, F.cx, F.cy, ex, ey, 2.5);
  const wux = Math.cos(wasteAng), wuy = Math.sin(wasteAng), wvx = -wuy, wvy = wux;
  const bins = [];
  for (const [du, w, h, d] of [[-1.1, 1.6, 1.3, 1.1], [0.9, 1.6, 1.3, 1.1]]) bins.push([wastePos[0] + wux * du, h / 2, wastePos[1] + wuy * du, wasteAng, w, h, d]);
  bins.push([wastePos[0] - wvx * 0.9, 0.8, wastePos[1] - wvy * 0.9, wasteAng, 4.6, 1.6, 0.15]);
  addInstanced(site, bins, mat('equipmentDark'), bins.map(() => -1), { structure: true });
  overlay('grounds', [[wastePos[0], 1.0, wastePos[1], wasteAng, 5.2, 2.0, 2.6]], [-1], site);
  keepOut.push([wastePos[0], wastePos[1], wastePos[0], wastePos[1], 4.5]);
  // records layer: a row of tiles in front of the far half of the street façade (always in view), clear of
  // the entrance walk
  const eu = entrance ? (entrance.mx - F.cx) * ex + (entrance.my - F.cy) * ey : 0;   // entrance position along +e
  const ru = Math.min(eu - 9.5, -Math.max(4, (sgn > 0 ? -pu0 : pu1) * 0.45));
  const recBase = outsideAlong(bodies, F.cx + ex * ru, F.cy + ey * ru, sx, sy, 3.0);
  const recAt = recBase;
  const recAng = Math.atan2(ey, ex);
  keepOut.push([recAt[0] - ex * 8, recAt[1] - ey * 8, recAt[0] + ex * 8, recAt[1] + ey * 8, 3.2]);

  // a few trees on the base, clear of the building, neighbours, paths and the data layers, and only on the
  // side away from the default camera so they never stand in front of the façade
  const trees = [];
  const step = 6.5, inset = 2.6;
  const perim = [];
  for (let du = M.u0 + inset; du <= M.u1 - inset; du += step) perim.push([du, M.v0 + inset], [du, M.v1 - inset]);
  for (let dv = M.v0 + inset + step; dv <= M.v1 - inset - step * 0.5; dv += step) perim.push([M.u0 + inset, dv], [M.u1 - inset, dv]);
  for (const [du, dv] of perim) {
    if (trees.length >= 14) break;
    const [x, y] = padAt(du, dv);
    if ((x - F.cx) * view.dx + (y - F.cy) * view.dy > -2) continue;
    if (inBuilding(x, y, 3.4) || inContext(x, y, 2.2)) continue;
    if (keepOut.some(([x0, y0, x1, y1, r]) => segDist(x, y, x0, y0, x1, y1) < r)) continue;
    const k = ((trees.length * 7919) % 13) / 13;      // stable size variation
    trees.push({ x, y, h: 1.4 + k * 0.6, r: 1.25 + k * 0.6 });
  }
  if (trees.length) {
    const trunk = keep(new THREE.CylinderGeometry(0.16, 0.22, 1, 7));
    const crown = keep(new THREE.IcosahedronGeometry(1, 1));
    const tk = instanced(trees.map((t) => [t.x, t.h / 2, t.y, 0, 1, t.h, 1]), mat('trunk'), trunk);
    const cr = instanced(trees.map((t) => [t.x, t.h + t.r * 0.85, t.y, t.x * 0.37, t.r, t.r * 1.15, t.r]), mat('foliage'), crown);
    for (const o of [tk, cr]) { o.castShadow = o.receiveShadow = true; o.raycast = () => {}; site.add(o); }
  }

  const bb = boundsOf(bodies.concat(rooftop));
  const contact = new THREE.Mesh(keep(new THREE.PlaneGeometry(1, 1)), mat('contact'));
  contact.rotation.x = -Math.PI / 2;
  contact.position.set((bb.min.x + bb.max.x) / 2, 0.03, (bb.min.z + bb.max.z) / 2);
  contact.scale.set((bb.max.x - bb.min.x) * 1.45 + 8, (bb.max.z - bb.min.z) * 1.45 + 8, 1);
  contact.raycast = () => {};
  site.add(contact);

  // ---- context ------------------------------------------------------------------------------------
  const context = [];
  for (const c of entry.context ?? []) {
    const r = cleanRing(c.r);
    if (r.length < 6) continue;
    const g = keep(extrude(THREE, [r], Math.max(0.5, c.t - c.b) + (c.b < 0.5 ? 0.4 : 0)));
    const mesh = new THREE.Mesh(g, mat('context'));
    mesh.position.y = c.b < 0.5 ? c.b - 0.4 : c.b;
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.raycast = () => {};
    const edges = new THREE.LineSegments(keep(new THREE.EdgesGeometry(g, 25)), mat('contextEdge'));
    edges.raycast = () => {};
    mesh.add(edges);
    g.computeBoundingBox();
    mesh.userData.box = g.boundingBox.clone().translate(new THREE.Vector3(0, mesh.position.y, 0));
    ctxRoot.add(mesh);
    context.push(mesh);
  }

  const anchors = {
    shared: anchorShared ?? { pos: T(F.cx, F.cy, fh), level: 0 },
    systems: anchorSystems ?? { pos: T(F.cx, F.cy, S.H + 1), level: roofTop, roof: true },
    grounds: anchorGrounds ?? { pos: T(F.cx, F.cy, -1), level: -1 },
    records: { pos: T(recAt[0], recAt[1], 2.2), level: -1 },
  };
  // footprint hull (Three.js x, z) and the site elements the camera keeps in frame
  const hull = convexHull(allPts).map(([x, y]) => [x, -y]);
  const siteFrame = bins.map(([x, , y]) => [x, 2, -y]);
  if (entrance) siteFrame.push([entrance.mx + entrance.nx * 2.2, 3, -(entrance.my + entrance.ny * 2.2)]);

  let lastGap = -1, lastLift = -1;
  const topLevel = Math.max(...bodies.map(S.topLevel));
  return {
    root, facadeRoot, roofRoot, interior, site, outline: outlineLines, guides, buckets, context, overlays, pickables, anchors, approx,
    records: { at: recAt, ang: recAng },
    H: S.H, storeys: S.storeys, fh, tier: tierName, bounds: bb, axis: wa, view, topLevel, plantTop, hull, siteFrame,
    cutAt: { x: F.cx, z: -F.cy },
    offset: (level, gap) => (level < 0 ? 0 : (level + 1) * gap),
    // Move every floor-level object: `gap` metres between storeys, `lift` metres for the roof (X-Ray).
    setLevels(gap, lift) {
      if (Math.abs(gap - lastGap) < 1e-4 && Math.abs(lift - lastLift) < 1e-4) return;
      lastGap = gap; lastLift = lift;
      const off = (l) => (l < 0 ? 0 : (l + 1) * gap);
      for (const e of explodables) {
        if (e.mesh) {
          const a = e.mesh.instanceMatrix.array;
          for (let i = 0; i < e.levels.length; i++) a[i * 16 + 13] = e.base[i] + off(e.levels[i]) + (e.roof ? lift : 0);
          e.mesh.instanceMatrix.needsUpdate = true;
          e.mesh.computeBoundingSphere();
          e.mesh.computeBoundingBox();
        } else e.obj.position.y = e.y0 + off(e.level) + (e.roof ? lift : 0);
      }
      const p = guideGeo.attributes.position;
      guideCorners.forEach(({ x, z, m }, i) => {
        p.setXYZ(i * 2, x, m.base, z);
        p.setXYZ(i * 2 + 1, x, m.top - 0.4 + off(S.topLevel(m)) + lift, z);
      });
      p.needsUpdate = true;
      guides.computeLineDistances();
    },
    dispose() { own.forEach((g) => g.dispose()); root.traverse((o) => { if (o.isInstancedMesh) o.dispose(); }); },
  };

  // ---- helpers bound to this build ------------------------------------------------------------------
  function structure(o) { o.raycast = () => {}; o.userData.structure = true; }
  function track(mesh, levels, roof = false) {
    const a = mesh.instanceMatrix.array;
    return { mesh, levels, base: Float32Array.from({ length: levels.length }, (_, i) => a[i * 16 + 13]), roof };
  }
  function instanced(list, material, geometry = unit) {
    if (!list.length) return null;
    const m = new THREE.InstancedMesh(geometry, material, list.length);
    list.forEach((p, i) => m.setMatrixAt(i, compose(THREE, p)));
    m.instanceMatrix.needsUpdate = true;
    return m;
  }
  // a single box on the site (base, paths): flat, shadow-receiving, not pickable
  function flat(item, material) {
    const m = new THREE.Mesh(unit, material);
    compose(THREE, item).decompose(m.position, m.quaternion, m.scale);
    m.receiveShadow = true;
    m.raycast = () => {};
    return m;
  }
  function addInstanced(parent, list, material, levels, { roof = false, zone = null, structure: st = false, geometry } = {}) {
    if (!list.length) return null;
    const m = instanced(list, material, geometry);
    m.castShadow = m.receiveShadow = true;
    if (zone) { m.userData = { zone }; pickables.push(m); } else if (st) structure(m);
    parent.add(m);
    explodables.push(track(m, levels, roof));
    return m;
  }
  function overlay(zone, list, levels, parent, roof = false) {
    if (!list.length) return;
    const m = instanced(list, mat('overlay', zone));
    m.userData = { zone, overlay: true };
    m.renderOrder = 2;
    parent.add(m);
    overlays[zone].push(m);
    pickables.push(m);
    explodables.push(track(m, levels, roof));
  }
}

// One upright tile per record item, coloured by its ACTUAL rating class. An abstract documentation layer
// beside the building: paperwork has no location inside it.
export function buildRecordTiles(THREE, rec, items, tileMat, plinthMat) {
  const g = new THREE.Group();
  const n = Math.max(items.length, 1);
  const step = 1.25, w = 1.0, h = 1.5;
  const span = (n - 1) * step;
  const ux = Math.cos(rec.ang), uy = Math.sin(rec.ang);
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
  plinth.userData = { zone: 'records' };
  plinth.receiveShadow = true;
  g.add(plinth);
  g.userData.dispose = () => { tile.dispose(); plinth.geometry.dispose(); };
  return g;
}

// ---- helpers ------------------------------------------------------------------------------------------
function compose(THREE, [x, y, z, a, sx, sy, sz]) {
  // `a` is an angle in the data frame (from east, counter-clockwise seen from above); Three's Z points south
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, -z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), a), new THREE.Vector3(sx, sy, sz));
}

function extrude(THREE, rings, depth) {
  const toPts = (r) => { const p = []; for (let i = 0; i < r.length; i += 2) p.push(new THREE.Vector2(r[i], r[i + 1])); return p; };
  const shape = new THREE.Shape(toPts(rings[0]));
  for (const h of rings.slice(1)) if (h.length >= 6) shape.holes.push(new THREE.Path(toPts(h)));
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  g.rotateX(-Math.PI / 2);
  return g;
}

function boundsOf(masses) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, top = 0;
  for (const m of masses) {
    const r = m.rings[0];
    for (let i = 0; i < r.length; i += 2) { x0 = Math.min(x0, r[i]); x1 = Math.max(x1, r[i]); y0 = Math.min(y0, r[i + 1]); y1 = Math.max(y1, r[i + 1]); }
    top = Math.max(top, m.top);
  }
  return { min: { x: x0, y: -PARKING_DEPTH, z: -y1 }, max: { x: x1, y: top + 1, z: -y0 }, top };
}

function outsideAlong(bodies, cx, cy, dx, dy, margin) {
  for (let d = 1; d < 300; d += 0.5) {
    const x = cx + dx * d, y = cy + dy * d;
    if (!bodies.some((m) => pointInPoly(x, y, m.rings))) return [x + dx * margin, y + dy * margin];
  }
  return [cx + dx * 30, cy + dy * 30];
}

function segDist(px, py, x0, y0, x1, y1) {
  const dx = x1 - x0, dy = y1 - y0, l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / l2)) : 0;
  return Math.hypot(px - (x0 + dx * t), py - (y0 + dy * t));
}
