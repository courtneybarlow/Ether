// Real push notifications (Web Push) to the iPad and iPhone home-screen app.
// Notification keys are generated on first use and kept in the server-only vault (nothing to configure).
import webpush from 'web-push';
import { admin, env, vaultGet, vaultSet } from './core.js';

export async function vapid(owner) {
  let v = await vaultGet(owner, 'vapid');
  if (!v) { v = webpush.generateVAPIDKeys(); await vaultSet(owner, 'vapid', v); }
  return v;
}
export async function subscribe(owner, sub, device) {
  if (!sub || !sub.endpoint) throw new Error('bad_subscription');
  const { error } = await admin().from('push_subs').upsert({ endpoint: sub.endpoint, owner, sub, device: String(device || '').slice(0, 120) }, { onConflict: 'endpoint' });
  if (error) throw error;
}
export async function unsubscribe(endpoint) { await admin().from('push_subs').delete().eq('endpoint', endpoint); }

export async function notify(owner, { title = 'Ether', body = '', tag, url = '/' } = {}) {
  const v = await vapid(owner);
  webpush.setVapidDetails('mailto:' + (env('OWNER_EMAIL') || 'ether@example.com'), v.publicKey, v.privateKey);
  const { data, error } = await admin().from('push_subs').select('endpoint,sub').eq('owner', owner);
  if (error) throw error;
  let sent = 0;
  for (const row of data || []) {
    try { await webpush.sendNotification(row.sub, JSON.stringify({ title, body, tag, url }), { TTL: 3600, urgency: 'normal' }); sent++; }
    catch (e) { if (e.statusCode === 404 || e.statusCode === 410) await unsubscribe(row.endpoint); else console.error('push', e.statusCode, e.body); }
  }
  return { sent, devices: (data || []).length };
}
