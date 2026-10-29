// POST /api/tts  { text, voice? }  →  audio/mpeg. Ether's natural voice (OpenAI).
// The model is a setting (ETHER_TTS_MODEL) so it can move to OpenAI's replacement before Jan 6, 2027.
import { handle, body, requireUser, env, HttpError } from '../lib/core.js';

const STYLE = 'Warm, calm and confident, like a trusted chief of staff who is also a friend. Natural pacing, light smile in the voice, never robotic or salesy.';

export default handle(async (req, res) => {
  if (req.method !== 'POST') throw new HttpError(405, 'method');
  await requireUser(req);
  const key = env('OPENAI_API_KEY');
  if (!key) throw new HttpError(503, 'voice_not_configured');
  const b = body(req);
  const text = String(b.text || '').slice(0, 1500).trim();
  if (!text) throw new HttpError(400, 'no_text');
  const model = env('ETHER_TTS_MODEL', 'gpt-4o-mini-tts');
  const payload = { model, voice: String(b.voice || env('ETHER_VOICE', 'marin')), input: text, response_format: 'mp3', speed: Math.max(0.7, Math.min(1.4, Number(b.speed) || 1)) };
  if (/gpt-/.test(model)) payload.instructions = STYLE;
  const r = await fetch('https://api.openai.com/v1/audio/speech', { method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  if (!r.ok) { const t = await r.text(); throw new HttpError(502, r.status === 429 ? 'rate_limited' : 'voice_error', t.slice(0, 300)); }
  res.statusCode = 200;
  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Cache-Control', 'no-store');
  res.end(Buffer.from(await r.arrayBuffer()));
});
