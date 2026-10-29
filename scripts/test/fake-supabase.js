/* In-browser stand-in for supabase-js, used only by the local test harness. */
(function () {
  const rows = new Map(); // path -> {path,parent,id,data,owner}
  const subs = [];
  const seed = window.__SEED || [];
  for (const d of seed) rows.set(d.path, { path: d.path, parent: d.path.split('/').slice(0, -1).join('/'), id: d.path.split('/').pop(), data: d.data, owner: 'u1' });
  const emit = (row, old) => subs.forEach(cb => cb({ new: row || {}, old: old || {} }));
  const getv = (r, col) => col.startsWith('data->>') ? (r.data[col.slice(7)] == null ? null : String(r.data[col.slice(7)])) : r[col];
  function Q() { this.f = []; this.o = []; this.l = 0; this.op = 'select'; }
  Q.prototype.select = function () { return this; };
  for (const [m, fn] of Object.entries({ eq: (a, b) => a === b, neq: (a, b) => a !== b, lt: (a, b) => a != null && a < b, lte: (a, b) => a != null && a <= b, gt: (a, b) => a != null && a > b, gte: (a, b) => a != null && a >= b })) Q.prototype[m] = function (c, v) { this.f.push(r => fn(getv(r, c), String(v))); return this; };
  Q.prototype.in = function (c, vs) { this.f.push(r => vs.includes(getv(r, c))); return this; };
  Q.prototype.order = function (c, o) { this.o.push([c, !o || o.ascending !== false]); return this; };
  Q.prototype.limit = function (n) { this.l = n; return this; };
  Q.prototype.maybeSingle = function () { this.single = true; return this; };
  Q.prototype.upsert = function (row) { this.op = 'upsert'; this.row = row; return this; };
  Q.prototype.delete = function () { this.op = 'delete'; return this; };
  Q.prototype.then = function (res, rej) {
    try {
      if (this.op === 'upsert') { const r = { ...this.row }; const old = rows.get(r.path); rows.set(r.path, r); setTimeout(() => emit(r, old), 10); return Promise.resolve({ error: null }).then(res, rej); }
      let list = [...rows.values()].filter(r => this.f.every(f => f(r)));
      if (this.op === 'delete') { list.forEach(r => { rows.delete(r.path); setTimeout(() => emit(null, r), 10); }); return Promise.resolve({ error: null }).then(res, rej); }
      for (const [c, asc] of this.o.slice().reverse()) list.sort((a, b) => { const x = getv(a, c), y = getv(b, c); if (x == null) return 1; if (y == null) return -1; return (x < y ? -1 : x > y ? 1 : 0) * (asc ? 1 : -1); });
      if (this.l) list = list.slice(0, this.l);
      const out = list.map(r => ({ id: r.id, data: JSON.parse(JSON.stringify(r.data)) }));
      return Promise.resolve({ data: this.single ? (out[0] || null) : out, error: null }).then(res, rej);
    } catch (e) { return Promise.reject(e).then(res, rej); }
  };
  let session = null;
  window.supabase = { createClient: () => ({
    from: () => new Q(),
    rpc: async (name, a) => { const r = rows.get(a.p_path); if (!r) return { error: { message: 'not_found', code: 'P0002' } }; const old = JSON.parse(JSON.stringify(r)); for (const [k, v] of Object.entries(a.p_patch)) { if (v && typeof v === 'object' && v.__delete__) delete r.data[k]; else r.data[k] = v; } setTimeout(() => emit(r, old), 10); return { data: r.data, error: null }; },
    auth: {
      getSession: async () => ({ data: { session } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signInWithPassword: async ({ email, password }) => password === 'pw' ? { data: { session: (session = { access_token: 't', user: { id: 'u1', email } }) } } : { error: { message: 'bad' } },
      signOut: async () => { session = null; }
    },
    realtime: { setAuth() {} },
    channel: () => ({ on(_e, _f, cb) { subs.push(cb); return this; }, subscribe() { return this; } })
  }) };
  window.__rows = rows;
})();
