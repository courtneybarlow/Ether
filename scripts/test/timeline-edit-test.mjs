// Timeline: tap empty time → add event; tap event → change it; remove it. All through the calendar tools.
import { createRequire } from 'node:module';
import { start, liveCal, log } from './server.mjs';
const { chromium } = createRequire(import.meta.url)('playwright');
const OUT = process.env.OUT || '.';
const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date());
const at = (h, m) => new Date(`${day}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`).toISOString();
liveCal.on = true;
liveCal.events = [{ id: 'g100', gid: 'g100', gcal: 'me@x.com', editable: true, summary: 'Leslie Content', status: 'confirmed', start: { dateTime: at(16, 0) }, end: { dateTime: at(17, 0) } }];
const srv = await start(5190);
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1180, height: 820 }, timezoneId: 'America/Chicago' });
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto('http://localhost:5190/');
await p.fill('#ether-login input[name=email]', 'c@x.com'); await p.fill('#ether-login input[name=password]', 'pw'); await p.click('#ether-login button');
await p.waitForSelector('.tl-ev', { timeout: 8000 });
// 1. tap empty spot at ~6pm
const box = await (await p.$('#timeline .tl-in')).boundingBox();
const xAt = h => box.x + (h - 7) / 16 * box.width;
await p.mouse.move(xAt(18), box.y + 29); await p.waitForTimeout(150);
const ghost = await p.$eval('.tl-ghost b', e => e.textContent).catch(() => null);
await p.mouse.click(xAt(18), box.y + 29);
await p.waitForSelector('#tl-pop');
const pre = await p.evaluate(() => ({ s: document.getElementById('tlp-s').value, e: document.getElementById('tlp-e').value }));
await p.fill('#tlp-title', 'King Bath');
await p.click('[data-len="90"]');
await p.screenshot({ path: OUT + '/tl-new.png' });
await p.click('#tlp-save');
await p.waitForTimeout(700);
const afterAdd = await p.$$eval('.tl-ev', els => els.map(e => e.dataset.tip));
// 2. tap Leslie, extend to 5:30
{ const lb = await p.evaluateHandle(() => [...document.querySelectorAll('.tl-ev')].find(e => /Leslie/.test(e.dataset.tip))); await lb.click(); }
await p.waitForSelector('#tl-pop'); await p.waitForTimeout(400);
await p.fill('#tlp-e', '17:30');
await p.screenshot({ path: OUT + '/tl-edit.png' });
await p.click('#tlp-save'); await p.waitForTimeout(700);
// 3. remove King Bath (two taps)
await p.evaluate(() => [...document.querySelectorAll('.tl-ev')].find(e => /King Bath/.test(e.dataset.tip)).click());
await p.waitForSelector('#tlp-del'); await p.click('#tlp-del'); const armed = await p.$eval('#tlp-del', e => e.textContent); await p.click('#tlp-del'); await p.waitForTimeout(700);
const final = await p.$$eval('.tl-ev', els => els.map(e => e.dataset.tip));
const calls = log.filter(l => l[0] === 'tools' && /create|update|delete/.test(l[2])).map(l => [l[2], l[3].summary || '', l[3].start ? new Date(l[3].start).toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' }) : '', l[3].end ? new Date(l[3].end).toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' }) : '']);
console.log(JSON.stringify({ ghost, pre, afterAdd, armed, final, calls, caption: await p.$eval('#caption', e => e.textContent), errs }, null, 1));
await b.close(); srv.close();
