// Building X-Ray: Three.js geometry for ONE building.
//
//   SOURCED       The outer walls follow the footprints and heights of the City of Toronto 3D Massing parts
//                 matched to this address (holes, wings and rooftop parts included). Neighbouring massing
//                 within ~110 m is drawn as neutral context.
//   ILLUSTRATIVE  The façade detail (windows, frames, floor bands, pilasters, base course, entrance canopy,
//                 garage door, balconies, parapets) is a regular pattern spaced by the registered storeys and
//                 scaled to the building's height class. The rooms inside the cutaway (rooms.js), the floor
//                 slabs around them (real outline, illustrative storey height), the rooftop plant and the site
//                 (presentation base, walkway, driveway, trees) are generic. None of it is the building's
//                 actual design or floor plan.
//
// The cutaway is a single notch at one corner of the main wing (cutaway.js): the scene clips the façade,
// roof and outline with a box there and shows the room stack for that corner. Everything else stays
// solid. Structure is never recoloured by data; only the rooms' floor tint, outlines and the records sheet
// carry the inspection results.
//
// Frames: data x = east, y = north. Three.js X = east, Y = up, Z = south (= −north).

import { BUCKETS, cleanRing, pointInPoly, wallEdges, corners, convexHull, innerFrame, wingFrames, syntheticMass, storeyLayout } from './footprint.js';
import { cutawayPlan, SLAB as CUT_SLAB } from './cutaway.js';
import { buildCutaway } from './rooms.js';
const WALL = 0.3;      // façade thickness
const SLAB = CUT_SLAB; // floor slab thickness

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
  // (narrow or courtyard plans: narrower wings before the unfitted fallback frame, whose centre can lie
  // outside the building)
  const wingsOf = new Map(bodies.map((m) => {
    let w = wingFrames(m.rings);
    if (!w.length) { const F0 = innerFrame(m.rings); w = F0.fitted ? [F0] : wingFrames(m.rings, { minSide: 3.5 }); if (!w.length) w = [F0]; }
    return [m, w];
  }));
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

  // ---- roof: slab + membrane, parapets, rooftop parts --------------------------------------------------
  for (const m of bodies) {
    const roof = new THREE.Mesh(keep(extrude(THREE, m.rings, 0.4)), [mat('roof'), mat('roofEdge')]);
    roof.position.y = m.top - 0.4;
    roof.castShadow = roof.receiveShadow = true;
    roof.userData = { zone: 'exterior' };
    pickables.push(roof);
    roofRoot.add(roof);
  }
  addInstanced(roofRoot, parapets.map((p) => p.item), mat('parapet'), { zone: 'exterior' });
  for (const m of rooftop) {
    const pent = new THREE.Mesh(keep(extrude(THREE, m.rings, m.top - m.base)), [mat('roof'), approx ? mat('facadeApprox', 0) : mat('penthouse')]);
    pent.position.y = m.base;
    pent.castShadow = pent.receiveShadow = true;
    pent.userData = { zone: 'exterior' };
    pickables.push(pent);
    roofRoot.add(pent);
  }

  // ---- cutaway: notch plan, floor slabs around it, the room stack per corner ---------------------------
  const plan = cutawayPlan({ F, bodies, storeys: S.storeys, fh, base: main.base, prefer: { su: sgn, sv: sideDir } });
  // slabs (real outline) at every storey the notch exposes, and the ceiling above it
  for (const m of bodies) {
    const ys = [];
    for (let f = 0; f < S.levels(m); f++) {
      const y = m.base + f * fh;
      if (y >= plan.yb - 0.05 && y <= plan.yt + SLAB + 0.05) ys.push(y - SLAB);
    }
    if (!ys.length) continue;
    const slabs = new THREE.InstancedMesh(keep(extrude(THREE, m.rings, SLAB)), [mat('floor'), mat('slabEdge')], ys.length);
    ys.forEach((y, i) => slabs.setMatrixAt(i, new THREE.Matrix4().makeTranslation(0, y, 0)));
    slabs.castShadow = slabs.receiveShadow = true;
    structure(slabs);
    interior.add(slabs);
  }
  const cutaways = new Map();             // corner key -> built room stack (lazily)
  const cutawayAt = (key) => {
    if (!cutaways.has(key)) {
      const c = plan.corners.find((x) => x.key === key);
      const built = buildCutaway(THREE, plan, c, bodies, mat);
      built.corner = c;
      built.group.userData.cornerKey = key;
      interior.add(built.group);
      cutaways.set(key, built);
    }
    return cutaways.get(key);
  };

  let plantTop = main.top;
  // rooftop plant: generic equipment sized to the building (exterior detail; picks "building systems")
  {
    const ang = Math.atan2(F.uy, F.ux);
    const at = (du, dv) => [F.cx + F.ux * du + F.vx * dv, F.cy + F.uy * du + F.vy * dv];
    const plantH = Math.min(2.6, Math.max(1.4, S.H * 0.12));
    const plant = [], fans = [], bulk = [];
    const ry = main.top;
    const pk = (list, du, dv, hh, su, sv) => { const [x, y] = at(du, dv); list.push([x, ry + hh / 2, y, ang, su, hh, sv]); };
    const coreS = Math.min(2.4, F.B * 0.55);
    pk(plant, F.A * 0.3, -(Math.min(1.8, F.B * 0.42) / 2 + coreS / 2 + 0.15), plantH, coreS + 1.8, coreS + 1.4);
    if (tierName !== 'low') pk(bulk, -F.A + Math.min(5.6, F.A * 0.5) / 2, 0, Math.min(2.4, plantH), Math.min(5.6, F.A * 0.5) + 0.4, Math.min(2.8, F.B * 0.75) + 0.4);
    const rtu = Math.max(1, Math.min(4, Math.floor(F.A / 5)));
    const uh = Math.min(1.3, plantH * 0.7);
    for (let i = 0; i < rtu; i++) {
      const du = -F.A * 0.55 + (i * F.A * 1.1) / rtu, dv = F.B * 0.45;
      pk(plant, du, dv, uh, 2.4, 1.6);
      const [x, y] = at(du, dv);
      fans.push([x, ry + uh + 0.08, y, 0, 1.1, 0.16, 1.1]);
    }
    addInstanced(roofRoot, plant, mat('equipment'), { zone: 'systems' });
    addInstanced(roofRoot, bulk, mat('penthouse'), { zone: 'exterior' });
    addInstanced(roofRoot, fans, mat('equipmentDark'), { zone: 'systems', geometry: keep(new THREE.CylinderGeometry(0.5, 0.5, 1, 20)) });
    plantTop = ry + plantH + 0.35;
  }

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
  // (waste and parking are shown inside the cutaway; the site keeps only the driveway)
  const bins = [[wastePos[0], 0, wastePos[1]]];
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

  // footprint hull (Three.js x, z) and the site elements the camera keeps in frame
  const hull = convexHull(allPts).map(([x, y]) => [x, -y]);
  const siteFrame = bins.map(([x, , y]) => [x, 2, -y]);
  if (entrance) siteFrame.push([entrance.mx + entrance.nx * 2.2, 3, -(entrance.my + entrance.ny * 2.2)]);

  return {
    root, facadeRoot, roofRoot, interior, site, outline: outlineLines, buckets, context, pickables, approx,
    // the records sheet stands on the street side; `wall` is the façade point its leader line meets
    records: { at: recAt, ang: recAng, wall: [recAt[0] - sx * 3, recAt[1] - sy * 3] },
    H: S.H, storeys: S.storeys, fh, tier: tierName, bounds: bb, axis: wa, view, plantTop, hull, siteFrame,
    plan, cutawayAt,
    dispose() {
      for (const c of cutaways.values()) c.dispose();
      own.forEach((g) => g.dispose());
      root.traverse((o) => { if (o.isInstancedMesh) o.dispose(); });
    },
  };

  // ---- helpers bound to this build ------------------------------------------------------------------
  function structure(o) { o.raycast = () => {}; o.userData.structure = true; }
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
  function addInstanced(parent, list, material, { zone = null, structure: st = false, geometry } = {}) {
    if (!list.length) return null;
    const m = instanced(list, material, geometry);
    m.castShadow = m.receiveShadow = true;
    if (zone) { m.userData = { zone }; pickables.push(m); } else if (st) structure(m);
    parent.add(m);
    return m;
  }
}

