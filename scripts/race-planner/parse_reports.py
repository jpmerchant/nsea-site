"""Parse USA Swimming race-analysis report PDFs (USA Swimming elite, 2010 Indiana Senior LCM Champs,
2012 AG Elite Camp) into one JSON of per-swim, per-length data.

Usage: python3 parse_reports.py "<path to Race Data folder>" data/swims.json
Needs pdftotext (poppler). Three layouts are handled by reading each block's header line.
"""
import subprocess, re, json, glob, os, sys

SMAP = {'FR': 'FR', 'FREE': 'FR', 'FREESTYLE': 'FR', 'BK': 'BK', 'BA': 'BK', 'BACK': 'BK', 'BACKSTROKE': 'BK',
        'BR': 'BR', 'BT': 'BR', 'BREAST': 'BR', 'BREASTSTROKE': 'BR', 'FL': 'FL', 'FLY': 'FL', 'BUTTERFLY': 'FL', 'IM': 'IM'}

def tsec(x):
    x = x.strip()
    if ':' in x:
        m, s = x.split(':'); return int(m) * 60 + float(s)
    return float(x)

def num(x):
    try: return float(x)
    except ValueError: return None

def parse(f, tier):
    t = subprocess.run(['pdftotext', '-layout', f, '-'], capture_output=True, text=True).stdout
    low = f.lower()
    sex = 'F' if re.search(r'women|girl|female', low) else 'M'
    course = 'SCY' if ('/scy/' in low or ' yard ' in low) else 'LCM'
    fn = re.sub(r"^(men|women|boys|girls)('s)?\s+", '', os.path.basename(f)[:-4], flags=re.I)
    m = re.search(r'(\d+)\s*(?:Yard\s+)?(\w+)', fn)
    dist = int(m.group(1)); st = SMAP[re.sub(r'\d+$', '', m.group(2).upper())]
    out = []
    for b in re.split(r'\n\s*Name:\s*', t)[1:]:
        hdr = None; laps = []
        age = re.search(r'Age:\s*(\d+)', b); age = int(age.group(1)) if age else None
        for L in b.splitlines():
            s = L.strip()
            if s.startswith('Dist'):
                hdr = 'usa' if s.find('Time') < s.find('Split') else 'camp'
                hasT2 = 'Tempo 2' in s
                continue
            if hdr and re.match(r'^\d+\s', s):
                p = re.sub(r'\(\s*[\d.]+\)', '', s).replace('*', ' ').split()
                if int(p[0]) > dist: continue
                try:
                    if hdr == 'usa': d, brk, brkd, cum, drop, cyc, split, tempo = p[:8]
                    else: d, brk, brkd, split, drop, cyc, cum, tempo = p[:8]
                    rest = p[8:][2:] if hasT2 else p[8:]
                    laps.append(dict(d=int(d), brk=num(brk), cyc=num(cyc), split=tsec(split), cum=tsec(cum),
                                     tempo=num(tempo), dpc=num(rest[0]) if rest else None))
                except (ValueError, IndexError):
                    pass
        if laps and laps[-1]['d'] == dist:
            T = laps[-1]['cum']
            if abs(sum(l['split'] for l in laps) - T) < 0.6:
                out.append(dict(tier=tier, course=course, sex=sex, stroke=st, dist=dist, age=age, T=T,
                                src=f.split('Race Data/')[-1], laps=laps))
    return out

def main(root, dest):
    R = []
    for f in sorted(glob.glob(root + '/USA Swimming - */*/*.pdf')): R += parse(f, 'usa')
    for f in sorted(glob.glob(root + '/2010 Indiana*/*.pdf')): R += parse(f, 'indiana')
    for f in sorted(glob.glob(root + '/USA Swimming AG Camp/**/*.pdf', recursive=True)): R += parse(f, 'ag')
    seen = set(); U = []
    for r in R:  # the AG Camp folder has the same races in more than one file
        k = (r['tier'], r['course'], r['sex'], r['stroke'], r['dist'], round(r['T'], 2), r['laps'][0]['split'])
        if k not in seen: seen.add(k); U.append(r)
    json.dump(U, open(dest, 'w'))
    print(len(U), 'swims ->', dest)

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
