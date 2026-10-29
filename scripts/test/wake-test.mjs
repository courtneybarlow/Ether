import { createRequire } from 'node:module';
import { start } from './server.mjs';
const { chromium } = createRequire(import.meta.url)('playwright');
import { readFileSync } from 'node:fs';
const srv = await start(5180);
const b = await chromium.launch();
const p = await b.newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.text()); });
await p.goto('http://localhost:5180/manifest.webmanifest');
for (const f of ['HeyJarvis.wav', 'HeyJarviswhatsonmyca.wav', 'Goodmorninghowareyou.wav']) {
  const b64 = readFileSync(new URL('./' + f, import.meta.url)).toString('base64');
  const score = await p.evaluate(async b64 => {
    const mod = await import('/vendor/oww/WakeWordEngine.js');
    const ort = await import('/vendor/ort/ort.wasm.min.mjs'); ort.env.wasm.wasmPaths = '/vendor/ort/'; ort.env.wasm.numThreads = 1;
    window.__eng = window.__eng || new mod.WakeWordEngine({ baseAssetUrl: '/models', keywords: ['hey_jarvis'], ortWasmPath: '/vendor/ort/' });
    await window.__eng.load();
    const buf = Uint8Array.from(atob(b64), c => c.charCodeAt(0)).buffer;
    return await window.__eng.runWav(buf);
  }, b64);
  console.log(f.padEnd(30), score.toFixed(3));
}
console.log('errors', errs.slice(0, 5));
await b.close(); srv.close();
