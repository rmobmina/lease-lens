// Homepage hero: a thin-line architectural atlas of downtown Toronto, drawn on a 2D canvas.
//
// Every line comes from City of Toronto Open Data (scripts/build_hero.py builds the file):
// building footprints and heights from 3D Massing (2025), streets and shoreline from the Toronto
// Centreline, and RentSafeTO buildings from the reliable footprint matches used by the Building X-Ray.
// The only artistic choices are simplification (small footprints dropped, outlines simplified) and
// the drawing style. Nothing is traced from map imagery.
//
// Lightweight by design: no Three.js, one canvas, redrawn only while something changes (idle = no
// animation frames). The same projection draws the static SVG fallback (see build_hero.py), so the
// fallback and the canvas line up exactly when one replaces the other.

export const VIEW = {
  bearing: 17.5,   // the camera looks north-north-east, about 35° off the street grid, from over the lake
  elevation: 32,   // degrees above the horizon
};

const DATA_URL = 'data/hero/toronto-hero.json';
const DEG = Math.PI / 180;

export function project(view) {
  const b = view.bearing * DEG, e = view.elevation * DEG;
  const fx = Math.sin(b), fy = Math.cos(b);        // forward (into the screen)
  const rx = fy, ry = -fx;                         // right
  const se = Math.sin(e), ce = Math.cos(e);
  return {
    fx, fy,
    sx: (x, y) => x * rx + y * ry,
    sy: (x, y, z) => -(x * fx + y * fy) * se - z * ce,
    depth: (x, y) => x * fx + y * fy,
  };
}

// Decode the compact file into typed arrays.
export function decode(doc) {
  const nb = doc.b.length;
  let nv = 0;
  for (const b of doc.b) nv += (b.length - 2) / 2;
  const X = new Float32Array(nv), Y = new Float32Array(nv);
  const start = new Uint32Array(nb + 1), top = new Float32Array(nb), base = new Float32Array(nb);
  const cx = new Float32Array(nb), cy = new Float32Array(nb);
  let v = 0;
  doc.b.forEach((b, i) => {
    top[i] = b[0]; base[i] = b[1]; start[i] = v;
    let x = 0, y = 0, sx = 0, sy = 0;
    for (let k = 2; k < b.length; k += 2) {
      x = k === 2 ? b[k] : x + b[k]; y = k === 2 ? b[k + 1] : y + b[k + 1];
      X[v] = x; Y[v] = y; sx += x; sy += y; v++;
    }
    const n = v - start[i];
    cx[i] = sx / n; cy[i] = sy / n;
  });
  start[nb] = v;
  const line = (arr, from) => {
    const pts = [];
    let x = 0, y = 0;
    for (let k = from; k < arr.length; k += 2) {
      x = k === from ? arr[k] : x + arr[k]; y = k === from ? arr[k + 1] : y + arr[k + 1];
      pts.push(x, y);
    }
    return pts;
  };
  const rentalOf = new Int32Array(nb).fill(-1);
  doc.rent.forEach((r, j) => r.b.forEach((i) => (rentalOf[i] = j)));
  return {
    nb, X, Y, start, top, base, cx, cy, rentalOf,
    rentals: doc.rent,
    roads: doc.r.map((r) => ({ c: r[0], pts: line(r, 1) })),
    shore: doc.s.map((s) => line(s, 0)),
    labels: doc.labels,
    bbox: doc.bbox,
    frame: doc.frame,
    simplified: doc.simplified,
  };
}

const ease = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : 1 - Math.pow(1 - t, 3));

