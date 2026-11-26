// Meet Day family side: the coach-written family meet info and the per-meet "family view on" switch, both kept as ops.
// Shared by the coach app (Tools › Families) and the Worker (family view).
// Family meet info: the coaches' family text (Tools › Families). Families see nothing until a coach saves it; the coach's
// box starts from the meet file's general info (`fallback`), which was written for coaches.
const live = (ops, type) => { const undone = new Set(ops.filter((o) => o.type === 'undo').map((o) => o.data && o.data.op)); return ops.filter((o) => o.type === type && !undone.has(o.id)); };
export function familyInfo(pkg, ops, { fallback = false } = {}) {
  const last = live(ops, 'finfo').sort((a, b) => (a.at < b.at ? -1 : 1)).pop();
  if (last && last.data && Array.isArray(last.data.sections)) return last.data.sections;
  return fallback ? pkg.general || [] : [];
}
export function familyViewOn(ops) {
  const last = live(ops, 'familyview').sort((a, b) => (a.at < b.at ? -1 : 1)).pop();
  return !!(last && last.data && last.data.on);
}
// Coach text -> sections. A line ending in ":" (or starting with "#") starts a section; other lines are its items.
export function parseInfoText(text) {
  const out = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const l = raw.trim().replace(/^[-•*]\s*/, '');
    if (!l) continue;
    const h = l.match(/^#+\s*(.+)$/) || (raw.trim().endsWith(':') && !/^[-•*]/.test(raw.trim()) ? [null, l.slice(0, -1)] : null);
    if (h) out.push({ title: h[1].trim().slice(0, 80), items: [] });
    else { if (!out.length) out.push({ title: 'Meet info', items: [] }); out[out.length - 1].items.push(l.slice(0, 400)); }
  }
  return out.filter((s) => s.items.length).slice(0, 20);
}
export const infoText = (sections) => (sections || []).map((s) => `${s.title}:\n${(s.items || []).map((x) => '- ' + x).join('\n')}`).join('\n\n');

