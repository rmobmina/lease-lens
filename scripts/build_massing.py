"""Build per-building 3D massing for the Building X-Ray.

Source  City of Toronto Open Data, "3D Massing" (2025 shapefile), Open Government Licence – Toronto.
        https://open.toronto.ca/dataset/3d-massing/
Input   data/raw/massing_2025/3DMassingShapefile_2025_WGS84.{shp,shx,dbf}   (download: see docs/building-xray.md)
        data/apartment_building_evaluations_*.csv                            (RentSafeTO)
Output  dashboard/data/massing/<shard>.json   per-building geometry, provenance and match details
        dashboard/data/massing/index.json     summary counts
        docs/massing-matches.csv              one row per building, for review

Run     python3 scripts/build_massing.py        (standard library only, about a minute)

Matching rules (documented in docs/building-xray.md):
  1. Address point  = the latest RentSafeTO evaluation's LATITUDE/LONGITUDE.
  2. Seeds          = every massing polygon that contains the point. If none, the nearest polygon within
                      NEAR_M metres, unless another substantial polygon is almost as close (ambiguous).
  3. Rooftop parts  = polygons with MIN_HEIGHT > 0 (penthouses) resting on a seed are added.
  4. Height check   = tallest roof / registered storeys must be 2.3–4.8 m per storey, or fit with one
                      storey below grade (then medium confidence). If the seeds are too low
                      (e.g. the point is in a podium), connected parts are added and the check repeated.
  5. Anything that fails is NOT assigned: the building gets an approximate generic model, labelled as such.
"""
import csv
import json
import math
import os
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(__file__))
from massing_lib import (lonlat_to_merc, read_dbf, read_shx, record_bbox, read_polygon, group_rings,
                         ring_area, point_in_poly, ring_dist, simplify)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'data/raw/massing_2025/3DMassingShapefile_2025_WGS84')
OUT = os.path.join(ROOT, 'dashboard/data/massing')
SHARDS = 64
NEAR_M = 15          # max distance from the address point to an unmatched footprint
AMBIG_M = 4          # a second substantial footprint this much farther is "too close to call"
CONTEXT_M = 110      # neighbouring buildings drawn for context
PER_STOREY = (2.3, 4.8)
EST_STOREY_M = 3.0   # storey height used when a height must be estimated
CELL = 150           # spatial index cell (mercator metres)


def latest_buildings():
    """One row per RSN: the latest evaluation in either file, with coordinates and storeys."""
    files = [('cur', 'apartment_building_evaluations_2023_current.csv', 'SITE ADDRESS', 'EVALUATION COMPLETED ON', 'CONFIRMED STOREYS', 'CONFIRMED UNITS'),
             ('pre', 'apartment_building_evaluations_pre_2023.csv', 'SITE_ADDRESS', 'EVALUATION_COMPLETED_ON', 'CONFIRMED_STOREYS', 'CONFIRMED_UNITS')]
    rows = []
    for era, fn, a, d, s, u in files:
        for r in csv.DictReader(open(os.path.join(ROOT, 'data', fn), encoding='utf-8')):
            rows.append({'rsn': r['RSN'].strip(), 'address': r[a].strip(), 'date': r[d].strip(),
                         'storeys': num(r[s]), 'units': num(r[u]),
                         'lat': num(r['LATITUDE']), 'lon': num(r['LONGITUDE']), 'x': num(r['X']), 'y': num(r['Y'])})
    fit = affine_fit([r for r in rows if r['lat'] and r['lon'] and r['x'] and r['x'] > 1000])
    out = {}
    for r in sorted(rows, key=lambda r: r['date']):
        if not r['rsn'] or 'CREATED IN ERROR' in r['address'].upper():
            continue
        if not (r['lat'] and r['lon']) and r['x'] and r['x'] > 1000:
            r['lat'], r['lon'], r['coords'] = fit(r['x'], r['y']) + ('derived-from-XY',)
        else:
            r['coords'] = 'given' if r['lat'] else 'missing'
        prev = out.get(r['rsn'])
        # keep the latest row, but don't lose coordinates or storeys a later row left blank
        if prev:
            for k in ('lat', 'lon', 'storeys', 'units'):
                if r[k] is None:
                    r[k] = prev[k]
            if r['coords'] == 'missing' and prev['coords'] != 'missing':
                r['coords'] = prev['coords']
        out[r['rsn']] = r
    return list(out.values())


