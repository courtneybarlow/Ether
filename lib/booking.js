// Booking page logic: open times, and turning a pick into a real calendar event.
// Defaults: 60-minute working sessions, weekdays 5:30–7:30 pm and Saturdays 10 am–2 pm (Courtney's time),
// at least 12 hours' notice, up to 3 weeks out. Overridable from the Ether doc prefs/booking.
import crypto from 'node:crypto';
import { env, TZ, HttpError, getDoc, setDoc, listCol, localParts, addDays, dowOf } from './core.js';
import { allEventsBetween } from './calendar.js';
import * as google from './google.js';
import { notify } from './push.js';

export const DEFAULTS = {
  title: '60-minute working session',
  minutes: 60,
  step: 30,                 // start times every 30 minutes
  bufferMin: 15,            // keep 15 minutes clear around other events
  noticeHours: 12,
  horizonDays: 21,
  maxPerDay: 2,
  hours: { 1: [['17:30', '19:30']], 2: [['17:30', '19:30']], 3: [['17:30', '19:30']], 4: [['17:30', '19:30']], 5: [['17:30', '19:30']], 6: [['10:00', '14:00']] }
};
export async function settings(owner) {
  const p = (await getDoc(owner, 'prefs/booking')) || {};
  return { ...DEFAULTS, ...p, hours: p.hours || DEFAULTS.hours };
}

// Wall-clock time in TZ → real instant (handles daylight saving).
export function zoned(ymd, hhmm, tz = TZ) {
  const [y, m, d] = ymd.split('-').map(Number), [hh, mm] = hhmm.split(':').map(Number);
  let t = Date.UTC(y, m - 1, d, hh, mm);
  for (let i = 0; i < 2; i++) {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(t)).map(x => [x.type, x.value]));
    const asLocal = Date.UTC(+p.year, +p.month - 1, +p.day, (+p.hour) % 24, +p.minute);
    t += Date.UTC(y, m - 1, d, hh, mm) - asLocal;
  }
  return new Date(t);
}

async function busyBlocks(owner, from, to) {
  const blocks = [];
  try {
    for (const e of await allEventsBetween(from, to)) {
      if (e.status === 'cancelled' || e.transparency === 'transparent') continue;
      if (e.start.dateTime) blocks.push({ s: new Date(e.start.dateTime), e: new Date(e.end.dateTime || e.start.dateTime) });
    }
  } catch (e) { console.error('booking ical', e.message); }
  if (await google.linked(owner)) { try { blocks.push(...await google.busy(owner, from, to)); } catch (e) { console.error('booking freebusy', e.message); } }
  for (const b of await listCol(owner, 'bookings')) if (b.status !== 'cancelled' && b.start) blocks.push({ s: new Date(b.start), e: new Date(b.end), booking: true });
  return blocks;
}

export async function openSlots(owner, now = new Date()) {
  const cfg = await settings(owner);
  const to = new Date(now.getTime() + (cfg.horizonDays + 1) * 864e5);
  return { cfg, days: computeDays(cfg, await busyBlocks(owner, now, to), now) };
}

// Pure slot math (tested in scripts/test/booking-test.mjs).
export function computeDays(cfg, blocks, now = new Date()) {
  const today = localParts(now).date;
  const from = new Date(now.getTime() + cfg.noticeHours * 3600e3);
  const buf = cfg.bufferMin * 60e3, len = cfg.minutes * 60e3;
  const days = [];
  for (let i = 0; i <= cfg.horizonDays; i++) {
    const day = addDays(today, i), windows = cfg.hours[dowOf(day)] || [];
    const booked = blocks.filter(b => b.booking && localParts(b.s).date === day).length;
    const slots = [];
    if (booked < cfg.maxPerDay) {
      for (const [a, b] of windows) {
        const end = zoned(day, b);
        for (let s = zoned(day, a); s.getTime() + len <= end.getTime(); s = new Date(s.getTime() + cfg.step * 60e3)) {
          const e = new Date(s.getTime() + len);
          if (s < from) continue;
          if (blocks.some(x => x.s.getTime() < e.getTime() + buf && x.e.getTime() > s.getTime() - buf)) continue;
          slots.push(s.toISOString());
        }
      }
    }
    if (windows.length) days.push({ date: day, slots });
  }
  return days;
}

