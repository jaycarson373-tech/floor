create extension if not exists pgcrypto;

create table if not exists public.players (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  gx int not null default 0,
  gy int not null default 0,
  facing text not null default 'south',
  last_seen timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint players_facing_check check (facing in ('north', 'south', 'east', 'west'))
);

alter table public.players enable row level security;

revoke delete on public.players from anon, authenticated;
revoke update on public.players from anon, authenticated;
grant select, insert on public.players to anon, authenticated;
grant update (name, last_seen) on public.players to authenticated;

drop policy if exists "players are readable by everyone" on public.players;
create policy "players are readable by everyone"
  on public.players
  for select
  to anon, authenticated
  using (true);

drop policy if exists "players insert own anonymous session row" on public.players;
create policy "players insert own anonymous session row"
  on public.players
  for insert
  to authenticated
  with check (auth.uid() = id);

drop policy if exists "players update own row" on public.players;
create policy "players update own row"
  on public.players
  for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

drop policy if exists "players cannot delete from client" on public.players;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'players'
  ) then
    alter publication supabase_realtime add table public.players;
  end if;
end $$;
