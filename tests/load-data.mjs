// Loads the real RentSafeTO CSVs through the SAME loader the website uses (explorer/js/data.js),
// so the tests check exactly the records the pages draw. No demo data.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
import * as d3 from 'd3';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let cache;
export async function loadData() {
  if (cache) return cache;
  globalThis.window = globalThis;
  // explorer/js/data.js asks for '../data/<file>.csv' relative to the page; resolve it from dashboard/.
  globalThis.d3 = { ...d3, text: (file) => readFile(path.resolve(root, 'dashboard', file), 'utf8') };
  vm.runInThisContext(await readFile(path.join(root, 'explorer/js/data.js'), 'utf8'), { filename: 'explorer/js/data.js' });
  cache = await globalThis.LL.loadAll();
  return cache;
}

// The raw CSV rows, parsed independently of the app's loader, for cross-checking.
export async function rawRows(era) {
  const file = era === 'cur' ? 'apartment_building_evaluations_2023_current.csv' : 'apartment_building_evaluations_pre_2023.csv';
  return d3.csvParse(await readFile(path.join(root, 'data', file), 'utf8'));
}
