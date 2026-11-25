"""Build public/embeds/race-planner-data.json for the NSEA Race Planner.

Inputs (scripts/race-planner/data/):
  swims.json          per-swim, per-length data from parse_reports.py (USA Swimming elite, 2010 Indiana
                      Senior LCM Champs, 2012 USA Swimming AG Elite Camp)
  ncaa2024_top8.json  2024 NCAA top-8 averages (hand-transcribed from the Russell Mark / ASCA PDFs)
  elite_refs.json     dolphin-kick counts and breathing notes (USA Swimming reference PDFs)

For every event the planner offers, each data source becomes a "reference level": its median time
(converted to the event's course) and, per length, its pacing share, off-the-wall (breakout) time, stroke
rate (cycles/min) and the spread of rates around that. The planner blends the two levels either side
of a swimmer's goal time.

Usage: python3 build_model.py [out.json]
"""
import json, os, sys, statistics as st

HERE = os.path.dirname(os.path.abspath(__file__))
D = lambda f: os.path.join(HERE, 'data', f)
SW = json.load(open(D('swims.json')))
NCAA = json.load(open(D('ncaa2024_top8.json')))
REFS = json.load(open(D('elite_refs.json')))

LABEL = {
    'ncaa': 'NCAA top 8 (2024)',
    'usa': 'USA Swimming elite',
    'indiana': 'Indiana Senior Champs (2010)',
    'ag': 'USA Swimming AG Camp (2012)',
}
# Seconds in the target course = seconds in the source course x factor.
LCM_TO_SCY = {50: 1 / 1.11, 100: 1 / 1.11, 200: 1 / 1.11, 400: 1 / 1.11}
FREE_DIST_MAP = {('LCM', 400): ('SCY', 500, 1.115), ('LCM', 800): ('SCY', 1000, 1.12), ('LCM', 1500): ('SCY', 1650, 0.975)}
IM_ORDER = ['FL', 'BK', 'BR', 'FR']

EVENTS = []
for sex in 'FM':
    for d in (50, 100, 200, 500, 1000, 1650): EVENTS.append(('SCY', sex, 'FR', d))
    for s in ('BK', 'BR', 'FL'):
        for d in (50, 100, 200): EVENTS.append(('SCY', sex, s, d))
    for d in (100, 200, 400): EVENTS.append(('SCY', sex, 'IM', d))
    for d in (50, 100, 200, 400, 800, 1500): EVENTS.append(('LCM', sex, 'FR', d))
    for s in ('BK', 'BR', 'FL'):
        for d in (50, 100, 200): EVENTS.append(('LCM', sex, s, d))
    for d in (200, 400): EVENTS.append(('LCM', sex, 'IM', d))


def q(v, p):
    v = sorted(v)
    if not v: return None
    i = (len(v) - 1) * p; lo = int(i); hi = min(lo + 1, len(v) - 1)
    return v[lo] + (v[hi] - v[lo]) * (i - lo)


def r4(x): return None if x is None else round(x, 4)


def plausible(s):
    """Drop swims whose split timing is broken in the source (e.g. a 25 recorded as 8.27 then 19.54)."""
    sp = [l['split'] for l in s['laps']][1:]
    if len(sp) < 2: return True
    return max(sp) / min(sp) <= 1.25 or (s['stroke'] == 'IM' and max(sp) / min(sp) <= 1.6)


DROPPED = []


def summarize(swims):
    """Median profile of one source group, per source length."""
    n = len(swims[0]['laps'])
    swims = [s for s in swims if len(s['laps']) == n]
    bad = [s for s in swims if not plausible(s)]
    DROPPED.extend(bad)
    swims = [s for s in swims if plausible(s)] or swims
    T = st.median(s['T'] for s in swims)
    share = [st.median(s['laps'][i]['split'] / s['T'] for s in swims) for i in range(n)]
    tot = sum(share); share = [x / tot for x in share]
    brk = []
    for i in range(n):
        v = [s['laps'][i]['brk'] for s in swims if s['laps'][i]['brk']]
        brk.append(st.median(v) if v else None)
    tempo, cyc, offs = [], [], []
    for i in range(n):
        v = [s['laps'][i]['tempo'] for s in swims if s['laps'][i]['tempo']]
        m = st.median(v) if v else None
        tempo.append(m)
        if m: offs += [x - m for x in v]
        c = [s['laps'][i]['cyc'] for s in swims if s['laps'][i]['cyc']]
        cyc.append(st.median(c) if c else None)
    spread = None
    if len(offs) >= 8 and len(swims) >= 3:
        spread = {k: round(q(offs, p), 2) for k, p in (('p10', .1), ('p25', .25), ('p75', .75), ('p90', .9))}
    ages = [s['age'] for s in swims if s.get('age')]
    return dict(n=len(swims), T=T, share=share, brk=brk, tempo=tempo, cyc=cyc, spread=spread,
                ages=[min(ages), max(ages)] if ages else None, srcL=None)


