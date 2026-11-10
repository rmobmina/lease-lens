"""Build the ward boundaries for the Explore map (dashboard/data/wards/toronto-wards.json).

Source: City of Toronto Open Data, "City Wards" (25-ward model, December 2018), WGS84 GeoJSON:
  https://open.toronto.ca/dataset/city-wards/
  file: City Wards Data - 4326.geojson  -> data/raw/wards/city-wards-data-4326.geojson
Open Government Licence - Toronto.

What this does, and nothing else:
  * keeps the ward code (AREA_SHORT_CODE, "01".."25", the same code as the WARD column of the
    RentSafeTO files) and the ward name;
  * simplifies each ring with Douglas-Peucker at TOL_M metres (shapes stay recognisable at city and
    neighbourhood zoom; the outline can move by up to TOL_M);
  * rounds coordinates to 5 decimals (about 1 m).
No boundary is moved, merged or invented.

Usage: python3 scripts/build_wards.py
"""
import json
import math
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'data', 'raw', 'wards', 'city-wards-data-4326.geojson')
OUT = os.path.join(ROOT, 'dashboard', 'data', 'wards', 'toronto-wards.json')
TOL_M = 12.0
LAT0 = 43.7  # local scale for metres <-> degrees (Toronto)
KX = 111320 * math.cos(math.radians(LAT0))
KY = 110540


def seg_dist(p, a, b):
    ax, ay = a[0] * KX, a[1] * KY
    bx, by = b[0] * KX, b[1] * KY
    px, py = p[0] * KX, p[1] * KY
    dx, dy = bx - ax, by - ay
    L = dx * dx + dy * dy
    t = 0 if L == 0 else max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / L))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def simplify(pts, tol):
    """Iterative Douglas-Peucker on an open polyline."""
    if len(pts) < 3:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        i, j = stack.pop()
        best, k = 0, -1
        for m in range(i + 1, j):
            d = seg_dist(pts[m], pts[i], pts[j])
            if d > best:
                best, k = d, m
        if best > tol and k > 0:
            keep[k] = True
            stack += [(i, k), (k, j)]
    return [p for p, f in zip(pts, keep) if f]


def ring(r):
    closed = r[0] == r[-1]
    body = r[:-1] if closed else r
    # split the closed ring at its farthest point so both halves simplify well
    far = max(range(len(body)), key=lambda i: (body[i][0] - body[0][0]) ** 2 + (body[i][1] - body[0][1]) ** 2)
    a = simplify(body[:far + 1], TOL_M)
    b = simplify(body[far:] + [body[0]], TOL_M)
    out = a + b[1:]
    out = [[round(x, 5), round(y, 5)] for x, y in out]
    return out if len(out) >= 4 else [[round(x, 5), round(y, 5)] for x, y in r]


def main():
    src = json.load(open(SRC))
    feats = []
    before = after = 0
    for f in src['features']:
        p = f['properties']
        g = f['geometry']
        polys = g['coordinates'] if g['type'] == 'MultiPolygon' else [g['coordinates']]
        out = []
        for poly in polys:
            rings = []
            for r in poly:
                before += len(r)
                s = ring(r)
                after += len(s)
                rings.append(s)
            out.append(rings)
        feats.append({
            'type': 'Feature',
            'properties': {'ward': p['AREA_SHORT_CODE'], 'name': p['AREA_NAME']},
            'geometry': {'type': 'MultiPolygon', 'coordinates': out},
        })
    feats.sort(key=lambda f: f['properties']['ward'])
    assert len(feats) == 25, 'expected the 25-ward model'
    fc = {
        'type': 'FeatureCollection',
        'source': 'City of Toronto Open Data, City Wards (25-ward model, December 2018). Open Government Licence - Toronto.',
        'simplified_m': TOL_M,
        'features': feats,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w') as fh:
        json.dump(fc, fh, separators=(',', ':'))
    print('%d wards, %d -> %d vertices, %d KB' % (len(feats), before, after, os.path.getsize(OUT) // 1024))


if __name__ == '__main__':
    main()
