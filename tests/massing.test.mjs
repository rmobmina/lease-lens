// Checks the preprocessed building geometry (dashboard/data/massing, built by scripts/build_massing.py).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'dashboard/data/massing');
const index = JSON.parse(readFileSync(path.join(dir, 'index.json'), 'utf8'));
const all = {};
for (const f of readdirSync(dir).filter((f) => /^\d+\.json$/.test(f))) {
  const shard = +f.split('.')[0];
  for (const [rsn, e] of Object.entries(JSON.parse(readFileSync(path.join(dir, f), 'utf8')))) {
    assert.equal(+rsn % index.shards, shard, `${rsn} is in the wrong shard`);
    all[rsn] = e;
  }
}
const PROV = new Set(['massing', 'footprint', 'approximate', 'unavailable']);

test('every building in the index has an entry with a known provenance', () => {
  assert.equal(Object.keys(all).length, index.buildings);
  for (const e of Object.values(all)) assert.ok(PROV.has(e.provenance), e.rsn);
});

test('matched buildings carry real rings, heights and match details; others carry none', () => {
  for (const e of Object.values(all)) {
    if (e.provenance === 'massing' || e.provenance === 'footprint') {
      assert.ok(e.masses.length >= 1, e.rsn);
      assert.ok(['high', 'medium'].includes(e.match.confidence), e.rsn);
      assert.ok(['contains', 'nearest'].includes(e.match.method), e.rsn);
      for (const m of e.masses) {
        for (const r of m.rings) assert.ok(r.length >= 6 && r.length % 2 === 0, e.rsn);
        assert.ok(m.top > m.base, `${e.rsn}: top must be above base`);
      }
    } else {
      assert.equal(e.masses, undefined, `${e.rsn}: approximate entries must not carry geometry`);
      assert.ok(e.match.note, e.rsn);
    }
  }
});

test('assigned heights fit the registered storeys (no silent mismatches)', () => {
  for (const e of Object.values(all)) {
    if (e.provenance !== 'massing' || !e.storeys) continue;
    const per = e.height_m / e.storeys, perBelow = e.storeys > 1 ? e.height_m / (e.storeys - 1) : per;
    const ok = (per >= 2.3 && per <= 4.8) || (per <= 4.8 && perBelow >= 2.3);
    assert.ok(ok, `${e.rsn}: ${e.height_m} m for ${e.storeys} storeys`);
    if (e.match.confidence === 'high') assert.ok(per >= 2.3 && per <= 4.8, `${e.rsn}: high confidence needs a strict fit`);
  }
});

test('named test buildings match their own footprint', () => {
  const cases = { 4153170: '711 Bloor St W', 4152650: '1765 Victoria Park Ave', 4575691: '25 Selby St (51 storeys)', 4152711: '875 Kennedy Rd' };
  for (const [rsn, name] of Object.entries(cases)) {
    const e = all[rsn];
    assert.equal(e.provenance, 'massing', name);
    assert.equal(e.match.method, 'contains', name);
    assert.equal(e.match.confidence, 'high', name);
  }
  assert.ok(all[4575691].height_m > 150, 'Selby St tower height comes from AVG_HEIGHT when MAX_HEIGHT is 0');
  assert.ok(all[4152650].masses.length >= 2, 'Victoria Park keeps its separate building parts');
});
