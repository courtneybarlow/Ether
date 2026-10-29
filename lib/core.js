// Shared server helpers: responses, login checks, database access.
import { createClient } from '@supabase/supabase-js';

export const env = (k, d) => (process.env[k] ?? d);
export const TZ = env('ETHER_TZ', 'America/Chicago');

let _admin = null;
export function admin() {
  if (!_admin) _admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false, autoRefreshToken: false } });
  return _admin;
}

export function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}
export class HttpError extends Error { constructor(status, code, msg) { super(msg || code); this.status = status; this.code = code; } }
export function handle(fn) {
  return async (req, res) => {
    try { await fn(req, res); }
    catch (e) {
      const status = e.status || 500;
      if (status >= 500) console.error(e);
      if (!res.headersSent) send(res, status, { error: e.message || 'error', code: e.code || 'error' });
    }
  };
}
export function body(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch (e) { return {}; } }
  return {};
}

// Only Courtney's account may use the server.
export async function requireUser(req) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!token) throw new HttpError(401, 'not_signed_in');
  const { data, error } = await admin().auth.getUser(token);
  if (error || !data || !data.user) throw new HttpError(401, 'not_signed_in');
  const owner = (env('OWNER_EMAIL', '') || '').toLowerCase();
  if (owner && (data.user.email || '').toLowerCase() !== owner) throw new HttpError(403, 'not_allowed');
  return data.user;
}
export function requireCron(req) {
  const s = env('CRON_SECRET');
  const h = req.headers.authorization || '';
  if (!s || h !== 'Bearer ' + s) throw new HttpError(401, 'bad_cron_secret');
}

let _ownerId = null;
export async function ownerId() {
  if (_ownerId) return _ownerId;
  const email = (env('OWNER_EMAIL', '') || '').toLowerCase();
  for (let page = 1; page < 20; page++) {
    const { data, error } = await admin().auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw error;
    const u = data.users.find(x => !email || (x.email || '').toLowerCase() === email);
    if (u) return (_ownerId = u.id);
    if (data.users.length < 100) break;
  }
  throw new HttpError(500, 'owner_not_found', 'No Supabase user matches OWNER_EMAIL');
}

/* ---- Documents (same paths the app uses) ---- */
const parentOf = p => p.split('/').slice(0, -1).join('/');
const lastOf = p => p.split('/').pop();
export async function getDoc(owner, path) {
  const { data, error } = await admin().from('docs').select('data,updated_at').eq('owner', owner).eq('path', path).maybeSingle();
  if (error) throw error;
  return data ? data.data : null;
}
export async function setDoc(owner, path, data) {
  const { error } = await admin().from('docs').upsert({ owner, path, parent: parentOf(path), id: lastOf(path), data, updated_at: new Date().toISOString() }, { onConflict: 'owner,path' });
  if (error) throw error;
}
export async function mergeDoc(owner, path, patch) {
  const cur = (await getDoc(owner, path)) || {};
  await setDoc(owner, path, { ...cur, ...patch });
}
export async function listCol(owner, parent) {
  const { data, error } = await admin().from('docs').select('id,data').eq('owner', owner).eq('parent', parent).limit(5000);
  if (error) throw error;
  return (data || []).map(r => ({ id: r.id, ...r.data }));
}

/* ---- Server-only vault ---- */
export async function vaultGet(owner, key) {
  const { data, error } = await admin().from('vault').select('value').eq('owner', owner).eq('key', key).maybeSingle();
  if (error) throw error;
  return data ? data.value : null;
}
export async function vaultSet(owner, key, value) {
  const { error } = await admin().from('vault').upsert({ owner, key, value, updated_at: new Date().toISOString() }, { onConflict: 'owner,key' });
  if (error) throw error;
}

/* ---- Local time helpers (America/Chicago by default) ---- */
export function localParts(d = new Date()) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false });
  const p = Object.fromEntries(f.formatToParts(d).map(x => [x.type, x.value]));
  const hour = Number(p.hour) % 24;
  return { date: `${p.year}-${p.month}-${p.day}`, hour, minute: Number(p.minute), mins: hour * 60 + Number(p.minute), dow: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday) };
}
export function addDays(ymd, n) { const [y, m, d] = ymd.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1, d + n)); return t.toISOString().slice(0, 10); }
export function diffDays(a, b) { const pa = a.split('-').map(Number), pb = b.split('-').map(Number); return Math.round((Date.UTC(pb[0], pb[1] - 1, pb[2]) - Date.UTC(pa[0], pa[1] - 1, pa[2])) / 86400000); }
export function dowOf(ymd) { const [y, m, d] = ymd.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); }
export function hm(d) { return new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }).format(d).toLowerCase().replace(':00', ''); }