export async function mountHeroAtlas(host, { reducedMotion = false, onPick, onReady, colors } = {}) {
  const doc = await fetch(DATA_URL).then((r) => { if (!r.ok) throw new Error(`hero data ${r.status}`); return r.json(); });
  const D = decode(doc);
  const canvas = document.createElement('canvas');
  canvas.className = 'atlas-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  host.append(canvas);
  const g = canvas.getContext('2d');
  const label = document.createElement('div');
  label.className = 'atlas-label';
  label.hidden = true;
  host.append(label);

  let C = colors();
  let W = 0, H = 0, dpr = 1;
  let view = { ...VIEW };
  const target = { ...VIEW };
  let order = null, orderBearing = null;
  let t0 = null, raf = 0, hover = -1, alive = true;
  let intro = reducedMotion ? null : { ms: 1900 };
  let slow = 0; // frames over budget during the intro; on slow devices the intro is skipped

  // Depth order (far first), refreshed when the camera turns enough to matter.
  function sortOrder() {
    if (order && Math.abs(orderBearing - view.bearing) < 1.5) return;
    const P = project(view);
    const d = new Float32Array(D.nb);
    for (let i = 0; i < D.nb; i++) d[i] = P.depth(D.cx[i], D.cy[i]);
    order = Uint32Array.from({ length: D.nb }, (_, i) => i).sort((a, b) => d[b] - d[a]);
    orderBearing = view.bearing;
  }

  function size() {
    const r = host.getBoundingClientRect();
    W = Math.max(1, Math.round(r.width)); H = Math.max(1, Math.round(r.height));
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    canvas.style.width = `${W}px`; canvas.style.height = `${H}px`;
  }

  // Fit the drawn content (frame from build_hero.py) inside the box, centred: the same rule as the
  // fallback's preserveAspectRatio="xMidYMid meet", so the two land on the same pixels.
  function transform() {
    const [x0, y0, x1, y1] = D.frame;
    const s = Math.min(W / (x1 - x0), H / (y1 - y0));
    return { s, ox: W / 2 - ((x0 + x1) / 2) * s, oy: H / 2 - ((y0 + y1) / 2) * s };
  }

  const roofPath = (P, T, i, z) => {
    const a = D.start[i], b = D.start[i + 1];
    g.moveTo(T.ox + P.sx(D.X[a], D.Y[a]) * T.s, T.oy + P.sy(D.X[a], D.Y[a], z) * T.s);
    for (let k = a + 1; k < b; k++) g.lineTo(T.ox + P.sx(D.X[k], D.Y[k]) * T.s, T.oy + P.sy(D.X[k], D.Y[k], z) * T.s);
    g.closePath();
  };

  function draw(now) {
    const t = intro && t0 != null ? now - t0 : Infinity;
    const P = project(view);
    const T = transform();
    sortOrder();
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = C.bg;
    g.fillRect(0, 0, W, H);
    const pt = (x, y, z = 0) => [T.ox + P.sx(x, y) * T.s, T.oy + P.sy(x, y, z) * T.s];

    // 1. the ground: streets by class, then the shoreline
    const roadsIn = ease(t / 700);
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (const [cls, width, alpha] of [[0, 0.6, 0.55], [1, 0.8, 0.7], [2, 1.1, 0.85], [3, 1.4, 0.9]]) {
      g.beginPath();
      for (const r of D.roads) {
        if (r.c !== cls) continue;
        const p = r.pts;
        let [x, y] = pt(p[0], p[1]);
        g.moveTo(x, y);
        for (let k = 2; k < p.length; k += 2) { [x, y] = pt(p[k], p[k + 1]); g.lineTo(x, y); }
      }
      g.globalAlpha = alpha * roadsIn;
      g.strokeStyle = C.road;
      g.lineWidth = width;
      g.stroke();
    }
    g.beginPath();
    for (const p of D.shore) {
      let [x, y] = pt(p[0], p[1]);
      g.moveTo(x, y);
      for (let k = 2; k < p.length; k += 2) { [x, y] = pt(p[k], p[k + 1]); g.lineTo(x, y); }
    }
    g.globalAlpha = roadsIn;
    g.strokeStyle = C.shore;
    g.lineWidth = 1.4;
    g.stroke();
    g.globalAlpha = 1;

    // 2. buildings rise, nearest to the origin first; hidden lines removed by painting far to near
    const lx = -P.fx, ly = -P.fy; // toward the camera
    g.lineWidth = 0.55;
    for (let n = 0; n < D.nb; n++) {
      const i = order[n];
      const dist = Math.hypot(D.cx[i], D.cy[i]);
      const grow = intro ? ease((t - 350 - dist * 0.22) / 650) : 1;
      if (grow <= 0) continue;
      const z1 = D.base[i] + (D.top[i] - D.base[i]) * grow, z0 = D.base[i];
      const rental = D.rentalOf[i] >= 0;
      const lit = rental && D.rentalOf[i] === hover;
      g.beginPath();
      const a = D.start[i], b = D.start[i + 1];
      for (let k = a; k < b; k++) {
        const k2 = k + 1 < b ? k + 1 : a;
        const ex = D.X[k2] - D.X[k], ey = D.Y[k2] - D.Y[k];
        if (ey * lx - ex * ly <= 0) continue; // wall faces away (rings are counter-clockwise)
        const [ax, ay] = pt(D.X[k], D.Y[k], z0), [bx, by] = pt(D.X[k2], D.Y[k2], z0);
        const [cx2, cy2] = pt(D.X[k2], D.Y[k2], z1), [dx, dy] = pt(D.X[k], D.Y[k], z1);
        g.moveTo(ax, ay); g.lineTo(bx, by); g.lineTo(cx2, cy2); g.lineTo(dx, dy); g.closePath();
      }
      roofPath(P, T, i, z1);
      g.fillStyle = lit ? C.rentalFillHover : rental ? C.rentalFill : C.fill;
      g.fill();
      g.strokeStyle = rental ? C.rental : C.line;
      g.lineWidth = rental ? (lit ? 1.4 : 0.9) : 0.55;
      g.stroke();
    }

    // 3. labels: real street names on their own centrelines, and the lake
    const labelsIn = intro ? ease((t - 1300) / 500) : 1;
    if (labelsIn > 0) {
      g.globalAlpha = labelsIn;
      g.font = `500 11px ${C.font}`;
      g.fillStyle = C.labelInk;
      g.textBaseline = 'middle';
      const placed = [];
      for (const l of D.labels) {
        const [x, y] = pt(l.at[0], l.at[1]);
        if (x < 40 || x > W - 40 || y < 20 || y > H - 20) continue;
        if (placed.some(([px, py]) => Math.abs(px - x) < 90 && Math.abs(py - y) < 26)) continue;
        placed.push([x, y]);
        const [x2, y2] = pt(l.at[0] + l.dir[0], l.at[1] + l.dir[1]);
        let ang = Math.atan2(y2 - y, x2 - x);
        if (ang > Math.PI / 2) ang -= Math.PI; else if (ang < -Math.PI / 2) ang += Math.PI;
        g.save(); g.translate(x, y); g.rotate(ang);
        const w = g.measureText(l.name).width;
        g.fillStyle = C.bg; g.globalAlpha = 0.85 * labelsIn; g.fillRect(-w / 2 - 4, -8, w + 8, 16);
        g.fillStyle = C.labelInk; g.globalAlpha = labelsIn; g.textAlign = 'center'; g.fillText(l.name, 0, 0);
        g.restore();
      }
      g.globalAlpha = 1;
    }
    return t < intro?.ms;
  }

  // Camera: settle from a slightly turned view at the start; then follow the pointer a little.
  function step(now) {
    raf = 0;
    if (!alive) return;
    if (t0 == null) t0 = now;
    const t = intro ? now - t0 : Infinity;
    const settle = intro ? ease(t / intro.ms) : 1;
    const from = intro ? { bearing: VIEW.bearing + 9, elevation: VIEW.elevation + 10 } : VIEW;
    const goal = { bearing: from.bearing + (target.bearing - from.bearing) * settle, elevation: from.elevation + (target.elevation - from.elevation) * settle };
    view.bearing += (goal.bearing - view.bearing) * (settle < 1 ? 1 : 0.14);
    view.elevation += (goal.elevation - view.elevation) * (settle < 1 ? 1 : 0.14);
    const q = performance.now();
    const busy = draw(now);
    const ms = performance.now() - q;
    host.dataset.ms = ms.toFixed(1);
    if (intro && ms > 70 && ++slow >= 2) { intro = null; Object.assign(view, VIEW); }
    host.dataset.frames = (+(host.dataset.frames || 0) + 1);
    const moving = Math.abs(goal.bearing - view.bearing) > 0.01 || Math.abs(goal.elevation - view.elevation) > 0.01;
    if (busy || moving) raf = requestAnimationFrame(step);
    else host.dataset.idle = '1';
  }
  const kick = () => { delete host.dataset.idle; if (!raf) raf = requestAnimationFrame(step); };

  // Pointer: a gentle parallax and hover on RentSafeTO buildings (fine pointers only).
  const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
  function onMove(e) {
    const r = host.getBoundingClientRect();
    const u = (e.clientX - r.left) / r.width - 0.5, v = (e.clientY - r.top) / r.height - 0.5;
    if (!reducedMotion) { target.bearing = VIEW.bearing + u * 6; target.elevation = VIEW.elevation - v * 4; }
    const hit = pick(e.clientX - r.left, e.clientY - r.top);
    if (hit !== hover) {
      hover = hit;
      host.style.cursor = hit >= 0 && onPick ? 'pointer' : '';
      label.hidden = hit < 0;
      if (hit >= 0) label.textContent = `${D.rentals[hit].address} · RentSafeTO building`;
    }
    if (hit >= 0) { label.style.left = `${e.clientX - r.left + 14}px`; label.style.top = `${e.clientY - r.top + 14}px`; }
    kick();
  }
  function onLeave() { Object.assign(target, VIEW); hover = -1; label.hidden = true; host.style.cursor = ''; kick(); }
  function onClick(e) {
    const r = host.getBoundingClientRect();
    const hit = pick(e.clientX - r.left, e.clientY - r.top);
    if (hit >= 0 && onPick) onPick(D.rentals[hit]);
  }
  // hit-test the roofs of RentSafeTO buildings, nearest first
  function pick(mx, my) {
    if (!order) return -1;
    const P = project(view), T = transform();
    for (let n = D.nb - 1; n >= 0; n--) {
      const i = order[n];
      if (D.rentalOf[i] < 0) continue;
      const a = D.start[i], b = D.start[i + 1];
      let inside = false;
      for (let k = a, j = b - 1; k < b; j = k++) {
        const xk = T.ox + P.sx(D.X[k], D.Y[k]) * T.s, yk = T.oy + P.sy(D.X[k], D.Y[k], D.top[i]) * T.s;
        const xj = T.ox + P.sx(D.X[j], D.Y[j]) * T.s, yj = T.oy + P.sy(D.X[j], D.Y[j], D.top[i]) * T.s;
        if ((yk > my) !== (yj > my) && mx < ((xj - xk) * (my - yk)) / (yj - yk || 1e-9) + xk) inside = !inside;
      }
      if (inside) return D.rentalOf[i];
    }
    return -1;
  }
  if (fine) {
    host.addEventListener('pointermove', onMove);
    host.addEventListener('pointerleave', onLeave);
    host.addEventListener('click', onClick);
  }

  const ro = new ResizeObserver(() => { size(); kick(); });
  ro.observe(host);
  size();
  kick();
  onReady?.();

  return {
    data: D,
    restyle() { C = colors(); kick(); },
    destroy() {
      alive = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      host.removeEventListener('pointermove', onMove);
      host.removeEventListener('pointerleave', onLeave);
      host.removeEventListener('click', onClick);
      canvas.remove(); label.remove();
    },
  };
}
