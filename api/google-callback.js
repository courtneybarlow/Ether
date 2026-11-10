// GET /api/google-callback: Google sends Courtney back here after she lets Ether add bookings to her calendar.
import { handle } from '../lib/core.js';
import { checkState, finishLogin } from '../lib/google.js';

export default handle(async (req, res) => {
  const url = new URL(req.url, 'https://x');
  const back = msg => { res.statusCode = 302; res.setHeader('Location', '/?google=' + encodeURIComponent(msg) + '&open=voice'); res.end(); };
  if (url.searchParams.get('error')) return back('declined');
  const owner = checkState(url.searchParams.get('state'));
  await finishLogin(req, owner, url.searchParams.get('code'));
  back('linked');
});