def groups():
    G = {}
    for s in SW:
        G.setdefault((s['tier'], s['course'], s['sex'], s['stroke'], s['dist']), []).append(s)
    out = {}
    for k, v in G.items():
        g = summarize(v); g['srcL'] = 25 if k[1] == 'SCY' else 50
        out[k] = g
    return out


GROUPS = groups()


def ncaa_group(sex, stroke, dist):
    e = NCAA.get(f'{sex}_{dist}_{stroke}')
    if not e: return None
    n = dist // 25
    if 'splits' in e:
        sp = e['splits']
    else:  # 50 splits: divide into 25s with USA Swimming SCY elite within-50 ratios
        r = within50('SCY', sex, stroke, dist)
        sp = []
        for k, s50 in enumerate(e['splits50']):
            sp += [s50 * r[k], s50 * (1 - r[k])]
    tot = sum(sp)
    return dict(n=8, T=e['total'], share=[x / tot for x in sp], brk=[None] * n,
                tempo=[60 / t for t in e['tempo']], cyc=e.get('cycles'), spread=None, ages=None, srcL=25,
                kicks=e.get('kicks'))


def within50(course, sex, stroke, dist):
    """Share of each 50 taken by its first 25, from USA Swimming SCY elite swims (same event if we have it)."""
    cands = [GROUPS.get(('usa', 'SCY', sex, stroke, dist))]
    cands += [GROUPS.get(('usa', 'SCY', sex, stroke, d)) for d in (200, 100, 500, 400)]
    cands += [GROUPS.get(('usa', 'SCY', sex, 'FR', d)) for d in (200, 100)]
    g = next(c for c in cands if c)
    sh = g['share']; m = len(sh) // 2
    ratios = [sh[2 * k] / (sh[2 * k] + sh[2 * k + 1]) for k in range(m)]
    first, rest = ratios[0], (st.median(ratios[1:]) if len(ratios) > 1 else 0.49)
    target = dist // 50 if dist >= 50 else 1
    if g is cands[0] and len(ratios) == target: return ratios
    return [first] + [rest] * (target - 1)


def cum_resample(share, n_out):
    """Re-grid a pacing profile (shares per source length) onto n_out equal lengths by distance fraction."""
    n = len(share); cum = [0.0]
    for x in share: cum.append(cum[-1] + x)
    pts = []
    for j in range(1, n_out + 1):
        f = j / n_out * n; i = min(int(f), n - 1); fr = f - i
        pts.append(cum[i] + (cum[i + 1] - cum[i]) * fr)
    return [pts[0]] + [pts[j] - pts[j - 1] for j in range(1, n_out)]


def at_frac(arr, j, n_out):
    """Value of a per-source-length array at target length j (by distance fraction)."""
    if not arr: return None
    i = min(int((j + 0.5) / n_out * len(arr)), len(arr) - 1)
    return arr[i]


