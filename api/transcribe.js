// POST /api/transcribe  { audio: base64, mime }  →  { text }. What Courtney said, from the mic.
import { handle, send, body, requireUser, env, HttpError } from '../lib/core.js';

export default handle(async (req, res) => {
  if (req.method !== 'POST') throw new HttpError(405, 'method');
  await requireUser(req);
  const key = env('OPENAI_API_KEY');
  if (!key) throw new HttpError(503, 'voice_not_configured');
  const b = body(req);
  const buf = Buffer.from(String(b.audio || ''), 'base64');
  if (buf.length < 800) return send(res, 200, { text: '' });
  const mime = String(b.mime || 'audio/mp4');
  const ext = /webm/.test(mime) ? 'webm' : /ogg/.test(mime) ? 'ogg' : /wav/.test(mime) ? 'wav' : 'mp4';
  const form = new FormData();
  form.append('file', new Blob([buf], { type: mime }), 'speech.' + ext);
  form.append('model', env('ETHER_STT_MODEL', 'gpt-4o-mini-transcribe'));
  form.append('language', 'en');
  form.append('prompt', 'Courtney talking to Ether, her assistant. Names: Seven Wellness Club (SWC), November Social, Alterra, 85SIXTY, Solidcore, Sweat House, Planable, Nashville.');
  const r = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: 'Bearer ' + key }, body: form });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const m = (j.error && j.error.message) || String(r.status); throw new HttpError(502, /insufficient_quota|no credits/i.test(JSON.stringify(j)) ? 'voice_no_credit' : r.status === 401 ? 'voice_key_invalid' : 'transcribe_error', m); }
  send(res, 200, { text: String(j.text || '').trim() });
});
