// Every task for today done → once-a-day supernova; tap hint stays empty.
import { createRequire } from 'node:module';
import { start } from './server.mjs';
const { chromium } = createRequire(import.meta.url)('playwright');
const OUT = process.env.OUT || '.';
const srv = await start(5187);
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1180, height: 820 } });
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.addInitScript(() => {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date());
  const now = new Date().toISOString();
  window.__SEED = [1, 2, 3, 4].map(i => ({ path: 'items/t' + i, data: { id: 't' + i, title: 'Task ' + i, area: 'swc', priority: 'p1', due: today, done: i > 1, doneAt: i > 1 ? now : null } }));
});
await p.goto('http://localhost:5187/');
await p.fill('#ether-login input[name=email]', 'c@x.com'); await p.fill('#ether-login input[name=password]', 'pw'); await p.click('#ether-login button');
await p.waitForTimeout(2500);
const before = await p.evaluate(() => ({ pct: document.getElementById('core-pct').textContent, hint: document.getElementById('core-hint').textContent }));
await p.evaluate(() => document.querySelector('.box[aria-checked="false"][data-id]')?.click());
await p.waitForTimeout(1100);
const mid = await p.evaluate(() => ({ pct: document.getElementById('core-pct').textContent, nova: document.body.classList.contains('supernova'), bursts: document.querySelectorAll('.burst').length, shocks: document.querySelectorAll('.shock').length, caption: document.getElementById('caption').textContent }));
await p.screenshot({ path: OUT + '/fullcharge.png' });
await p.waitForTimeout(2500);
const after = await p.evaluate(() => ({ full: document.body.classList.contains('fullcharge'), sub: document.getElementById('core-sub').textContent, left: document.querySelectorAll('.burst,.shock').length, flag: localStorage.getItem('ether-full-' + new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date())) }));
console.log(JSON.stringify({ before, mid, after, errs }));
await b.close(); srv.close();