// Records: an abstract inspection sheet on two posts beside the building, one tile per record item
// coloured by its ACTUAL rating class, with a thin leader line to the façade. Paperwork has no location
// inside the building, so it is never drawn as a room.
export function buildRecordSheet(THREE, rec, items, tileMat, boardMat, postMat, leaderMat) {
  const own = [];
  const box = new THREE.BoxGeometry(1, 1, 1);
  own.push(box);
  const g = new THREE.Group();
  const sheet = new THREE.Group();
  sheet.position.set(rec.at[0], 0, -rec.at[1]);
  sheet.rotation.y = rec.ang;
  g.add(sheet);
  const n = Math.max(items.length, 1);
  const cols = Math.min(5, n), rows = Math.ceil(n / cols);
  const ts = 0.6, gap = 0.14, pad = 0.28, head = 0.26;
  const bw = cols * ts + (cols - 1) * gap + pad * 2, bh = rows * ts + (rows - 1) * gap + pad * 2 + head;
  const y0 = 1.0;
  const add = (material, x, y, z, sx, sy, sz, data) => {
    const m = new THREE.Mesh(box, material);
    m.position.set(x, y, z);
    m.scale.set(sx, sy, sz);
    m.userData = { zone: 'records', ...data };
    m.castShadow = true;
    sheet.add(m);
    return m;
  };
  add(boardMat, 0, y0 + bh / 2, 0, bw, bh, 0.08);
  for (const z of [-0.045, 0.045]) add(postMat, 0, y0 + bh - head / 2, z, bw, head, 0.01);
  for (const x of [-bw / 2 + 0.3, bw / 2 - 0.3]) add(postMat, x, y0 / 2, 0, 0.08, y0, 0.08);
  items.forEach((it, i) => {
    const c = i % cols, r = Math.floor(i / cols);
    const x = -bw / 2 + pad + c * (ts + gap) + ts / 2;
    const y = y0 + bh - head - pad - r * (ts + gap) - ts / 2;
    for (const z of [-0.06, 0.06]) add(tileMat(it), x, y, z, ts, ts, 0.04, { item: it.col, tile: true });
  });
  // leader: up from the top of the sheet, then across to the façade
  const topY = y0 + bh, ly = topY + 0.6;
  const pts = [rec.at[0], topY, -rec.at[1], rec.at[0], ly, -rec.at[1], rec.at[0], ly, -rec.at[1], rec.wall[0], ly, -rec.wall[1]];
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  own.push(lg);
  const leader = new THREE.LineSegments(lg, leaderMat);
  leader.raycast = () => {};
  g.add(leader);
  g.userData.dispose = () => own.forEach((x) => x.dispose());
  g.userData.top = new THREE.Vector3(rec.at[0], topY, -rec.at[1]);
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
  return { min: { x: x0, y: 0, z: -y1 }, max: { x: x1, y: top + 1, z: -y0 }, top };
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