def num(v):
    try:
        v = float(str(v).strip())
        return v if math.isfinite(v) else None
    except (TypeError, ValueError):
        return None


def affine_fit(pts):
    """Least squares lat/lon ~ a*X + b*Y + c (same approach as explorer/js/data.js)."""
    x0, y0 = 312000, 4840000

    def solve(key):
        m = [[0.0] * 3 for _ in range(3)]
        v = [0.0] * 3
        for p in pts:
            f = (p['x'] - x0, p['y'] - y0, 1)
            for i in range(3):
                v[i] += f[i] * p[key]
                for j in range(3):
                    m[i][j] += f[i] * f[j]
        for i in range(3):
            for k in range(i + 1, 3):
                r = m[k][i] / m[i][i]
                for j in range(i, 3):
                    m[k][j] -= r * m[i][j]
                v[k] -= r * v[i]
        c = [0.0] * 3
        for i in (2, 1, 0):
            c[i] = (v[i] - sum(m[i][j] * c[j] for j in range(i + 1, 3))) / m[i][i]
        return lambda x, y: c[0] * (x - x0) + c[1] * (y - y0) + c[2]

    la, lo = solve('lat'), solve('lon')
    return lambda x, y: (la(x, y), lo(x, y))


class Massing:
    def __init__(self):
        self.shx = read_shx(SRC + '.shx')
        self.attrs = list(read_dbf(SRC + '.dbf'))
        self.shp = open(SRC + '.shp', 'rb')
        self.grid = defaultdict(list)
        self.bbox = {}
        for i, (off, _) in enumerate(self.shx):
            bb = record_bbox(self.shp, off)
            if not bb:
                continue
            self.bbox[i] = bb
            for cx in range(int(bb[0] // CELL), int(bb[2] // CELL) + 1):
                for cy in range(int(bb[1] // CELL), int(bb[3] // CELL) + 1):
                    self.grid[(cx, cy)].append(i)
        self.cache = {}

    def near(self, x, y, r):
        ids = set()
        for cx in range(int((x - r) // CELL), int((x + r) // CELL) + 1):
            for cy in range(int((y - r) // CELL), int((y + r) // CELL) + 1):
                ids.update(self.grid.get((cx, cy), ()))
        return [i for i in ids if not (self.bbox[i][2] < x - r or self.bbox[i][0] > x + r or self.bbox[i][3] < y - r or self.bbox[i][1] > y + r)]

    def polys(self, i):
        if i not in self.cache:
            self.cache[i] = group_rings(read_polygon(self.shp, self.shx[i][0]))
        return self.cache[i]

    def part(self, i):
        a = self.attrs[i]
        avg, mx, mn = a['AVG_HEIGHT'] or 0, a['MAX_HEIGHT'] or 0, a['MIN_HEIGHT'] or 0
        top = avg if avg > 0 else mx
        return {'id': i, 'base': mn if mn > 0.5 else 0.0, 'top': top, 'max': mx, 'hsrc': a['HEIGHT_SRC'], 'bsrc': a['BLDG_SRC']}


def build():
    M = Massing()
    print(f'{len(M.bbox):,} massing records indexed')
    os.makedirs(OUT, exist_ok=True)
    shards = defaultdict(dict)
    report = []
    for b in latest_buildings():
        entry = match(M, b)
        shards[int(b['rsn']) % SHARDS][b['rsn']] = entry
        m = entry['match']
        report.append([b['rsn'], b['address'], entry['provenance'], m.get('confidence', ''), m.get('method', ''),
                       m.get('distance_m', ''), b['storeys'] or '', entry.get('height_m', ''), len(entry.get('masses', [])), m.get('note', '')])
    for s, d in shards.items():
        with open(os.path.join(OUT, f'{s}.json'), 'w') as f:
            json.dump(d, f, separators=(',', ':'))
    counts = defaultdict(int)
    for r in report:
        counts[r[2]] += 1
        counts[f'{r[2]}:{r[3]}'] += 1
    with open(os.path.join(OUT, 'index.json'), 'w') as f:
        json.dump({'source': 'City of Toronto Open Data, 3D Massing (2025), Open Government Licence – Toronto',
                   'url': 'https://open.toronto.ca/dataset/3d-massing/', 'shards': SHARDS, 'buildings': len(report), 'counts': counts}, f, indent=1)
    with open(os.path.join(ROOT, 'docs/massing-matches.csv'), 'w', newline='') as f:
        w = csv.writer(f)
        w.writerow(['rsn', 'address', 'provenance', 'confidence', 'method', 'distance_m', 'storeys', 'height_m', 'masses', 'note'])
        w.writerows(sorted(report, key=lambda r: r[0]))
    print(json.dumps(counts, indent=1))


def match(M, b):
    base = {'rsn': b['rsn'], 'storeys': b['storeys'], 'units': b['units']}
    if b['lat'] is None:
        return {**base, 'provenance': 'unavailable', 'match': {'note': 'No coordinates in the RentSafeTO record'}}
    px, py = lonlat_to_merc(b['lon'], b['lat'])
    k = math.cos(math.radians(b['lat']))  # mercator metres -> ground metres
    cand = []
    for i in M.near(px, py, (NEAR_M + 60) / k):
        for poly in M.polys(i):
            inside = point_in_poly((px, py), poly)
            d = 0.0 if inside else ring_dist((px, py), poly[0]) * k
            part = M.part(i)
            if part['base'] > 0 and part['top'] < part['base'] + 0.5:
                part['top'] = max(part['top'], part['max'])
                if part['top'] < part['base'] + 0.5:
                    continue  # raised part with no usable height: skip rather than invent one
            cand.append({'i': i, 'poly': poly, 'd': d, 'area': -ring_area(poly[0]) * k * k, **part})

    def substantial(c):
        return c['area'] >= 60 and c['top'] >= 4 and c['base'] == 0

    seeds = [c for c in cand if c['d'] == 0 and c['base'] == 0]
    method, note = 'contains', ''
    if not seeds:
        near = sorted([c for c in cand if c['d'] <= NEAR_M and substantial(c)], key=lambda c: c['d'])
        if not near:
            return approximate(base, b, 'No building footprint within %d m of the address point' % NEAR_M)
        rivals = [c for c in near[1:] if c['d'] - near[0]['d'] < AMBIG_M and not touching(near[0], c, k)]
        if rivals:
            # two candidates almost equally close: let the registered height decide, or give up
            ok = [c for c in [near[0]] + rivals if height_ok(c['top'], b['storeys'])]
            if len(ok) != 1:
                return approximate(base, b, 'Two or more footprints are about equally close to the address point', ambiguous=True)
            near = ok
            note = 'nearest footprints were close; chosen by registered height'
        seeds, method = [near[0]], 'nearest'

    masses = seeds[:]
    ids = {c['i'] for c in masses}

    def add_rooftop():
        for c in cand:
            if c['i'] not in ids and c['base'] > 0 and any(point_in_poly(c['poly'][0][0], s['poly']) or touching(s, c, k) for s in masses):
                masses.append(c)
                ids.add(c['i'])

    add_rooftop()
    top = max(c['top'] for c in masses)
    merged = False
    if b['storeys'] and top / b['storeys'] < PER_STOREY[0]:
        # point probably sits in a podium or a wing: grow through connected parts (bounded) and re-check
        frontier = list(masses)
        while frontier and len(masses) < 16:
            s = frontier.pop()
            for c in cand:
                if c['i'] not in ids and c['base'] == 0 and touching(s, c, k):
                    masses.append(c)
                    ids.add(c['i'])
                    frontier.append(c)
        add_rooftop()
        top = max(c['top'] for c in masses)
        merged = len(masses) > len(seeds)
    consistent = height_ok(top, b['storeys'])
    if b['storeys'] and not consistent:
        return approximate(base, b, 'Footprint found, but its height (%.1f m) does not fit %d registered storeys' % (top, b['storeys']), candidate_m=round(top, 1))
    if top <= 0:
        provenance = 'footprint'
    else:
        provenance = 'massing'
    conf = 'high' if method == 'contains' and not merged and strict_height(top, b['storeys']) else 'medium'
    if b['storeys'] and not strict_height(top, b['storeys']):
        note = (note + '; ' if note else '') + 'height fits only if one registered storey is below grade'
    if merged:
        note = (note + '; ' if note else '') + 'connected parts merged to reach the registered height'
    if not b['storeys']:
        note = (note + '; ' if note else '') + 'no registered storeys to check height against'

    # local frame: metres east (x) and north (y) of the building's centre
    cx = sum(c['poly'][0][j][0] for c in seeds for j in range(len(c['poly'][0]))) / sum(len(c['poly'][0]) for c in seeds)
    cy = sum(c['poly'][0][j][1] for c in seeds for j in range(len(c['poly'][0]))) / sum(len(c['poly'][0]) for c in seeds)
    loc = lambda p: [round((p[0] - cx) * k, 2), round((p[1] - cy) * k, 2)]

    def rings(poly, tol):
        out = []
        for r in [poly[0]] + poly[1]:
            r = simplify(r, tol / k)
            out.append([v for p in r for v in loc(p)])
        return out

    est = EST_STOREY_M * (b['storeys'] or 3)
    entry = {**base, 'provenance': provenance,
             'height_m': round(top if top > 0 else est, 1),
             'point': loc((px, py)),
             'masses': [{'rings': rings(c['poly'], 0.15), 'base': round(c['base'], 1),
                         'top': round(c['top'] if c['top'] > 0 else est, 1), 'roof': c['base'] > 0,
                         'hsrc': c['hsrc'], 'bsrc': c['bsrc']} for c in masses],
             'match': {'method': method, 'confidence': conf, 'distance_m': round(min(c['d'] for c in seeds), 1),
                       'parts': len(masses), 'height_per_storey': round(top / b['storeys'], 2) if b['storeys'] and top > 0 else None,
                       'note': note}}
    entry['context'] = context(M, cx, cy, k, ids, loc)
    return entry


def context(M, cx, cy, k, skip, loc):
    out = []
    for i in M.near(cx, cy, CONTEXT_M / k):
        if i in skip:
            continue
        p = M.part(i)
        if p['top'] < 2.5:
            continue
        for poly in M.polys(i):
            a = -ring_area(poly[0]) * k * k
            if a < 12:
                continue
            r = simplify(poly[0], 0.6 / k)
            pts = [loc(q) for q in r]
            if min(math.hypot(*q) for q in pts) > CONTEXT_M:
                continue
            out.append({'r': [round(v, 1) for q in pts for v in q], 'b': round(p['base'], 1), 't': round(p['top'], 1)})
    return out


def touching(a, b, k, tol=0.6):
    ra, rb = a['poly'][0], b['poly'][0]
    ba = [min(p[0] for p in ra), min(p[1] for p in ra), max(p[0] for p in ra), max(p[1] for p in ra)]
    bb = [min(p[0] for p in rb), min(p[1] for p in rb), max(p[0] for p in rb), max(p[1] for p in rb)]
    t = tol / k
    if ba[2] + t < bb[0] or bb[2] + t < ba[0] or ba[3] + t < bb[1] or bb[3] + t < ba[1]:
        return False
    return any(ring_dist(p, rb) <= t for p in ra) or any(ring_dist(p, ra) <= t for p in rb)


def height_ok(top, storeys):
    """Strict fit, or a fit if one registered storey is partly below grade (RentSafeTO counts can include it)."""
    if not storeys:
        return top > 0
    return strict_height(top, storeys) or (storeys >= 2 and PER_STOREY[0] * (storeys - 1) <= top <= PER_STOREY[1] * storeys)


def strict_height(top, storeys):
    return bool(storeys) and PER_STOREY[0] <= top / storeys <= PER_STOREY[1]


def approximate(base, b, why, ambiguous=False, candidate_m=None):
    s = b['storeys'] or 3
    return {**base, 'provenance': 'approximate', 'height_m': round(EST_STOREY_M * s, 1),
            'match': {'note': why, 'ambiguous': ambiguous, 'candidate_height_m': candidate_m}}


if __name__ == '__main__':
    build()
