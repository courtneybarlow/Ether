// POST /api/tick: called every 15 minutes by the scheduler (Supabase pg_cron). Runs whatever job is due.
// Manual test: POST /api/tick?job=morningNudge with the same secret.
import { handle, send, requireCron, ownerId } from '../lib/core.js';
import { tick } from '../lib/jobs.js';

export default handle(async (req, res) => {
  requireCron(req);
  const job = new URL(req.url, 'https://x').searchParams.get('job');
  send(res, 200, await tick(await ownerId(), { force: job || null }));
});
