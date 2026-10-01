// Loads both RentSafeTO CSVs and normalizes them into one list of evaluation records.
// Every transformation here is documented in explorer/DATA_NOTES.md and in the "Data notes" tab.
// No record is dropped: anomalies are kept and tagged in `flags`.

const ERA = {
  pre: { key: 'pre', label: 'Pre-2023', file: '../data/apartment_building_evaluations_pre_2023.csv', scaleMin: 1, scaleMax: 5 },
  cur: { key: 'cur', label: '2023–current', file: '../data/apartment_building_evaluations_2023_current.csv', scaleMin: 0, scaleMax: 3 },
};

// Column mapping. Pre-2023 uses UNDERSCORE_NAMES, 2023-current uses "SPACED NAMES".
const COLS = {
  pre: {
    rsn: 'RSN', yearRegistered: 'YEAR_REGISTERED', yearEvaluatedRaw: 'YEAR_EVALUATED', yearBuilt: 'YEAR_BUILT',
    propertyType: 'PROPERTY_TYPE', ward: 'WARD', wardName: 'WARDNAME', address: 'SITE_ADDRESS',
    storeys: 'CONFIRMED_STOREYS', units: 'CONFIRMED_UNITS', date: 'EVALUATION_COMPLETED_ON', score: 'SCORE',
    nAreas: 'NO_OF_AREAS_EVALUATED', grid: 'GRID', lat: 'LATITUDE', lon: 'LONGITUDE', x: 'X', y: 'Y',
    resultsOfScore: 'RESULTS_OF_SCORE',
  },
  cur: {
    rsn: 'RSN', yearRegistered: 'YEAR REGISTERED', yearEvaluatedRaw: 'YEAR EVALUATED', yearBuilt: 'YEAR BUILT',
    propertyType: 'PROPERTY TYPE', ward: 'WARD', wardName: 'WARDNAME', address: 'SITE ADDRESS',
    storeys: 'CONFIRMED STOREYS', units: 'CONFIRMED UNITS', date: 'EVALUATION COMPLETED ON', score: 'CURRENT BUILDING EVAL SCORE',
    nAreas: 'NO OF AREAS EVALUATED', grid: 'GRID', lat: 'LATITUDE', lon: 'LONGITUDE', x: 'X', y: 'Y',
    proactive: 'PROACTIVE BUILDING SCORE', reactive: 'CURRENT REACTIVE SCORE',
  },
};

// Inspection categories = the contiguous block of rating columns in each file.
const CATEGORY_RANGE = {
  pre: ['ENTRANCE_LOBBY', 'OTHER_FACILITIES'],
  cur: ['NUMBERING OF PROPERTY', 'TENANT SERVICE REQUEST LOG'],
};

function num(v) {
  if (v == null) return null;
  const t = String(v).trim();
  if (t === '' || t.toUpperCase() === 'N/A') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function prettyCat(name) {
  return name.replace(/_/g, ' ').toLowerCase()
    .replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .replace(/\bInt\b/g, 'Int.').replace(/\bExt\b/g, 'Ext.')
    .replace(/Int\.\./g, 'Int.').replace(/Ext\.\./g, 'Ext.');
}

function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Least-squares affine fit lat/lon ~ a*X + b*Y + c, from rows that have both.
// Used ONLY to fill in coordinates for rows with X/Y but no LATITUDE/LONGITUDE.
function fitAffine(rows) {
  const pts = rows.filter((r) => r.latGiven != null && r.lonGiven != null && r.x != null && r.y != null && r.x > 1000);
  const solve = (target) => {
    // normal equations for [x, y, 1]
    let m = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], v = [0, 0, 0];
    const x0 = 312000, y0 = 4840000; // centre for numeric stability
    for (const p of pts) {
      const f = [p.x - x0, p.y - y0, 1];
      for (let i = 0; i < 3; i++) { v[i] += f[i] * p[target]; for (let j = 0; j < 3; j++) m[i][j] += f[i] * f[j]; }
    }
    // Gaussian elimination
    for (let i = 0; i < 3; i++) {
      for (let k = i + 1; k < 3; k++) {
        const r = m[k][i] / m[i][i];
        for (let j = i; j < 3; j++) m[k][j] -= r * m[i][j];
        v[k] -= r * v[i];
      }
    }
    const c = [0, 0, 0];
    for (let i = 2; i >= 0; i--) {
      let s = v[i];
      for (let j = i + 1; j < 3; j++) s -= m[i][j] * c[j];
      c[i] = s / m[i][i];
    }
    return (x, y) => c[0] * (x - x0) + c[1] * (y - y0) + c[2];
  };
  return { lat: solve('latGiven'), lon: solve('lonGiven'), n: pts.length };
}

