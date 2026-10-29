// The Nine's ranking rules, shared with the server so notifications match the dashboard.
import { addDays, diffDays, dowOf, localParts } from './core.js';

export const PRI = { p0: 0, p1: 1, p2: 2 };
export const isQuick = it => (it.mins && it.mins <= 20) || (it.area === 'home' && (!it.mins || it.mins <= 30));
export const isWeekend = ref => { const d = dowOf(ref); return d === 0 || d === 6; };
const doneOn = (it, day) => it.done && it.doneAt && localParts(new Date(it.doneAt)).date === day;

export function eligible(it, ref) {
  if (it.someday) return false;
  if (it.done && !doneOn(it, ref)) return false;
  if (it.start && it.start > addDays(ref, 1)) return false;
  return true;
}
export function rank(it, ref) {
  const due = it.due || '', lead = Math.max(1, Number(it.lead) || 3);
  const soon = due && due > ref && diffDays(ref, due) <= lead;
  let bucket = due && due < ref ? 0 : due === ref ? 1 : (soon || (!due && it.priority === 'p0')) ? 2 : 3;
  const wkend = isWeekend(ref);
  if (wkend && it.area === 'work') bucket = 4;
  const areaRank = wkend ? (it.area === 'swc' ? 0 : it.area === 'work' ? 2 : 1) : (it.area === 'work' ? 0 : 1);
  return [bucket, PRI[it.priority] ?? 1, areaRank, due || '9999-12-31', it.title || ''];
}
export const cmpFor = ref => (a, b) => { const ra = rank(a, ref), rb = rank(b, ref); for (let i = 0; i < ra.length; i++) { if (ra[i] < rb[i]) return -1; if (ra[i] > rb[i]) return 1; } return 0; };

export function pickNine(items, ref, nineOrder = []) {
  const all = items.filter(it => eligible(it, ref));
  const pinned = all.filter(it => it.pinnedFor === ref || (it.alwaysMust && it.due === ref)).sort(cmpFor(ref)).slice(0, 9);
  const pinIds = new Set(pinned.map(p => p.id));
  const pool = all.filter(it => !pinIds.has(it.id)).sort(cmpFor(ref));
  const big = pool.filter(it => !isQuick(it)), small = pool.filter(isQuick);
  const apply = list => { if (!nineOrder.length) return list; const ix = id => { const i = nineOrder.indexOf(id); return i < 0 ? 1e6 : i; }; return list.map((x, i) => [x, i]).sort((a, b) => (ix(a[0].id) - ix(b[0].id)) || (a[1] - b[1])).map(p => p[0]); };
  const bigSeq = apply([...pinned, ...big]);
  return { must: bigSeq.slice(0, 3), should: bigSeq.slice(3, 9), quick: apply(small).slice(0, 9) };
}
