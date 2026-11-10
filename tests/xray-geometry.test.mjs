// Pure geometry and layout helpers of the 3D Building X-Ray (no Three.js, no DOM).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { wallEdges, innerFrame, pointInPoly, bucketOf, area, corners, storeyLayout, syntheticMass } from '../dashboard/js/xray/footprint.js';
import { layoutLabels } from '../dashboard/js/xray/annotations.js';

const square = [[0, 0, 10, 0, 10, 10, 0, 10]];                 // CCW
const squareCW = [[0, 0, 0, 10, 10, 10, 10, 0]];               // CW, as the shapefile stores outer rings
const courtyard = [[0, 0, 30, 0, 30, 30, 0, 30], [10, 10, 10, 20, 20, 20, 20, 10]];

test('wall normals point out of the solid whatever the ring orientation, and into a courtyard', () => {
  for (const rings of [square, squareCW, courtyard]) {
    for (const e of wallEdges(rings)) {
      const out = [e.mx + e.nx * 0.5, e.my + e.ny * 0.5], inn = [e.mx - e.nx * 0.5, e.my - e.ny * 0.5];
      assert.equal(pointInPoly(...out, rings), false, 'outside point should be outside the solid');
      assert.equal(pointInPoly(...inn, rings), true, 'inside point should be in the solid');
    }
  }
});

test('orientation buckets are 45° bins', () => {
  assert.equal(bucketOf(1, 0), 0);
  assert.equal(bucketOf(0, 1), 2);
  assert.equal(bucketOf(-1, 0), 4);
  assert.equal(bucketOf(0, -1), 6);
  assert.equal(bucketOf(Math.SQRT1_2, -Math.SQRT1_2), 7);
});

test('the illustrative layout frame stays inside irregular real footprints', () => {
  const L = [[0, 0, 40, 0, 40, 10, 10, 10, 10, 40, 0, 40]];     // L-shape
  const shard = JSON.parse(readFileSync(new URL('../dashboard/data/massing/' + (4228864 % 64) + '.json', import.meta.url)));
  const bayview = shard['4228864'].masses.find((m) => !m.roof).rings;   // 164-vertex footprint with a courtyard
  for (const rings of [square, squareCW, courtyard, L, bayview]) {
    const F = innerFrame(rings);
    if (!F.fitted) continue;
    for (const [i, j] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 0]]) {
      assert.ok(pointInPoly(F.cx + (F.ux * F.A * i + F.vx * F.B * j), F.cy + (F.uy * F.A * i + F.vy * F.B * j), rings));
    }
    assert.ok(F.A >= F.B);
  }
});

test('silhouette corners skip straight runs', () => {
  const withMid = [0, 0, 5, 0, 10, 0, 10, 10, 0, 10];          // a redundant vertex at (5, 0)
  assert.equal(corners(withMid).length, 4);
  assert.ok(area(withMid) > 0);
});

test('storey height comes from the sourced height and the registered storeys', () => {
  const m = syntheticMass({ storeys: 10, units: 80, height_m: 30 });
  const S = storeyLayout({ storeys: 10 }, [m]);
  assert.equal(S.storeys, 10);
  assert.ok(Math.abs(S.fh - 3) < 1e-9);
  assert.equal(S.topLevel(m), 10);
});

test('labels never overlap and stay inside the canvas', () => {
  const box = { w: 700, h: 400, x0: 250, x1: 450 };
  const items = Array.from({ length: 5 }, (_, i) => ({ key: `z${i}`, x: 340 + (i % 2) * 20, y: 190 + i * 4, w: 140, h: 36 }));
  const pos = layoutLabels(items, box);
  const rects = items.map((it) => ({ ...pos.get(it.key), w: it.w, h: it.h }));
  for (const r of rects) {
    assert.ok(r.lx >= 0 && r.lx + r.w <= box.w && r.ly >= 0 && r.ly + r.h <= box.h, 'inside the canvas');
    assert.ok(r.side === 'left' ? r.lx + r.w <= box.x0 : r.lx >= box.x1, 'beside the model, not on it');
  }
  for (let a = 0; a < rects.length; a++) for (let b = a + 1; b < rects.length; b++) {
    const A = rects[a], B = rects[b];
    const overlap = A.lx < B.lx + B.w && B.lx < A.lx + A.w && A.ly < B.ly + B.h && B.ly < A.ly + A.h;
    assert.equal(overlap, false, `labels ${a} and ${b} overlap`);
  }
});

