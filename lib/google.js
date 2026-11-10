// Google Calendar for bookings: Courtney connects once; Ether can then check busy times
// and add booked sessions (with a Google Meet link and an invite to the guest).
import crypto from 'node:crypto';
import { env, HttpError, vaultGet, vaultSet } from './core.js';

const SCOPES = 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.freebusy';
export const configured = () => !!(env('GOOGLE_CLIENT_ID') && env('GOOGLE_CLIENT_SECRET'));
const redirectUri = req => env('GOOGLE_REDIRECT_URI') || `https://${req.headers['x-forwarded-host'] || req.headers.host}/api/google-callback`;
const sign = s => crypto.createHmac('sha256', env('GOOGLE_CLIENT_SECRET') || 'x').update(s).digest('base64url');

export function loginUrl(req, owner) {
  if (!configured()) throw new HttpError(400, 'google_not_configured', 'Google isn’t set up on the server yet');
  const p = Buffer.from(JSON.stringify({ o: owner, t: Date.now() })).toString('base64url');
  const q = new URLSearchParams({ client_id: env('GOOGLE_CLIENT_ID'), redirect_uri: redirectUri(req), response_type: 'code', scope: SCOPES, access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state: p + '.' + sign(p) });
  return 'https://accounts.google.com/o/oauth2/v2/auth?' + q;
}
export function checkState(state) {
  const [p, s] = String(state || '').split('.');
  if (!p || sign(p) !== s) throw new HttpError(400, 'bad_state');
  const o = JSON.parse(Buffer.from(p, 'base64url').toString());
  if (Date.now() - o.t > 15 * 60 * 1000) throw new HttpError(400, 'state_expired');
  return o.o;
}
async function tokenCall(params) {
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: env('GOOGLE_CLIENT_ID'), client_secret: env('GOOGLE_CLIENT_SECRET'), ...params }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new HttpError(502, 'google_reauth', 'Google token error: ' + (j.error_description || j.error || r.status));
  return j;
}
export async function finishLogin(req, owner, code) {
  const j = await tokenCall({ grant_type: 'authorization_code', code, redirect_uri: redirectUri(req) });
  const prev = (await vaultGet(owner, 'google')) || {};
  await vaultSet(owner, 'google', { refresh_token: j.refresh_token || prev.refresh_token, access_token: j.access_token, exp: Date.now() + j.expires_in * 1000, scope: j.scope });
}
export async function linked(owner) { const v = await vaultGet(owner, 'google'); return !!(configured() && v && v.refresh_token); }
async function access(owner) {
  const v = await vaultGet(owner, 'google');
  if (!v || !v.refresh_token) throw new HttpError(409, 'google_not_linked');
  if (v.access_token && v.exp > Date.now() + 60000) return v.access_token;
  const j = await tokenCall({ grant_type: 'refresh_token', refresh_token: v.refresh_token });
  await vaultSet(owner, 'google', { ...v, access_token: j.access_token, exp: Date.now() + j.expires_in * 1000 });
  return j.access_token;
}
async function g(owner, method, path, body) {
  const r = await fetch('https://www.googleapis.com/calendar/v3' + path, { method, headers: { Authorization: 'Bearer ' + (await access(owner)), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new HttpError(502, r.status === 401 ? 'google_reauth' : 'google_error', 'Google Calendar ' + r.status + ': ' + ((j.error && j.error.message) || ''));
  return j;
}
// Busy blocks on her primary Google calendar (fresher than the iCal feeds).
export async function busy(owner, from, to) {
  const j = await g(owner, 'POST', '/freeBusy', { timeMin: from.toISOString(), timeMax: to.toISOString(), items: [{ id: 'primary' }] });
  const c = (j.calendars && j.calendars.primary) || {};
  return (c.busy || []).map(b => ({ s: new Date(b.start), e: new Date(b.end) }));
}
// Add the session; Google emails the guest an invite with the Meet link.
export async function addEvent(owner, { start, end, summary, description, guestEmail, guestName, requestId }) {
  const ev = await g(owner, 'POST', '/calendars/primary/events?conferenceDataVersion=1&sendUpdates=all', {
    summary, description,
    start: { dateTime: start.toISOString(), timeZone: env('ETHER_TZ', 'America/Chicago') },
    end: { dateTime: end.toISOString(), timeZone: env('ETHER_TZ', 'America/Chicago') },
    attendees: [{ email: guestEmail, displayName: guestName }],
    conferenceData: { createRequest: { requestId, conferenceSolutionKey: { type: 'hangoutsMeet' } } },
    reminders: { useDefault: true },
    source: { title: 'Booked through Ether', url: 'https://' + (env('ETHER_HOST') || 'ether-one-rho.vercel.app') + '/book' }
  });
  const meet = ev.hangoutLink || ((ev.conferenceData && ev.conferenceData.entryPoints) || []).map(p => p.uri).find(u => /meet\.google/.test(u || '')) || '';
  return { id: ev.id, htmlLink: ev.htmlLink, meet };
}