const emailOk = s => /^[^\s@<>()]+@[^\s@<>()]+\.[a-z]{2,}$/i.test(s);
const clean = (s, n) => String(s || '').replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

export async function book(owner, input) {
  if (input.website) throw new HttpError(400, 'bad_request'); // bots fill the hidden field
  const name = clean(input.name, 80), email = clean(input.email, 120).toLowerCase(), topic = String(input.topic || '').replace(/[<>]/g, '').trim().slice(0, 1000);
  if (name.length < 2) throw new HttpError(400, 'need_name', 'Please add your name.');
  if (!emailOk(email)) throw new HttpError(400, 'need_email', 'Please check your email address.');
  const start = new Date(String(input.start || ''));
  if (isNaN(start)) throw new HttpError(400, 'bad_time');
  const recent = (await listCol(owner, 'bookings')).filter(b => b.email === email && b.status !== 'cancelled' && new Date(b.createdAt) > new Date(Date.now() - 864e5));
  if (recent.length >= 2) throw new HttpError(429, 'too_many', 'You already have sessions booked. Reach out directly to add more.');
  const { cfg, days } = await openSlots(owner);
  if (!days.some(d => d.slots.includes(start.toISOString()))) throw new HttpError(409, 'slot_taken', 'That time was just taken. Please pick another.');
  const end = new Date(start.getTime() + cfg.minutes * 60e3);
  const id = crypto.randomBytes(9).toString('base64url');
  const ownerName = env('OWNER_NAME', 'Courtney');
  const rec = { id, name, email, topic, start: start.toISOString(), end: end.toISOString(), title: cfg.title, status: 'confirmed', createdAt: new Date().toISOString(), calendar: 'pending' };
  await setDoc(owner, 'bookings/' + id, rec);
  if (await google.linked(owner)) {
    try {
      const ev = await google.addEvent(owner, { start, end, requestId: id, guestEmail: email, guestName: name, summary: `${cfg.title}: ${name} × ${ownerName}`, description: `${topic ? 'What we’ll work on:\n' + topic + '\n\n' : ''}Booked through Ether.` });
      Object.assign(rec, { calendar: 'google', eventId: ev.id, meet: ev.meet, eventLink: ev.htmlLink });
    } catch (e) { rec.calendar = 'failed'; rec.calendarError = e.message; }
    await setDoc(owner, 'bookings/' + id, rec);
  }
  const when = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(start);
  try { await notify(owner, { title: 'New booking ✦', body: `${name} booked ${cfg.title.toLowerCase()} for ${when}.${rec.calendar === 'failed' ? ' It didn’t make it onto Google Calendar, so add it by hand.' : ''}`, tag: 'booking-' + id, url: '/?open=schedule' }); } catch (e) {}
  return { id, start: rec.start, end: rec.end, title: cfg.title, owner: ownerName, meet: rec.meet || '', invited: rec.calendar === 'google' };
}

// A calendar file the guest can add themselves (works with any calendar app).
export function ics({ id, start, end, title, owner, meet }) {
  const f = d => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Ether//Booking//EN', 'METHOD:PUBLISH', 'BEGIN:VEVENT', `UID:${id}@ether`, `DTSTAMP:${f(Date.now())}`, `DTSTART:${f(start)}`, `DTEND:${f(end)}`, `SUMMARY:${title} with ${owner}`, meet ? `LOCATION:${meet}` : '', meet ? `DESCRIPTION:Join: ${meet}` : '', 'END:VEVENT', 'END:VCALENDAR'].filter(Boolean).join('\r\n');
}
