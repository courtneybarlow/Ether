/* Ether's ears and voice.
   EtherVoice: natural voice (server /api/tts), played through Web Audio so it works after one tap on iPad.
   EtherMic:   records what Courtney says, stops on its own when she pauses, returns the text (/api/transcribe).
   EtherWake:  listens on the device for the wake word while Ether is open (openWakeWord, runs locally). */
(function () {
  'use strict';
  const store = { get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} } };
  let ctx = null;
  // Play through the speaker even when the iPad is on silent (Safari 17+).
  function session(t) { try { if (navigator.audioSession && navigator.audioSession.type !== t) navigator.audioSession.type = t; } catch (e) {} }
  window.etherAudioSession = session;
  function audioCtx() {
    if (!ctx) { const AC = window.AudioContext || window.webkitAudioContext; ctx = new AC(); }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }
  // iPad only allows sound after a tap: the first tap anywhere unlocks it for the session.
  function unlock() {
    const c = audioCtx();
    try { const b = c.createBuffer(1, 1, 22050), s = c.createBufferSource(); s.buffer = b; s.connect(c.destination); s.start(0); } catch (e) {}
  }
  ['pointerdown', 'touchend', 'keydown'].forEach(ev => document.addEventListener(ev, unlock, { capture: true, passive: true }));

  function chime(kind) {
    try {
      const c = audioCtx(), t = c.currentTime, o = c.createOscillator(), g = c.createGain();
      const f = kind === 'up' ? [660, 990] : kind === 'down' ? [880, 520] : [740, 740];
      o.type = 'sine'; o.frequency.setValueAtTime(f[0], t); o.frequency.exponentialRampToValueAtTime(f[1], t + 0.14);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.12, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
      o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + 0.25);
    } catch (e) {}
  }

  /* ---------- Voice ---------- */
  const cache = new Map();
  let current = null, gen = 0;
  const VOICES = ['marin', 'cedar', 'coral', 'sage', 'shimmer', 'nova', 'ballad', 'alloy', 'ash', 'verse', 'echo', 'fable', 'onyx'];
  const EtherVoice = {
    VOICES,
    get provider() { return store.get('ether-voice-provider') || 'natural'; },
    set provider(v) { store.set('ether-voice-provider', v); },
    get voice() { return store.get('ether-ai-voice') || (window.ETHER_CFG && window.ETHER_CFG.voice) || 'marin'; },
    set voice(v) { store.set('ether-ai-voice', v); cache.clear(); },
    get speed() { return Number(store.get('ether-rate')) || 1; },
    available() { return !!(window.ETHER_CFG && window.ETHER_CFG.features && window.ETHER_CFG.features.voice) && this.provider === 'natural'; },
    fetch(text) {
      const key = this.voice + '|' + this.speed + '|' + text;
      if (cache.has(key)) return cache.get(key);
      const p = window.etherApi('/api/tts', { json: { text, voice: this.voice, speed: this.speed }, raw: true })
        .then(async r => { if (!r.ok) { let j = {}; try { j = await r.json(); } catch (e) {} const err = new Error(j.error || ('tts ' + r.status)); err.code = j.code || 'voice_error'; throw err; } return r.arrayBuffer(); })
        .then(buf => new Promise((res, rej) => audioCtx().decodeAudioData(buf, res, rej)));
      p.catch(() => cache.delete(key));
      cache.set(key, p);
      if (cache.size > 40) cache.delete(cache.keys().next().value);
      return p;
    },
    prefetch(text) { if (this.available() && text) this.fetch(text).catch(() => {}); },
    async speak(text) {
      const my = ++gen;
      session('playback');
      const buf = await this.fetch(text);
      if (my !== gen) return;
      await new Promise(resolve => {
        const c = audioCtx(), src = c.createBufferSource();
        src.buffer = buf; src.connect(c.destination);
        src.onended = () => { if (current === src) current = null; resolve(); };
        current = src; src.start(0);
      });
    },
    stop() { gen++; if (current) { try { current.stop(); } catch (e) {} current = null; } }
  };

  /* ---------- Mic ---------- */
  let rec = null;
  const EtherMic = {
    get active() { return !!rec; },
    stop() { if (rec) rec.finish(); },
    cancel() { if (rec) rec.abort(); },
    async listen({ onLevel, maxMs = 15000 } = {}) {
      if (rec) rec.abort();
      session('play-and-record');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      const mime = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'].find(m => window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) || '';
      const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks = [];
      mr.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
      const c = audioCtx(), srcNode = c.createMediaStreamSource(stream), an = c.createAnalyser();
      an.fftSize = 1024; srcNode.connect(an);
      const data = new Float32Array(an.fftSize);
      let heard = false, quietSince = 0, base = 0.01, n = 0, raf = 0, aborted = false;
      const t0 = performance.now();
      const done = new Promise(resolve => { mr.onstop = resolve; });
      const cleanup = () => { cancelAnimationFrame(raf); try { srcNode.disconnect(); } catch (e) {} stream.getTracks().forEach(t => t.stop()); rec = null; };
      const finish = () => { if (mr.state !== 'inactive') mr.stop(); };
      rec = { finish, abort: () => { aborted = true; finish(); } };
      const loop = () => {
        an.getFloatTimeDomainData(data);
        let s = 0; for (let i = 0; i < data.length; i++) s += data[i] * data[i];
        const rms = Math.sqrt(s / data.length), now = performance.now();
        if (now - t0 < 350) { base = (base * n + rms) / (++n); }
        const thr = Math.max(0.018, base * 3);
        if (onLevel) onLevel(Math.min(1, rms / (thr * 3)));
        if (rms > thr) { heard = true; quietSince = 0; } else if (heard && !quietSince) quietSince = now;
        if ((heard && quietSince && now - quietSince > 1300) || (!heard && now - t0 > 7000) || now - t0 > maxMs) { finish(); return; }
        raf = requestAnimationFrame(loop);
      };
      mr.start(250); chime('up'); loop();
      await done; cleanup(); session('playback');
      if (aborted || !heard) { chime('down'); return ''; }
      chime('down');
      const blob = new Blob(chunks, { type: mr.mimeType || mime || 'audio/mp4' });
      const b64 = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(String(fr.result).split(',')[1] || ''); fr.readAsDataURL(blob); });
      const out = await window.etherApi('/api/transcribe', { json: { audio: b64, mime: blob.type } });
      return (out && out.text) || '';
    }
  };

  /* ---------- Wake word ---------- */
  let engine = null, wakeCb = null, paused = false, starting = null;
  const WAKE_LABEL = { hey_jarvis: 'Hey Jarvis', hey_mycroft: 'Hey Mycroft', alexa: 'Alexa', hey_ether: 'Hey Ether' };
  const EtherWake = {
    get keyword() { return store.get('ether-wake-word') || (window.ETHER_CFG && window.ETHER_CFG.wakeWord) || 'hey_jarvis'; },
    get label() { return WAKE_LABEL[this.keyword] || this.keyword; },
    get enabled() { return store.get('ether-wake') === '1'; },
    set enabled(v) { store.set('ether-wake', v ? '1' : '0'); if (v) this.start(); else this.stop(); },
    get running() { return !!(engine && engine._workletNode) && !paused; },
    onWake(cb) { wakeCb = cb; },
    async start() {
      if (starting) return starting;
      starting = (async () => {
        try {
          if (!engine) {
            const mod = await import('/vendor/oww/WakeWordEngine.js');
            const ortMod = await import('/vendor/ort/ort.wasm.min.mjs');
            ortMod.env.wasm.wasmPaths = '/vendor/ort/'; ortMod.env.wasm.numThreads = 1;
            engine = new mod.WakeWordEngine({ baseAssetUrl: '/models', keywords: [this.keyword], detectionThreshold: Number(store.get('ether-wake-threshold')) || 0.5, cooldownMs: 2500, ortWasmPath: '/vendor/ort/' });
            await engine.load();
            engine.on('detect', () => { if (!paused && wakeCb) wakeCb(); });
            engine.on('error', e => console.warn('wake', e));
          }
          paused = false;
          await engine.start();
          if (engine._audioContext && engine._audioContext.state === 'suspended') await engine._audioContext.resume().catch(() => {});
          document.dispatchEvent(new CustomEvent('ether-wake-state'));
        } finally { starting = null; }
      })();
      return starting;
    },
    // The mic is released while Ether talks or records a request, then picks back up.
    async pause() { paused = true; if (engine) await engine.stop(); document.dispatchEvent(new CustomEvent('ether-wake-state')); },
    async resume() { if (this.enabled && !document.hidden) { try { await this.start(); } catch (e) { console.warn(e); } } },
    async stop() { paused = true; if (engine) await engine.stop(); document.dispatchEvent(new CustomEvent('ether-wake-state')); }
  };
  document.addEventListener('visibilitychange', () => { if (document.hidden) { if (engine) engine.stop(); } else if (EtherWake.enabled && !EtherMic.active) EtherWake.resume(); });

  window.EtherVoice = EtherVoice; window.EtherMic = EtherMic; window.EtherWake = EtherWake; window.etherChime = chime;
})();