// ---- camera fitting and wings ---------------------------------------------------------------------
import { fitView, projectAll } from '../dashboard/js/xray/framing.js';
import { wingFrames } from '../dashboard/js/xray/footprint.js';

const boxPts = (w, d, y0, y1, cx = 0, cz = 0) => {
  const p = [];
  for (const x of [cx - w / 2, cx + w / 2]) for (const y of [y0, y1]) for (const z of [cz - d / 2, cz + d / 2]) p.push([x, y, z]);
  return p;
};

test('the fitted camera keeps every model point inside the safe area, tightly, for any shape and canvas', () => {
  const shapes = { tall: boxPts(18, 13, 0, 124), wide: boxPts(390, 280, 0, 12), low: boxPts(27, 23, -3.5, 7), exploded: boxPts(25, 19, -3.5, 60, 40, -30) };
  const insets = { l: 0.2, r: 0.2, t: 0.1, b: 0.09 };
  for (const [name, pts] of Object.entries(shapes)) {
    for (const aspect of [0.46, 1, 1.45, 2.4]) {
      for (const [theta, phi] of [[0.6, 1.0], [-2.2, 1.15], [3.0, 0.9]]) {
        const fit = fitView(pts, { theta, phi, fov: 30, aspect, insets });
        const s = projectAll(pts, { position: fit.position, theta, phi, fov: 30, aspect });
        const eps = 1e-6;
        for (const [x, y, z] of s) {
          assert.ok(z > 0, `${name}: point behind the camera`);
          assert.ok(x >= insets.l - eps && x <= 1 - insets.r + eps && y >= insets.t - eps && y <= 1 - insets.b + eps, `${name} @${aspect}: point outside the safe area`);
        }
        // tight: the model touches the safe area on at least one axis (it is not just pushed far away)
        const xs = s.map((p) => p[0]), ys = s.map((p) => p[1]);
        const touchX = Math.abs(Math.min(...xs) - insets.l) < 1e-4 && Math.abs(Math.max(...xs) - (1 - insets.r)) < 1e-4;
        const touchY = Math.abs(Math.min(...ys) - insets.t) < 1e-4 && Math.abs(Math.max(...ys) - (1 - insets.b)) < 1e-4;
        assert.ok(touchX || touchY, `${name} @${aspect}: not tight`);
        assert.ok(fit.distance > 0);
      }
    }
  }
});

test('an L-shaped footprint gets two wings, each inside the outline and not overlapping', () => {
  const L = [[0, 0, 60, 0, 60, 15, 15, 15, 15, 45, 0, 45]];
  const wings = wingFrames(L);
  assert.equal(wings.length, 2);
  for (const W of wings) {
    for (const [i, j] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      assert.ok(pointInPoly(W.cx + W.ux * W.A * i + W.vx * W.B * j, W.cy + W.uy * W.A * i + W.vy * W.B * j, L));
    }
  }
  const [a, b] = wings;   // centres are far apart relative to their half-sizes along at least one axis
  assert.ok(Math.abs(a.cx - b.cx) > 5 || Math.abs(a.cy - b.cy) > 5);
  assert.equal(wingFrames([[0, 0, 40, 0, 40, 14, 0, 14]]).length, 1);
});

test('the camera is pushed out of the building along its line of sight, and left alone outside it', async () => {
  const { pushOutside } = await import('../dashboard/js/xray/framing.js');
  const sq = [[-10, -10], [10, -10], [10, 10], [-10, 10]];
  for (const hull of [sq, [...sq].reverse()]) {
    const out = pushOutside([0, 5, 0], [4, 8, 3], hull, 20, 2);          // inside → pushed to the grown wall
    assert.ok(out, 'should push');
    const k = out[0] / 4;
    assert.ok(Math.abs(out[1] - (5 + 3 * k)) < 1e-6 && Math.abs(out[2] - 3 * k) < 1e-6, 'stays on the line of sight');
    assert.ok(Math.abs(out[0] - 12.01 * 4 / Math.hypot(4, 3, 3) * (Math.hypot(4, 3, 3) / 4)) < 0.02);
    assert.equal(pushOutside([0, 5, 0], [30, 20, 30], hull, 20, 2), null, 'outside: untouched');
    assert.equal(pushOutside([0, 5, 0], [1, 40, 1], hull, 20, 2), null, 'above the roof: untouched');
    const top = pushOutside([0, 5, 0], [0.5, 15, 0.5], hull, 20, 2);       // steep view: exits through the roof
    assert.ok(top && Math.abs(top[1] - 22.01 * 1) < 0.05);
  }
});