function normalize(era, raw, columns) {
  const C = COLS[era];
  const [c0, c1] = CATEGORY_RANGE[era];
  const cats = columns.slice(columns.indexOf(c0), columns.indexOf(c1) + 1);
  return {
    cats,
    records: raw.map((r, i) => {
      const addrRaw = (r[C.address] || '').trim();
      const ratings = {}, naCats = [], blankCats = [];
      for (const c of cats) {
        const t = (r[c] ?? '').trim();
        if (t === '') { ratings[c] = null; blankCats.push(c); }
        else if (t.toUpperCase() === 'N/A') { ratings[c] = null; naCats.push(c); }
        else ratings[c] = num(t);
      }
      const date = (r[C.date] || '').trim();
      const yb = num(r[C.yearBuilt]);
      const yearEval = date ? +date.slice(0, 4) : null;
      const rec = {
        uid: `${era}-${(r._id || i).toString().trim()}`,
        era,
        rowId: r._id,
        rsn: (r[C.rsn] || '').trim(),
        addressRaw: addrRaw,
        address: addrRaw.replace(/^\*\*\s*CREATED IN ERROR\s*\*\*\s*/i, '').replace(/--CLOSED$/i, '').trim(),
        yearRegistered: num(r[C.yearRegistered]),
        yearEvaluatedRaw: (r[C.yearEvaluatedRaw] || '').trim(),
        yearEvaluated: yearEval,
        yearBuilt: yb,
        age: yb != null && yearEval != null ? yearEval - yb : null,
        decade: yb != null ? Math.floor(yb / 10) * 10 : null,
        propertyType: (r[C.propertyType] || '').trim() || null,
        ward: (r[C.ward] || '').trim() ? String(+r[C.ward]).padStart(2, '0') : null,
        wardName: (r[C.wardName] || '').trim() || null,
        storeys: num(r[C.storeys]),
        units: num(r[C.units]),
        date,
        time: date ? new Date(date + 'T12:00:00').getTime() : null,
        score: num(r[C.score]),
        proactive: C.proactive ? num(r[C.proactive]) : null,
        reactive: C.reactive ? num(r[C.reactive]) : null,
        resultsOfScore: C.resultsOfScore ? (r[C.resultsOfScore] || '').trim() : null,
        nAreas: num(r[C.nAreas]),
        grid: (r[C.grid] || '').trim(),
        latGiven: num(r[C.lat]),
        lonGiven: num(r[C.lon]),
        x: num(r[C.x]),
        y: num(r[C.y]),
        ratings,
        naCats,
        blankCats,
        flags: [],
        raw: r,
      };
      if (/CREATED IN ERROR/i.test(addrRaw)) rec.flags.push('created-in-error');
      if (/--CLOSED/i.test(addrRaw)) rec.flags.push('closed');
      if (blankCats.length === cats.length) rec.flags.push('no-ratings');
      if (yb == null) rec.flags.push('year-built-missing');
      if (rec.yearEvaluatedRaw && +rec.yearEvaluatedRaw !== yearEval) rec.flags.push('year-evaluated-mismatch');
      if (era === 'cur' && rec.proactive != null && rec.reactive != null && rec.proactive + rec.reactive !== rec.score)
        rec.flags.push('score-not-proactive+reactive');
      return rec;
    }),
  };
}

async function loadAll(onProgress) {
  const out = { records: [], cats: {}, profile: {} };
  for (const era of ['pre', 'cur']) {
    onProgress?.(`Loading ${ERA[era].label}…`);
    const text = await d3.text(ERA[era].file);
    const raw = d3.csvParse(text);
    const { cats, records } = normalize(era, raw, raw.columns);
    out.cats[era] = cats;
    out.profile[era] = { columns: raw.columns, rows: raw.length };
    out.records.push(...records);
  }

  // Duplicate RSN + date within a file
  const seen = d3.group(out.records, (r) => `${r.era}|${r.rsn}|${r.date}`);
  for (const g of seen.values()) if (g.length > 1) g.forEach((r) => r.flags.push('duplicate-rsn-date'));

  // Coordinates: given lat/lon, else derived from X/Y by affine fit, else missing.
  const fit = fitAffine(out.records);
  out.coordFitN = fit.n;
  for (const r of out.records) {
    if (r.latGiven != null && r.lonGiven != null) { r.lat = r.latGiven; r.lon = r.lonGiven; r.coordSource = 'given'; }
    else if (r.x != null && r.y != null && r.x > 1000) {
      r.lat = fit.lat(r.x, r.y); r.lon = fit.lon(r.x, r.y); r.coordSource = 'derived-from-XY';
      r.flags.push('coords-derived');
    } else { r.lat = null; r.lon = null; r.coordSource = 'missing'; r.flags.push('coords-missing'); }
  }

  // Score percentile within era (lets the two methodologies share one colour scale).
  for (const era of ['pre', 'cur']) {
    const rs = out.records.filter((r) => r.era === era && r.score != null);
    const sorted = rs.map((r) => r.score).sort((a, b) => a - b);
    for (const r of rs) r.scorePctInEra = (d3.bisectRight(sorted, r.score) / sorted.length) * 100;
  }

  // Evaluation sequence per building (by RSN) across both files.
  out.byRsn = d3.group(out.records, (r) => r.rsn);
  for (const [, evs] of out.byRsn) {
    evs.sort((a, b) => a.time - b.time);
    evs.forEach((r, i) => { r.evalIndex = i + 1; r.evalCount = evs.length; });
  }

  // Category metadata
  out.catList = [];
  for (const era of ['pre', 'cur'])
    for (const c of out.cats[era])
      out.catList.push({ key: `${era}:${c}`, era, col: c, label: prettyCat(c) });
  out.catByKey = new Map(out.catList.map((c) => [c.key, c]));
  return out;
}

window.LL = Object.assign(window.LL || {}, { ERA, COLS, loadAll, median, prettyCat });
