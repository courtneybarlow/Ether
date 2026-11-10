// Public booking endpoint (no sign-in).  GET → open times.  POST { start, name, email, topic } → booked.
import { handle, send, body, ownerId, env, TZ, HttpError } from '../lib/core.js';
import { openSlots, book, ics } from '../lib/booking.js';

export default handle(async (req, res) => {
  const owner = await ownerId();
  if (req.method === 'GET') {
    const url = new URL(req.url, 'https://x');
    if (url.searchParams.get('ics')) {
      const p = JSON.parse(Buffer.from(url.searchParams.get('ics'), 'base64url').toString());
      res.statusCode = 200; res.setHeader('Content-Type', 'text/calendar; charset=utf-8'); res.setHeader('Content-Disposition', 'attachment; filename="session.ics"');
      return res.end(ics({ id: String(p.id).slice(0, 40), start: p.start, end: p.end, title: String(p.title).slice(0, 80), owner: String(p.owner).slice(0, 60), meet: /^https:\/\/meet\.google\.com\//.test(p.meet || '') ? p.meet : '' }));
    }
    const { cfg, days } = await openSlots(owner);
    res.setHeader('Cache-Control', 'no-store');
    return send(res, 200, { owner: env('OWNER_NAME', 'Courtney'), tz: TZ, title: cfg.title, minutes: cfg.minutes, days });
  }
  if (req.method !== 'POST') throw new HttpError(405, 'method');
  send(res, 200, await book(owner, body(req)));
});