def place(g, course, sex, stroke, dist, n_out, conv, scy_from_lcm):
    """Map a source group onto the target event's lengths."""
    share = g['share']
    if len(share) == n_out:
        out_share = list(share)
    elif scy_from_lcm and n_out == 2 * len(share):
        r = within50('SCY', sex, stroke, dist)
        out_share = []
        for k, s50 in enumerate(share):
            rr = r[min(k, len(r) - 1)]
            out_share += [s50 * rr, s50 * (1 - rr)]
    else:
        out_share = cum_resample(share, n_out)
        if scy_from_lcm and n_out % 2 == 0:  # re-gridded distance swims: put the dive-vs-push difference back in each 50
            r = within50('SCY', sex, stroke, 500 if stroke == 'FR' else dist)
            for k in range(n_out // 2):
                rr = r[0] if k == 0 else (st.median(r[1:]) if len(r) > 1 else 0.495)
                s50 = out_share[2 * k] + out_share[2 * k + 1]
                out_share[2 * k], out_share[2 * k + 1] = s50 * rr, s50 * (1 - rr)
    brk = g['brk']
    if len(brk) == n_out and all(b is not None for b in brk):
        out_brk = list(brk)
    else:
        b = [x for x in brk if x is not None]
        start = brk[0] if brk and brk[0] is not None else None
        turn = st.median(b[1:]) if len(b) > 1 else None
        out_brk = [start] + [turn] * (n_out - 1) if start is not None else None
    tempo = [at_frac(g['tempo'], j, n_out) for j in range(n_out)]
    same = len(share) == n_out
    return dict(T=g['T'] * conv, Tnative=g['T'], conv=round(conv, 4), share=[r4(x) for x in out_share],
                brk=[r4(x) for x in out_brk] if out_brk else None, tempo=[r4(x) for x in tempo],
                cyc=g['cyc'] if same else None, spread=g['spread'], n=g['n'], ages=g['ages'],
                kicks=g.get('kicks') if same else None)


def tier_entry(tier, g, course_src, dist_src, course, sex, stroke, dist, n_out, modeled=False):
    conv = 1.0
    fmap = FREE_DIST_MAP if stroke == 'FR' else {}
    if course_src != course:
        if course == 'SCY':
            conv = fmap.get((course_src, dist_src), (None, None, LCM_TO_SCY.get(dist_src, 1 / 1.11)))[2]
        else:
            conv = 1 / fmap.get(('LCM', {500: 400, 1000: 800, 1650: 1500}.get(dist_src, dist_src)), (0, 0, 1 / 1.11))[2]
    e = place(g, course, sex, stroke, dist, n_out, conv, course == 'SCY' and course_src == 'LCM')
    e.update(id=tier, label=LABEL[tier], course=course_src, dist=dist_src, modeled=modeled)
    return e


def build_event(course, sex, stroke, dist):
    L = 25 if course == 'SCY' else 50
    n = dist // L
    tiers, notes, modeled = [], [], False

    def add(tier, csrc, dsrc, mod=False, g=None):
        g = g or (ncaa_group(sex, stroke, dsrc) if tier == 'ncaa' else GROUPS.get((tier, csrc, sex, stroke, dsrc)))
        if g: tiers.append(tier_entry(tier, g, csrc, dsrc, course, sex, stroke, dist, n, mod))

    direct = {'SCY': {500: ('LCM', 400), 1000: ('LCM', 800), 1650: ('LCM', 1500)},
              'LCM': {}}
    if course == 'SCY':
        if dist in (1000, 1650):
            src = direct['SCY'][dist]
            add('usa', *src, True); add('indiana', *src, True)
            notes.append(f'No {dist}-yard race data in the folder: the pacing shape comes from long course {src[1]} m races, re-gridded to {dist} yards and converted.')
            modeled = True
        elif stroke == 'IM' and dist == 100:
            for t in ('ncaa', 'usa'):
                g = ncaa_group(sex, 'IM', 200) if t == 'ncaa' else GROUPS.get((t, 'SCY', sex, 'IM', 200))
                if g:
                    leg = [sum(g['share'][k * len(g['share']) // 4:(k + 1) * len(g['share']) // 4]) for k in range(4)]
                    g2 = dict(g, share=leg, T=g['T'] * 0.475, brk=[g['brk'][0], g['brk'][2] if len(g['brk']) > 2 else None, g['brk'][4] if len(g['brk']) > 4 else None, g['brk'][6] if len(g['brk']) > 6 else None],
                              tempo=[g['tempo'][0], g['tempo'][len(g['tempo']) // 4], g['tempo'][len(g['tempo']) // 2], g['tempo'][3 * len(g['tempo']) // 4]], cyc=None, kicks=None)
                    add(t, 'SCY', 100, True, g2)
            g = GROUPS.get(('ag', 'LCM', sex, 'IM', 200))
            if g:
                g2 = dict(g, share=g['share'], T=g['T'] * 0.475, cyc=None)
                add('ag', 'LCM', 100, True, g2)
            notes.append('There is no 100 IM race data: each leg is one length, using the leg shares of the 200 IM sources.')
            modeled = True
        elif dist == 50 and stroke != 'FR':
            modeled = True
            for t, csrc in (('ncaa', 'SCY'), ('usa', 'SCY'), ('indiana', 'LCM'), ('ag', 'LCM')):
                g = ncaa_group(sex, stroke, 100) if t == 'ncaa' else GROUPS.get((t, csrc, sex, stroke, 100))
                if not g: continue
                g2 = derive_50(g, t, csrc, sex)
                add(t, csrc, 50, True, g2)
            notes.append(f'There is no 50 {stroke} race data: each level uses the first half of its 100 {stroke}, sped up by how much faster 50 free swimmers hold their rate than the first half of a 100 free.')
        else:
            add('ncaa', 'SCY', dist); add('usa', 'SCY', dist)
            ldist = {500: 400}.get(dist, dist)
            add('indiana', 'LCM', ldist); add('ag', 'LCM', ldist)
    else:
        if dist == 50 and stroke != 'FR':
            modeled = True
            for t in ('usa', 'indiana', 'ag'):
                g = GROUPS.get((t, 'LCM', sex, stroke, 100))
                if g: add(t, 'LCM', 50, True, derive_50(g, t, 'LCM', sex))
            notes.append(f'There is no 50 {stroke} race data: each level uses the first 50 of its 100 {stroke}, sped up by the 50 free / 100 free rate difference.')
        else:
            add('usa', 'LCM', dist); add('indiana', 'LCM', dist); add('ag', 'LCM', dist)
            if not any(t['id'] == 'usa' for t in tiers):
                sdist = {400: 500, 800: 1000, 1500: 1650}.get(dist, dist)
                if (stroke, sdist) != ('FR', 1000) and sdist != 1650:
                    add('ncaa', 'SCY', sdist, True); add('usa', 'SCY', sdist, True)
    tiers = [t for t in tiers if t['share'] and abs(sum(t['share']) - 1) < 0.02]
    tiers.sort(key=lambda t: t['T'])
    # drop tiers that are effectively the same level (keep the larger sample)
    keep = []
    for t in tiers:
        if keep and abs(t['T'] - keep[-1]['T']) / keep[-1]['T'] < 0.004:
            if t['n'] > keep[-1]['n']: keep[-1] = t
            continue
        keep.append(t)
    tiers = keep

    legs = [IM_ORDER[min(3, i * 4 // n)] for i in range(n)] if stroke == 'IM' else [stroke] * n
    turns = []
    for i in range(n - 1):
        a, b = legs[i], legs[i + 1]
        turns.append('flip' if a in ('FR', 'BK') and a == b else 'touch')
    turns.append('finish')

    kicks, ksrc = None, None
    for t in tiers:
        if t.get('kicks') and len(t['kicks']) == n: kicks, ksrc = t['kicks'], t['label']; break
    if not kicks:
        kc = REFS['kick_counts'].get(sex, {}).get(course, {}).get(stroke, {}).get(str(dist))
        if kc and len(kc) == n: kicks, ksrc = kc, 'USA Swimming elite kick counts'
    br = REFS['breathing_notes'].get(f'{sex}_{dist}_{stroke}')
    for t in tiers: t.pop('kicks', None)
    return dict(course=course, sex=sex, stroke=stroke, dist=dist, L=L, n=n, legs=legs, turns=turns,
                tiers=tiers, kicks=kicks, kicksSrc=ksrc, breathing=br, modeled=modeled, notes=notes)


def rate_ratio_50(sex, course_tier):
    """Average 50 free stroke rate / first-half rate of the 100 free, for the same level, sex and course."""
    t, c = course_tier
    if t == 'ncaa':
        a, b = NCAA.get(f'{sex}_50_FR'), NCAA.get(f'{sex}_100_FR')
        if a and b: return (sum(60 / x for x in a['tempo']) / 2) / (sum(60 / x for x in b['tempo'][:2]) / 2)
    a, b = GROUPS.get((t, c, sex, 'FR', 50)), GROUPS.get((t, c, sex, 'FR', 100))
    if a and b:
        ta = [x for x in a['tempo'] if x]; tb = [x for x in b['tempo'][:len(b['tempo']) // 2] if x]
        if ta and tb: return (sum(ta) / len(ta)) / (sum(tb) / len(tb))
    return 1.08


def derive_50(g, tier, csrc, sex):
    h = len(g['share']) // 2
    sh = g['share'][:h]; s = sum(sh)
    ratio = rate_ratio_50(sex, (tier, csrc))
    fr100 = ncaa_group(sex, 'FR', 100) if tier == 'ncaa' else GROUPS.get((tier, csrc, sex, 'FR', 100))
    fr50 = ncaa_group(sex, 'FR', 50) if tier == 'ncaa' else GROUPS.get((tier, csrc, sex, 'FR', 50))
    # time of a 50 vs the first half of a 100, from free at the same level
    tfac = (fr50['T'] / (fr100['T'] * sum(fr100['share'][:len(fr100['share']) // 2]))) if (fr50 and fr100) else 0.97
    return dict(g, share=[x / s for x in sh], T=g['T'] * s * tfac, brk=g['brk'][:h] if g['brk'] else None,
                tempo=[x * ratio if x else None for x in g['tempo'][:h]], cyc=None, kicks=None)


DBP = json.load(open(D('db_profiles.json'))) if os.path.exists(D('db_profiles.json')) else {'events': {}, 'ages': []}
ASCA = json.load(open(D('asca_tempo_2021_22.json')))


def elite_tempo(course, sex, stroke, dist, L, n):
    """ASCA top-8 (2021-22) seconds per cycle, mapped onto each length."""
    t = ASCA.get(sex, {}).get(course, {}).get(f'{stroke}_{dist}')
    if not t: return None
    seg = 50 if dist <= 200 else 100
    return [t[min(int(((j + 0.5) * L) // seg), len(t) - 1)] for j in range(n)]


def pacing(key, course, dist, n):
    """Results-database pacing bins for this event, per length, by age group."""
    e = DBP['events'].get(key)
    if not e: return None
    out = {}
    if dist == 50 and course == 'SCY' and e.get('p25'):
        for a, v in e['p25'].items():
            out[a] = {'n': v['n'], 'bins': [{'T': b['T'], 'n': b['n'], 'lo': b['lo'], 'hi': b['hi'], 'share': b['share']} for b in v['bins']]}
        return {'unit': 25, 'ages': out, 'n25': e.get('n25')}
    if not e.get('p50') or dist < 100: return None
    w = e.get('w50', {})
    for a, v in e['p50'].items():
        ratios = w.get(a) or w.get('all')
        bins = []
        for b in v['bins']:
            sh = b['share']
            if course == 'SCY':
                r = ratios if ratios and len(ratios) == len(sh) else None
                if r is None:
                    base = ratios or [0.47, 0.495]
                    r = [base[0]] + [st.median(base[1:]) if len(base) > 1 else 0.495] * (len(sh) - 1)
                per = []
                for k, x in enumerate(sh): per += [round(x * r[k], 4), round(x * (1 - r[k]), 4)]
                sh = per
            if len(sh) != n: continue
            bins.append({'T': b['T'], 'n': b['n'], 'lo': b['lo'], 'hi': b['hi'], 'share': sh})
        if bins: out[a] = {'n': v['n'], 'bins': bins, 'w50src': 'db' if (course == 'SCY' and w.get(a)) else ('db-all' if course == 'SCY' and w.get('all') else None)}
    return {'unit': 50, 'ages': out, 'n25': e.get('n25')} if out else None


def main(out):
    data = {'version': 3, 'built': 'from scripts/race-planner/build_model.py', 'ages': DBP.get('ages', []),
            'dbTotals': DBP.get('totals'), 'events': {}}
    for e in EVENTS:
        ev = build_event(*e)
        if not ev['tiers']:
            print('NO DATA', e); continue
        key = '%s_%s_%s_%d' % e
        ev['pace'] = pacing(key, e[0], e[3], ev['n'])
        if ev['pace'] and ev['modeled']:
            n = ev['pace']['ages']['all']['n'] if 'all' in ev['pace']['ages'] else sum(v['n'] for v in ev['pace']['ages'].values())
            what = {50: f'the first half of each level\'s 100 {e[2]}, sped up by the 50 free / 100 free rate difference',
                    100: 'the 200 IM legs', 1000: 'long course 800 m races', 1650: 'long course 1500 m races'}[e[3]]
            ev['notes'] = [f'Pacing comes from {n:,} real swims in NSEA\'s results database. There is no race-analysis data for this event, so breakouts and stroke rates are modeled from {what}.']
            ev['modeled'] = 'rates'
        ev['eliteTempo'] = elite_tempo(e[0], e[1], e[2], e[3], ev['L'], ev['n'])
        data['events'][key] = ev
    json.dump(data, open(out, 'w'), separators=(',', ':'))
    print(len(data['events']), 'events ->', out, os.path.getsize(out), 'bytes')
    for b in DROPPED: print('  dropped (broken splits):', b['src'], round(b['T'], 2), [l['split'] for l in b['laps']])


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, '..', '..', 'public', 'embeds', 'race-planner-data.json'))
