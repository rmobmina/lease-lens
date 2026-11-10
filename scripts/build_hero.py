"""Build the homepage hero: a simplified wireframe atlas of downtown Toronto.

Every line in the hero comes from City of Toronto Open Data (Open Government Licence – Toronto):
  - Buildings   "3D Massing" (2025)             data/raw/massing_2025/3DMassingShapefile_2025_WGS84.*
                footprints simplified (Douglas-Peucker, SIMPLIFY_M) and heights rounded to 1 m
  - Streets     "Toronto Centreline (TCL)" v2     data/raw/centreline/centreline_v2_4326.csv
                https://open.toronto.ca/dataset/toronto-centreline-tcl/
  - Shoreline   the "Major Shoreline" features of the same Centreline file
  - Rentals     RentSafeTO buildings whose footprint was matched reliably by scripts/build_massing.py
                (provenance "massing" in dashboard/data/massing); approximate matches are left out

Nothing is traced from map imagery and nothing is invented: small footprints are dropped, shapes are
simplified, and lanes, trails and minor features are left out. That simplification is the only artistic
choice, and the page says so.

Output  dashboard/data/hero/toronto-hero.json    compact, integer metres (x east, y north of ORIGIN)
        dashboard/data/hero/toronto-hero.svg     static fallback drawn with the same projection as the page
Run     python3 scripts/build_hero.py            (standard library only; needs both raw files above)
"""
import csv
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from massing_lib import lonlat_to_merc, read_dbf, read_shx, record_bbox, read_polygon, group_rings, ring_area, simplify, point_in_ring
from build_massing import latest_buildings

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MASSING = os.path.join(ROOT, 'data/raw/massing_2025/3DMassingShapefile_2025_WGS84')
CENTRELINE = os.path.join(ROOT, 'data/raw/centreline/centreline_v2_4326.csv')
SHARDS = os.path.join(ROOT, 'dashboard/data/massing')
OUT = os.path.join(ROOT, 'dashboard/data/hero')

# Downtown Toronto, from Bathurst St to the Don River and from the Toronto Islands to Bloor St.
WEST, SOUTH, EAST, NORTH = -79.412, 43.622, -79.352, 43.672
ORIGIN = (-79.384, 43.648)          # near King St W and Bay St
MIN_AREA = 140                      # m², smaller footprints (sheds, kiosks) are dropped
MIN_HEIGHT = 4                      # m
SIMPLIFY_M = 1.6
ROADS = {'Expressway': 3, 'Major Arterial': 2, 'Minor Arterial': 1, 'Collector': 1, 'Local': 0}
LABELS = [  # real street names, placed on the street's own centreline near a chosen latitude/longitude
    ('Yonge St', 'lat', 43.6585), ('Bloor St W', 'lon', -79.395), ('Queen St W', 'lon', -79.398),
    ('Spadina Ave', 'lat', 43.652), ('Front St W', 'lon', -79.392),
]

K = math.cos(math.radians(ORIGIN[1]))           # Web Mercator metres -> ground metres
OX, OY = lonlat_to_merc(*ORIGIN)


def local_merc(x, y):
    return (round((x - OX) * K), round((y - OY) * K))


def local_ll(lon, lat):
    return local_merc(*lonlat_to_merc(lon, lat))


def in_box(lon, lat):
    return WEST <= lon <= EAST and SOUTH <= lat <= NORTH


def flat(points):
    """[(x, y), ...] -> [x0, y0, dx1, dy1, ...] (delta-encoded integers)."""
    out, px, py = [], 0, 0
    for i, (x, y) in enumerate(points):
        out += [x, y] if i == 0 else [x - px, y - py]
        px, py = x, y
    return out


