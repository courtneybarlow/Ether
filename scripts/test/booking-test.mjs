import { computeDays, zoned, DEFAULTS } from '../../lib/booking.js';
const show = d => new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(d));
// DST check: Nov 1 2026 is the switch. 5:30 pm CT on Oct 30 (CDT) and Nov 2 (CST).
console.log('zoned CDT', zoned('2026-10-30', '17:30').toISOString(), ' CST', zoned('2026-11-02', '17:30').toISOString());
const now = new Date('2026-11-10T18:50:00Z'); // Tue 12:50 pm CT
const blocks = [
  { s: new Date('2026-11-10T23:45:00Z'), e: new Date('2026-11-11T00:45:00Z') },          // Tue 5:45–6:45 pm event
  { s: new Date('2026-11-14T17:00:00Z'), e: new Date('2026-11-14T18:00:00Z') },          // Sat 11–12 event
  { s: new Date('2026-11-12T23:30:00Z'), e: new Date('2026-11-13T00:30:00Z'), booking: true },
  { s: new Date('2026-11-13T00:30:00Z'), e: new Date('2026-11-13T01:30:00Z'), booking: true } // Thu: two bookings = full
];
const days = computeDays(DEFAULTS, blocks, now);
for (const d of days.slice(0, 7)) console.log(d.date, d.slots.length ? d.slots.map(s => show(s).split(', ').pop()).join(' | ') : '(none)');
console.log('days with windows in 3 weeks:', days.length, 'open slots total:', days.reduce((a, d) => a + d.slots.length, 0));
