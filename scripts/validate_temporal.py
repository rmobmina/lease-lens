"""Independent check of the numbers quoted in the temporal chapter (story/temporal.html).

Re-derives every figure straight from the raw CSV with the standard library only, so it does not share
code with story/js/temporal-data.js. Run from the repo root:  python3 scripts/validate_temporal.py

Definitions (same as the chapter):
  building = RSN; period = 2023-current file only (pre-2023 used a different scoring method);
  first/latest = earliest/most recent EVALUATION COMPLETED ON per RSN; eligible = >= 2 scored evaluations;
  direction = sign(latest - first), "same" = exactly equal.
"""
import csv, statistics as st
from collections import Counter, defaultdict

PATH = 'data/apartment_building_evaluations_2023_current.csv'
rows = list(csv.DictReader(open(PATH, encoding='utf-8-sig')))

def num(v):
    v = (v or '').strip()
    try: return float(v)
    except ValueError: return None

audit = Counter()
by_rsn = defaultdict(list)
for r in rows:
    score, date, rsn = num(r['CURRENT BUILDING EVAL SCORE']), r['EVALUATION COMPLETED ON'].strip(), r['RSN'].strip()
    if 'CREATED IN ERROR' in r['SITE ADDRESS'].upper(): audit['created in error (excluded)'] += 1; continue
    if score is None: audit['missing score (excluded)'] += 1; continue
    if not date: audit['missing date (excluded)'] += 1; continue
    by_rsn[rsn].append((date, r['_id'], score))

dup = [k for k, v in by_rsn.items() if len({d for d, _, _ in v}) != len(v)]
pairs = {}
for rsn, evs in by_rsn.items():
    evs.sort()
    if len(evs) >= 2: pairs[rsn] = (evs[0][2], evs[-1][2])

deltas = [b - a for a, b in pairs.values()]
n = len(deltas)
up, down = sum(d > 0 for d in deltas), sum(d < 0 for d in deltas)
low = [b - a for a, b in pairs.values() if a < 65]
high = [b - a for a, b in pairs.values() if a >= 95]

report = [
    ('rows in 2023+ file', len(rows), None),
    ('buildings (RSNs)', len(by_rsn), None),
    ('buildings with 1 evaluation (not compared)', sum(len(v) == 1 for v in by_rsn.values()), None),
    ('buildings with 3+ evaluations (first vs latest used)', sum(len(v) >= 3 for v in by_rsn.values()), None),
    ('duplicate evaluation dates within an RSN', len(dup), 0),
    ('excluded rows', sum(audit.values()), None),
    ('eligible buildings', n, 3215),
    ('higher %', round(100 * up / n, 1), 64.4),
    ('lower %', round(100 * down / n, 1), 29.3),
    ('same %', round(100 * (n - up - down) / n, 1), 6.3),
    ('mean change', round(st.mean(deltas), 2), 3.42),
    ('started < 65: n', len(low), 61),
    ('started < 65: % higher', round(100 * sum(d > 0 for d in low) / len(low), 1), 96.7),
    ('started < 65: mean change', round(st.mean(low), 1), 29.5),
    ('started >= 95: % lower', round(100 * sum(d < 0 for d in high) / len(high), 1), 54.8),
    ('changed by <= 2 points %', round(100 * sum(abs(d) <= 2 for d in deltas) / n, 1), 29.0),
    ('rose >= 10', sum(d >= 10 for d in deltas), 600),
    ('fell >= 10', sum(d <= -10 for d in deltas), 137),
]
ok = True
for label, got, want in report:
    flag = '' if want is None else ('ok' if got == want else f'MISMATCH (expected {want})')
    ok &= want is None or got == want
    print(f'{label:<55} {got:>8}  {flag}')
for k, v in audit.items(): print(f'  {k}: {v}')
raise SystemExit(0 if ok else 1)
