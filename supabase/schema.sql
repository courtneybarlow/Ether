-- Ether database. Paste this whole file into Supabase → SQL Editor → New query → Run.
-- Safe to run more than once.

-- 1. Documents: every Ether record (tasks, chores, logs, check-ins, cycle…) lives here,
--    addressed by a path like "items/abc" or "data/users/<id>/mind/checkins/xyz".
create table if not exists public.docs (
  owner      uuid        not null default auth.uid() references auth.users(id) on delete cascade,
  path       text        not null,
  parent     text        not null,
  id         text        not null,
  data       jsonb       not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner, path)
);
create index if not exists docs_parent_idx on public.docs (owner, parent);

alter table public.docs enable row level security;
drop policy if exists docs_owner on public.docs;
create policy docs_owner on public.docs for all to authenticated
  using (owner = auth.uid()) with check (owner = auth.uid());

-- Live updates to the app (deletes carry the full old row so the app knows which list changed).
alter table public.docs replica identity full;
do $$ begin
  alter publication supabase_realtime add table public.docs;
exception when duplicate_object then null; end $$;

-- Merge fields into an existing document (like "update"): fails if the document doesn't exist.
-- A field set to {"__delete__": true} is removed.
create or replace function public.doc_merge(p_path text, p_patch jsonb)
returns jsonb language plpgsql security invoker as $$
declare
  cur jsonb; k text; v jsonb;
begin
  select data into cur from public.docs where owner = auth.uid() and path = p_path for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  for k, v in select * from jsonb_each(p_patch) loop
    if jsonb_typeof(v) = 'object' and v ? '__delete__' then cur := cur - k; else cur := jsonb_set(cur, array[k], v, true); end if;
  end loop;
  update public.docs set data = cur, updated_at = now() where owner = auth.uid() and path = p_path;
  return cur;
end $$;

-- 2. Server-only storage (Spotify login, notification keys, job runs). The app itself can't read it.
create table if not exists public.vault (
  owner      uuid  not null references auth.users(id) on delete cascade,
  key        text  not null,
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (owner, key)
);
alter table public.vault enable row level security;  -- no policies: only the server (service key) can touch it

-- 3. Devices that receive push notifications.
create table if not exists public.push_subs (
  endpoint   text primary key,
  owner      uuid not null references auth.users(id) on delete cascade,
  sub        jsonb not null,
  device     text,
  created_at timestamptz not null default now()
);
alter table public.push_subs enable row level security;
