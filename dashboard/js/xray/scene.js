// Building X-Ray: Three.js scene. Lazy-loaded by sections/xray.js when the view opens.
//
// Three views share one model:
//   exterior  the sourced massing with an illustrative façade pattern
//   xray      an architectural cutaway: the roof lifts, the walls facing the camera slide out and fade
//             (they follow the camera as it orbits), the illustrative interior and the category
//             highlights fade in — a staged, reversible ~850 ms sequence
//   exploded  the cutaway with storeys separated by a reader-controlled gap
//
// Rendering is on demand: frames are drawn only for input, a transition, damping or a selection fade.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildBuilding, buildRecordTiles, PARKING_DEPTH } from './building.js';
import { createMaterials } from './materials.js';
import { createAnnotations } from './annotations.js';
import { fitView, pushOutside } from './framing.js';

const FOV = 30;
const REVEAL_MS = 850;
const EXPLODE_MS = 650;
const ZONES = ['exterior', 'systems', 'shared', 'records', 'grounds'];
const STRUCTURE = ['floor', 'slabEdge', 'concrete', 'partition', 'poche', 'cab', 'car', 'carGlass', 'paint'];
const ROOF = ['roof', 'roofEdge', 'parapet', 'penthouse'];
const FACADE = ['facade', 'facadeApprox', 'wallInside', 'glass', 'band', 'base', 'frame', 'door'];
const BASE_EMPHASIS = { ok: 0.22, some: 0.42, high: 0.5, none: 0.36 };  // translucent by default; only the selection is strong

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const smooth = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };

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
  const hemi = new THREE.HemisphereLight(0xffffff, 0xd8d0c2, 0.58);
  const sun = new THREE.DirectionalLight(0xfff3e2, 3.0);
  const fill = new THREE.DirectionalLight(0xdfe8f5, 0.55);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.08;
  sun.shadow.radius = 3;
  scene.add(hemi, sun, sun.target, fill, fill.target);

  const kit = createMaterials(THREE);
  const mat = kit.mat;
  // Section plane for the cutaway: vertical, facing the camera, swept from in front of the building to
  // just past its centre. Everything architectural is clipped by it; context, site and records are not.
  const section = new THREE.Plane(new THREE.Vector3(0, 0, -1), 1e6);
  const CLIPPED = new Set([...FACADE, ...ROOF, ...STRUCTURE, 'overlay', 'outline', 'guide']);
  function clipMaterials() {
    for (const m of kit.all()) {
      if (!CLIPPED.has(m.userData.name) || m.clippingPlanes?.length) continue;
      m.clippingPlanes = [section];
      if (m.isMeshStandardMaterial && m.userData.name !== 'overlay') m.side = THREE.DoubleSide; // cut walls show their inner faces
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
    building: null, tiles: null, home: null, atHome: false, sep: 0.55,
    p: 0, e: 0,                                        // reveal and explode progress, 0..1
    emph: Object.fromEntries(ZONES.map((z) => [z, 0])),
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
    b.slide = THREE.MathUtils.clamp(R * 0.22, 3.5, 10);
    b.lift = Math.max(3, b.fh * 1.3);
    // widest floor gap: the exploded model grows by about its own height (or half its footprint for low,
    // wide buildings), with each gap kept between 0.8 and 1.6 storeys so floors stay clearly related
    const plan = Math.hypot(bb.max.x - bb.min.x, bb.max.z - bb.min.z);
    b.maxGap = THREE.MathUtils.clamp(Math.max(b.H, plan * 0.5) / (b.topLevel + 1), b.fh * 0.8, b.fh * 1.6);
    kit.applyPalette(state.palette, state.statuses);
    applyColours();
    clipMaterials();
    state.home = null;          // a new building always gets its own fitted three-quarter view
    frameHome(false, 'none');
    placeLights();
    applyVisuals();
  }
  function clearBuilding() {
    clearTiles();
    if (!state.building) return;
    scene.remove(state.building.root);
    state.building.dispose();
    state.building = null;
  }
  function clearTiles() {
    if (!state.tiles) return;
    state.tiles.parent?.remove(state.tiles);
    state.tiles.userData.dispose();
    state.tiles = null;
  }
  // items: [{ col, cls }] — the record items of the inspection shown and their rating classes
  function setRecords(items) {
    if (!state.building) return;
    clearTiles();
    const list = items.length ? items : [{ col: 'none', cls: 'none' }];
    state.tiles = buildRecordTiles(THREE, state.building.records, list, (it) => mat('tile', it.cls), mat('plinth'));
    state.building.site.add(state.tiles);
    kit.applyPalette(state.palette, state.statuses);
    applyVisuals();
    requestRender();
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
  function viewDistance(radius) {
    const v = THREE.MathUtils.degToRad(camera.fov);
    const h = 2 * Math.atan(Math.tan(v / 2) * camera.aspect);
    return radius / Math.sin(Math.min(v, h) / 2);
  }
  function gapNow(e = state.e) { return state.building ? e * state.sep * state.building.maxGap : 0; }
  // three-quarter view onto the long, street-facing façade; the cutaway looks in from a little higher
  function homeAngles(mode) {
    const b = state.building, bb = b.bounds;
    const tall = b.H > Math.hypot(bb.max.x - bb.min.x, bb.max.z - bb.min.z) * 1.4;
    const deg = mode === 'exterior' ? (tall ? 66 : 60) : mode === 'xray' ? (tall ? 64 : 58) : (tall ? 60 : 55);
    return { theta: Math.atan2(b.view.dx, -b.view.dy), phi: THREE.MathUtils.degToRad(deg) };
  }
  // The visible model as points: footprint hull at the lowest and highest visible heights (lifted roof,
  // rooftop plant and exploded floors included), the site elements beside it, and the records layer.
  // Neighbouring buildings are not included. `live` uses the current transition state instead of the
  // destination of the current mode.
  function modelPoints(mode = state.mode, live = false) {
    const b = state.building;
    const ext = live ? state.p < 0.5 : mode === 'exterior';
    const gap = live ? gapNow() : mode === 'exploded' ? state.sep * b.maxGap : 0;
    const lift = live ? ease(clamp01(state.p / 0.4)) * b.lift : ext ? 0 : b.lift;
    const top = topAt(gap, lift);
    const bot = ext ? 0 : -PARKING_DEPTH - 0.35;
    const pts = [];
    for (const [x, z] of b.hull) pts.push([x, bot, z], [x, top, z]);
    for (const p of b.siteFrame) pts.push(p, [p[0], 0, p[2]]);
    if (!ext && state.tiles) {
      const bx = new THREE.Box3().setFromObject(state.tiles);
      for (const x of [bx.min.x, bx.max.x]) for (const y of [bx.min.y, bx.max.y]) for (const z of [bx.min.z, bx.max.z]) pts.push([x, y, z]);
    }
    return pts;
  }
  function topAt(gap, lift) { const b = state.building; return Math.max(b.bounds.top + 0.9, b.plantTop) + (b.topLevel + 1) * gap + lift; }
  // The camera never enters the building: whatever moved it (zoom, pan, double-click, focus, a tween), if it
  // ends up inside the footprint prism (plus a margin) it backs out along its own line of sight.
  function keepOutside() {
    const b = state.building;
    if (!b) return false;
    const top = topAt(gapNow(), ease(clamp01(state.p / 0.4)) * b.lift);
    const t = controls.target, c = camera.position;
    const out = pushOutside([t.x, t.y, t.z], [c.x, c.y, c.z], b.hull, top, Math.max(1.5, b.fh * 0.7));
    if (!out) return false;
    c.set(out[0], out[1], out[2]);
    return true;
  }
  // canvas kept free around the model: ~10% padding, and room for the label columns at the sides
  function safeInsets(mode = state.mode) {
    const w = canvasWrap.clientWidth || 600, h = canvasWrap.clientHeight || 420;
    const labels = w < 560 ? 0 : mode === 'exterior' ? Math.min(150, w * 0.15) : Math.min(172, w * 0.21);
    const side = Math.max(w * 0.07, labels) / w;
    return { l: side, r: side, t: h < 480 ? 0.08 : 0.1, b: h < 480 ? 0.07 : 0.09 };
  }
  function currentSpherical() { return new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target)); }
  // keep: 'none' = default angles for the mode, 'azimuth' = keep the reader's heading, 'both' = keep both
  function frameHome(animate = true, keep = 'none', ms = 800) {
    if (!state.building) return;
    const def = homeAngles(state.mode);
    let theta = def.theta, phi = def.phi;
    if (state.home && keep !== 'none') {
      const cur = currentSpherical();
      theta = cur.theta;
      if (keep === 'both') phi = cur.phi;
    }
    const pts = modelPoints();
    const fit = fitView(pts, { theta, phi, fov: camera.fov, aspect: camera.aspect, insets: safeInsets(), near: camera.near * 4 });
    const target = new THREE.Vector3(...fit.target);
    const r = Math.max(...pts.map((p) => target.distanceTo(new THREE.Vector3(...p))));
    state.home = { target, dist: fit.distance, theta, phi, r };
    state.atHome = true;
    controls.minDistance = Math.max(4, r * 0.15);
    controls.maxDistance = Math.max(fit.distance * 2.6, controls.minDistance * 2);
    scene.fog.near = fit.distance * 1.25;
    scene.fog.far = fit.distance * 3.6;
    moveTo(target, fit.distance, theta, phi, animate ? ms : 0);
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
  function zoneBox(zone) {
    const b = state.building, box = new THREE.Box3();
    if (zone === 'records') { if (state.tiles) box.setFromObject(state.tiles); return box; }
    for (const m of b.overlays[zone] ?? []) {
      if (!m.boundingBox) m.computeBoundingBox();
      box.union(m.boundingBox.clone().applyMatrix4(m.matrixWorld));
    }
    return box;
  }
  function focusZone(zone) {
    const b = state.building;
    if (!b) return;
    if (!zone || zone === 'exterior') return frameHome(true, 'azimuth');
    b.root.updateMatrixWorld(true);
    const box = zoneBox(zone);
    if (box.isEmpty()) return frameHome(true, 'azimuth');
    const sph = box.getBoundingSphere(new THREE.Sphere());
    // zones that repeat on every floor (corridors, shaft) focus on one representative floor, at the label
    const anchor = anchorOf(zone);
    const r = Math.min(sph.radius * 1.1, Math.max(16, b.R * 0.65));
    const center = anchor && sph.radius > r ? anchor : sph.center;
    const dist = THREE.MathUtils.clamp(viewDistance(Math.max(r, 8)), controls.minDistance * 1.1, controls.maxDistance);
    const s = currentSpherical();
    state.atHome = false;
    moveTo(center, dist, null, Math.min(Math.max(s.phi, THREE.MathUtils.degToRad(48)), THREE.MathUtils.degToRad(68)));
  }
  controls.addEventListener('start', () => { state.atHome = false; });
  // keep panning near the building
  controls.addEventListener('change', () => {
    if (state.home) {
      const c = state.home.target, lim = state.home.r * 0.9, t = controls.target;
      const off = t.clone().sub(c);
      if (off.length() > lim) { off.setLength(lim); t.copy(c).add(off); }
    }
    requestRender();
  });

  // ---- appearance: one function maps (reveal, explode, selection) to every material and transform --------
  const camDir = new THREE.Vector3();
  const tmpColor = new THREE.Color();
  function applyColours() {
    const P = state.palette;
    scene.background.set(P.sky);
    scene.fog.color.set(P.sky);
    hemi.groundColor.set(P.ground);
    for (const m of kit.all()) {
      if (!m.emissive) continue;
      m.emissive.set(P.accent);
    }
  }
  function applyVisuals() {
    const b = state.building;
    if (!b) return;
    const P = state.p, E = state.e;
    const seg = (a, z) => ease(clamp01((P - a) / (z - a)));
    const roofK = seg(0, 0.4), cutK = seg(0.1, 0.6), inK = seg(0.3, 0.75), hiK = seg(0.55, 1);
    b.setLevels(gapNow(), roofK * b.lift);

    // section plane follows the camera and sweeps in with the reveal
    camDir.copy(camera.position).sub(controls.target).setY(0).normalize();
    const cx = b.cutAt.x, cz = b.cutAt.z;     // through the main wing's corridor
    const offset = THREE.MathUtils.lerp(b.R * 1.3 + 4, 0.9, cutK);
    section.normal.copy(camDir).negate();
    section.constant = camDir.x * cx + camDir.z * cz + (cutK > 0.001 ? offset : 1e6);
    // façade: the walls facing the camera slide outward and fade; the rest stay (and separate with their floors)
    const extSel = state.selected === 'exterior', extHot = state.hover === 'exterior';
    for (const bk of b.buckets) {
      const front = smooth(0.3, 0.7, bk.normal.dot(camDir));   // walls turned toward the reader; the section cuts the rest
      const cut = cutK * front;
      bk.cut = cut;
      bk.group.position.copy(bk.normal).multiplyScalar(cut * b.slide);
      bk.group.visible = cut < 0.995;
      for (const k of FACADE) fade(mat(k, bk.index), 1 - cut, extSel ? 0.1 : extHot ? 0.06 : 0);
    }
    const ol = mat('outline');
    ol.opacity = 0.75 * (1 - 0.6 * cutK) * (1 - E);
    ol.color.set(extSel || extHot ? state.palette.accent : state.palette.outline);
    for (const k of ROOF) fade(mat(k), 1, extSel ? 0.1 : 0);       // the roof lifts and is cut, never ghosted
    b.guides.visible = E > 0.01;
    mat('guide').opacity = 0.5 * E;
    b.interior.visible = inK > 0.001;
    for (const k of STRUCTURE) fade(mat(k), inK);
    for (const z of ZONES) {
      const o = mat('overlay', z);
      o.opacity = hiK * state.emph[z];
      o.visible = o.opacity > 0.004;
      o.emissiveIntensity = z === state.selected ? 0.12 : 0;
    }
    if (state.tiles) {
      state.tiles.visible = hiK > 0.001;
      const dim = state.selected && state.selected !== 'records';
      for (const m of kit.named('tile').concat(kit.named('plinth'))) fade(m, hiK * (dim ? 0.3 : 1));
    }
    mat('contact').opacity = 0.32 * (1 - cutK);
    // neighbouring massing recedes toward the background, more so inside the building
    const recede = 0.42 + 0.33 * cutK;
    const P2 = state.palette;
    mat('context').color.set(P2.mat.context).lerp(tmpColor.set(P2.sky), recede);
    mat('contextEdge').color.set(P2.mat.contextEdge).lerp(tmpColor.set(P2.sky), recede * 0.8);
    // the façade casts no shadow while it is cut away, so the interior is lit
    for (const bk of b.buckets) bk.group.traverse((o) => { if (o.isMesh) o.castShadow = bk.cut < 0.5; });
  }
  function fade(m, o, emissive = 0) {
    const op = clamp01(o);
    const transparent = op < 0.999 || m.userData.base < 1;
    if (m.transparent !== transparent) { m.transparent = transparent; m.needsUpdate = true; }
    m.opacity = op * (m.userData.base ?? 1);
    m.depthWrite = op > 0.6;
    m.visible = op > 0.004;
    if (m.emissive) m.emissiveIntensity = emissive;
  }
  function emphasisTarget(z) {
    const s = state.statuses[z] ?? 'none';
    if (state.selected) return z === state.selected ? 0.7 : 0.08;
    return Math.min(0.95, BASE_EMPHASIS[s] + (state.hover === z ? 0.2 : 0));
  }

  // context buildings between the camera and the selected building fade out
  const ray = new THREE.Ray(), hitPt = new THREE.Vector3(), focusPts = [new THREE.Vector3(), new THREE.Vector3()];
  function fadeContext() {
    const b = state.building;
    if (!b) return;
    const bb = b.bounds;
    focusPts[0].set((bb.min.x + bb.max.x) / 2, b.H * 0.4, (bb.min.z + bb.max.z) / 2);
    focusPts[1].set(focusPts[0].x, b.H, focusPts[0].z);
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
      t.apply(t.from + (t.to - t.from) * k);
      if (k >= 1) tweens.delete(key);
    }
    let settling = false;
    const rm = reducedMotion();
    for (const z of ZONES) {
      const target = emphasisTarget(z), cur = state.emph[z];
      if (Math.abs(target - cur) > 0.003) { state.emph[z] = rm ? target : cur + (target - cur) * Math.min(1, dt / 110); settling = !rm; } else state.emph[z] = target;
    }
    const damping = tweens.has('camera') ? false : controls.update();
    applyVisuals();
    keepOutside();         // after the roof lift / floor separation of this frame, before drawing
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
      }
    }
  }

  // ---- annotations -------------------------------------------------------------------------------------------
  const v = new THREE.Vector3();
  const raycaster = new THREE.Raycaster();
  function anchorOf(zone) {
    const b = state.building;
    if (zone === 'exterior') {
      // on the most camera-facing wall that is still standing
      let best = null, score = -Infinity;
      for (const bk of b.buckets) {
        if ((bk.cut ?? 0) > 0.5 || bk.length < 2) continue;
        const s = bk.normal.dot(camDir);
        if (s > score) { score = s; best = bk; }
      }
      return best ? best.anchor.clone().add(best.group.position) : null;
    }
    const a = b.anchors[zone];
    if (!a) return null;
    const p = a.pos.clone();
    p.y += b.offset(a.level, gapNow()) + (a.roof ? ease(clamp01(state.p / 0.4)) * b.lift : 0);
    return p;
  }
  function occluded(p) {
    const b = state.building;
    const dir = p.clone().sub(camera.position);
    const d = dir.length();
    raycaster.set(camera.position, dir.normalize());
    raycaster.far = d - 0.6;
    const walls = b.buckets.filter((bk) => (bk.cut ?? 0) < 0.5).map((bk) => bk.group);
    return raycaster.intersectObjects(walls, true).length > 0;
  }
  function placeLabels() {
    const b = state.building;
    const w = canvasWrap.clientWidth, h = canvasWrap.clientHeight;
    if (!b) { notes.update([], { w, h }); return; }
    const inside = state.p > 0.5;
    const narrow = w < 560, short = h < 380;
    // the model's projected extent, so label columns sit beside it
    const ext = projectedExtent();
    const x0 = ext.x0 * w, x1 = ext.x1 * w;
    const items = [];
    for (const zone of ZONES) {
      const l = state.labels[zone];
      if (!l) continue;
      const hot = zone === state.hover, sel = zone === state.selected;
      // one strong label at a time: with a selection only it (and the hovered one) shows; without one the
      // categories with poor ratings get full labels and the rest shrink to their title
      let show = state.selected ? sel || hot : inside ? true : zone === 'exterior';
      if (narrow || short) show = show && (sel || hot || (!state.selected && zone === 'exterior' && !inside));
      const p = show ? anchorOf(zone) : null;
      let x = 0, y = 0, visible = false;
      if (p) {
        v.copy(p).project(camera);
        x = (v.x * 0.5 + 0.5) * w; y = (-v.y * 0.5 + 0.5) * h;
        visible = v.z < 1 && x > 4 && x < w - 4 && y > 4 && y < h - 4;
        if (visible && zone !== 'exterior' && inside && occluded(p)) visible = false;
      }
      items.push({
        key: zone, x, y, visible, title: l.title, sub: l.sub, status: l.status, hot, selected: sel,
        dim: !!state.selected && !sel, compact: (!!state.selected && !sel) || (!state.selected && inside && (l.status === 'ok' || l.status === 'none')),
      });
    }
    notes.update(items, { w, h, x0, x1 });
  }
  function setLabels(labels) { state.labels = labels; requestRender(); }
  // projected extent of the visible model, 0..1 of the canvas (y down)
  function projectedExtent() {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of modelPoints(state.mode, true)) {
      v.set(p[0], p[1], p[2]).project(camera);
      const sx = v.x * 0.5 + 0.5, sy = -v.y * 0.5 + 0.5;
      x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
    }
    return { x0, x1, y0, y1 };
  }

  // ---- picking -----------------------------------------------------------------------------------------------
  const ndc = new THREE.Vector2();
  function shown(o) { for (let n = o; n; n = n.parent) if (!n.visible) return false; return true; }
  function opaque(o) { const m = Array.isArray(o.material) ? o.material[0] : o.material; return m.opacity > (o.userData.overlay ? 0.01 : 0.45); }
  function hitAt(ev) {
    const b = state.building;
    if (!b) return null;
    const r = el.getBoundingClientRect();
    ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    raycaster.far = Infinity;
    const targets = b.pickables.concat(state.tiles ? [state.tiles] : []);
    const hits = raycaster.intersectObjects(targets, true).filter((h) => h.object.userData.zone && shown(h.object) && opaque(h.object));
    if (!hits.length) return null;
    // in the cutaway, anything inside wins over the walls behind it
    return state.p > 0.5 ? hits.find((h) => h.object.userData.zone !== 'exterior') ?? hits[0] : hits[0];
  }
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
    // stay centred: re-fit if the reader hasn't moved away from the default framing
    if (state.building && state.home && state.atHome) frameHome(false, 'both');
    requestRender();
  });
  ro.observe(canvasWrap);

  // ---- mode transitions ----------------------------------------------------------------------------------------
  function setMode(mode) {
    if (mode === state.mode) return;
    const prev = state.mode;
    state.mode = mode;
    const rm = reducedMotion();
    const pTo = mode === 'exterior' ? 0 : 1, eTo = mode === 'exploded' ? 1 : 0;
    if (state.p !== pTo) {
      const from = state.p;
      tween('reveal', from, pTo, (x) => { state.p = x; }, rm ? 0 : REVEAL_MS * Math.abs(pTo - from));
    }
    if (state.e !== eTo) {
      const from = state.e;
      tween('explode', from, eTo, (x) => { state.e = x; }, rm ? 0 : EXPLODE_MS * Math.abs(eTo - from) + (prev === 'exterior' ? 250 : 0));
    }
    // frame the destination: bounds after the roof lift and floor separation, computed before animating
    if (state.selected && state.selected !== 'exterior' && mode !== 'exterior') focusZoneLater(); else frameHome(true, state.atHome ? 'none' : 'azimuth');
  }
  // focus after the levels have moved, so the camera aims at where the zone ends up
  function focusZoneLater() {
    const zone = state.selected;
    const ms = reducedMotion() ? 0 : Math.max(REVEAL_MS, EXPLODE_MS) * 0.6;
    setTimeout(() => { if (!state.disposed && state.selected === zone) focusZone(zone); }, ms);
  }

  return {
    setBuilding,
    setRecords,
    setStatuses(s) { state.statuses = { ...s }; kit.applyPalette(state.palette, state.statuses); requestRender(); },
    setLabels,
    setSelected(zone) {
      if (zone === state.selected) return;
      state.selected = zone;
      requestRender();
      if (state.mode !== 'exterior' || zone === 'exterior' || !zone) focusZone(zone);
    },
    setMode,
    // the camera follows the separation so the whole exploded model stays in frame, keeping its angle
    setSeparation(v, { reframe = false } = {}) {
      state.sep = clamp01(v);
      requestRender();
      if (state.mode !== 'exploded' || !state.building) return;
      if (state.selected) { if (reframe) focusZone(state.selected); return; }
      if (state.atHome || reframe) frameHome(true, 'both', 320);
    },
    focus(zone) { focusZone(zone ?? state.selected); },
    reset() { frameHome(true, 'none'); },
    rotate(deg) {
      const s = currentSpherical();
      state.atHome = false;
      moveTo(controls.target.clone(), s.radius, s.theta + THREE.MathUtils.degToRad(deg), s.phi, 450);
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