def buildings():
    x0, y0 = lonlat_to_merc(WEST, SOUTH)
    x1, y1 = lonlat_to_merc(EAST, NORTH)
    shx = read_shx(MASSING + '.shx')
    shp = open(MASSING + '.shp', 'rb')
    want = {}
    for i, (off, _) in enumerate(shx):
        bb = record_bbox(shp, off)
        if bb and bb[0] > x0 and bb[2] < x1 and bb[1] > y0 and bb[3] < y1:
            want[i] = off
    out = []
    for i, a in enumerate(read_dbf(MASSING + '.dbf')):
        if i not in want:
            continue
        top = (a['AVG_HEIGHT'] or 0) or (a['MAX_HEIGHT'] or 0)
        base = a['MIN_HEIGHT'] or 0
        if top < MIN_HEIGHT:
            continue
        for outer, _holes in group_rings(read_polygon(shp, want[i])):
            area = abs(ring_area(outer)) * K * K
            if area < MIN_AREA:
                continue
            ring = simplify(outer, SIMPLIFY_M / K)
            pts = []
            for p in ring:
                q = local_merc(*p)
                if not pts or q != pts[-1]:
                    pts.append(q)
            if len(pts) > 1 and pts[0] == pts[-1]:
                pts.pop()
            if len(pts) < 3:
                continue
            if ring_area(pts) < 0:      # counter-clockwise, so outward normals are consistent
                pts.reverse()
            out.append({'pts': pts, 'top': round(top), 'base': round(base) if base > 0.5 else 0, 'area': area})
    return out


def rentals():
    """Footprints of RentSafeTO buildings that the massing build matched reliably."""
    found = []
    pts = {r['rsn']: r for r in latest_buildings()}
    for name in os.listdir(SHARDS):
        if not name[0].isdigit():
            continue
        for rsn, e in json.load(open(os.path.join(SHARDS, name))).items():
            b = pts.get(rsn)
            if e.get('provenance') != 'massing' or not b or not b.get('lat') or not in_box(b['lon'], b['lat']):
                continue
            # shard rings are metres from the building centre; the address point sits at e['point']
            ax, ay = lonlat_to_merc(b['lon'], b['lat'])
            cx, cy = ax - e['point'][0] / K_SHARD(b['lat']), ay - e['point'][1] / K_SHARD(b['lat'])
            rings = []
            for m in e['masses']:
                r = m['rings'][0]
                ring = [local_merc(cx + r[j] / K_SHARD(b['lat']), cy + r[j + 1] / K_SHARD(b['lat'])) for j in range(0, len(r), 2)]
                rings.append(ring)
            found.append({'rsn': rsn, 'address': b['address'].title(), 'rings': rings})
    return found


def K_SHARD(lat):
    # build_massing.py scales each building by the cosine of its own latitude
    return math.cos(math.radians(lat))


def streets():
    csv.field_size_limit(10 ** 9)
    roads, shore, named = [], [], {}
    for r in csv.DictReader(open(CENTRELINE, encoding='utf-8')):
        kind = r['FEATURE_CODE_DESC']
        if kind not in ROADS and kind != 'Major Shoreline':
            continue
        g = json.loads(r['geometry'])
        lines = g['coordinates'] if g['type'] == 'MultiLineString' else [g['coordinates']]
        for line in lines:
            # keep runs of points inside the box (clipped at the first point outside)
            run = []
            for lon, lat in line:
                if in_box(lon, lat):
                    run.append(local_ll(lon, lat))
                    continue
                if len(run) > 1:
                    (shore if kind == 'Major Shoreline' else roads).append((ROADS.get(kind, 0), run))
                run = []
            if len(run) > 1:
                (shore if kind == 'Major Shoreline' else roads).append((ROADS.get(kind, 0), run))
            if kind in ROADS:
                named.setdefault(r['LINEAR_NAME_FULL'], []).extend(line)
    labels = []
    for name, axis, at in LABELS:
        pts = [p for p in named.get(name, []) if in_box(*p)]
        if not pts:
            continue
        i = 1 if axis == 'lat' else 0
        best = min(pts, key=lambda p: abs(p[i] - at))
        # direction of the street near that point, for the label angle
        near = sorted(pts, key=lambda p: (p[0] - best[0]) ** 2 + (p[1] - best[1]) ** 2)[:12]
        a, b = local_ll(*min(near, key=lambda p: p[i])), local_ll(*max(near, key=lambda p: p[i]))
        labels.append({'name': name, 'at': local_ll(*best), 'dir': [b[0] - a[0], b[1] - a[1]]})
    return roads, shore, labels


