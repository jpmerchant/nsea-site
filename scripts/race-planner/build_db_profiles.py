"""Pacing profiles for the Race Planner from NSEA's results database (nsea_results.sqlite).

Every individual swim in a full results file (HY-TEK CL2/HY3: championships and every other meet loaded),
status OK, not a duplicate, with complete splits. For each event and age group the swims are sorted by
final time and cut into bins of similar size; each bin keeps its median time, its swim count and the
median share of the race taken by each 50 (each 25 for 50s). The planner reads the bins either side
of a goal time, so a 2:05 200 free plan is paced like real 2:05 swims.

Usage: python3 build_db_profiles.py <nsea_results.sqlite> <out.json>
"""
import sqlite3, sys, json, statistics as st
from collections import defaultdict

DB, OUT = sys.argv[1], sys.argv[2]
c = sqlite3.connect(f'file:{DB}?mode=ro', uri=True)
STROKE = {1: 'FR', 2: 'BK', 3: 'BR', 4: 'FL', 5: 'IM'}
COURSE = {'Y': 'SCY', 'L': 'LCM'}
EVENTS = {
    'SCY': {'FR': [50, 100, 200, 500, 1000, 1650], 'BK': [50, 100, 200], 'BR': [50, 100, 200], 'FL': [50, 100, 200], 'IM': [100, 200, 400]},
    'LCM': {'FR': [50, 100, 200, 400, 800, 1500], 'BK': [50, 100, 200], 'BR': [50, 100, 200], 'FL': [50, 100, 200], 'IM': [200, 400]},
}
AGES = [('all', 'All ages', 0, 99), ('10u', '10 & under', 0, 10), ('1112', '11–12', 11, 12), ('1314', '13–14', 13, 14), ('15o', '15 & over', 15, 99)]
MIN_BIN, MAX_BINS, MIN_SWIMS = 40, 12, 120
MAX_AGE = 24  # leave out masters swims that sit in some meet files

# splits keyed by result
SP = defaultdict(dict)
for rid, idx, cum in c.execute("""SELECT s.result_id, s.split_index, s.cum_cs FROM split s JOIN result r ON r.id = s.result_id
        JOIN meet m ON m.id = r.meet_id
        WHERE m.source_system IN ('CL2','HY3') AND r.kind = 'I' AND r.status = 'OK' AND COALESCE(r.is_dup,0) = 0 AND r.time_cs > 0"""):
    SP[rid][idx] = cum

rows = c.execute("""SELECT r.id, r.course, r.distance, r.stroke, COALESCE(r.event_sex, s.sex), r.age, r.time_cs, m.is_champ
    FROM result r JOIN meet m ON m.id = r.meet_id LEFT JOIN swimmer s ON s.id = r.swimmer_id
    WHERE m.source_system IN ('CL2','HY3') AND r.kind = 'I' AND r.status = 'OK' AND COALESCE(r.is_dup,0) = 0 AND r.time_cs > 0
      AND r.round IN ('P','F')""").fetchall()


def segs(sp, dist, t, step):
    """Split times of each `step` yards/metres, or None if any is missing or implausible."""
    n = dist // step; idx = [k * step // 25 for k in range(1, n + 1)]
    if any(i not in sp for i in idx): return None
    cum = [sp[i] for i in idx]
    if cum[-1] != t: return None
    out, prev = [], 0
    for x in cum: out.append(x - prev); prev = x
    avg = t / n
    if any(s < avg * 0.5 or s > avg * 2 for s in out): return None
    return out


ev50 = defaultdict(list)   # (course,sex,stroke,dist) -> [(t, age, shares per 50)]
ev25 = defaultdict(list)   # 25-split swims: shares per 25
for rid, course, dist, stroke, sex, age, t, champ in rows:
    course = COURSE.get(course); stroke = STROKE.get(stroke)
    if not course or not stroke or sex not in ('F', 'M') or dist not in EVENTS[course].get(stroke, []): continue
    if age is not None and age > MAX_AGE: continue
    sp = SP.get(rid)
    if not sp: continue
    if dist >= 100:
        s = segs(sp, dist, t, 50)
        if s: ev50[(course, sex, stroke, dist)].append((t, age, [x / t for x in s]))
    if course == 'SCY':
        s = segs(sp, dist, t, 25)
        if s: ev25[(course, sex, stroke, dist)].append((t, age, [x / t for x in s]))


def bins(swims):
    swims = sorted(swims, key=lambda s: s[0])
    n = len(swims)
    lo, hi = int(n * 0.02), n - int(n * 0.02)  # drop the slowest and fastest 2%
    swims = swims[lo:hi]; n = len(swims)
    k = max(1, min(MAX_BINS, n // MIN_BIN))
    out = []
    for b in range(k):
        part = swims[b * n // k:(b + 1) * n // k]
        L = len(part[0][2])
        sh = [st.median(p[2][i] for p in part) for i in range(L)]
        tot = sum(sh)
        ages = [p[1] for p in part if p[1]]
        out.append({'T': round(st.median(p[0] for p in part) / 100, 2), 'n': len(part), 'lo': round(part[0][0] / 100, 2),
                    'hi': round(part[-1][0] / 100, 2), 'share': [round(x / tot, 4) for x in sh],
                    'age': [min(ages), max(ages)] if ages else None})
    return out


def by_age(swims):
    out = {}
    for key, _, a0, a1 in AGES:
        sel = [s for s in swims if key == 'all' or (s[1] is not None and a0 <= s[1] <= a1)]
        if len(sel) >= MIN_SWIMS: out[key] = {'n': len(sel), 'bins': bins(sel)}
    return out


def within50(swims25):
    """First-25 share of each 50, by 50 position (median over swims), from swims with 25 splits."""
    if len(swims25) < 30: return None
    L = len(swims25[0][2]) // 2
    return [round(st.median(s[2][2 * k] / (s[2][2 * k] + s[2][2 * k + 1]) for s in swims25), 4) for k in range(L)]


data = {'ages': [[k, lbl] for k, lbl, _, _ in AGES], 'events': {}}
total50 = total25 = 0
for course, strokes in EVENTS.items():
    for stroke, dists in strokes.items():
        for dist in dists:
            for sex in 'FM':
                k = (course, sex, stroke, dist)
                e = {}
                if dist >= 100 and ev50.get(k):
                    e['p50'] = by_age(ev50[k]); total50 += len(ev50[k])
                if ev25.get(k):
                    if dist == 50:
                        e['p25'] = by_age(ev25[k])
                    w = {a: within50([s for s in ev25[k] if a == 'all' or (s[1] is not None and a0 <= s[1] <= a1)])
                         for a, _, a0, a1 in AGES}
                    e['w50'] = {a: v for a, v in w.items() if v}
                    e['n25'] = len(ev25[k]); total25 += len(ev25[k])
                if e: data['events']['%s_%s_%s_%d' % (course, sex, stroke, dist)] = e
data['totals'] = {'swims50': total50, 'swims25': total25}
json.dump(data, open(OUT, 'w'), separators=(',', ':'))
print(len(data['events']), 'events;', total50, 'swims with 50 splits;', total25, 'with 25 splits ->', OUT)
