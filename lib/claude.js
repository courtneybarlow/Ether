// Ether's brain: Claude through Courtney's own Anthropic developer account.
import { env, HttpError } from './core.js';

export const MODEL = () => env('ETHER_MODEL', 'claude-sonnet-5-5');

export async function claude({ system, messages, tools, max_tokens = 2048, model }) {
  const key = env('ANTHROPIC_API_KEY');
  if (!key) throw new HttpError(500, 'brain_not_configured', 'ANTHROPIC_API_KEY is missing');
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: model || MODEL(), max_tokens, system, messages, ...(tools && tools.length ? { tools } : {}) })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const type = j && j.error && j.error.type;
    const code = r.status === 429 || type === 'rate_limit_error' ? 'rate_limited' : r.status === 529 || type === 'overloaded_error' ? 'overloaded' : r.status === 401 ? 'brain_key_invalid' : r.status === 400 && /credit/i.test(JSON.stringify(j)) ? 'brain_out_of_credit' : 'brain_error';
    throw new HttpError(r.status === 429 ? 429 : 502, code, (j.error && j.error.message) || 'Claude request failed');
  }
  return j;
}

export const textOf = res => (res.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n').trim();

export function parseJSON(text) {
  const t = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try { return JSON.parse(t); } catch (e) {}
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
  throw new Error('invalid_json');
}

// One-shot research call with web search, returning parsed JSON.
export async function researchJSON(prompt, { maxUses = 6, max_tokens = 3000, location = true } = {}) {
  const tool = { type: 'web_search_20250305', name: 'web_search', max_uses: maxUses };
  if (location) tool.user_location = { type: 'approximate', city: 'Nashville', region: 'Tennessee', country: 'US', timezone: env('ETHER_TZ', 'America/Chicago') };
  const res = await claude({
    system: 'You research current facts carefully and reply with ONLY the JSON object requested, no prose, no code fences.',
    messages: [{ role: 'user', content: prompt }],
    tools: [tool],
    max_tokens
  });
  return parseJSON(textOf(res));
}
