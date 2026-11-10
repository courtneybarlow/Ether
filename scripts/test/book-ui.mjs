import { createRequire } from 'node:module';
import { start, log } from './server.mjs';
const { chromium } = createRequire(import.meta.url)('playwright');
const srv = await start(5185);
const OUT = process.env.OUT;
const b = await chromium.launch();
for (const [w, h, name, tz] of [[1280, 860, 'desk', 'America/Chicago'], [390, 844, 'phone', 'America/New_York']]) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, timezoneId: tz, deviceScaleFactor: 2 });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:5185/book.html'); await p.waitForSelector('.time');
  await p.screenshot({ path: `${OUT}/book-${name}-1.png`, fullPage: name === 'phone' });
  await p.click('.time');
  await p.fill('input[name=name]', 'Jessie Morgan'); await p.fill('input[name=email]', 'jessie@example.com'); await p.fill('textarea[name=topic]', 'Spring campaign plan for the book launch.');
  await p.screenshot({ path: `${OUT}/book-${name}-2.png`, fullPage: name === 'phone' });
  await p.click('#go'); await p.waitForSelector('#v-done:not([hidden])');
  await p.waitForTimeout(250);
  await p.screenshot({ path: `${OUT}/book-${name}-3.png`, fullPage: name === 'phone' });
  console.log(name, 'errors', errs, 'ics', await p.getAttribute('#d-ics', 'href').then(x => x.slice(0, 30)));
}
console.log('posted', JSON.stringify(log.filter(l => l[0] === 'book').map(l => l[1])));
await b.close(); srv.close();
