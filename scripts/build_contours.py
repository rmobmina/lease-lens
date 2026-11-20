# Generates the homepage's decorative topographic contours (dashboard/assets/home/contours.svg): isolines of one
# smooth, non-periodic field, so the pattern never visibly repeats. Standard library only.
# Run  python3 scripts/build_contours.py dashboard/assets/home/contours.svg
import math, sys
W, H, STEP = 1600, 1000, 6
bumps = [(-0.18,0.10,520,1.0),(0.30,0.05,380,-0.7),(0.62,0.18,460,0.9),(0.95,0.02,420,-0.6),(1.10,0.55,560,0.8),
         (0.78,0.92,500,-0.9),(0.42,1.05,600,1.1),(0.05,0.85,440,-0.8),(0.20,0.45,300,0.45),(0.70,0.50,340,-0.35),(0.86,0.14,150,0.55),(0.56,0.86,170,-0.5),(0.30,0.80,120,0.35)]
def f(x, y):
    v = 0
    for bx, by, r, a in bumps:
        dx, dy = x - bx*W, y - by*H
        v += a*math.exp(-(dx*dx+dy*dy)/(2*r*r))
    v += 0.18*math.sin(x/410+0.7)*math.cos(y/330-0.4) + 0.08*math.sin((x+y)/260)
    return v
nx, ny = W//STEP+1, H//STEP+1
F = [[f(i*STEP, j*STEP) for i in range(nx)] for j in range(ny)]
lo = min(min(r) for r in F); hi = max(max(r) for r in F)
levels = [lo+(hi-lo)*(k+0.5)/17 for k in range(17)]
def interp(p1, p2, v1, v2, t):
    u = (t-v1)/(v2-v1) if v2 != v1 else 0.5
    return (p1[0]+(p2[0]-p1[0])*u, p1[1]+(p2[1]-p1[1])*u)
paths = []
for t in levels:
    segs = []
    for j in range(ny-1):
        for i in range(nx-1):
            c = [(i*STEP,j*STEP),((i+1)*STEP,j*STEP),((i+1)*STEP,(j+1)*STEP),(i*STEP,(j+1)*STEP)]
            v = [F[j][i],F[j][i+1],F[j+1][i+1],F[j+1][i]]
            pts = []
            for a in range(4):
                b = (a+1) % 4
                if (v[a] < t) != (v[b] < t): pts.append(interp(c[a], c[b], v[a], v[b], t))
            if len(pts) == 2: segs.append(tuple(pts))
            elif len(pts) == 4: segs += [(pts[0],pts[1]),(pts[2],pts[3])]
    # chain segments into polylines
    key = lambda p: (round(p[0],2), round(p[1],2))
    adj = {}
    for k,(a,b) in enumerate(segs):
        adj.setdefault(key(a),[]).append(k); adj.setdefault(key(b),[]).append(k)
    used = [False]*len(segs)
    for k in range(len(segs)):
        if used[k]: continue
        used[k] = True; line = list(segs[k])
        for end in (1, 0):
            while True:
                p = line[-1] if end else line[0]
                nxt = [m for m in adj.get(key(p),[]) if not used[m]]
                if not nxt: break
                m = nxt[0]; used[m] = True
                a,b = segs[m]; q = b if key(a)==key(p) else a
                if end: line.append(q)
                else: line.insert(0,q)
        if len(line) < 6: continue
        # light simplification: keep every 2nd point, always the ends
        line = line[::2] + ([line[-1]] if len(line) % 2 == 0 else [])
        paths.append('M' + 'L'.join(f'{x:.0f},{y:.0f}' for x,y in line))
out = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" preserveAspectRatio="xMidYMid slice">'
       f'<path fill="none" stroke="#000" stroke-width="1.1" stroke-linejoin="round" stroke-linecap="round" d="{"".join(paths)}"/></svg>\n')
open(sys.argv[1],'w').write(out)
print(len(paths),'lines', len(out)//1024,'KB')