def main():
    bl = buildings()
    rent = rentals()
    # a massing footprint belongs to a rental if its first vertex-centroid falls inside the rental's matched footprint
    tagged = set()
    rent_out = []
    for k, r in enumerate(rent):
        hits = []
        for j, b in enumerate(bl):
            cx = sum(p[0] for p in b['pts']) / len(b['pts'])
            cy = sum(p[1] for p in b['pts']) / len(b['pts'])
            if any(point_in_ring((cx, cy), ring) for ring in r['rings']):
                hits.append(j)
        if hits:
            tagged.update(hits)
            rent_out.append({'rsn': r['rsn'], 'address': r['address'], 'b': hits})
    roads, shore, labels = streets()
    xs = [p[0] for b in bl for p in b['pts']]
    ys = [p[1] for b in bl for p in b['pts']]
    doc = {
        'v': 1,
        'origin': ORIGIN,
        'bbox': [local_ll(WEST, SOUTH), local_ll(EAST, NORTH)],
        'extent': [min(xs), min(ys), max(xs), max(ys)],
        'sources': ['City of Toronto, 3D Massing (2025)', 'City of Toronto, Toronto Centreline (TCL)',
                    'City of Toronto, Apartment Building Evaluations (RentSafeTO)'],
        'simplified': f'Footprints under {MIN_AREA} m² and buildings under {MIN_HEIGHT} m dropped; outlines simplified to {SIMPLIFY_M} m; heights rounded to 1 m; laneways, trails and minor features left out.',
        # buildings: [top, base, x0, y0, dx, dy, ...]
        'b': [[b['top'], b['base']] + flat(b['pts']) for b in bl],
        # streets: [class, x0, y0, dx, dy, ...]   class 3 expressway, 2 major arterial, 1 minor/collector, 0 local
        'r': [[c] + flat(pts) for c, pts in roads],
        's': [flat(pts) for _, pts in shore],
        'rent': rent_out,
        'labels': labels,
    }
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, 'toronto-hero.json')
    with open(path, 'w') as f:
        json.dump(doc, f, separators=(',', ':'))
    doc['frame'] = content_frame(doc)
    with open(path, 'w') as f:
        json.dump(doc, f, separators=(',', ':'))
    svg = fallback_svg(doc)
    with open(os.path.join(OUT, 'toronto-hero.svg'), 'w') as f:
        f.write(svg)
    print(f'{len(bl):,} buildings ({len(tagged)} parts of {len(rent_out)} RentSafeTO buildings), {len(roads):,} street lines, '
          f'{len(shore)} shoreline lines, {len(labels)} labels -> {os.path.getsize(path) / 1024:.0f} KB')


# Same view and frame as dashboard/js/home/hero-atlas.js (VIEW, project, sceneFrame): keep them in sync.
BEARING, ELEVATION = 17.5, 32
FALLBACK_MIN_TOP = 70
FRAME_ASPECT = 1.3      # width : height of the framed drawing   # the fallback draws streets, the shoreline and only the taller buildings


