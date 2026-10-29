import { readFileSync } from 'node:fs';
import { pickNine } from '../../lib/nine.js';
const d = JSON.parse(readFileSync(process.env.EXPORT, 'utf8')).docs.filter(x => x.path.startsWith('items/')).map(x => ({ id: x.path.slice(6), ...x.data }));
for (const day of ['2026-10-30', '2026-10-31']) { const n = pickNine(d, day); console.log(day, 'MUST', n.must.map(x => x.area + ':' + x.title)); }
