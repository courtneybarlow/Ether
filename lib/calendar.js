// Calendars from private iCal links (Google "Secret address in iCal format", iCloud public calendars…).
// CALENDAR_ICS holds one calendar per line:  Name | https://…ics
import ICAL from 'ical.js';
import { env, HttpError } from './core.js';
import * as google from './google.js';

export function calendars() {
  return String(env('CALENDAR_ICS', ''))
    .split(/\n|;;/).map(s => s.trim()).filter(Boolean)
    .map((line, i) => {
      const [a, b] = line.includes('|') ? line.split('|').map(s => s.trim()) : ['Calendar ' + (i + 1), line];
      const url = b.replace(/^webcal:\/\//i, 'https://');
      const m = url.match(/calendar\.google\.com\/calendar\/ical\/([^/]+)\//i);
      return { id: 'cal' + i, summary: a, url, google: m ? decodeURIComponent(m[1]) : null };
    });
}

const cache = new Map(); // url -> {at, text}
async function fetchICS(url) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < 5 * 60 * 1000) return hit.text;
  const r = await fetch(url, { headers: { 'User-Agent': 'Ether/1.0' } });
  if (!r.ok) throw new HttpError(502, 'calendar_fetch_failed', `Calendar feed returned ${r.status}`);
  const text = await r.text();
  cache.set(url, { at: Date.now(), text });
  return text;
}

const toISO = t => (t.isDate ? null : t.toJSDate().toISOString());
const toDate = t => t.toString().slice(0, 10);
function shape(uid, summary, start, end, status, transp) {
  const s = start.isDate ? { date: toDate(start) } : { dateTime: toISO(start) };
  const e = end ? (end.isDate ? { date: toDate(end) } : { dateTime: toISO(end) }) : s;
  return { id: uid + '@' + (s.dateTime || s.date), summary: summary || '(No title)', status: status === 'CANCELLED' ? 'cancelled' : 'confirmed', transparency: transp === 'TRANSPARENT' ? 'transparent' : 'opaque', start: s, end: e };
}

export function expand(text, from, to) {
  const root = new ICAL.Component(ICAL.parse(text));
  for (const tz of root.getAllSubcomponents('vtimezone')) {
    try { const zone = new ICAL.Timezone(tz); if (!ICAL.TimezoneService.has(zone.tzid)) ICAL.TimezoneService.register(zone.tzid, zone); } catch (e) {}
  }
  const vevents = root.getAllSubcomponents('vevent');
  const masters = new Map(), exceptions = [];
  for (const v of vevents) {
    const ev = new ICAL.Event(v);
    if (ev.isRecurrenceException()) exceptions.push(ev); else masters.set(ev.uid, ev);
  }
  for (const ex of exceptions) { const m = masters.get(ex.uid); if (m) { try { m.relateException(ex); } catch (e) {} } }
  const out = [];
  const fromT = from.getTime(), toT = to.getTime();
  for (const ev of masters.values()) {
    const status = (ev.component.getFirstPropertyValue('status') || '').toUpperCase();
    const transp = (ev.component.getFirstPropertyValue('transp') || '').toUpperCase();
    if (!ev.isRecurring()) {
      if (!ev.startDate) continue;
      const s = ev.startDate.toJSDate().getTime(), e = (ev.endDate || ev.startDate).toJSDate().getTime();
      if (e >= fromT && s <= toT) out.push(shape(ev.uid, ev.summary, ev.startDate, ev.endDate, status, transp));
      continue;
    }
    const it = ev.iterator();
    let next, n = 0;
    while ((next = it.next()) && n++ < 2000) {
      const t = next.toJSDate().getTime();
      if (t > toT) break;
      let det; try { det = ev.getOccurrenceDetails(next); } catch (e) { continue; }
      const e = det.endDate.toJSDate().getTime();
      if (e < fromT) continue;
      const st = (det.item.component.getFirstPropertyValue('status') || status || '').toUpperCase();
      out.push(shape(ev.uid, det.item.summary, det.startDate, det.endDate, st, (det.item.component.getFirstPropertyValue('transp') || transp || '').toUpperCase()));
    }
  }
  return out.sort((a, b) => String(a.start.dateTime || a.start.date).localeCompare(String(b.start.dateTime || b.start.date)));
}

// Range strings come from the app as local wall time ("2026-10-29T00:00:00"); widen a day each side, the app filters by local day.
function rangeOf(args) {
  const now = Date.now();
  const p = s => (s ? new Date(String(s).replace(/(Z|[+-]\d\d:\d\d)?$/, 'Z')).getTime() : NaN);
  const a = p(args.startTime), b = p(args.endTime);
  return { from: new Date((isNaN(a) ? now - 7 * 864e5 : a) - 864e5), to: new Date((isNaN(b) ? now + 8 * 864e5 : b) + 864e5) };
}

export async function listCalendars(owner) {
  const live = owner ? await google.linked(owner).catch(() => false) : false;
  // writable: Ether can add and change events here (a Google calendar, read live once Google is connected).
  return { calendars: calendars().map(({ id, summary, google: gid }) => ({ id, summary, primary: id === 'cal0', google: gid, live: !!(live && gid), writable: !!(live && gid && !/@import\.calendar\.google\.com$|#holiday@|@group\.v\.calendar/i.test(gid)) })) };
}
export async function listEvents(args, owner) {
  const cal = calendars().find(c => c.id === args.calendarId);
  if (!cal) throw new HttpError(404, 'calendar_not_found');
  const { from, to } = rangeOf(args);
  if (cal.google && owner && await google.linked(owner).catch(() => false)) {
    try { return { events: await google.listEvents(owner, cal.google, from, to), live: true }; }
    catch (e) { console.error('calendar live', cal.summary, e.message); }
  }
  return { events: expand(await fetchICS(cal.url), from, to) };
}
// Everything on all calendars in a range (used by notifications on the server).
export async function allEventsBetween(from, to) {
  const out = [];
  for (const c of calendars()) {
    try { for (const e of expand(await fetchICS(c.url), from, to)) out.push({ ...e, cal: c.summary }); } catch (e) { console.error('calendar', c.summary, e.message); }
  }
  return out;
}
