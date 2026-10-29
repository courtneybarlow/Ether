/* Ether runtime: gives the app the same db / user / sample / mcp interfaces it had inside Claude,
   backed by Supabase (database + login) and Ether's own server routes (/api/*). */
(function () {
  'use strict';

  const cfgP = fetch('/api/config').then(r => r.json());
  let sb = null, session = null;
  const ready = (async () => {
    const cfg = await cfgP;
    window.ETHER_CFG = cfg;
    sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'ether-auth' },
      realtime: { params: { eventsPerSecond: 20 } }
    });
    const { data } = await sb.auth.getSession();
    session = data.session;
    sb.auth.onAuthStateChange((_e, s) => { session = s; if (s) sb.realtime.setAuth(s.access_token); });
    if (!session) session = await showLogin();
    sb.realtime.setAuth(session.access_token);
    startRealtime();
    return cfg;
  })();

  /* ---------- Login (email + password: works inside a home-screen app, unlike magic links) ---------- */
  function showLogin() {
    return new Promise(resolve => {
      const el = document.createElement('div');
      el.id = 'ether-login';
      el.innerHTML = `<form autocomplete="on">
        <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.2" aria-hidden="true"><circle cx="16" cy="16" r="13" opacity=".5"/><circle cx="16" cy="16" r="8.5"/><circle cx="16" cy="16" r="3" fill="currentColor"/></svg>
        <h1>Ether</h1>
        <label>Email<input name="email" type="email" autocomplete="username" required></label>
        <label>Password<input name="password" type="password" autocomplete="current-password" required></label>
        <button type="submit">Wake up Ether</button>
        <p class="err" role="alert"></p></form>`;
      document.body.appendChild(el);
      const f = el.querySelector('form'), err = el.querySelector('.err');
      f.addEventListener('submit', async e => {
        e.preventDefault(); err.textContent = '';
        const { data, error } = await sb.auth.signInWithPassword({ email: f.email.value.trim(), password: f.password.value });
        if (error) { err.textContent = 'That didn’t work. Check your email and password.'; return; }
        el.remove(); resolve(data.session);
      });
    });
  }

  async function token() {
    await ready;
    const { data } = await sb.auth.getSession();
    session = data.session || session;
    return session && session.access_token;
  }
  async function api(path, opts = {}) {
    const t = await token();
    const headers = Object.assign({ Authorization: 'Bearer ' + t }, opts.headers || {});
    if (opts.json !== undefined) { headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(opts.json); }
    const r = await fetch(path, { method: opts.method || (opts.body ? 'POST' : 'GET'), headers, body: opts.body, signal: opts.signal });
    if (opts.raw) return r;
    let body = null; try { body = await r.json(); } catch (e) {}
    if (!r.ok) { const err = new Error((body && body.error) || ('HTTP ' + r.status)); err.code = (body && body.code) || ('http_' + r.status); err.status = r.status; throw err; }
    return body;
  }
  window.etherApi = api;
  window.etherReady = ready;

  /* ---------- Database ---------- */
  const uid = () => session && session.user && session.user.id;
  const clean = p => String(p).replace(/^\/+|\/+$/g, '');
  const parentOf = p => { const s = clean(p).split('/'); s.pop(); return s.join('/'); };
  const lastOf = p => clean(p).split('/').pop();
  const newId = () => { const a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'; let s = ''; const r = crypto.getRandomValues(new Uint8Array(20)); for (const b of r) s += a[b % a.length]; return s; };
  const copy = o => (o == null ? o : JSON.parse(JSON.stringify(o)));
  const stripDeletes = o => { const out = {}; for (const [k, v] of Object.entries(o || {})) if (!(v && typeof v === 'object' && !Array.isArray(v) && v.__delete__)) out[k] = v; return out; };

  function DocSnap(id, data) { this.id = id; this.exists = data != null; this._d = data; }
  DocSnap.prototype.data = function () { return copy(this._d); };

  const listeners = new Set(); // {kind:'doc'|'col', path, q, cb, err, timer}
  function schedule(l) { clearTimeout(l.timer); l.timer = setTimeout(() => run(l), 60); }
  async function run(l) {
    if (l.dead) return;
    try {
      if (l.kind === 'doc') { const s = await getDoc(l.path); if (!l.dead) l.cb(s); }
      else { const s = await getCol(l.path, l.q); if (!l.dead) l.cb(s); }
    } catch (e) { if (!l.dead && l.err) l.err(e); }
  }
  function touched(path) {
    const parent = parentOf(path);
    for (const l of listeners) if ((l.kind === 'doc' && l.path === path) || (l.kind === 'col' && l.path === parent)) schedule(l);
  }
  function startRealtime() {
    sb.channel('ether-docs')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'docs' }, p => { const row = p.new && p.new.path ? p.new : p.old; if (row && row.path) touched(row.path); })
      .subscribe();
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') for (const l of listeners) schedule(l); });
  }

  async function getDoc(path) {
    await ready; path = clean(path);
    const { data, error } = await sb.from('docs').select('id,data').eq('path', path).maybeSingle();
    if (error) throw error;
    return new DocSnap(lastOf(path), data ? data.data : null);
  }
  async function getCol(path, q) {
    await ready; path = clean(path);
    let qb = sb.from('docs').select('id,data').eq('parent', path);
    for (const [f, op, v] of (q.where || [])) {
      const col = 'data->>' + f, val = String(v);
      const m = { '==': 'eq', '!=': 'neq', '<': 'lt', '<=': 'lte', '>': 'gt', '>=': 'gte' }[op];
      if (m) qb = qb[m](col, val);
      else if (op === 'in') qb = qb.in(col, v.map(String));
    }
    for (const [f, dir] of (q.order || [])) qb = qb.order('data->>' + f, { ascending: dir !== 'desc', nullsFirst: false });
    qb = qb.limit(q.limit || 2000);
    const { data, error } = await qb;
    if (error) throw error;
    const docs = (data || []).map(r => new DocSnap(r.id, r.data));
    return { docs, size: docs.length, empty: !docs.length, forEach: fn => docs.forEach(fn) };
  }

  function docRef(path) {
    path = clean(path);
    const ref = {
      id: lastOf(path), path,
      collection: sub => colRef(path + '/' + sub),
      get: () => getDoc(path),
      async set(data, opts) {
        await ready;
        if (opts && opts.merge) { try { await ref.update(data); return; } catch (e) { if (e.code !== 'P0002' && !/not_found/.test(e.message || '')) throw e; } }
        const row = { owner: uid(), path, parent: parentOf(path), id: lastOf(path), data: stripDeletes(copy(data)), updated_at: new Date().toISOString() };
        const { error } = await sb.from('docs').upsert(row, { onConflict: 'owner,path' });
        if (error) throw error; touched(path);
      },
      async update(patch) {
        await ready;
        const { error } = await sb.rpc('doc_merge', { p_path: path, p_patch: copy(patch) });
        if (error) { const e = new Error(error.message); e.code = error.code; throw e; }
        touched(path);
      },
      async delete() {
        await ready;
        const { error } = await sb.from('docs').delete().eq('path', path);
        if (error) throw error; touched(path);
      },
      onSnapshot(cb, err) { const l = { kind: 'doc', path, cb, err }; listeners.add(l); ready.then(() => run(l)); return () => { l.dead = true; listeners.delete(l); }; }
    };
    return ref;
  }
  function colRef(path, q) {
    path = clean(path); q = q || { where: [], order: [], limit: 0 };
    const next = add => colRef(path, Object.assign({}, q, add));
    return {
      id: lastOf(path), path,
      doc: id => docRef(path + '/' + (id || newId())),
      where: (f, op, v) => next({ where: [...q.where, [f, op, v]] }),
      orderBy: (f, dir) => next({ order: [...q.order, [f, dir || 'asc']] }),
      limit: n => next({ limit: n }),
      get: () => getCol(path, q),
      async add(data) { const r = docRef(path + '/' + newId()); await r.set(data); return r; },
      onSnapshot(cb, err) { const l = { kind: 'col', path, q, cb, err }; listeners.add(l); ready.then(() => run(l)); return () => { l.dead = true; listeners.delete(l); }; }
    };
  }
  const db = {
    collection: p => colRef(p),
    doc: p => docRef(p),
    async batch(writes) { for (const w of writes) { const r = docRef(w.path); if (w.op === 'delete') await r.delete(); else if (w.op === 'update') await r.update(w.data); else await r.set(w.data); } }
  };

  /* ---------- User ---------- */
  const user = { id: async () => { await ready; return uid(); }, email: async () => { await ready; return session && session.user && session.user.email; } };

  /* ---------- Brain (Claude on Courtney's own developer account) ---------- */
  function extractJSON(text) {
    let t = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    try { return JSON.parse(t); } catch (e) {}
    const a = t.indexOf('{'), b = t.lastIndexOf('}');
    if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch (e) {} }
    const err = new Error('invalid_json'); err.code = 'invalid_json'; throw err;
  }
  function mergeTurns(input) {
    const out = [];
    for (const m of input) {
      const content = typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content;
      const last = out[out.length - 1];
      if (last && last.role === m.role) last.content = last.content.concat(content); else out.push({ role: m.role, content: content.slice() });
    }
    if (out.length && out[0].role !== 'user') out.unshift({ role: 'user', content: [{ type: 'text', text: '(start)' }] });
    return out;
  }
  async function brain(input, opts = {}) {
    const tools = opts.tools || [];
    const messages = mergeTurns(input);
    for (let round = 0; round < 6; round++) {
      const res = await api('/api/brain', { json: { messages, json: opts.json !== false, tools: tools.map(t => ({ name: t.name, description: t.description, input_schema: t.inputSchema })) }, signal: opts.signal });
      messages.push({ role: 'assistant', content: res.content });
      const calls = res.content.filter(c => c.type === 'tool_use');
      if (res.stop_reason !== 'tool_use' || !calls.length) return res.content.filter(c => c.type === 'text').map(c => c.text).join('\n');
      const results = [];
      for (const c of calls) {
        const tool = tools.find(t => t.name === c.name);
        let out;
        try { out = tool ? await tool.execute(c.input || {}, { signal: opts.signal }) : { error: 'unknown tool' }; }
        catch (e) { out = { error: (e && (e.code || e.message)) || 'failed' }; }
        results.push({ type: 'tool_result', tool_use_id: c.id, content: JSON.stringify(out == null ? {} : out).slice(0, 20000) });
      }
      messages.push({ role: 'user', content: results });
    }
    const e = new Error('too_many_steps'); e.code = 'too_many_steps'; throw e;
  }
  const sample = {
    limits: async () => ({ tools: true }),
    json: async (input, opts) => extractJSON(await brain(input, Object.assign({}, opts, { json: true }))),
    text: async (input, opts) => brain(input, Object.assign({}, opts, { json: false }))
  };

  /* ---------- Connected services (same call shapes the app used with Claude connectors) ---------- */
  async function callTool(server, tool, args, o = {}) {
    const payload = await api('/api/tools', { json: { server, tool, args: args || {} }, signal: o.signal });
    return { payload };
  }
  function watchTool(server, tool, args, cb, o = {}) {
    let dead = false, timer = null;
    const tickIt = async () => {
      if (dead) return;
      try { const r = await callTool(server, tool, args); if (!dead) cb({ type: 'data', result: r }); }
      catch (e) { if (!dead) cb({ type: 'error', error: { code: e.code || 'error', message: e.message } }); }
      if (!dead && o.refetchInterval) timer = setTimeout(tickIt, o.refetchInterval);
    };
    tickIt();
    const vis = () => { if (document.visibilityState === 'visible' && !dead) { clearTimeout(timer); tickIt(); } };
    document.addEventListener('visibilitychange', vis);
    return () => { dead = true; clearTimeout(timer); document.removeEventListener('visibilitychange', vis); };
  }
  const mcp = { callTool, watchTool };

  window.claude = {
    async use(name) {
      await ready;
      if (name === 'db') return db;
      if (name === 'user') return user;
      if (name === 'sample') return sample;
      if (name === 'mcp') return mcp;
      throw Object.assign(new Error('unknown capability ' + name), { code: 'not_available' });
    }
  };
  window.etherSignOut = async () => { await ready; await sb.auth.signOut(); location.reload(); };
})();
