// Building X-Ray: the illustrative rooms inside the cutaway notch (see cutaway.js for where they go).
//
// One group per corner, built in corner-local coordinates (x = a along the wing, y = height, z = b across
// it) and placed with a single matrix, so the same scenes serve every corner. Every room is a generic,
// reusable vignette sized to the notch:
//
//   shared   a corridor: unit doors along the back wall, a stair flight with handrails, ceiling lights
//   systems  a services room: elevator shaft and cab, an air-handling unit with its duct, electrical
//            panels, pipes and a riser
//   grounds  ground-level parking and waste: painted bays with parked cars, wheel stops, a waste room
//            with carts
//
// Nothing here is this building's real layout, and nothing shows damage: the rooms only say "this is the
// kind of space inspectors look at for this category". Each room's floor carries a light tint of the
// category's status; the selected room gets a civic-blue outline and the others are dimmed (scene.js).
//
// Rooms neither cast nor receive shadows: the notch is open on two sides only, and sunlit-but-shadowless
// interiors read like an architectural section drawing instead of a dark hole.

import { SLAB, facadeInNotch } from './cutaway.js';

export function buildCutaway(THREE, plan, corner, bodies, mat) {
  const own = [];
  const keep = (g) => { own.push(g); return g; };
  const unit = keep(new THREE.BoxGeometry(1, 1, 1));
  const cyl = keep(new THREE.CylinderGeometry(0.5, 0.5, 1, 18));
  const group = new THREE.Group();
  group.matrixAutoUpdate = false;
  const aH = new THREE.Vector3(corner.aHat[0], 0, -corner.aHat[1]);
  const bH = new THREE.Vector3(corner.bHat[0], 0, -corner.bHat[1]);
  group.matrix.makeBasis(aH, new THREE.Vector3(0, 1, 0), bH).setPosition(corner.K[0], 0, -corner.K[1]);

  const { W, D, fh } = plan;
  const zf = -corner.mb, z0 = zf + 0.3;            // façade outer face, and its inner face
  const h = fh - SLAB;                              // floor to ceiling
  const items = new Map();                          // "material|zone|geometry" -> transforms
  const put = (name, zone, geo, x, y, z, sx, sy, sz, rot = null) => {
    const k = `${name}|${zone}|${geo}`;
    if (!items.has(k)) items.set(k, []);
    items.get(k).push({ x, y, z, sx, sy, sz, rot });
  };
  const box = (name, zone, x0, x1, y0, y1, za, zb) => put(name, zone, 'box', (x0 + x1) / 2, (y0 + y1) / 2, (za + zb) / 2, Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(zb - za));
  // cylinders: axis 'x', 'y' or 'z'
  const rod = (name, zone, axis, x, y, z, len, r) => put(name, zone, 'cyl', x, y, z, r * 2, len, r * 2, axis === 'y' ? null : axis === 'x' ? [0, 0, Math.PI / 2] : [Math.PI / 2, 0, 0]);

  const slots = plan.slots.map((s) => {
    const yf = plan.yb + s.storey * fh;
    const x0 = s.x0 ?? -corner.ma, x1 = s.x1;
    const first = s.x0 == null;
    const lastInStorey = !plan.slots.some((o) => o !== s && o.storey === s.storey && (o.x0 ?? -Infinity) >= x1 - 1e-6);
    shell(s.zone, x0, x1, yf, first, lastInStorey);
    if (s.zone === 'shared') shared(x0 + (first ? 0.3 : 0.1), x1, yf);
    if (s.zone === 'systems') systems(x0 + (first ? 0.3 : 0.1), x1, yf);
    if (s.zone === 'grounds') grounds(x0 + (first ? 0.3 : 0.1), x1, yf);
    return { zone: s.zone, storey: s.storey, x0, x1, yf, h, zf, D };
  });

  // ---- the room box: back wall, end wall or partition, floor finish, skirting ------------------------
  function shell(zone, x0, x1, yf, first, last) {
    box('room', zone, x0, x1, yf, yf + h, D, D + 0.24);
    box('roomEnd', zone, x1, x1 + (last ? 0.26 : 0.16), yf, yf + h, zf, D + 0.24);
    box('floorTint', zone, x0 + (first ? 0.3 : 0), x1, yf, yf + 0.03, z0, D);
    box('trim', zone, x0, x1, yf, yf + 0.1, D - 0.025, D);
  }

  // ---- shared spaces: corridor ---------------------------------------------------------------------
  function shared(x0, x1, yf) {
    const len = x1 - x0;
    const sl = Math.min(4.4, len * 0.42), sw = Math.min(1.25, (D - z0) * 0.32);
    const sx1 = x1 - 0.2, sx0 = sx1 - sl;
    const n = 14, rise = h / n, run = sl / n;
    for (let i = 0; i < n; i++) box('stair', 'shared', sx0 + i * run, sx0 + (i + 1) * run, yf, yf + (i + 1) * rise, D - sw, D);
    // handrail on the open side: posts and a sloped rail, stopping below the ceiling
    const zr = D - sw - 0.03;
    const railAt = (i) => yf + (i + 1) * rise + 0.9;
    let iMax = 0;
    while (iMax < n - 1 && railAt(iMax + 1) < yf + h - 0.12) iMax++;
    for (let i = 0; i <= iMax; i += 3) box('metal', 'shared', sx0 + (i + 0.5) * run - 0.025, sx0 + (i + 0.5) * run + 0.025, yf + (i + 1) * rise, railAt(i), zr - 0.025, zr + 0.025);
    const ax = sx0 + 0.5 * run, ay = railAt(0), bx = sx0 + (iMax + 0.5) * run, by = railAt(iMax);
    const rl = Math.hypot(bx - ax, by - ay);
    if (rl > 0.3) put('metal', 'shared', 'box', (ax + bx) / 2, (ay + by) / 2, zr, rl, 0.05, 0.05, [0, 0, Math.atan2(by - ay, bx - ax)]);
    // wall rail along the back wall over the stair, and the stair's side stringer
    box('trim', 'shared', sx0, sx1, yf, yf + 0.06, D - sw - 0.04, D - sw);
    // a darker runner marks the corridor along the back wall
    box('runner', 'shared', x0 + 0.2, sx0 - 0.2, yf + 0.03, yf + 0.04, D - 2.0, D - 0.25);
    // unit doors on the back wall, clear of the stair
    const doorEnd = sx0 - 0.9;
    const nd = Math.max(0, Math.floor((doorEnd - x0 - 0.6) / 3.0));
    for (let k = 0; k < nd; k++) {
      const c = x0 + 1.4 + k * 3.0;
      box('unitDoor', 'shared', c - 0.46, c + 0.46, yf, yf + 2.1, D - 0.07, D);
      box('trim', 'shared', c - 0.54, c - 0.46, yf, yf + 2.18, D - 0.1, D);
      box('trim', 'shared', c + 0.46, c + 0.54, yf, yf + 2.18, D - 0.1, D);
      box('trim', 'shared', c - 0.54, c + 0.54, yf + 2.1, yf + 2.18, D - 0.1, D);
      box('metal', 'shared', c + 0.28, c + 0.4, yf + 1.02, yf + 1.06, D - 0.13, D - 0.07);
    }
    for (let x = x0 + 1.6; x < sx0 - 0.8; x += 3.0) box('light', 'shared', x - 0.55, x + 0.55, yf + h - 0.04, yf + h, D - 1.25, D - 1.05);
  }

  // ---- building systems: services room ------------------------------------------------------------------
  function systems(x0, x1, yf) {
    let a = x0 + 0.3, b = x1 - 0.2;
    // elevator shaft at the far end, open toward the reader so the cab shows
    if (b - a >= 4.4) {
      const s1 = b, s0 = b - 2.3, zs = D - 2.3;
      box('concrete', 'systems', s0 - 0.2, s0, yf, yf + h, zs, D);
      box('concrete', 'systems', s0 - 0.2, s0 + 0.35, yf, yf + h, zs - 0.2, zs);
      box('concrete', 'systems', s1 - 0.35, s1, yf, yf + h, zs - 0.2, zs);
      box('concrete', 'systems', s0 - 0.2, s1, yf + h - 0.45, yf + h, zs - 0.2, zs);
      box('cab', 'systems', s0 + 0.3, s1 - 0.3, yf + 0.25, yf + 2.45, zs + 0.3, D - 0.25);
      box('equipmentDark', 'systems', s0 + 0.3, s1 - 0.3, yf, yf + 0.04, zs, D);
      for (const x of [s0 + 0.8, s1 - 0.8]) box('metal', 'systems', x - 0.015, x + 0.015, yf + 2.45, yf + h, (zs + D) / 2 - 0.015, (zs + D) / 2 + 0.015);
      for (const x of [s0 + 0.05, s1 - 0.1]) box('metal', 'systems', x, x + 0.05, yf, yf + h, (zs + D) / 2 - 0.06, (zs + D) / 2 + 0.06);
      b = s0 - 0.5;
    }
    // electrical panels against the back wall at the near end
    if (b - a >= 2.4) {
      const n = b - a >= 7 ? 3 : 2;
      for (let i = 0; i < n; i++) {
        const c0 = a + i * 0.72;
        box('panel', 'systems', c0, c0 + 0.64, yf, yf + 1.95, D - 0.4, D);
        box('equipmentDark', 'systems', c0 + 0.08, c0 + 0.56, yf + 1.62, yf + 1.7, D - 0.42, D - 0.39);
      }
      box('equipmentDark', 'systems', a, a + n * 0.72 - 0.08, yf + 1.95, yf + h, D - 0.25, D - 0.05);   // cable tray riser
      a += n * 0.72 + 0.5;
    }
    // air-handling unit with its fan and a duct up to the ceiling and along it
    if (b - a >= 3.0) {
      const w = Math.min(2.8, b - a - 0.3), c = (a + b) / 2;
      box('concrete', 'systems', c - w / 2 - 0.1, c + w / 2 + 0.1, yf, yf + 0.14, D - 1.75, D - 0.1);
      box('equipment', 'systems', c - w / 2, c + w / 2, yf + 0.14, yf + 1.62, D - 1.65, D - 0.2);
      rod('equipmentDark', 'systems', 'z', c - w * 0.18, yf + 0.88, D - 1.67, 0.04, Math.min(0.5, w * 0.17));
      box('equipmentDark', 'systems', c + w * 0.12, c + w * 0.14, yf + 0.3, yf + 1.46, D - 1.68, D - 1.64);
      box('equipmentDark', 'systems', c + w * 0.34, c + w * 0.36, yf + 0.3, yf + 1.46, D - 1.68, D - 1.64);
      box('duct', 'systems', c - 0.35, c + 0.35, yf + 1.62, yf + h - 0.2, D - 1.15, D - 0.65);
      box('duct', 'systems', x0 + 0.2, c + 0.35, yf + h - 0.62, yf + h - 0.2, D - 1.15, D - 0.65);
    }
    // two pipes along the back wall and a riser
    for (const [y, r] of [[h - 0.32, 0.07], [h - 0.52, 0.06]]) rod('pipe', 'systems', 'x', (x0 + 0.2 + x1 - 0.2) / 2, yf + y, D - 0.36, x1 - x0 - 0.4, r);
    rod('pipe', 'systems', 'y', x0 + 0.45, yf + h / 2, D - 0.36, h, 0.08);
    for (let x = x0 + 1.2; x < x1 - 1; x += 2.6) box('light', 'systems', x - 0.5, x + 0.5, yf + h - 0.04, yf + h, z0 + 0.8, z0 + 1.0);
  }

  // ---- parking, grounds and waste: ground-level parking and a waste room ---------------------------
  function grounds(x0, x1, yf) {
    const len = x1 - x0;
    const ww = Math.min(3.4, len * 0.36);
    const wx = x1 - ww;
    // waste room: a low wall and carts
    box('roomEnd', 'grounds', wx - 0.15, wx, yf, yf + 1.4, D - 2.6, D);
    const nb = ww >= 2.8 ? 3 : 2;
    for (let i = 0; i < nb; i++) {
      const c = wx + 0.25 + (i + 0.5) * ((ww - 0.45) / nb);
      const bw = Math.min(0.74, (ww - 0.45) / nb - 0.12);
      box(i === nb - 1 ? 'binAlt' : 'bin', 'grounds', c - bw / 2, c + bw / 2, yf + 0.1, yf + 1.12, D - 1.15, D - 0.2);
      box('equipmentDark', 'grounds', c - bw / 2 - 0.03, c + bw / 2 + 0.03, yf + 1.12, yf + 1.18, D - 1.2, D - 0.15);
    }
    // parking bays
    const depth = D - z0 - 0.3;
    const noseIn = depth >= 4.9;
    const bay = noseIn ? 2.7 : 5.8;
    const pa = x0 + 0.4, pb = wx - 0.4;
    const nBays = Math.max(0, Math.floor((pb - pa) / bay));
    for (let i = 0; i <= nBays; i++) box('paint', 'grounds', pa + i * bay - 0.05, pa + i * bay + 0.05, yf + 0.03, yf + 0.04, noseIn ? D - 5.0 : D - 2.6, D - 0.2);
    for (let i = 0; i < nBays; i++) {
      const c = pa + (i + 0.5) * bay;
      if (noseIn) box('concrete', 'grounds', c - 0.8, c + 0.8, yf, yf + 0.14, D - 0.6, D - 0.42);
      if (nBays >= 3 && i === nBays - 1) continue;          // leave one bay empty
      car(c, noseIn ? D - 0.75 - 2.2 : D - 1.35, noseIn, yf);
    }
  }
  function car(cx, cz, noseIn, yf) {
    // body length along z when parked nose-in, along x when parallel
    const L = 4.4, Wc = 1.8;
    const bx = noseIn ? Wc : L, bz = noseIn ? L : Wc;
    put('carBody', 'grounds', 'box', cx, yf + 0.6, cz, bx, 0.6, bz);
    const off = 0.3;
    put('carGlass', 'grounds', 'box', cx + (noseIn ? 0 : off), yf + 1.13, cz + (noseIn ? off : 0), noseIn ? Wc - 0.24 : 2.3, 0.46, noseIn ? 2.3 : Wc - 0.24);
    for (const s of [-1, 1]) for (const t of [-1, 1]) {
      const along = 1.42 * t, side = (Wc / 2 - 0.08) * s;
      rod('tire', 'grounds', noseIn ? 'x' : 'z', cx + (noseIn ? side : along), yf + 0.33, cz + (noseIn ? along : side), 0.24, 0.33);
    }
  }

  // ---- meshes ---------------------------------------------------------------------------------------------
  const pickables = [];
  const tmpQ = new THREE.Quaternion(), tmpE = new THREE.Euler();
  for (const [k, list] of items) {
    const [name, zone, geo] = k.split('|');
    const m = new THREE.InstancedMesh(geo === 'cyl' ? cyl : unit, mat(name, zone), list.length);
    list.forEach((t, i) => {
      tmpQ.setFromEuler(tmpE.set(...(t.rot ?? [0, 0, 0])));
      m.setMatrixAt(i, new THREE.Matrix4().compose(new THREE.Vector3(t.x, t.y, t.z), tmpQ, new THREE.Vector3(t.sx, t.sy, t.sz)));
    });
    m.instanceMatrix.needsUpdate = true;
    m.userData = { zone };
    m.castShadow = m.receiveShadow = false;
    pickables.push(m);
    group.add(m);
  }

  // outline of each room (shown when it is selected or hovered), and the section lines where the cut
  // meets the real façade
  const frames = {};
  for (const s of slots) {
    const g = keep(new THREE.EdgesGeometry(new THREE.BoxGeometry(s.x1 - s.x0, s.h, s.D - s.zf)));
    const l = new THREE.LineSegments(g, mat('slotEdge', s.zone));
    l.position.set((s.x0 + s.x1) / 2, s.yf + s.h / 2, (s.zf + s.D) / 2);
    l.raycast = () => {};
    l.renderOrder = 3;
    group.add(l);
    frames[s.zone] = l;
  }
  const cut = [];
  const segs = facadeInNotch(plan, corner, bodies);
  for (let lv = 0; lv <= plan.levels; lv++) {
    const y = plan.yb + lv * fh + (lv === 0 ? 0.02 : 0);
    for (const [a0, b0, a1, b1] of segs) cut.push(a0, y, b0, a1, y, b1);
  }
  for (const [a0, b0, a1, b1] of segs) {
    for (const [a, b] of [[a0, b0], [a1, b1]]) {
      if (Math.abs(a - W) < 0.06 || Math.abs(b - D) < 0.06) cut.push(a, plan.yb, b, a, plan.yt + SLAB, b);
    }
  }
  const cutGeo = keep(new THREE.BufferGeometry());
  cutGeo.setAttribute('position', new THREE.Float32BufferAttribute(cut, 3));
  const cutLines = new THREE.LineSegments(cutGeo, mat('cutLine'));
  cutLines.raycast = () => {};
  group.add(cutLines);

  // label anchor and framing box of each room, in world coordinates
  group.updateMatrixWorld(true);
  const toW = (x, y, z) => new THREE.Vector3(x, y, z).applyMatrix4(group.matrix);
  for (const s of slots) {
    s.anchor = toW((s.x0 + s.x1) / 2, s.yf + s.h * 0.62, s.zf + 0.4);
    s.box = new THREE.Box3();
    for (const x of [s.x0, s.x1]) for (const y of [s.yf, s.yf + s.h]) for (const z of [s.zf, s.D]) s.box.expandByPoint(toW(x, y, z));
  }
  const stack = new THREE.Box3();
  for (const s of slots) stack.union(s.box);
  // outward viewing direction for this corner: across the long open face, a little from the end
  const out = aH.clone().multiplyScalar(-0.45).add(bH.clone().multiplyScalar(-1)).normalize();

  return {
    group, slots, frames, pickables, stack, out, cutLines, key: corner.key,
    dispose() { own.forEach((g) => g.dispose()); group.traverse((o) => { if (o.isInstancedMesh) o.dispose(); }); },
  };
}
