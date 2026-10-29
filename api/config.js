// GET /api/config: public settings the app needs before sign-in (no secrets).
import { handle, send, env } from '../lib/core.js';

export default handle(async (req, res) => {
  send(res, 200, {
    supabaseUrl: env('SUPABASE_URL'),
    supabaseAnonKey: env('SUPABASE_ANON_KEY'),
    voice: env('ETHER_VOICE', 'marin'),
    wakeWord: env('ETHER_WAKE_WORD', 'hey_jarvis'),
    features: {
      brain: !!env('ANTHROPIC_API_KEY'),
      voice: !!env('OPENAI_API_KEY'),
      spotify: !!(env('SPOTIFY_CLIENT_ID') && env('SPOTIFY_CLIENT_SECRET')),
      shopify: !!(env('SHOPIFY_SHOP') && (env('SHOPIFY_ADMIN_TOKEN') || env('SHOPIFY_CLIENT_ID'))),
      calendar: !!env('CALENDAR_ICS'),
      planable: !!env('PLANABLE_TOKEN')
    }
  });
});
