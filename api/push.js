// /api/push?op=key | subscribe | unsubscribe | test
import { handle, send, body, requireUser, HttpError } from '../lib/core.js';
import { vapid, subscribe, unsubscribe, notify } from '../lib/push.js';

export default handle(async (req, res) => {
  const user = await requireUser(req);
  const op = new URL(req.url, 'https://x').searchParams.get('op');
  if (op === 'key') return send(res, 200, { publicKey: (await vapid(user.id)).publicKey });
  if (req.method !== 'POST') throw new HttpError(405, 'method');
  const b = body(req);
  if (op === 'subscribe') { await subscribe(user.id, b.subscription, b.device); return send(res, 200, { ok: true }); }
  if (op === 'unsubscribe') { await unsubscribe(b.endpoint); return send(res, 200, { ok: true }); }
  if (op === 'test') return send(res, 200, await notify(user.id, { title: 'Ether', body: 'Notifications are on. I’ll keep these short and useful.', tag: 'test' }));
  throw new HttpError(400, 'unknown_op');
});
