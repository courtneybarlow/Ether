// Spotify: search and real playback control on Courtney's devices (Spotify Connect; needs Premium).
import crypto from 'node:crypto';
import { env, HttpError, vaultGet, vaultSet } from './core.js';

const SCOPES = 'user-read-playback-state user-modify-playback-state user-read-currently-playing user-read-recently-played playlist-read-private user-library-read';
export const redirectUri = req => env('SPOTIFY_REDIRECT_URI') || `https://${req.headers['x-forwarded-host'] || req.headers.host}/api/spotify-callback`;

const sign = s => crypto.createHmac('sha256', env('SPOTIFY_CLIENT_SECRET') || 'x').update(s).digest('base64url');
export function loginUrl(req, owner) {
  const payload = Buffer.from(JSON.stringify({ o: owner, t: Date.now() })).toString('base64url');
  const state = payload + '.' + sign(payload);
  const q = new URLSearchParams({ response_type: 'code', client_id: env('SPOTIFY_CLIENT_ID'), scope: SCOPES, redirect_uri: redirectUri(req), state });
  return 'https://accounts.spotify.com/authorize?' + q;
}
export function checkState(state) {
  const [p, s] = String(state || '').split('.');
  if (!p || sign(p) !== s) throw new HttpError(400, 'bad_state');
  const o = JSON.parse(Buffer.from(p, 'base64url').toString());
  if (Date.now() - o.t > 15 * 60 * 1000) throw new HttpError(400, 'state_expired');
  return o.o;
}
const basic = () => 'Basic ' + Buffer.from(env('SPOTIFY_CLIENT_ID') + ':' + env('SPOTIFY_CLIENT_SECRET')).toString('base64');
async function tokenCall(params) {
  const r = await fetch('https://accounts.spotify.com/api/token', { method: 'POST', headers: { Authorization: basic(), 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new HttpError(502, 'needs_reauth', 'Spotify token error: ' + (j.error_description || j.error || r.status));
  return j;
}
export async function finishLogin(req, owner, code) {
  const j = await tokenCall({ grant_type: 'authorization_code', code, redirect_uri: redirectUri(req) });
  await vaultSet(owner, 'spotify', { refresh_token: j.refresh_token, access_token: j.access_token, exp: Date.now() + j.expires_in * 1000 });
}
async function access(owner) {
  const v = await vaultGet(owner, 'spotify');
  if (!v || !v.refresh_token) throw new HttpError(409, 'spotify_not_linked', 'Spotify isn’t linked yet');
  if (v.access_token && v.exp > Date.now() + 60000) return v.access_token;
  const j = await tokenCall({ grant_type: 'refresh_token', refresh_token: v.refresh_token });
  await vaultSet(owner, 'spotify', { refresh_token: j.refresh_token || v.refresh_token, access_token: j.access_token, exp: Date.now() + j.expires_in * 1000 });
  return j.access_token;
}
async function sp(owner, method, path, bodyObj) {
  const r = await fetch('https://api.spotify.com/v1' + path, { method, headers: { Authorization: 'Bearer ' + (await access(owner)), ...(bodyObj ? { 'Content-Type': 'application/json' } : {}) }, body: bodyObj ? JSON.stringify(bodyObj) : undefined });
  if (r.status === 204) return null;
  const j = await r.json().catch(() => null);
  if (!r.ok) {
    const reason = j && j.error && (j.error.reason || j.error.message);
    if (r.status === 403 && /PREMIUM/i.test(reason || '')) throw new HttpError(403, 'premium_required', 'Spotify Premium is required for playback control');
    if (r.status === 404 && /device/i.test(reason || '')) throw new HttpError(409, 'no_device', 'No active Spotify device');
    throw new HttpError(502, 'spotify_error', `Spotify ${r.status}: ${reason || ''}`);
  }
  return j;
}

const TYPE = { track: 'MUSIC', album: 'COLLECTION', playlist: 'COLLECTION', artist: 'CREATOR', episode: 'TALK', show: 'TALK' };
function ent(x, type) {
  if (!x) return null;
  const creators = x.artists ? x.artists.map(a => ({ name: a.name })) : x.owner ? [{ name: x.owner.display_name }] : x.show ? [{ name: x.show.name }] : x.publisher ? [{ name: x.publisher }] : [];
  return { name: x.name, creators, entity_type: TYPE[type], kind: type, url: x.external_urls && x.external_urls.spotify, uri: x.uri };
}
export async function search(owner, args) {
  const q = String(args.prompt || args.query || '').slice(0, 200);
  if (!q) return { entities: [] };
  const j = await sp(owner, 'GET', `/search?${new URLSearchParams({ q, type: 'track,artist,album,playlist,episode', limit: '4', market: 'from_token' })}`);
  const pick = (k, t, n) => ((j && j[k] && j[k].items) || []).filter(Boolean).slice(0, n).map(x => ent(x, t));
  const entities = [...pick('tracks', 'track', 3), ...pick('artists', 'artist', 1), ...pick('albums', 'album', 1), ...pick('playlists', 'playlist', 2), ...pick('episodes', 'episode', 1)].filter(Boolean);
  return { entities, explanations: [] };
}
export async function devices(owner) {
  const j = await sp(owner, 'GET', '/me/player/devices');
  return { devices: ((j && j.devices) || []).map(d => ({ id: d.id, name: d.name, type: d.type, active: d.is_active, volume: d.volume_percent })) };
}
async function pickDevice(owner, wanted) {
  const { devices: ds } = await devices(owner);
  if (!ds.length) throw new HttpError(409, 'no_device', 'Open Spotify on the iPad (or a speaker) once, then try again');
  if (wanted) { const w = ds.find(d => d.id === wanted || d.name.toLowerCase().includes(String(wanted).toLowerCase())); if (w) return w; }
  return ds.find(d => d.active) || ds.find(d => /tablet/i.test(d.type)) || ds.find(d => /speaker|avr|tv/i.test(d.type)) || ds.find(d => /smartphone/i.test(d.type)) || ds[0];
}
export async function play(owner, args) {
  const d = await pickDevice(owner, args.device);
  const uri = String(args.uri || '');
  const bodyObj = !uri ? undefined : /^spotify:(track|episode):/.test(uri) ? { uris: [uri] } : { context_uri: uri };
  if (!d.active) { try { await sp(owner, 'PUT', '/me/player', { device_ids: [d.id], play: false }); } catch (e) {} }
  await sp(owner, 'PUT', `/me/player/play?device_id=${encodeURIComponent(d.id)}`, bodyObj);
  return { ok: true, device: d.name };
}
export async function control(owner, op, args) {
  if (op === 'pause') { await sp(owner, 'PUT', '/me/player/pause'); return { ok: true }; }
  if (op === 'resume') return play(owner, {});
  if (op === 'next') { await sp(owner, 'POST', '/me/player/next'); return { ok: true }; }
  if (op === 'previous') { await sp(owner, 'POST', '/me/player/previous'); return { ok: true }; }
  if (op === 'volume') { await sp(owner, 'PUT', `/me/player/volume?volume_percent=${Math.max(0, Math.min(100, Number(args.percent) || 50))}`); return { ok: true }; }
  if (op === 'now') {
    const j = await sp(owner, 'GET', '/me/player');
    if (!j || !j.item) return { playing: false };
    return { playing: !!j.is_playing, name: j.item.name, by: (j.item.artists || []).map(a => a.name).join(', ') || (j.item.show && j.item.show.name) || '', device: j.device && j.device.name, uri: j.item.uri };
  }
  throw new HttpError(400, 'unknown_op');
}
export async function linked(owner) { const v = await vaultGet(owner, 'spotify'); return { linked: !!(v && v.refresh_token) }; }
