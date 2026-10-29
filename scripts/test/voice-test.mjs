import { createRequire } from 'node:module';
import { start, log } from './server.mjs';
const { chromium } = createRequire(import.meta.url)('playwright');
const srv = await start(5182);
const wav = new URL('./HeyJarvis.wav', import.meta.url).pathname;
const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-file-for-fake-audio-capture=' + wav, '--autoplay-policy=no-user-gesture-required'] });
const ctx = await b.newContext({ viewport: { width: 1180, height: 820 }, permissions: ['microphone'] });
const p = await ctx.newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (/wake|error/i.test(m.text())) errs.push(m.type() + ': ' + m.text().slice(0, 200)); });
await p.addInitScript(() => { window.__SEED = []; localStorage.setItem('ether-wake', '1'); });
await p.goto('http://localhost:5182/');
await p.fill('#ether-login input[name=email]', 'c@x.com'); await p.fill('#ether-login input[name=password]', 'pw'); await p.click('#ether-login button');
await p.waitForTimeout(1200);
await p.mouse.click(600, 300); // first tap starts listening
// The fake mic loops "Hey Jarvis" so the wake word should fire, then the mic records and the transcript gets submitted.
const ok = await p.waitForFunction(() => [...window.__rows.values()].some(r => r.path.startsWith('log/') && /water the plants/.test(r.data.text || '')), null, { timeout: 45000 }).then(() => true).catch(() => false);
console.log('wake→listen→submit:', ok, log.filter(l => l[0] === 'transcribe'));
console.log('wake state:', await p.evaluate(() => ({ enabled: EtherWake.enabled, running: EtherWake.running })));
console.log(errs.slice(0, 8));
await b.close(); srv.close();
