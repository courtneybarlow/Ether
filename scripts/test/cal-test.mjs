import { readFileSync } from 'node:fs';
import { expand } from '../../lib/calendar.js';
const ev = expand(readFileSync(new URL('./sample.ics', import.meta.url), 'utf8'), new Date('2026-10-28T00:00:00Z'), new Date('2026-11-08T00:00:00Z'));
for (const e of ev) console.log(e.status.padEnd(10), (e.start.dateTime || e.start.date).padEnd(26), e.summary);
