"""Readers and geometry helpers for the City of Toronto 3D Massing shapefile (standard library only).

The 2025 "WGS84" shapefile is actually stored in Web Mercator (EPSG:3857) metres; see its .prj.
Each record is one PolygonZ building part with heights above ground (MIN/MAX/AVG_HEIGHT, metres).
"""
import math
import struct

R_EARTH = 6378137.0


def lonlat_to_merc(lon, lat):
    x = math.radians(lon) * R_EARTH
    y = math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)) * R_EARTH
    return x, y


def merc_to_lonlat(x, y):
    lon = math.degrees(x / R_EARTH)
    lat = math.degrees(2 * math.atan(math.exp(y / R_EARTH)) - math.pi / 2)
    return lon, lat


def read_dbf(path):
    with open(path, 'rb') as f:
        head = f.read(32)
        n, hl, rl = struct.unpack('<IHH', head[4:12])
        fields = []
        while True:
            d = f.read(32)
            if d[0] == 0x0D:
                break
            fields.append((d[:11].split(b'\0')[0].decode(), chr(d[11]), d[16]))
        f.seek(hl)
        for _ in range(n):
            r = f.read(rl)
            o, out = 1, {}
            for name, typ, ln in fields:
                v = r[o:o + ln].decode('utf-8', 'replace').strip()
                o += ln
                if typ in 'FN':
                    try:
                        v = float(v)
                    except ValueError:
                        v = None
                out[name] = v
            yield out


def read_shx(path):
    with open(path, 'rb') as f:
        data = f.read()
    n = (len(data) - 100) // 8
    return [struct.unpack('>ii', data[100 + i * 8:108 + i * 8]) for i in range(n)]  # (offset words, length words)


def record_bbox(shp, offset_words):
    shp.seek(offset_words * 2 + 8)
    head = shp.read(36)
    stype = struct.unpack('<i', head[:4])[0]
    if stype == 0:
        return None
    return struct.unpack('<4d', head[4:36])


def read_polygon(shp, offset_words):
    """Returns a list of rings [[(x, y), ...], ...] in source coordinates (Z ignored)."""
    shp.seek(offset_words * 2 + 8)
    head = shp.read(44)
    stype, = struct.unpack('<i', head[:4])
    if stype == 0:
        return []
    nparts, npoints = struct.unpack('<ii', head[36:44])
    parts = struct.unpack(f'<{nparts}i', shp.read(4 * nparts))
    pts = struct.unpack(f'<{2 * npoints}d', shp.read(16 * npoints))
    rings = []
    for i, p0 in enumerate(parts):
        p1 = parts[i + 1] if i + 1 < nparts else npoints
        rings.append([(pts[2 * k], pts[2 * k + 1]) for k in range(p0, p1)])
    return rings


def ring_area(r):
    """Signed shoelace area (positive = counter-clockwise)."""
    a = 0.0
    for i in range(len(r)):
        x0, y0 = r[i]
        x1, y1 = r[(i + 1) % len(r)]
        a += x0 * y1 - x1 * y0
    return a / 2


def group_rings(rings):
    """Shapefile convention: outer rings clockwise, holes counter-clockwise.
    Returns polygons [(outer, [holes])]. Holes are attached to the outer ring that contains them."""
    outers, holes = [], []
    for r in rings:
        if len(r) < 4:
            continue
        (outers if ring_area(r) < 0 else holes).append(r)
    polys = [(o, []) for o in outers]
    for h in holes:
        for o, hs in polys:
            if point_in_ring(h[0], o):
                hs.append(h)
                break
    return polys


def point_in_ring(p, r):
    x, y = p
    inside = False
    j = len(r) - 1
    for i in range(len(r)):
        xi, yi = r[i]
        xj, yj = r[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / ((yj - yi) or 1e-12) + xi:
            inside = not inside
        j = i
    return inside


def point_in_poly(p, poly):
    outer, holes = poly
    return point_in_ring(p, outer) and not any(point_in_ring(p, h) for h in holes)


def seg_dist(p, a, b):
    px, py = p
    ax, ay = a
    bx, by = b
    dx, dy = bx - ax, by - ay
    L = dx * dx + dy * dy
    t = 0 if L == 0 else max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / L))
    return math.hypot(px - ax - t * dx, py - ay - t * dy)


def ring_dist(p, r):
    return min(seg_dist(p, r[i], r[(i + 1) % len(r)]) for i in range(len(r)))


def simplify(r, tol):
    """Douglas-Peucker on a closed ring (keeps at least 4 points)."""
    if len(r) <= 5:
        return r
    pts = r[:-1] if r[0] == r[-1] else r[:]

    def dp(seq):
        if len(seq) < 3:
            return seq
        a, b = seq[0], seq[-1]
        i, d = max(((i, seg_dist(seq[i], a, b)) for i in range(1, len(seq) - 1)), key=lambda t: t[1])
        if d <= tol:
            return [a, b]
        return dp(seq[:i + 1])[:-1] + dp(seq[i:])

    # split at the point farthest from the first one so the ring isn't anchored on a corner only
    far = max(range(len(pts)), key=lambda i: (pts[i][0] - pts[0][0]) ** 2 + (pts[i][1] - pts[0][1]) ** 2)
    out = dp(pts[:far + 1])[:-1] + dp(pts[far:] + [pts[0]])[:-1]
    return out if len(out) >= 3 else pts
