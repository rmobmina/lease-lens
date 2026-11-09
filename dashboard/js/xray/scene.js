// Building X-Ray: Three.js scene lifecycle. Lazy-loaded by sections/xray.js when the view opens.
//
// Renders on demand only: a frame is drawn after input, a state change, during a transition or while
// orbit damping settles. Nothing runs while the model is idle.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildBuilding, buildRecordTiles } from './building.js';

const FOV = 30;
const DUR = 450;
const ZONES = ['exterior', 'shared', 'systems', 'records', 'grounds'];

export function createXrayScene(container, { onSelect, onHover, onContextLost, palette, reducedMotion }) {
  const canvasWrap = document.createElement('div');
  canvasWrap.className = 'xr-canvas';
  const labelLayer = document.createElement('div');
  labelLayer.className = 'xr-labels';
  labelLayer.setAttribute('aria-hidden', 'true');
  const chip = document.createElement('div');
  chip.className = 'xr-hoverchip';
  chip.hidden = true;
  chip.setAttribute('aria-hidden', 'true');
  container.append(canvasWrap, labelLayer, chip);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0x000000, 0);
  canvasWrap.append(renderer.domElement);
  renderer.domElement.setAttribute('aria-hidden', 'true');
  const el = renderer.domElement;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;
  scene.environment = envTex;
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.5, 5000);

  // soft sky fill + one sun, shadow frustum fitted to each building
  const hemi = new THREE.HemisphereLight(0xffffff, 0xd9d3c7, 0.9);
  const sun = new THREE.DirectionalLight(0xfff6ea, 2.1);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0008;
  sun.shadow.normalBias = 0.12;
  sun.shadow.radius = 4;
  scene.add(hemi, sun, sun.target);

  // ---- materials (shared across buildings; one per zone + kind so a zone can be styled alone) ----------
  const hatch = makeHatch(0.35);
  const hatchCoarse = makeHatch(0.08);   // approximate shell: stripes a few metres apart, readable from afar
  const materials = new Map();
  const lineMats = new Map();
  const KIND = {
    wall: { roughness: 0.82 }, approx: { roughness: 0.85 }, roof: { roughness: 0.9 }, slab: { roughness: 0.9 }, dark: { roughness: 0.6 },
    window: { roughness: 0.12, metalness: 0.1, envMapIntensity: 1.2 }, glass: { roughness: 0.1, transparent: true, opacity: 0.45, envMapIntensity: 1.2 },
    paint: { roughness: 0.6 }, context: { roughness: 0.95 }, ground: { roughness: 1 }, tint: { roughness: 0.55, transparent: true, opacity: 0.6 },
  };
  function mat(zone, kind) {
    const k = `${zone}|${kind}`;
    if (!materials.has(k)) {
      const m = new THREE.MeshStandardMaterial({ envMapIntensity: 0.35, ...KIND[kind] });
      m.userData = { zone, kind, base: m.opacity };
      materials.set(k, m);
    }
    return materials.get(k);
  }
  const lineFor = (zone) => {
    if (!lineMats.has(zone)) lineMats.set(zone, new THREE.LineBasicMaterial({ transparent: true, opacity: 0.5 }));
    return lineMats.get(zone);
  };
  const tileMat = (it) => {
    const k = `records|tile-${it.cls}`;
    if (!materials.has(k)) {
      const m = new THREE.MeshStandardMaterial({ roughness: 0.6 });
      m.userData = { zone: 'records', kind: 'tile', cls: it.cls, base: 1 };
      materials.set(k, m);
    }
    return materials.get(k);
  };

  const ground = new THREE.Mesh(new THREE.CircleGeometry(1, 96), mat(null, 'ground'));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.02;
  ground.receiveShadow = true;
  scene.add(ground);

  const controls = new OrbitControls(camera, el);
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.rotateSpeed = 0.6;
  controls.zoomSpeed = 0.8;
  controls.panSpeed = 0.6;
  controls.screenSpacePanning = true;
  controls.minPolarAngle = THREE.MathUtils.degToRad(12);  // not straight down
  controls.maxPolarAngle = THREE.MathUtils.degToRad(84);  // not under the ground
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };

  const state = { mode: 'exterior', hover: null, selected: null, statuses: {}, labels: {}, palette, disposed: false, building: null, tiles: null, edges: [], home: null };

  // ---- building ------------------------------------------------------------------------------------------
  function setBuilding(entry) {
    clearBuilding();
    const approx = entry.provenance === 'approximate' || !entry.masses?.length;
    const b = buildBuilding(THREE, mergeGeometries, entry, (zone, kind) => mat(zone, approx && zone === 'exterior' && kind === 'wall' ? 'approx' : kind));
    state.building = b;
    scene.add(b.root);
    b.root.traverse((o) => {
      if (o.isMesh && !o.isInstancedMesh && o.userData.edges) addEdges(o, o.userData.context ? 'context' : o.userData.zone, o.userData.edges);
    });
    b.interior.visible = state.mode === 'xray';
    // ground + sun sized to the building
    const R = b.bounds.sphere.radius;
    const span = Math.max(180, R * 5);
    ground.scale.setScalar(span);
    const c = b.bounds.sphere.center;
    sun.target.position.set(c.x, 0, c.z);
    sun.position.set(c.x - R * 1.4, Math.max(R * 2.2, b.H * 1.5), c.z + R * 1.7);
    const S = Math.max(R * 1.7, 50);
    Object.assign(sun.shadow.camera, { left: -S, right: S, top: S, bottom: -S, near: 1, far: R * 8 + b.H * 4 });
    sun.shadow.camera.updateProjectionMatrix();
    camera.far = span * 6;
    camera.updateProjectionMatrix();
    applyAppearance(true);
    frameHome(!!state.home);
  }
  function addEdges(o, zone, angle) {
    const l = new THREE.LineSegments(new THREE.EdgesGeometry(o.geometry, angle), lineFor(zone));
    l.raycast = () => {};
    o.add(l);
    state.edges.push(l);
  }
  function clearBuilding() {
    clearTiles();
    if (!state.building) return;
    scene.remove(state.building.root);
    state.edges.forEach((l) => l.geometry.dispose());
    state.edges = [];
    state.building.dispose();
    state.building = null;
  }
  function clearTiles() {
    if (!state.tiles) return;
    state.tiles.parent?.remove(state.tiles);
    state.tiles.traverse((o) => { if (o.isLineSegments) { o.geometry.dispose(); state.edges = state.edges.filter((e) => e !== o); } });
    state.tiles.userData.dispose();
    state.tiles = null;
  }
  // items: [{ col, cls }] for the inspection shown (cls = rating class), empty when the system had none
  function setRecords(items) {
    if (!state.building) return;
    clearTiles();
    const list = items.length ? items : [{ col: 'none', cls: 'none' }];
    state.tiles = buildRecordTiles(THREE, state.building.records, list, tileMat, mat('records', 'tint'));
    state.building.zones.records.add(state.tiles);
    state.tiles.traverse((o) => { if (o.isMesh && o.userData.edges) addEdges(o, 'records', 30); });
    applyAppearance(true);
  }

  // ---- camera framing ---------------------------------------------------------------------------------------
  function viewDistance(radius) {
    const v = THREE.MathUtils.degToRad(camera.fov);
    const h = 2 * Math.atan(Math.tan(v / 2) * camera.aspect);
    return radius / Math.sin(Math.min(v, h) / 2);
  }
  function homeView() {
    const b = state.building;
    const sph = b.bounds.sphere;
    const xray = state.mode === 'xray';
    const target = sph.center.clone();
    if (xray) target.y = Math.max((b.H - 3.4) / 2, sph.center.y - 2);
    const r = Math.max(18, sph.radius) * (xray ? 1.06 : 1);  // small buildings keep some street context
    const dist = viewDistance(r) * (xray ? 0.88 : 0.95);
    // three-quarter view onto the long façade and an end wall, from the sunlit south side, roof visible
    const a = b.bounds.axis;
    const u = new THREE.Vector3(Math.cos(a), 0, -Math.sin(a));
    const n = new THREE.Vector3(-Math.sin(a), 0, -Math.cos(a));
    if (n.z < 0) n.negate();
    const dir = n.clone().add(u.clone().multiplyScalar(0.75 * (u.x * n.z - u.z * n.x >= 0 ? 1 : -1))).normalize();
    const tall = b.H > sph.radius * 1.2;
    return { target, dist, azimuth: Math.atan2(dir.x, dir.z), polar: THREE.MathUtils.degToRad(tall ? 70 : 60), r };
  }
  function frameHome(animate = true) {
    if (!state.building) return;
    const h = homeView();
    state.home = h;
    controls.minDistance = Math.max(4, h.r * 0.25);
    controls.maxDistance = h.dist * 2.6;
    moveTo(h.target, h.dist, h.azimuth, h.polar, animate);
  }
  function moveTo(target, dist, azimuth, polar, animate = true) {
    const s = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
    const fresh = s.radius < 1e-3;
    const t0 = controls.target.clone(), d0 = fresh ? dist : s.radius;
    const a0 = fresh ? (azimuth ?? 0) : s.theta, p0 = fresh ? (polar ?? 1) : s.phi;
    const az = azimuth ?? a0, po = polar ?? p0;
    let da = az - a0;
    da = Math.atan2(Math.sin(da), Math.cos(da));
    const apply = (k) => {
      controls.target.lerpVectors(t0, target, k);
      camera.position.setFromSpherical(new THREE.Spherical(d0 + (dist - d0) * k, p0 + (po - p0) * k, a0 + da * k)).add(controls.target);
      camera.lookAt(controls.target);
    };
    tween(0, 1, apply, animate && !fresh && !reducedMotion() ? 650 : 0);
  }
  function focusZone(zone) {
    const b = state.building;
    if (!b) return;
    if (!zone) return frameHome();
    const g = zone === 'records' && state.tiles ? state.tiles : b.zones[zone];
    const box = new THREE.Box3().setFromObject(g);
    if (box.isEmpty()) return;
    const sph = box.getBoundingSphere(new THREE.Sphere());
    const dist = THREE.MathUtils.clamp(viewDistance(Math.max(sph.radius, 10)) * 1.25, controls.minDistance * 1.1, controls.maxDistance);
    moveTo(sph.center, dist, null, null);
  }
  // keep panning near the building
  controls.addEventListener('change', () => {
    if (state.home) {
      const c = state.home.target, lim = state.home.r * 0.9, t = controls.target;
      const off = t.clone().sub(c);
      if (off.length() > lim) { off.setLength(lim); t.copy(c).add(off); }
      t.y = THREE.MathUtils.clamp(t.y, -4, (state.building?.H ?? 30) + 4);
    }
    requestRender();
  });

  // ---- appearance -------------------------------------------------------------------------------------------
  function applyAppearance(instant = false) {
    const P = state.palette;
    for (const m of materials.values()) {
      const { zone, kind } = m.userData;
      if (kind === 'tint') m.color.set(P.status[state.statuses[zone] ?? 'none']);
      else if (kind === 'tile') m.color.set(P.rating[m.userData.cls] ?? P.status.none);
      else if (kind === 'approx') m.color.set(P.mat.wall);
      else m.color.set(P.mat[kind] ?? P.mat.wall);
      const hatched = (kind === 'tint' && (state.statuses[zone] ?? 'none') === 'none') || kind === 'approx' || (kind === 'tile' && m.userData.cls === 'none');
      const map = hatched ? (kind === 'approx' ? hatchCoarse : hatch) : null;
      if (m.map !== map) { m.map = map; m.needsUpdate = true; }
      m.emissive.set(P.accent);
      m.emissiveIntensity = zone && zone === state.selected ? 0.1 : zone && zone === state.hover ? 0.07 : 0;
    }
    for (const [zone, lm] of lineMats) {
      const hot = zone === state.hover || zone === state.selected;
      // the façade outline carries the exterior status as a subtle accent; other outlines are neutral
      lm.color.set(hot ? P.accent : zone === 'context' ? P.contextEdge : zone === 'exterior' ? P.statusEdge[state.statuses.exterior ?? 'none'] : P.edge);
    }
    hemi.groundColor.set(P.ground);
    animateOpacity(instant);
  }
  function opacityOf(m) {
    const { zone, kind, base } = m.userData;
    const x = state.mode === 'xray', sel = state.selected;
    if (kind === 'ground') return x ? 0.6 : 1;
    if (kind === 'context') return x ? 0.3 : 1;
    if (zone === 'exterior') {
      if (!x) return base;
      if (sel === 'exterior') return kind === 'window' || kind === 'glass' ? 0.25 : 0.42;
      return kind === 'window' || kind === 'glass' ? 0 : 0.08;
    }
    if (!x) return 0;                              // interior hidden outside X-Ray
    if (zone === 'shared' && kind === 'slab') return sel === 'shared' ? 0.55 : sel ? 0.1 : 0.32; // see-through floor plates
    if (sel && zone !== sel) return kind === 'tint' ? 0.1 : 0.14;
    if (kind === 'tint') return sel === zone ? 0.82 : 0.4;   // tints stay translucent; only the selected category is emphasised
    return base;
  }
  function lineOpacity(zone) {
    const x = state.mode === 'xray', sel = state.selected;
    if (zone === 'context') return x ? 0.1 : 0.3;
    if (zone === 'exterior') return x ? (sel === 'exterior' ? 0.95 : 0.4) : 0.7;
    if (!x) return 0;
    if (sel && zone !== sel) return 0.1;
    return sel === zone ? 1 : 0.5;
  }
  let hideTimer = 0;
  function animateOpacity(instant) {
    const ms = instant || reducedMotion() ? 0 : DUR;
    clearTimeout(hideTimer);
    if (state.mode === 'xray' && state.building) state.building.interior.visible = true;
    for (const m of materials.values()) {
      const to = opacityOf(m), from = m.opacity;
      if (Math.abs(to - from) < 1e-3) { settle(m, to); continue; }
      if (!m.transparent) { m.transparent = true; m.needsUpdate = true; }
      m.depthWrite = to > 0.5;
      tween(from, to, (val) => { m.opacity = val; if (val === to) settle(m, to); }, ms);
    }
    for (const [zone, lm] of lineMats) tween(lm.opacity, lineOpacity(zone), (val) => (lm.opacity = val), ms);
    state.building?.zones.exterior.traverse((o) => { if (o.isMesh) o.castShadow = state.mode !== 'xray'; });
    if (state.mode !== 'xray' && state.building) {
      const hide = () => { if (state.mode !== 'xray' && state.building) state.building.interior.visible = false; requestRender(); };
      if (ms) hideTimer = setTimeout(hide, ms + 30); else hide();
    }
    requestRender();
  }
  function settle(m, to) {
    const k = m.userData.kind;
    if (to >= 0.999 && k !== 'glass' && k !== 'tint' && m.transparent) { m.transparent = false; m.depthWrite = true; m.needsUpdate = true; }
  }

  // ---- tweens + render on demand ----------------------------------------------------------------------------------
  const tweens = new Set();
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  function tween(from, to, apply, ms) {
    if (!ms) { apply(to); requestRender(); return; }
    tweens.add({ start: performance.now(), from, to, apply, ms });
    requestRender();
  }
  let frame = 0;
  function requestRender() { if (!frame && !state.disposed) frame = requestAnimationFrame(renderFrame); }
  function renderFrame(now) {
    frame = 0;
    for (const t of [...tweens]) {
      const k = Math.min(1, (now - t.start) / t.ms);
      t.apply(k >= 1 ? t.to : t.from + (t.to - t.from) * ease(k));
      if (k >= 1) tweens.delete(t);
    }
    const damping = tweens.size ? false : controls.update();
    renderer.render(scene, camera);
    placeLabels();
    if (tweens.size || damping) requestRender();
  }

  // ---- labels ------------------------------------------------------------------------------------------------------
  const labelEls = {};
  for (const zone of ZONES) {
    const lab = document.createElement('div');
    lab.className = 'xr-label';
    lab.dataset.zone = zone;
    lab.innerHTML = '<span class="xr-label-in"><span class="xr-label-dot"></span><span class="xr-label-line"></span><span class="xr-label-box"><b></b><small></small></span></span>';
    const hit = lab.firstChild;
    hit.addEventListener('click', () => onSelect(zone === state.selected ? null : zone));
    hit.addEventListener('pointerenter', () => setHover(zone));
    hit.addEventListener('pointerleave', () => setHover(null));
    labelLayer.append(lab);
    labelEls[zone] = lab;
  }
  const v = new THREE.Vector3();
  function placeLabels() {
    const b = state.building;
    const w = canvasWrap.clientWidth, h = canvasWrap.clientHeight;
    const cx = b ? (v.copy(b.bounds.sphere.center).project(camera).x * 0.5 + 0.5) * w : w / 2;
    for (const [zone, lab] of Object.entries(labelEls)) {
      const show = !!b && (state.mode === 'xray' || zone === 'exterior');
      if (!show) { lab.hidden = true; continue; }
      v.copy(b.anchors[zone]).project(camera);
      const x = (v.x * 0.5 + 0.5) * w, y = (-v.y * 0.5 + 0.5) * h;
      lab.hidden = v.z > 1 || x < -40 || x > w + 40 || y < -20 || y > h + 20;
      lab.classList.toggle('is-left', x < cx);
      lab.classList.toggle('is-hot', zone === state.hover || zone === state.selected);
      lab.classList.toggle('is-dim', !!state.selected && zone !== state.selected);
      lab.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    }
  }
  function setLabels(labels) {
    state.labels = labels;
    for (const [zone, lab] of Object.entries(labelEls)) {
      const l = labels[zone];
      if (!l) continue;
      lab.querySelector('b').textContent = l.title;
      lab.querySelector('small').textContent = l.sub;
      lab.dataset.status = l.status;
    }
    requestRender();
  }

  // ---- picking -----------------------------------------------------------------------------------------------------
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  function hitAt(ev) {
    if (!state.building) return null;
    const r = el.getBoundingClientRect();
    ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const targets = state.mode === 'xray' ? [state.building.zones.exterior, state.building.interior] : [state.building.zones.exterior];
    const hits = raycaster.intersectObjects(targets, true).filter((h) => h.object.userData.zone);
    if (!hits.length) return null;
    // In X-Ray mode the ghosted façade only wins when nothing inside it was hit.
    return state.mode === 'xray' ? hits.find((h) => h.object.userData.zone !== 'exterior') ?? hits[0] : hits[0];
  }
  function setHover(zone, ev) {
    if (zone !== state.hover) {
      state.hover = zone;
      el.style.cursor = zone ? 'pointer' : '';
      applyAppearance(true);
      onHover?.(zone);
    }
    const l = zone && state.labels[zone];
    chip.hidden = !l || !ev;
    if (l && ev) {
      const r = container.getBoundingClientRect();
      chip.innerHTML = `<b>${l.name}</b><span>${l.summary}</span>`;
      chip.style.transform = `translate(${Math.round(ev.clientX - r.left + 14)}px, ${Math.round(ev.clientY - r.top + 16)}px)`;
    }
  }
  let down = null, moveFrame = 0, lastMove = null, clickTimer = 0;
  const onDown = (ev) => { down = { x: ev.clientX, y: ev.clientY }; };
  const onUp = (ev) => {
    if (!down) return;
    const moved = Math.hypot(ev.clientX - down.x, ev.clientY - down.y);
    down = null;
    if (moved >= 5) return;
    // wait briefly so a double-click (focus) doesn't also toggle the selection
    clearTimeout(clickTimer);
    const h = hitAt(ev);
    clickTimer = setTimeout(() => { const z = h?.object.userData.zone ?? null; onSelect(z && z === state.selected ? null : z); }, 230);
  };
  const onDbl = (ev) => {
    clearTimeout(clickTimer);
    const h = hitAt(ev);
    if (!h) return;
    const dist = Math.max(controls.minDistance, camera.position.distanceTo(controls.target) * 0.6);
    moveTo(h.point, dist, null, null);
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

  // ---- size follows the viewer container (ResizeObserver), not the window -------------------------------------------
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
    // keep the reader's view, but re-fit if they haven't moved away from the default framing
    if (state.building && state.home && !state.selected && controls.target.distanceTo(state.home.target) < 0.5) frameHome(false);
    requestRender();
  });
  ro.observe(canvasWrap);

  function makeHatch(rep) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, 64, 64);
    g.strokeStyle = 'rgba(0,0,0,0.2)';
    g.lineWidth = 5;
    for (let i = -64; i < 128; i += 16) { g.beginPath(); g.moveTo(i, 64); g.lineTo(i + 64, 0); g.stroke(); }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(rep, rep);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  return {
    setBuilding,
    setRecords,
    setStatuses(s) { state.statuses = { ...s }; applyAppearance(true); },
    setLabels,
    setSelected(zone) {
      if (zone === state.selected) return;
      state.selected = zone;
      applyAppearance();
      focusZone(zone);
    },
    setMode(mode) {
      if (mode === state.mode) return;
      state.mode = mode;
      applyAppearance();
      if (state.selected) focusZone(state.selected); else frameHome();
    },
    reset() { frameHome(); },
    rotate(deg) {
      const s = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
      moveTo(controls.target.clone(), s.radius, s.theta + THREE.MathUtils.degToRad(deg), s.phi);
    },
    setPalette(p) { state.palette = p; applyAppearance(true); },
    hover: (z) => setHover(z),
    render: requestRender,
    dispose() {
      state.disposed = true;
      cancelAnimationFrame(frame);
      cancelAnimationFrame(moveFrame);
      clearTimeout(clickTimer);
      clearTimeout(hideTimer);
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
      for (const m of materials.values()) m.dispose();
      for (const m of lineMats.values()) m.dispose();
      hatch.dispose();
      hatchCoarse.dispose();
      envTex.dispose();
      pmrem.dispose();
      sun.shadow.map?.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvasWrap.remove();
      labelLayer.remove();
      chip.remove();
    },
  };
}
