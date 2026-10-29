// Local test server: serves the app with a fake database and fake AI so the UI can be exercised end to end.
import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { expand } from '../../lib/calendar.js';
const root = new URL('../../public/', import.meta.url).pathname;
const ics = readFileSync(new URL('./sample.ics', import.meta.url), 'utf8');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.wasm': 'application/wasm', '.onnx': 'application/octet-stream' };
export const log = [];
const readBody = req => new Promise(r => { let b = ''; req.on('data', c => b += c); req.on('end', () => { try { r(JSON.parse(b || '{}')); } catch (e) { r({}); } }); });
const json = (res, s, o) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
export function start(port = 5179) {
  return new Promise(resolve => {
    const srv = http.createServer(async (req, res) => {
      const url = new URL(req.url, 'http://x');
      if (url.pathname === '/vendor/supabase.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); return res.end(readFileSync(new URL('./fake-supabase.js', import.meta.url))); }
      if (url.pathname === '/api/config') return json(res, 200, { supabaseUrl: 'x', supabaseAnonKey: 'y', voice: 'marin', wakeWord: 'hey_jarvis', features: { brain: true, voice: false, spotify: true, shopify: true, calendar: true, planable: false } });
      if (url.pathname === '/api/brain') { const b = await readBody(req); log.push(['brain', b]); const last = b.messages[b.messages.length - 1];
        const hasTool = b.tools && b.tools.find(t => t.name === 'spotify_find');
        const texts = last.content.filter(c => c.type === 'text'); const said = texts.length ? texts[texts.length - 1].text : JSON.stringify(last.content); const userAsk = (() => { for (let i = b.messages.length - 1; i >= 0; i--) { const t = b.messages[i].content.filter(c => c.type === 'text'); if (b.messages[i].role === 'user' && t.length) return t[t.length - 1].text; } return ''; })();
        if (/play/i.test(said) && hasTool) return json(res, 200, { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'spotify_find', input: { query: 'golden hour' } }] });
        if (last.content.some(c => c.type === 'tool_result') && !/"t2"/.test(JSON.stringify(b.messages))) return json(res, 200, { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't2', name: 'spotify_play', input: { uri: 'spotify:track:abc' } }] });
        return json(res, 200, { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ reply: /play/i.test(userAsk) ? 'Playing Golden Hour on your iPad.' : 'Added it for tomorrow.', add: /play/i.test(userAsk) ? [] : [{ title: 'Test task from voice', area: 'life', due: null, priority: 'p1', mins: 15 }] }) }] }); }
      if (url.pathname === '/api/tools') { const b = await readBody(req); log.push(['tools', b.server, b.tool, b.args]);
        if (b.server === 'Google Calendar' && b.tool === 'list_calendars') return json(res, 200, { calendars: [{ id: 'cal0', summary: 'Personal' }] });
        if (b.server === 'Google Calendar' && b.tool === 'list_events') { const now = Date.now(); return json(res, 200, { events: expand(ics, new Date(now - 8 * 864e5), new Date(now + 9 * 864e5)) }); }
        if (b.server === 'Shopify') return json(res, 200, { totalCount: 2, orders: [{ name: '#1001', createdAt: new Date().toISOString(), totalPrice: '48.00', currencyCode: 'USD' }, { name: '#1002', createdAt: new Date().toISOString(), totalPrice: '30.00', currencyCode: 'USD' }] });
        if (b.server === 'Spotify' && b.tool === 'search') return json(res, 200, { entities: [{ name: 'Golden Hour', creators: [{ name: 'JVKE' }], entity_type: 'MUSIC', kind: 'track', uri: 'spotify:track:abc' }] });
        if (b.server === 'Spotify' && b.tool === 'play') return json(res, 200, { ok: true, device: 'Courtney’s iPad' });
        if (b.server === 'Spotify' && b.tool === 'status') return json(res, 200, { linked: false });
        return json(res, 404, { error: 'nope', code: 'not_in_manifest' }); }
      if (url.pathname === '/api/transcribe') { const b = await readBody(req); log.push(['transcribe', (b.audio || '').length, b.mime]); return json(res, 200, { text: 'remind me to water the plants' }); }
      if (url.pathname === '/api/tts') return json(res, 503, { error: 'off', code: 'voice_not_configured' });
      if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'not in test server' });
      let p = join(root, url.pathname === '/' ? 'index.html' : url.pathname);
      if (!existsSync(p) || statSync(p).isDirectory()) { res.writeHead(404); return res.end('nf'); }
      res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' }); res.end(readFileSync(p));
    });
    srv.listen(port, () => resolve(srv));
  });
}
