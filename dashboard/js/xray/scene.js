// Building X-Ray: Three.js scene. Lazy-loaded by sections/xray.js when the view opens.
//
// Three views share one model:
//   exterior  the sourced massing with its illustrative façade pattern, nothing cut
//   cutaway   one corner of the building is opened (a box-shaped notch a few storeys high, cutaway.js) to
//             show a short stack of illustrative rooms; the rest of the massing stays solid. While the
//             reader orbits, the opening moves to the street corner facing them.
//   focus     one inspection category: its room is outlined in civic blue, the others are dimmed (not
//             hidden), and the camera frames it. The exterior closes the cutaway and outlines the
//             façade; records frame the inspection sheet beside the building.
//
// The cut is a set of six clipping planes intersected (clipIntersection), applied to the façade, roof
// and silhouette materials only: slabs, rooms, the site and the context are never clipped. Opening and
// closing sweep the cut in from the façade (~600 ms, instant with reduced motion).
//
// Rendering is on demand: frames are drawn only for input, a transition, damping or a highlight fade.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildBuilding, buildRecordSheet } from './building.js';
import { createMaterials } from './materials.js';
import { createAnnotations } from './annotations.js';
import { fitView, pushOutside } from './framing.js';
import { facingCorner, SCENES } from './cutaway.js';

const FOV = 30;
const OPEN_MS = 620, CLOSE_MS = 260;
const ZONES = ['exterior', 'systems', 'shared', 'records', 'grounds'];
const ROOF = ['roof', 'roofEdge', 'parapet', 'penthouse'];
const FACADE = ['facade', 'facadeApprox', 'wallInside', 'glass', 'band', 'base', 'frame', 'door'];
// room materials (one variant per scene zone, so a room can be dimmed on its own)
const ROOM = ['room', 'roomEnd', 'floorTint', 'trim', 'stair', 'metal', 'runner', 'unitDoor', 'light', 'concrete', 'cab', 'equipment',
  'equipmentDark', 'panel', 'duct', 'pipe', 'bin', 'binAlt', 'paint', 'carBody', 'carGlass', 'tire'];