def content_frame(doc, margin=0.03):
    """Projected box [x0, y0, x1, y1] around what is actually drawn (building walls and roofs, streets, shoreline)
    for the default view. The page and the fallback both fit this box, so they land on the same pixels."""
    b, e = math.radians(BEARING), math.radians(ELEVATION)
    fx, fy = math.sin(b), math.cos(b)
    sx = lambda x, y: x * fy - y * fx
    sy = lambda x, y, z=0: -(x * fx + y * fy) * math.sin(e) - z * math.cos(e)
    xs, ys = [], []

    def walk(a):
        x = y = 0
        for k in range(0, len(a), 2):
            x, y = (a[k], a[k + 1]) if k == 0 else (x + a[k], y + a[k + 1])
            yield x, y
    for bld in doc['b']:
        for x, y in walk(bld[2:]):
            xs.append(sx(x, y)); ys.append(sy(x, y, 0)); ys.append(sy(x, y, bld[0]))
    for line in [r[1:] for r in doc['r']] + doc['s']:
        for x, y in walk(line):
            xs.append(sx(x, y)); ys.append(sy(x, y))
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    # the hero panel is about 1.3 : 1, so trim the far east and west edges evenly rather than shrink the city
    w = min(x1 - x0, (y1 - y0) * FRAME_ASPECT)
    cx = (x0 + x1) / 2
    x0, x1 = cx - w / 2, cx + w / 2
    mx, my = (x1 - x0) * margin, (y1 - y0) * margin
    return [round(x0 - mx), round(y0 - my), round(x1 + mx), round(y1 + my)]


def fallback_svg(doc):
    b, e = math.radians(BEARING), math.radians(ELEVATION)
    fx, fy = math.sin(b), math.cos(b)
    rx, ry = fy, -fx
    se, ce = math.sin(e), math.cos(e)
    sx = lambda x, y: x * rx + y * ry
    sy = lambda x, y, z=0: -(x * fx + y * fy) * se - z * ce
    fx0, fy0, fx1, fy1 = doc['frame']

    def unflat(a):
        pts, x, y = [], 0, 0
        for k in range(0, len(a), 2):
            x, y = (a[k], a[k + 1]) if k == 0 else (x + a[k], y + a[k + 1])
            pts.append((x, y))
        return pts

    P = lambda x, y, z=0: f'{sx(x, y):.0f},{sy(x, y, z):.0f}'
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{fx0:.0f} {fy0:.0f} {fx1 - fx0:.0f} {fy1 - fy0:.0f}" '
           f'preserveAspectRatio="xMidYMid meet" fill="none" stroke="#29458F" stroke-linejoin="round" stroke-linecap="round">',
           '<title>Downtown Toronto, simplified from City of Toronto 3D Massing and Centreline data</title>']
    for cls, w, a in [(2, 2.2, 0.5), (3, 3, 0.6)]:
        d = ''.join('M' + 'L'.join(P(x, y) for x, y in unflat(r[1:])) for r in doc['r'] if r[0] == cls)
        out.append(f'<path d="{d}" stroke-width="{w}" stroke-opacity="{a}" vector-effect="non-scaling-stroke"/>')
    d = ''.join('M' + 'L'.join(P(x, y) for x, y in unflat(s)) for s in doc['s'])
    out.append(f'<path d="{d}" stroke-width="1.4" vector-effect="non-scaling-stroke"/>')
    tall = []
    for bld in doc['b']:
        if bld[0] < FALLBACK_MIN_TOP:
            continue
        pts = unflat(bld[2:])
        cx = sum(p[0] for p in pts) / len(pts)
        cy = sum(p[1] for p in pts) / len(pts)
        tall.append((cx * fx + cy * fy, bld[0], bld[1], pts))
    tall.sort(key=lambda t: -t[0])
    g = ['<g fill="#fff" stroke-width="0.7" vector-effect="non-scaling-stroke">']
    for _, top, base, pts in tall:
        n, d = len(pts), ''
        for i in range(n):
            (ax, ay), (bx, by) = pts[i], pts[(i + 1) % n]
            if (by - ay) * -fx - (bx - ax) * -fy > 0:
                d += f'M{P(ax, ay, base)}L{P(bx, by, base)}L{P(bx, by, top)}L{P(ax, ay, top)}Z'
        g.append(f'<path d="{d}M' + 'L'.join(P(x, y, top) for x, y in pts) + 'Z"/>')
    g.append('</g>')
    out += g
    out.append('</svg>')
    return '\n'.join(out)


if __name__ == '__main__':
    main()
