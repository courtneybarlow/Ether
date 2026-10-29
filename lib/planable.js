// "Posting today" from Planable's public API (read only; needs a Pro/Enterprise token in PLANABLE_TOKEN).
import { env, hm } from './core.js';

const BASE = 'https://api.planable.io/api/v1';
async function get(path, q = {}) {
  const r = await fetch(BASE + path + '?' + new URLSearchParams(q), { headers: { Authorization: 'Bearer ' + env('PLANABLE_TOKEN') } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('planable ' + r.status + ' ' + ((j.error && j.error.message) || ''));
  return j.data || [];
}
const PLATFORM = { instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok', linkedin: 'LinkedIn', twitter: 'X', x: 'X', youtube: 'YouTube', pinterest: 'Pinterest', threads: 'Threads', googlemybusiness: 'Google' };

export async function postingSoon(now = new Date()) {
  if (!env('PLANABLE_TOKEN')) return null;
  const match = new RegExp(env('PLANABLE_WORKSPACES', 'seven|swc|wellness|november'), 'i');
  const spaces = (await get('/workspaces')).filter(w => match.test(w.name || ''));
  const out = [];
  const from = new Date(now.getTime() - 6 * 3600e3).toISOString(), to = new Date(now.getTime() + 54 * 3600e3).toISOString();
  for (const w of spaces) {
    const pages = Object.fromEntries((await get('/pages', { workspaceId: w.id, limit: '50' })).map(p => [p.id, p]));
    const posts = await get('/posts', { workspaceId: w.id, scheduledAfter: from, scheduledBefore: to, limit: '50' });
    for (const p of posts) {
      if (p.archived || p.published) continue;
      const pg = pages[p.pageId] || {};
      const pending = p.approval && ['PENDING', 'PARTIALLY_APPROVED', 'NEVER_SENT'].includes(p.approval.status) && p.approval.type !== 'NONE';
      const status = /draft/i.test(p.status || '') ? 'Draft' : pending ? 'Needs approval' : 'Scheduled';
      const text = (p.universalTitle || p.plainText || (p.type || 'Post')).replace(/\s+/g, ' ').trim();
      out.push({
        at: p.scheduledAt,
        time: p.scheduledAt ? hm(new Date(p.scheduledAt)) : '',
        title: (text.length > 58 ? text.slice(0, 57) + '…' : text) || 'Post',
        channel: PLATFORM[String(pg.platform || '').toLowerCase()] || pg.name || '',
        status,
        workspace: w.name
      });
    }
  }
  return out.sort((a, b) => String(a.at).localeCompare(String(b.at))).slice(0, 8);
}
