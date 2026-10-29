/* App shell glue: mic + wake word, settings, notifications, Spotify linking, import, service worker. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const H = () => window.etherHooks || {};
  const api = (...a) => window.etherApi(...a);
  const tool = (server, t, args) => api('/api/tools', { json: { server, tool: t, args: args || {} } });

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(e => console.warn('sw', e));

  /* ---------- Talk: tap the mic (or say the wake word), Ether listens and stops when you pause ---------- */
  let listening = false;
  async function listen() {
    if (window.EtherMic.active) { window.EtherMic.stop(); return; }
    if (listening) return;
    listening = true;
    try { H().stopSpeak && H().stopSpeak(); } catch (e) {}
    await window.EtherWake.pause();
    const ask = $('ask'), talk = $('talk');
    document.body.classList.add('listening');
    ask.placeholder = 'Listening…';
    try {
      const text = await window.EtherMic.listen({ onLevel: v => talk.style.setProperty('--lvl', v.toFixed(2)) });
      document.body.classList.remove('listening');
      if (text) { ask.value = text; $('ask-form').requestSubmit(); }
      else ask.placeholder = 'Didn’t catch that. Tap and try again.';
    } catch (e) {
      document.body.classList.remove('listening');
      const denied = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
      H().setCaption && H().setCaption(denied ? 'I need microphone access. Allow it for Ether in Settings, then tap the mic again.' : 'The mic didn’t work just then. Try again, or type.');
    } finally {
      listening = false;
      talk.style.removeProperty('--lvl');
      setTimeout(() => { if (!document.body.classList.contains('listening')) ask.placeholder = 'Talk or type to Ether…'; }, 4000);
    }
  }
  window.etherListen = listen;

  window.EtherWake.onWake(() => {
    if (window.EtherMic.active || listening) return;
    window.etherChime && window.etherChime('wake');
    listen();
  });
  // Keep the wake word running whenever Ether isn't talking or recording.
  setInterval(() => {
    const W = window.EtherWake;
    if (W.enabled && !W.running && !listening && !window.EtherMic.active && !document.body.classList.contains('speaking') && !document.hidden) W.resume();
    renderWakeState();
  }, 1500);
  // iPad needs one tap before audio/mic can start: start listening on the first tap after load.
  document.addEventListener('pointerdown', function first() { document.removeEventListener('pointerdown', first, true); if (window.EtherWake.enabled) window.EtherWake.resume(); }, true);

  /* ---------- Settings drawer ---------- */
  const VOICE_NOTES = { marin: 'warm, natural', cedar: 'calm, grounded', coral: 'bright, friendly', sage: 'soft, thoughtful', shimmer: 'light, clear', nova: 'upbeat', ballad: 'gentle', alloy: 'neutral', ash: 'deeper', verse: 'expressive', echo: 'deeper, smooth', fable: 'storyteller', onyx: 'deep' };
  function renderWakeState() {
    const el = $('wake-state'); if (!el) return;
    const W = window.EtherWake;
    el.textContent = !W.enabled ? 'Off' : W.running ? 'Listening' : document.body.classList.contains('speaking') ? 'Paused while talking' : 'Tap anywhere to start';
  }
  async function renderSettings() {
    const V = window.EtherVoice, W = window.EtherWake, cfg = window.ETHER_CFG || { features: {} };
    $('voice-provider').value = V.provider;
    $('ai-voice').innerHTML = V.VOICES.map(v => `<option value="${v}"${v === V.voice ? ' selected' : ''}>${v[0].toUpperCase() + v.slice(1)} · ${VOICE_NOTES[v] || ''}</option>`).join('');
    $('ai-voice-row').hidden = V.provider !== 'natural';
    $('dev-voice-row').hidden = V.provider === 'natural';
    const pr = $('voice-pitch') && $('voice-pitch').closest('.frow'); if (pr) pr.hidden = V.provider === 'natural';
    $('wake-on').checked = W.enabled;
    $('wake-label').textContent = W.label;
    const th = Number(localStorage.getItem('ether-wake-threshold')) || 0.5;
    $('wake-th').value = th; $('wake-th-out').textContent = th.toFixed(2);
    renderWakeState();
    renderNotifState();
    const f = cfg.features || {};
    const rows = [['Brain (Claude)', f.brain], ['Natural voice + mic (OpenAI)', f.voice], ['Calendar', f.calendar], ['Shopify sales', f.shopify], ['Planable posts', f.planable]];
    let sp = 'checking…';
    $('conn').innerHTML = rows.map(([n, ok]) => `<li><span>${n}</span><b class="${ok ? 'ok' : 'off'}">${ok ? 'Connected' : 'Not set up'}</b></li>`).join('') + `<li><span>Spotify</span><b id="sp-state">${sp}</b></li>`;
    if (!f.spotify) { $('sp-state').textContent = 'Not set up'; $('sp-state').className = 'off'; $('sp-link').hidden = true; }
    else tool('Spotify', 'status').then(r => { $('sp-state').textContent = r.linked ? 'Linked' : 'Not linked'; $('sp-state').className = r.linked ? 'ok' : 'off'; $('sp-link').textContent = r.linked ? 'Re-link Spotify' : 'Link Spotify'; }).catch(() => { $('sp-state').textContent = 'Not linked'; });
    window.claude.use('user').then(u => u.email()).then(e => { $('acct-email').textContent = e || ''; });
  }
  window.etherRenderSettings = renderSettings;

  document.addEventListener('change', e => {
    const t = e.target;
    if (t.id === 'voice-provider') { window.EtherVoice.provider = t.value; renderSettings(); preview(); }
    if (t.id === 'ai-voice') { window.EtherVoice.voice = t.value; preview(); }
    if (t.id === 'wake-on') { window.EtherWake.enabled = t.checked; renderWakeState(); if (t.checked) H().setCaption && H().setCaption(`Say “${window.EtherWake.label}” any time Ether is open.`); }
    if (t.id === 'import-file' && t.files && t.files[0]) importFile(t.files[0]);
  });
  document.addEventListener('input', e => {
    if (e.target.id === 'wake-th') { localStorage.setItem('ether-wake-threshold', e.target.value); $('wake-th-out').textContent = Number(e.target.value).toFixed(2); }
  });
  function preview() { H().speakSeq && H().speakSeq(['Hi Courtney. This is how I’ll sound now.'], { caption: false }); }

  /* ---------- Notifications ---------- */
  const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  function b64ToBytes(b64) { const pad = '='.repeat((4 - b64.length % 4) % 4); const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(raw, c => c.charCodeAt(0)); }
  async function renderNotifState() {
    const el = $('notif-state'); if (!el) return;
    if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) { el.textContent = isStandalone() ? 'Not supported here' : 'Add to Home Screen first'; return; }
    const reg = await navigator.serviceWorker.ready.catch(() => null);
    const sub = reg && await reg.pushManager.getSubscription().catch(() => null);
    el.textContent = sub && Notification.permission === 'granted' ? 'On for this device' : Notification.permission === 'denied' ? 'Blocked in Settings' : 'Off';
    $('notif-on').textContent = sub ? 'Re-connect this device' : 'Turn on for this device';
  }
  document.addEventListener('click', async e => {
    if (e.target.closest('#notif-on')) {
      const foot = $('notif-foot');
      try {
        if (!('PushManager' in window)) { foot.textContent = 'On iPad and iPhone: tap Share → Add to Home Screen, open Ether from the Home Screen, then turn this on.'; return; }
        const perm = await Notification.requestPermission();
        if (perm !== 'granted') { foot.textContent = 'Notifications are blocked. Turn them on for Ether in iPad Settings → Notifications.'; return; }
        const reg = await navigator.serviceWorker.ready;
        const { publicKey } = await api('/api/push?op=key');
        let sub = await reg.pushManager.getSubscription();
        if (sub) { try { await sub.unsubscribe(); } catch (x) {} }
        sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) });
        const device = /iPad/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.userAgent)) ? 'iPad' : /iPhone/.test(navigator.userAgent) ? 'iPhone' : 'Computer';
        await api('/api/push?op=subscribe', { json: { subscription: sub.toJSON(), device } });
        foot.textContent = 'You’re set. Notifications will come to this ' + device + '.';
        renderNotifState();
      } catch (err) { foot.textContent = 'That didn’t work: ' + (err.message || err); }
    }
    if (e.target.closest('#notif-test')) { try { const r = await api('/api/push?op=test', { method: 'POST', json: {} }); $('notif-foot').textContent = r.sent ? `Sent to ${r.sent} device${r.sent === 1 ? '' : 's'}.` : 'No devices are turned on yet.'; } catch (err) { $('notif-foot').textContent = 'Test failed: ' + err.message; } }
    if (e.target.closest('#sp-link')) { try { const r = await tool('Spotify', 'login-url'); location.href = r.url; } catch (err) { H().setCaption && H().setCaption('Spotify isn’t set up on the server yet.'); } }
    if (e.target.closest('#sign-out')) window.etherSignOut();
    const pl = e.target.closest('[data-spplay]');
    if (pl) {
      pl.disabled = true;
      try { const r = await tool('Spotify', 'play', { uri: pl.dataset.spplay }); H().setCaption && H().setCaption(`Playing on ${r.device || 'Spotify'}.`); }
      catch (err) { H().setCaption && H().setCaption(err.code === 'no_device' ? 'Open Spotify on the iPad once, then tap Play again.' : err.code === 'spotify_not_linked' ? 'Link Spotify in Settings first.' : 'Spotify didn’t start. Try again in a moment.'); }
      finally { pl.disabled = false; }
    }
  });

  /* ---------- Import from the Claude version ---------- */
  async function importFile(file) {
    const st = $('import-state');
    try {
      const j = JSON.parse(await file.text());
      const docs = Array.isArray(j.docs) ? j.docs : [];
      if (!docs.length) { st.textContent = 'That file has nothing to import.'; return; }
      const db = await window.claude.use('db'), u = await window.claude.use('user'), me = await u.id();
      let n = 0;
      for (const d of docs) {
        const path = String(d.path).replace(/^data\/users\/[^/]+/, 'data/users/' + me);
        await db.doc(path).set(d.data);
        if (++n % 10 === 0) st.textContent = `Importing… ${n} of ${docs.length}`;
      }
      st.textContent = `Imported ${n} records. Everything is here now.`;
    } catch (err) { st.textContent = 'Import failed: ' + (err.message || err); }
  }

  /* ---------- Links back into the app ---------- */
  document.addEventListener('ether-hooks', () => {
    const q = new URLSearchParams(location.search);
    if (q.get('spotify')) H().setCaption(q.get('spotify') === 'linked' ? 'Spotify is linked. Ask me to play anything.' : 'Spotify wasn’t linked. You can try again in Settings.');
    if (q.get('open')) setTimeout(() => H().openDrawer(q.get('open')), 400);
    if (q.toString()) history.replaceState(null, '', '/');
  });
})();
