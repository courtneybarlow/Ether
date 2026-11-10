// POST /api/tools  { server, tool, args }: calendar, Shopify and Spotify, in the shapes the app expects.
import { handle, send, body, requireUser, HttpError } from '../lib/core.js';
import { listCalendars, listEvents } from '../lib/calendar.js';
import { listOrders } from '../lib/shopify.js';
import * as spotify from '../lib/spotify.js';
import * as google from '../lib/google.js';

export default handle(async (req, res) => {
  if (req.method !== 'POST') throw new HttpError(405, 'method');
  const user = await requireUser(req);
  const { server, tool, args = {} } = body(req);
  let out;
  if (server === 'Google Calendar' || server === 'Calendar') {
    if (tool === 'list_calendars') out = await listCalendars();
    else if (tool === 'list_events') out = await listEvents(args);
  } else if (server === 'Shopify') {
    if (tool === 'list-orders') out = await listOrders(args);
  } else if (server === 'Spotify') {
    if (tool === 'search') out = await spotify.search(user.id, args);
    else if (tool === 'play') out = await spotify.play(user.id, args);
    else if (tool === 'devices') out = await spotify.devices(user.id);
    else if (tool === 'status') out = await spotify.linked(user.id);
    else if (tool === 'login-url') out = { url: spotify.loginUrl(req, user.id) };
    else if (['pause', 'resume', 'next', 'previous', 'volume', 'now'].includes(tool)) out = await spotify.control(user.id, tool, args);
  } else if (server === 'Google') {
    if (tool === 'login-url') out = { url: google.loginUrl(req, user.id) };
    else if (tool === 'status') out = { configured: google.configured(), linked: await google.linked(user.id) };
  }
  if (out === undefined) throw new HttpError(404, 'not_in_manifest', `Unknown tool ${server}/${tool}`);
  send(res, 200, out);
});