const DIM = 0.42;                // how far unselected rooms fade toward the sky colour

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export function createXrayScene(container, { onSelect, onHover, onContextLost, palette, reducedMotion }) {
  const canvasWrap = document.createElement('div');
  canvasWrap.className = 'xr-canvas';
  const chip = document.createElement('div');
  chip.className = 'xr-hoverchip';
  chip.hidden = true;
  chip.setAttribute('aria-hidden', 'true');
  container.append(canvasWrap, chip);
  const notes = createAnnotations(container, { onSelect: (z) => onSelect(z === state.selected ? null : z), onHover: (z) => setHover(z) });

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.localClippingEnabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  canvasWrap.append(renderer.domElement);
  const el = renderer.domElement;
  el.setAttribute('aria-hidden', 'true');

  const scene = new THREE.Scene();
  scene.background = new THREE.Color();
  scene.fog = new THREE.Fog(0xffffff, 200, 800);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;
  scene.environment = envTex;
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.5, 6000);

  // sky fill, a key sun (shadows) and a weak cool fill from the opposite side for modelling
  const hemi = new THREE.HemisphereLight(0xffffff, 0xd8d0c2, 0.62);
  const sun = new THREE.DirectionalLight(0xfff3e2, 3.0);
  const fill = new THREE.DirectionalLight(0xdfe8f5, 0.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.08;
  sun.shadow.radius = 3;
  scene.add(hemi, sun, sun.target, fill, fill.target);

  const kit = createMaterials(THREE);
  const mat = kit.mat;
  // the notch: six planes, intersected. Region = a ∈ (aMin, aMax), b ∈ (bMin, bMax), y ∈ (y0, y1) in the
  // active corner's frame. Planes start "closed" (an empty region).
  const planes = Array.from({ length: 6 }, () => new THREE.Plane(new THREE.Vector3(0, 1, 0), -1e6));
  const CLIPPED = new Set([...FACADE, ...ROOF, 'outline']);
  function clipMaterials() {
    for (const m of kit.all()) {
      if (!CLIPPED.has(m.userData.name) || m.clippingPlanes?.length) continue;
      m.clippingPlanes = planes;
      m.clipIntersection = true;
      m.clipShadows = true;
      if (m.isMeshStandardMaterial) m.side = THREE.DoubleSide;   // cut walls show their inner faces
      m.needsUpdate = true;
    }
  }
  const ground = new THREE.Mesh(new THREE.CircleGeometry(1, 96), mat('ground'));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.4;
  ground.receiveShadow = true;
  ground.raycast = () => {};
  scene.add(ground);

  const controls = new OrbitControls(camera, el);
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.rotateSpeed = 0.6;
  controls.zoomSpeed = 0.8;
  controls.panSpeed = 0.6;
  controls.screenSpacePanning = true;
  controls.minPolarAngle = THREE.MathUtils.degToRad(15);
  controls.maxPolarAngle = THREE.MathUtils.degToRad(84);
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };

  const state = {
    mode: 'exterior', selected: null, hover: null, statuses: {}, labels: {}, palette, disposed: false,
    building: null, sheet: null, home: null, atHome: false,
    corner: null, cut: null,         // active corner key and its built room stack
    open: 0, pending: null,          // notch openness 0..1; corner waiting for the notch to close
    dragging: false,
    dim: Object.fromEntries(ZONES.map((z) => [z, 0])),
  };

  // ---- building --------------------------------------------------------------------------------------
  function setBuilding(entry) {
    clearBuilding();
    const b = buildBuilding(THREE, entry, mat);
    state.building = b;
    scene.add(b.root);
    const bb = b.bounds;
    const R = Math.hypot(bb.max.x - bb.min.x, bb.max.z - bb.min.z, bb.max.y) / 2;
    const span = Math.max(260, R * 7);
    ground.scale.setScalar(span);
    camera.far = span * 4;
    camera.updateProjectionMatrix();
    b.R = R;
    state.open = 0;
    state.pending = null;
    useCorner(b.plan.home);
    kit.applyPalette(state.palette, state.statuses);
    applyColours();
    clipMaterials();
    state.home = null;          // a new building always gets its own fitted view
    frameHome(false, 'none');
    placeLights();
    syncOpen(true);
    applyVisuals();
  }
  function clearBuilding() {
    clearSheet();
    if (!state.building) return;
    scene.remove(state.building.root);
    state.building.dispose();
    state.building = null;
    state.cut = null;
  }
  function clearSheet() {
    if (!state.sheet) return;
    state.sheet.parent?.remove(state.sheet);
    state.sheet.userData.dispose();
    state.sheet = null;
  }
  // items: [{ col, cls }] — the record items of the inspection shown and their rating classes
  function setRecords(items) {
    if (!state.building) return;
    clearSheet();
    const list = items.length ? items : [{ col: 'none', cls: 'none' }];
    state.sheet = buildRecordSheet(THREE, state.building.records, list, (it) => mat('tile', it.cls), mat('board'), mat('trim', 'records'), mat('leader'));
    state.building.site.add(state.sheet);
    kit.applyPalette(state.palette, state.statuses);
    applyVisuals();
    requestRender();
  }
  function useCorner(key) {
    const b = state.building;
    state.corner = key;
    state.cut = b.cutawayAt(key);
    for (const o of b.interior.children) if (o.userData.cornerKey) o.visible = o.userData.cornerKey === key && state.open > 0.001;
    kit.applyPalette(state.palette, state.statuses);   // the first stack built creates the room materials
  }

  // ---- lights fitted to the building and the default view -----------------------------------------------
  function placeLights() {
    const b = state.building, h = state.home;
    if (!b || !h) return;
    const c = new THREE.Vector3((b.bounds.min.x + b.bounds.max.x) / 2, 0, (b.bounds.min.z + b.bounds.max.z) / 2);
    const az = h.theta - 0.85, el = THREE.MathUtils.degToRad(50);
    const d = b.R * 3 + b.H;
    sun.position.set(c.x + Math.sin(az) * Math.cos(el) * d, Math.sin(el) * d, c.z + Math.cos(az) * Math.cos(el) * d);
    sun.target.position.copy(c);
    fill.position.set(c.x - Math.sin(az) * d, d * 0.4, c.z - Math.cos(az) * d);
    fill.target.position.copy(c);
    const S = Math.max(b.R * 1.9, 40);
    Object.assign(sun.shadow.camera, { left: -S, right: S, top: S, bottom: -S, near: 1, far: d * 2.5 });
    sun.shadow.camera.updateProjectionMatrix();
  }

  // ---- camera ----------------------------------------------------------------------------------------------
  const tall = () => { const b = state.building, bb = b.bounds; return b.H > Math.hypot(bb.max.x - bb.min.x, bb.max.z - bb.min.z) * 1.4; };
  // exterior: three-quarter view onto the long, street-facing façade; cutaway: looking into the open corner
  function homeAngles(mode) {
    const b = state.building;
    if (mode === 'exterior' || !state.cut) return { theta: Math.atan2(b.view.dx, -b.view.dy), phi: THREE.MathUtils.degToRad(tall() ? 66 : 60) };
    // low enough to see under the storey above the opening (the rooms are a few metres deep)
    const o = state.cut.out;
    return { theta: Math.atan2(o.x, o.z), phi: THREE.MathUtils.degToRad(76) };
  }
  // The whole model as points: footprint hull from the ground to the top (rooftop plant included), the
  // site elements beside it, and the records sheet when it shows. Neighbouring buildings are not included.
  function modelPoints(mode = state.mode) {
    const b = state.building;
    const top = topOf();
    const pts = [];
    for (const [x, z] of b.hull) pts.push([x, 0, z], [x, top, z]);
    for (const p of b.siteFrame) pts.push(p, [p[0], 0, p[2]]);
    if (mode !== 'exterior' && state.sheet) boxPoints(new THREE.Box3().setFromObject(state.sheet), pts);
    return pts;
  }
  function boxPoints(bx, pts = []) {
    for (const x of [bx.min.x, bx.max.x]) for (const y of [bx.min.y, bx.max.y]) for (const z of [bx.min.z, bx.max.z]) pts.push([x, y, z]);
    return pts;
  }
  function topOf() { const b = state.building; return Math.max(b.bounds.top + 0.9, b.plantTop); }
  // The camera never enters the building: whatever moved it, if it ends up inside the footprint prism
  // (plus a margin) it backs out along its own line of sight.
  function keepOutside() {
    const b = state.building;
    if (!b) return false;
    const t = controls.target, c = camera.position;
    const out = pushOutside([t.x, t.y, t.z], [c.x, c.y, c.z], b.hull, topOf(), Math.max(1.5, b.fh * 0.7));
    if (!out) return false;
    c.set(out[0], out[1], out[2]);
    return true;
  }
  // canvas kept free around the model: ~10% padding, and room for the label column at the sides
  function safeInsets(mode = state.mode) {
    const w = canvasWrap.clientWidth || 600, h = canvasWrap.clientHeight || 420;
    // room beside the model for the one selected annotation (Focus); otherwise only the padding
    const labels = w < 560 || mode !== 'focus' ? 0 : Math.min(150, w * 0.14);
    const side = Math.max(w * 0.07, labels) / w;
    return { l: side, r: side, t: h < 480 ? 0.08 : 0.1, b: h < 480 ? 0.07 : 0.09 };
  }
  function currentSpherical() { return new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target)); }
  // keep: 'none' = default angles for the mode, 'azimuth' = keep the reader's heading, 'both' = keep both
  function frameHome(animate = true, keep = 'none', ms = 800, mode = state.mode === 'focus' ? 'cutaway' : state.mode) {
    if (!state.building) return;
    const def = homeAngles(mode);
    let theta = def.theta, phi = def.phi;
    if (state.home && keep !== 'none') {
      const cur = currentSpherical();
      theta = cur.theta;
      if (keep === 'both') phi = cur.phi;
    }
    fitTo(modelPoints(mode), theta, phi, animate ? ms : 0, true);
    state.atHome = true;
  }
  function fitTo(pts, theta, phi, ms, isHome = false) {
    const fit = fitView(pts, { theta, phi, fov: camera.fov, aspect: camera.aspect, insets: safeInsets(), near: camera.near * 4 });
    const target = new THREE.Vector3(...fit.target);
    if (isHome || !state.home) {
      const r = Math.max(...modelPoints('cutaway').map((p) => target.distanceTo(new THREE.Vector3(...p))));
      state.home = { target, dist: fit.distance, theta, phi, r };
      controls.minDistance = Math.max(4, r * 0.12);
      controls.maxDistance = Math.max(fit.distance * 2.6, controls.minDistance * 2);
      scene.fog.near = fit.distance * 1.25;
      scene.fog.far = fit.distance * 3.6;
    }
    // a framed view is always reachable by panning: the pan limit grows to include its target
    state.panLimit = Math.max(state.home.r * 0.9, target.distanceTo(state.home.target) + 1);
    moveTo(target, Math.max(fit.distance, controls.minDistance), theta, phi, ms);
  }
  function moveTo(target, dist, azimuth, polar, ms = 700) {
    const s = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
    const fresh = s.radius < 1e-3;
    const t0 = controls.target.clone(), d0 = fresh ? dist : s.radius;
    const a0 = fresh ? (azimuth ?? 0.6) : s.theta, p0 = fresh ? (polar ?? 1.1) : s.phi;
    const az = azimuth ?? a0, po = polar ?? p0;
    let da = az - a0;
    da = Math.atan2(Math.sin(da), Math.cos(da));
    const apply = (k) => {
      controls.target.lerpVectors(t0, target, k);
      camera.position.setFromSpherical(new THREE.Spherical(d0 + (dist - d0) * k, p0 + (po - p0) * k, a0 + da * k)).add(controls.target);
      keepOutside();
      camera.lookAt(controls.target);
    };
    tween('camera', 0, 1, (k) => apply(ease(k)), fresh || reducedMotion() ? 0 : ms);
  }
  // Focus: a room (with a margin of building around it), the records sheet, or the whole exterior.
  function focusZone(zone) {
    const b = state.building;
    if (!b) return;
    state.atHome = false;
    if (!zone) return frameHome(true, 'azimuth');
    if (zone === 'exterior') {
      const a = homeAngles('exterior'), cur = currentSpherical();
      return fitTo(modelPoints('exterior'), state.home ? cur.theta : a.theta, a.phi, 800);
    }
    if (zone === 'records') {
      if (!state.sheet) return frameHome(true, 'azimuth');
      // the sheet itself with a few metres around it (its leader runs to the façade behind), seen face-on
      // from the side away from the building (tiles are on both faces), turned a little toward the building
      const box = new THREE.Box3().setFromObject(state.sheet);
      const sc = box.getCenter(new THREE.Vector3());
      box.expandByVector(new THREE.Vector3(2.2, 0, 2.2));
      box.min.y = 0; box.max.y += 1.6;
      const pts = boxPoints(box);
      // outward: from the sheet's anchor on the façade toward the sheet (data frame y → world −z)
      const r = b.records, n = new THREE.Vector3(r.at[0] - r.wall[0], 0, -(r.at[1] - r.wall[1])).normalize();
      const face = Math.atan2(n.x, n.z), h = homeAngles('exterior').theta;
      const turn = Math.sign(Math.sin(h - face)) * THREE.MathUtils.degToRad(22);
      // the first heading whose fitted camera is clear of the building (a sheet in a concave bay of the
      // footprint can sit inside its convex hull); otherwise the wider view with the lower storeys
      const phi = THREE.MathUtils.degToRad(74), d = THREE.MathUtils.degToRad;
      for (const th of [face + turn, face - turn, face + 2.2 * turn, face - 2.2 * turn, h]) {
        const fit = fitView(pts, { theta: th, phi, fov: camera.fov, aspect: camera.aspect, insets: safeInsets(), near: camera.near * 4 });
        const cam = new THREE.Vector3().setFromSphericalCoords(Math.max(fit.distance, controls.minDistance), phi, th).add(new THREE.Vector3(...fit.target));
        if (!pushOutside(fit.target, cam.toArray(), b.hull, topOf(), Math.max(1.5, b.fh * 0.7))) return fitTo(pts, th, phi, 800);
      }
      const wide = boxPoints(new THREE.Box3().setFromObject(state.sheet));
      const low = Math.min(b.H, Math.max(3 * b.fh, 8));
      for (const [x, z] of b.hull) wide.push([x, 0, z], [x, low, z]);
      return fitTo(wide, h, d(68), 800);
    }
    const slot = state.cut?.slots.find((s) => s.zone === zone);
    if (!slot) return frameHome(true, 'azimuth');
    // the room itself with a margin of building around it (half a storey above and below, a bay to each
    // side), looking into its long open side a little from above, so the floor's real outline reads
    const bx = slot.box.clone();
    bx.min.y = Math.max(-0.4, bx.min.y - b.fh * 0.6);
    bx.max.y += b.fh * 0.6;
    const pad = Math.min(3, Math.max(1.2, bx.getSize(new THREE.Vector3()).length() * 0.12));
    bx.expandByVector(new THREE.Vector3(pad, 0, pad));
    const c = state.cut.corner;
    const ox = -(c.aHat[0] * 0.3 + c.bHat[0]), oz = c.aHat[1] * 0.3 + c.bHat[1];
    fitTo(boxPoints(bx), Math.atan2(ox, oz), THREE.MathUtils.degToRad(74), 800);
  }
  controls.addEventListener('start', () => { state.atHome = false; state.dragging = true; });
  controls.addEventListener('end', () => { state.dragging = false; });
  // keep panning near the building; in the cutaway, the opening follows the reader around the building
  controls.addEventListener('change', () => {
    if (state.home) {
      // (with a tolerance: re-clamping a target already on the limit would nudge it by float noise, and
      // OrbitControls would report that as a change on every frame, so rendering would never go idle)
      const c = state.home.target, lim = state.panLimit ?? state.home.r * 0.9, t = controls.target;
      const off = t.clone().sub(c);
      if (off.length() > lim + 0.01) { off.setLength(lim); t.copy(c).add(off); }
    }
    if (state.dragging && state.mode === 'cutaway' && state.building) {
      const d = camera.position.clone().sub(controls.target);
      const next = facingCorner(state.building.plan, d.x, -d.z, state.pending ?? state.corner);
      if (next !== (state.pending ?? state.corner)) switchCorner(next);
    }
    if (viewMoved(false)) requestRender();
  });
  // OrbitControls (0.160) re-clamps its target on every update, and for some coordinates that rounds back
  // and forth by ~1e-16; it then reports a change forever and rendering would never go idle. Motion below
  // a micrometre counts as none. `commit` = remember this view as the last one checked.
  const seen = { p: new THREE.Vector3(NaN, NaN, NaN), t: new THREE.Vector3(), q: new THREE.Quaternion() };
  function viewMoved(commit = true) {
    const moved = Number.isNaN(seen.p.x) || seen.p.distanceToSquared(camera.position) > 1e-12
      || seen.t.distanceToSquared(controls.target) > 1e-12 || 1 - Math.abs(seen.q.dot(camera.quaternion)) > 1e-12;
    if (commit) { seen.p.copy(camera.position); seen.t.copy(controls.target); seen.q.copy(camera.quaternion); }
    return moved;
  }

  // ---- the notch -----------------------------------------------------------------------------------
  const openTarget = () => (state.mode === 'exterior' || (state.mode === 'focus' && state.selected === 'exterior') ? 0 : 1);
  function syncOpen(instant = false) {
    if (state.pending) return;            // a corner switch is under way; it opens to the target itself
    const to = openTarget(), from = state.open;
    if (Math.abs(to - from) < 1e-4) return;
    tween('open', from, to, (x) => { state.open = x; }, instant || reducedMotion() ? 0 : (to > from ? OPEN_MS : CLOSE_MS) * Math.abs(to - from));
  }
  // close the notch, move it to another corner, open it again
  function switchCorner(key) {
    if (reducedMotion() || state.open < 0.01) { state.pending = null; useCorner(key); syncOpen(true); requestRender(); return; }
    state.pending = key;
    tween('open', state.open, 0, (x) => {
      state.open = x;
      if (x <= 0 && state.pending) {
        const k = state.pending;
        state.pending = null;
        useCorner(k);
        tweens.delete('open');
        tween('open', 0, openTarget(), (y) => { state.open = y; }, OPEN_MS * 0.8);
      }
    }, CLOSE_MS);
  }
  const aW = new THREE.Vector3(), bW = new THREE.Vector3(), kW = new THREE.Vector3();
  function placeNotch() {
    const b = state.building, c = state.cut?.corner;
    const k = ease(clamp01(state.open));
    if (!c || k < 0.001) { planes[0].set(new THREE.Vector3(0, -1, 0), 1e6); planes[1].set(new THREE.Vector3(0, 1, 0), -1e6 + 1); for (let i = 2; i < 6; i++) planes[i].set(new THREE.Vector3(0, 1, 0), 1e6); return; }
    const P = b.plan;
    aW.set(c.aHat[0], 0, -c.aHat[1]); bW.set(c.bHat[0], 0, -c.bHat[1]); kW.set(c.K[0], 0, -c.K[1]);
    const ak = aW.dot(kW), bk = bW.dot(kW);
    const aMin = -c.ma - 2.4, bMin = -c.mb - 2.4;          // just outside the façade (balconies included)
    const aMax = THREE.MathUtils.lerp(aMin - 0.1, P.W, k), bMax = THREE.MathUtils.lerp(bMin - 0.1, P.D, k);
    planes[0].normal.copy(aW); planes[0].constant = -ak - aMax;          // a < aMax
    planes[1].normal.copy(aW).negate(); planes[1].constant = ak + aMin;  // a > aMin
    planes[2].normal.copy(bW); planes[2].constant = -bk - bMax;          // b < bMax
    planes[3].normal.copy(bW).negate(); planes[3].constant = bk + bMin;  // b > bMin
    planes[4].normal.set(0, -1, 0); planes[4].constant = P.yb + 0.005;   // y > floor of the stack
    planes[5].normal.set(0, 1, 0); planes[5].constant = -P.yt;           // y < ceiling of the stack
  }
  // a point inside the open notch (its clipped geometry is invisible, so it can't be picked or occlude)
  function inNotch(p) { return state.open > 0.01 && planes.every((pl) => pl.distanceToPoint(p) < 0); }

  // ---- appearance -------------------------------------------------------------------------------------------
  const tmpColor = new THREE.Color();
  function applyColours() {
    const P = state.palette;
    scene.background.set(P.sky);
    scene.fog.color.set(P.sky);
    hemi.groundColor.set(P.ground);
    for (const m of kit.all()) if (m.emissive && m.userData.name !== 'light') m.emissive.set(P.accent);
  }
  function applyVisuals() {
    const b = state.building;
    if (!b) return;
    placeNotch();
    const k = ease(clamp01(state.open));
    const P = state.palette;
    // façade: never faded; outlined and faintly tinted when the exterior is selected or hovered
    const extSel = state.selected === 'exterior', extHot = state.hover === 'exterior';
    for (const bk of b.buckets) for (const n of FACADE) emissive(mat(n, bk.index), extSel ? 0.1 : extHot ? 0.06 : 0);
    for (const n of ROOF) emissive(mat(n), extSel ? 0.08 : 0);
    const ol = mat('outline');
    ol.color.set(extSel || extHot ? P.accent : P.outline);
    ol.opacity = extSel ? 0.95 : 0.75;
    // rooms: the active corner's stack shows while the notch is open
    for (const o of b.interior.children) if (o.userData.cornerKey) o.visible = o === state.cut?.group && k > 0.001;
    for (const z of SCENES) {
      const d = state.dim[z];
      for (const n of ROOM) {
        const m = kit.peek(n, z);
        if (!m) continue;
        m.color.copy(m.userData.baseColor).lerp(tmpColor.set(P.sky), d);
        if (n !== 'light') m.emissiveIntensity = state.hover === z && state.selected !== z ? 0.06 : 0;
      }
      const edge = kit.peek('slotEdge', z);
      if (edge) edge.opacity = k * (state.selected === z ? 0.95 : state.hover === z ? 0.55 : 0);
    }
    mat('cutLine').opacity = 0.85 * k;
    if (state.sheet) {
      state.sheet.visible = state.mode !== 'exterior' || state.selected === 'records';
      const d = state.dim.records;
      for (const m of kit.named('tile').concat(kit.named('board'), [mat('trim', 'records')])) m.color.copy(m.userData.baseColor).lerp(tmpColor.set(P.sky), d);
      mat('leader').opacity = 0.6 * (1 - d);
    }
    // neighbouring massing recedes toward the background, more so in focus
    const recede = state.mode === 'focus' ? 0.6 : 0.45;
    mat('context').color.set(P.mat.context).lerp(tmpColor.set(P.sky), recede);
    mat('contextEdge').color.set(P.mat.contextEdge).lerp(tmpColor.set(P.sky), recede * 0.8);
  }
  function emissive(m, v) { if (m.emissive) m.emissiveIntensity = v; }
  const dimTarget = (z) => (state.selected && state.selected !== z && state.mode !== 'exterior' ? (z === 'records' ? 0.5 : DIM) : 0);

  // context buildings between the camera and the selected building fade out
  // (sight lines to the building's middle and top, and in the cutaway to the room stack's bottom, middle
  // and the focused room, so even a low neighbour in front of the opening fades)
  const ray = new THREE.Ray(), hitPt = new THREE.Vector3(), focusPts = [];
  function fadeContext() {
    const b = state.building;
    if (!b) return;
    const bb = b.bounds;
    focusPts.length = 0;
    const mid = new THREE.Vector3((bb.min.x + bb.max.x) / 2, b.H * 0.4, (bb.min.z + bb.max.z) / 2);
    focusPts.push(mid, mid.clone().setY(b.H));
    if (state.mode !== 'exterior' && state.cut && state.open > 0.01) {
      const st = state.cut.stack, c = st.getCenter(new THREE.Vector3());
      focusPts.push(c, c.clone().setY(st.min.y + 0.8));
      const slot = state.cut.slots.find((x) => x.zone === state.selected);
      if (slot) focusPts.push(slot.box.getCenter(new THREE.Vector3()), slot.anchor);
    }
    if (state.selected === 'records' && state.sheet?.visible) {
      const sb = new THREE.Box3().setFromObject(state.sheet);
      focusPts.push(sb.getCenter(new THREE.Vector3()), sb.getCenter(new THREE.Vector3()).setY(sb.min.y + 0.4));
    }
    for (const m of b.context) {
      let hidden = false;
      for (const p of focusPts) {
        ray.origin.copy(camera.position);
        ray.direction.copy(p).sub(camera.position);
        const d = ray.direction.length();
        ray.direction.divideScalar(d);
        if (ray.intersectBox(m.userData.box, hitPt) && hitPt.distanceTo(camera.position) < d) { hidden = true; break; }
      }
      m.material = mat(hidden ? 'contextFaded' : 'context');
      m.children[0].material = mat(hidden ? 'contextEdgeFaded' : 'contextEdge');
      m.castShadow = !hidden;
    }
  }

  // ---- tweens + render on demand ---------------------------------------------------------------------------
  const tweens = new Map();
  function tween(key, from, to, apply, ms) {
    if (!ms) { tweens.delete(key); apply(to); requestRender(); return; }
    tweens.set(key, { start: performance.now(), from, to, apply, ms });
    requestRender();
  }
  let frame = 0, last = 0;
  function requestRender() { if (!frame && !state.disposed) frame = requestAnimationFrame(renderFrame); }
  function renderFrame(now) {
    frame = 0;
    const dt = last ? Math.min(64, now - last) : 16;
    last = now;
    for (const [key, t] of [...tweens]) {
      const k = Math.min(1, (now - t.start) / t.ms);
      if (tweens.get(key) !== t) continue;
      t.apply(t.from + (t.to - t.from) * k);
      if (k >= 1 && tweens.get(key) === t) tweens.delete(key);
    }
    let settling = false;
    const rm = reducedMotion();
    for (const z of ZONES) {
      const target = dimTarget(z), cur = state.dim[z];
      if (Math.abs(target - cur) > 0.003) { state.dim[z] = rm ? target : cur + (target - cur) * Math.min(1, dt / 120); settling = !rm; } else state.dim[z] = target;
    }
    const damping = tweens.has('camera') ? false : controls.update() && viewMoved();
    applyVisuals();
    keepOutside();
    fadeContext();
    renderer.render(scene, camera);
    placeLabels();
    if (tweens.size || damping || settling) requestRender();
    else {
      last = 0;
      if (state.building) {
        const e = projectedExtent();
        canvasWrap.dataset.fit = [e.x0, e.y0, e.x1, e.y1].map((n) => n.toFixed(3)).join(',');
        canvasWrap.dataset.cam = `${camera.position.x.toFixed(2)},${camera.position.y.toFixed(2)},${camera.position.z.toFixed(2)}`;
        const t = controls.target;
        canvasWrap.dataset.target = `${t.x.toFixed(2)},${t.y.toFixed(2)},${t.z.toFixed(2)}`;
        canvasWrap.dataset.mode = state.mode;
        canvasWrap.dataset.corner = state.corner ?? '';
        canvasWrap.dataset.open = state.open.toFixed(2);
      }
    }
  }

  // ---- annotations -------------------------------------------------------------------------------------------
  const v = new THREE.Vector3();
  const raycaster = new THREE.Raycaster();
  const camDir = new THREE.Vector3();
  function anchorOf(zone) {
    const b = state.building;
    if (zone === 'exterior') {
      // on the most camera-facing wall
      camDir.copy(camera.position).sub(controls.target).setY(0).normalize();
      let best = null, score = -Infinity;
      for (const bk of b.buckets) {
        if (bk.length < 2) continue;
        const s = bk.normal.dot(camDir);
        if (s > score) { score = s; best = bk; }
      }
      return best ? best.anchor.clone() : null;
    }
    if (zone === 'records') return state.sheet?.visible ? state.sheet.userData.top.clone().setY(state.sheet.userData.top.y + 0.2) : null;
    if (!state.cut || state.open < 0.6) return null;
    return state.cut.slots.find((s) => s.zone === zone)?.anchor.clone() ?? null;
  }
  function occluded(p) {
    const b = state.building;
    const dir = p.clone().sub(camera.position);
    const d = dir.length();
    raycaster.set(camera.position, dir.normalize());
    raycaster.far = d - 0.6;
    return raycaster.intersectObjects([b.facadeRoot, b.roofRoot], true).some((h) => !inNotch(h.point));
  }
  function placeLabels() {
    const b = state.building;
    const w = canvasWrap.clientWidth, h = canvasWrap.clientHeight;
    if (!b) { notes.update([], { w, h }); return; }
    const ext = projectedExtent();
    const items = [];
    for (const zone of ZONES) {
      const l = state.labels[zone];
      if (!l) continue;
      const hot = zone === state.hover, sel = zone === state.selected;
      // One annotation at a time, so the building stays the focus: the selected category, or whatever is
      // hovered. The category list beside the model names every category; nothing else floats over it.
      const show = sel || hot;
      const p = show ? anchorOf(zone) : null;
      let x = 0, y = 0, visible = false;
      if (p) {
        v.copy(p).project(camera);
        x = (v.x * 0.5 + 0.5) * w; y = (-v.y * 0.5 + 0.5) * h;
        visible = v.z < 1 && x > 4 && x < w - 4 && y > 4 && y < h - 4;
        if (visible && zone !== 'exterior' && occluded(p)) visible = false;
      }
      items.push({
        key: zone, x, y, visible, title: sel && l.name ? l.name : l.title, sub: l.sub,  // the selected callout has room for the panel's full name status: l.status, hot, selected: sel,
        dim: !!state.selected && !sel, compact: !sel && !hot,
      });
    }
    notes.update(items, { w, h, x0: ext.x0 * w, x1: ext.x1 * w });
  }
  function setLabels(labels) { state.labels = labels; requestRender(); }
  // projected extent of the visible model, 0..1 of the canvas (y down)
  // (in Focus on a room, the room is the subject: its label goes beside the room, not beside a building
  // that fills the whole canvas, where it would be pushed back over the model)
  function projectedExtent() {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    const room = state.mode === 'focus' && state.cut?.slots.find((s) => s.zone === state.selected);
    for (const p of room ? boxPoints(room.box) : modelPoints(state.mode)) {
      v.set(p[0], p[1], p[2]).project(camera);
      const sx = v.x * 0.5 + 0.5, sy = -v.y * 0.5 + 0.5;
      x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
    }
    return { x0, x1, y0, y1 };
  }

  // ---- picking -----------------------------------------------------------------------------------------------
  const ndc = new THREE.Vector2();
  function shown(o) { for (let n = o; n; n = n.parent) if (!n.visible) return false; return true; }
  function hitAt(ev) {
    const b = state.building;
    if (!b) return null;
    const r = el.getBoundingClientRect();
    ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    raycaster.far = Infinity;
    const targets = b.pickables.concat(state.cut && state.open > 0.5 ? state.cut.pickables : [], state.sheet?.visible ? [state.sheet] : []);
    const hits = raycaster.intersectObjects(targets, true).filter((h) => h.object.userData.zone && shown(h.object)
      && !(CLIPPED.has(materialName(h.object)) && inNotch(h.point)));
    return hits[0] ?? null;
  }
  function materialName(o) { const m = Array.isArray(o.material) ? o.material[0] : o.material; return m.userData.name; }
  function setHover(zone, ev) {
    if (zone !== state.hover) {
      state.hover = zone;
      el.style.cursor = zone ? 'pointer' : '';
      onHover?.(zone);
      requestRender();
    }
    const l = zone && state.labels[zone];
    chip.hidden = !l || !ev;
    if (l && ev) {
      const r = container.getBoundingClientRect();
      chip.innerHTML = `<b>${l.name}</b><span>${l.summary}</span>`;
      const x = Math.min(ev.clientX - r.left + 14, r.width - 290);
      chip.style.transform = `translate(${Math.round(x)}px, ${Math.round(ev.clientY - r.top + 16)}px)`;
    }
  }
  let down = null, moveFrame = 0, lastMove = null, clickTimer = 0;
  const onDown = (ev) => { down = { x: ev.clientX, y: ev.clientY }; };
  const onUp = (ev) => {
    if (!down) return;
    const moved = Math.hypot(ev.clientX - down.x, ev.clientY - down.y);
    down = null;
    if (moved >= 5) return;
    clearTimeout(clickTimer);
    const h = hitAt(ev);
    // wait briefly so a double-click (fly to point) doesn't also toggle the selection
    clickTimer = setTimeout(() => { const z = h?.object.userData.zone ?? null; onSelect(z && z === state.selected ? null : z); }, 230);
  };
  const onDbl = (ev) => {
    clearTimeout(clickTimer);
    const h = hitAt(ev);
    if (!h) return;
    state.atHome = false;
    moveTo(h.point, Math.max(controls.minDistance, camera.position.distanceTo(controls.target) * 0.6), null, null);
  };
  const onMove = (ev) => {
    if (ev.pointerType === 'touch' || down) return;
    lastMove = ev;
    if (moveFrame) return;
    moveFrame = requestAnimationFrame(() => { moveFrame = 0; if (lastMove) setHover(hitAt(lastMove)?.object.userData.zone ?? null, lastMove); });
  };
  const onLeave = () => setHover(null);
  const onLost = (e) => { e.preventDefault(); onContextLost?.(); };
  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('dblclick', onDbl);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerleave', onLeave);
  el.addEventListener('webglcontextlost', onLost);

  // ---- size follows the viewer container -------------------------------------------------------------------------
  let lastSize = '';
  function resize() {
    const w = canvasWrap.clientWidth || 600, h = canvasWrap.clientHeight || 420;
    if (`${w}x${h}` === lastSize) return false;
    lastSize = `${w}x${h}`;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    return true;
  }
  resize();
  const ro = new ResizeObserver(() => {
    if (!resize()) return;
    // stay framed: re-fit if the reader hasn't moved the camera themselves
    if (state.building && state.home) {
      if (state.atHome) frameHome(false, 'both');
      else if (state.mode === 'focus' && !state.dragging) focusZone(state.selected);
    }
    requestRender();
  });
  ro.observe(canvasWrap);

  // ---- modes -------------------------------------------------------------------------------------------------
  function setMode(mode) {
    if (!['exterior', 'cutaway', 'focus'].includes(mode)) mode = 'cutaway';
    if (mode === state.mode) return;
    state.mode = mode;
    syncOpen();
    if (mode === 'focus') focusZone(state.selected);
    else frameHome(true, state.atHome ? 'none' : 'azimuth');
  }

  return {
    setBuilding,
    setRecords,
    setStatuses(s) { state.statuses = { ...s }; kit.applyPalette(state.palette, state.statuses); requestRender(); },
    setLabels,
    setSelected(zone) {
      if (zone === state.selected) return;
      state.selected = zone;
      syncOpen();
      requestRender();
      if (state.mode === 'focus' && zone) focusZone(zone);
    },
    setMode,
    focus(zone) { focusZone(zone ?? state.selected); },
    reset() { state.mode === 'focus' ? focusZone(state.selected) : frameHome(true, 'none'); },
    rotate(deg) {
      const s = currentSpherical();
      state.atHome = false;
      moveTo(controls.target.clone(), s.radius, s.theta + THREE.MathUtils.degToRad(deg), s.phi, 450);
      if (state.mode === 'cutaway' && state.building) {
        const th = s.theta + THREE.MathUtils.degToRad(deg);
        const next = facingCorner(state.building.plan, Math.sin(th), -Math.cos(th), state.corner);
        if (next !== state.corner) switchCorner(next);
      }
    },
    setPalette(p) { state.palette = p; kit.applyPalette(p, state.statuses); applyColours(); requestRender(); },
    hover: (z) => setHover(z),
    render: requestRender,
    dispose() {
      state.disposed = true;
      cancelAnimationFrame(frame);
      cancelAnimationFrame(moveFrame);
      clearTimeout(clickTimer);
      tweens.clear();
      ro.disconnect();
      controls.dispose();
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('dblclick', onDbl);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
      el.removeEventListener('webglcontextlost', onLost);
      clearBuilding();
      ground.geometry.dispose();
      kit.dispose();
      envTex.dispose();
      pmrem.dispose();
      sun.shadow.map?.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvasWrap.remove();
      chip.remove();
      notes.dispose();
    },
  };
}
