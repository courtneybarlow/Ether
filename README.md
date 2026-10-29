# Ether

Courtney's personal command center: her 9-to-5, Seven Wellness Club, November Social and life in one voice-first dashboard for the iPad.

## What runs where
- `public/`: the app (installed to the iPad Home Screen). `index.html` is generated from the approved design with `python3 scripts/port.py <ether.html>`.
- `api/`: small server routes on Vercel: `brain` (Claude), `tools` (calendar, Shopify, Spotify), `tts` + `transcribe` (voice), `push` (notifications), `tick` (scheduled jobs), `config`, `spotify-callback`.
- `lib/`: shared server code. `nine.js` holds The Nine's ranking rules.
- `supabase/schema.sql`: database, login rules, live updates. `supabase/schedule.sql`: the 15-minute clock.

## Notes
- Wake word runs on the device with openWakeWord (`public/models`, pre-trained models are CC BY-NC-SA 4.0: personal use).
- OpenAI retires `gpt-4o-mini-tts` on 2027-01-06 and `gpt-4o-mini-transcribe` on 2027-02-26. Change `ETHER_TTS_MODEL` / `ETHER_STT_MODEL` (or the voice provider) before then.
- Tests: `node scripts/test/e2e.mjs`, `import-test.mjs`, `voice-test.mjs`, `wake-test.mjs`, `cal-test.mjs` (local fakes, no accounts needed).
