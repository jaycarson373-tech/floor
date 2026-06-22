-- Repairs partially migrated Supabase projects whose frontend already references
-- the phase 4-6 schema objects. This is schema-only: payout rows remain dry-run
-- by default, and no live treasury/payout behavior is introduced here.

create extension if not exists pgcrypto;

alter table if exists public.players add column if not exists wallet_address text;
alter table if exists public.players add column if not exists ranked boolean not null default false;
alter table if exists public.players add column if not exists ranked_checked_at timestamptz;
alter table if exists public.players add column if not exists gate_balance bigint not null default 0;

create unique index if not exists players_ranked_wallet_address_idx
  on public.players (wallet_address)
  where ranked = true and wallet_address is not null;

create table if not exists public.assets (
  id uuid primary key default gen_random_uuid(),
  symbol text unique not null,
  name text not null,
  base_price bigint not null check (base_price > 0),
  volatility int not null check (volatility > 0),
  created_at timestamptz not null default now()
);

create table if not exists public.seasons (
  id uuid primary key default gen_random_uuid(),
  season_number bigint unique not null,
  started_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'open' check (status in ('open', 'closing', 'snapshotted', 'paid')),
  pool_amount bigint not null default 0 check (pool_amount >= 0),
  payout_curve text not null default 'Top 9 ranked wallets: weights 40/25/15/8/5/3/2/1/1, scaled to available capped pool.',
  created_at timestamptz not null default now()
);

create index if not exists seasons_season_number_desc_idx
  on public.seasons (season_number desc);

create index if not exists seasons_status_ends_at_idx
  on public.seasons (status, ends_at);

create table if not exists public.season_standings (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id) on delete cascade,
  wallet text not null,
  "rank" int not null check ("rank" > 0),
  score bigint not null,
  snapshotted_at timestamptz not null default now(),
  unique (season_id, wallet)
);

create index if not exists season_standings_season_rank_idx
  on public.season_standings (season_id, "rank");

create table if not exists public.season_payouts (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id) on delete cascade,
  wallet text not null,
  amount bigint not null check (amount >= 0),
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'skipped')),
  tx_signature text,
  dry_run boolean not null default true,
  checkpoint_id text not null,
  error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (season_id, wallet)
);

create index if not exists season_payouts_season_status_idx
  on public.season_payouts (season_id, status, dry_run);

create table if not exists public.fee_claims (
  id uuid primary key default gen_random_uuid(),
  season_id uuid references public.seasons(id) on delete set null,
  claim_window text unique not null,
  amount_claimed bigint,
  status text not null default 'pending' check (status in ('pending', 'claimed', 'failed', 'skipped')),
  tx_signature text,
  dry_run boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists fee_claims_created_at_desc_idx
  on public.fee_claims (created_at desc);

create table if not exists public.tape_rounds (
  id uuid primary key default gen_random_uuid(),
  season_id uuid references public.seasons(id) on delete set null,
  round_number bigint unique not null,
  status text not null default 'open' check (status in ('open', 'locked', 'revealing', 'settled')),
  commit_hash text not null,
  server_seed text,
  public_entropy text not null,
  outcome text check (outcome in ('up', 'down')),
  pot bigint not null default 0 check (pot >= 0),
  opened_at timestamptz not null default now(),
  locked_at timestamptz,
  settled_at timestamptz
);

alter table public.tape_rounds add column if not exists season_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.tape_rounds'::regclass
      and conname = 'tape_rounds_season_id_fkey'
  ) then
    alter table public.tape_rounds
      add constraint tape_rounds_season_id_fkey
      foreign key (season_id) references public.seasons(id) on delete set null;
  end if;
end $$;

create index if not exists tape_rounds_round_number_desc_idx
  on public.tape_rounds (round_number desc);

create index if not exists tape_rounds_status_round_number_idx
  on public.tape_rounds (status, round_number);

create index if not exists tape_rounds_season_id_idx
  on public.tape_rounds (season_id);

create table if not exists public.tape_stakes (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.tape_rounds(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  side text not null check (side in ('up', 'down')),
  stake bigint not null check (stake > 0),
  ranked boolean not null default false,
  idempotency_key text not null,
  paid_out bigint not null default 0,
  pnl bigint not null default 0,
  created_at timestamptz not null default now(),
  unique (round_id, player_id),
  unique (player_id, idempotency_key)
);

create index if not exists tape_stakes_round_created_at_idx
  on public.tape_stakes (round_id, created_at);

create index if not exists tape_stakes_player_round_idx
  on public.tape_stakes (player_id, round_id);

create table if not exists public.tape_settlements (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null unique references public.tape_rounds(id) on delete cascade,
  total_staked bigint not null,
  total_paid bigint not null,
  rake bigint not null default 0,
  reconciliation_ok boolean not null,
  idempotency_key text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.tape_ranked_results (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.tape_rounds(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  pnl bigint not null,
  won boolean not null,
  created_at timestamptz not null default now(),
  unique (round_id, player_id)
);

create index if not exists tape_ranked_results_player_created_at_idx
  on public.tape_ranked_results (player_id, created_at desc);

create table if not exists public.managed_books (
  id uuid primary key default gen_random_uuid(),
  pm_id uuid not null unique references public.players(id) on delete cascade,
  cash_credits bigint not null default 0 check (cash_credits >= 0),
  ranked boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.allocations (
  id uuid primary key default gen_random_uuid(),
  allocator_id uuid not null references public.players(id) on delete cascade,
  pm_id uuid not null references public.players(id) on delete cascade,
  book_id uuid not null references public.managed_books(id) on delete cascade,
  principal bigint not null check (principal > 0),
  principal_remaining bigint not null check (principal_remaining >= 0),
  realized_pnl bigint not null default 0,
  fee_paid bigint not null default 0,
  status text not null default 'active' check (status in ('active', 'withdrawing', 'closed')),
  ranked boolean not null default false,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (allocator_id, idempotency_key)
);

create index if not exists allocations_allocator_created_at_idx
  on public.allocations (allocator_id, created_at desc);

create index if not exists allocations_pm_created_at_idx
  on public.allocations (pm_id, created_at desc);

create table if not exists public.managed_positions (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.managed_books(id) on delete cascade,
  asset_id uuid not null references public.assets(id) on delete cascade,
  qty bigint not null default 0 check (qty >= 0),
  avg_cost bigint not null default 0 check (avg_cost >= 0),
  updated_at timestamptz not null default now(),
  unique (book_id, asset_id)
);

create index if not exists managed_positions_book_id_idx
  on public.managed_positions (book_id);

create table if not exists public.managed_orders (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.managed_books(id) on delete cascade,
  pm_id uuid not null references public.players(id) on delete cascade,
  asset_id uuid not null references public.assets(id) on delete restrict,
  side text not null check (side in ('buy', 'sell')),
  qty bigint not null check (qty > 0),
  fill_price bigint not null check (fill_price > 0),
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  unique (book_id, idempotency_key)
);

create index if not exists managed_orders_book_created_at_idx
  on public.managed_orders (book_id, created_at desc);

create table if not exists public.allocation_settlements (
  id uuid primary key default gen_random_uuid(),
  allocation_id uuid not null references public.allocations(id) on delete cascade,
  book_id uuid not null references public.managed_books(id) on delete cascade,
  pm_id uuid not null references public.players(id) on delete cascade,
  allocator_id uuid not null references public.players(id) on delete cascade,
  gross_pnl bigint not null,
  fee bigint not null default 0 check (fee >= 0),
  allocator_delta bigint not null,
  status text not null check (status in ('settled', 'withdrawn')),
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  unique (allocation_id, idempotency_key)
);

create index if not exists allocation_settlements_allocation_created_at_idx
  on public.allocation_settlements (allocation_id, created_at desc);

do $$
begin
  if to_regclass('public.ranked_leaderboard') is null then
    execute $view$
      create view public.ranked_leaderboard as
      select
        p.id as player_id,
        p.name,
        p.wallet_address,
        0::bigint as ranked_pnl,
        0::bigint as ranked_duels,
        0::bigint as ranked_wins,
        case when p.ranked then 'Analyst' else 'Sandbox' end as tier
      from public.players p
      where p.ranked = true
      order by p.created_at asc
    $view$;
  end if;
end $$;

create or replace view public.pm_directory as
select
  p.id as pm_id,
  p.name,
  p.wallet_address,
  p.ranked,
  coalesce(rl.ranked_pnl, 0)::bigint as ranked_pnl,
  coalesce(rl.ranked_duels, 0)::bigint as ranked_duels,
  coalesce(rl.ranked_wins, 0)::bigint as ranked_wins,
  coalesce(rl.tier, case when p.ranked then 'Analyst' else 'Sandbox' end) as tier,
  (
    p.ranked = true
    and coalesce(rl.tier, 'Analyst') in ('PM', 'Desk Head', 'Boss')
  ) as pm_eligible,
  coalesce(b.cash_credits, 0)::bigint as managed_cash,
  coalesce(sum(a.principal_remaining) filter (where a.status in ('active', 'withdrawing')), 0)::bigint as aum
from public.players p
left join public.ranked_leaderboard rl on rl.player_id = p.id
left join public.managed_books b on b.pm_id = p.id
left join public.allocations a on a.pm_id = p.id
group by p.id, p.name, p.wallet_address, p.ranked, rl.ranked_pnl, rl.ranked_duels, rl.ranked_wins, rl.tier, b.cash_credits
order by pm_eligible desc, ranked_pnl desc, aum desc;

alter table public.seasons enable row level security;
alter table public.assets enable row level security;
alter table public.season_standings enable row level security;
alter table public.season_payouts enable row level security;
alter table public.fee_claims enable row level security;
alter table public.tape_rounds enable row level security;
alter table public.tape_stakes enable row level security;
alter table public.tape_settlements enable row level security;
alter table public.tape_ranked_results enable row level security;
alter table public.managed_books enable row level security;
alter table public.allocations enable row level security;
alter table public.managed_positions enable row level security;
alter table public.managed_orders enable row level security;
alter table public.allocation_settlements enable row level security;

revoke all on public.seasons from anon, authenticated;
revoke all on public.assets from anon, authenticated;
revoke all on public.season_standings from anon, authenticated;
revoke all on public.season_payouts from anon, authenticated;
revoke all on public.fee_claims from anon, authenticated;
revoke all on public.tape_rounds from anon, authenticated;
revoke all on public.tape_stakes from anon, authenticated;
revoke all on public.tape_settlements from anon, authenticated;
revoke all on public.tape_ranked_results from anon, authenticated;
revoke all on public.managed_books from anon, authenticated;
revoke all on public.allocations from anon, authenticated;
revoke all on public.managed_positions from anon, authenticated;
revoke all on public.managed_orders from anon, authenticated;
revoke all on public.allocation_settlements from anon, authenticated;

grant select on public.seasons to anon, authenticated;
grant select on public.assets to anon, authenticated;
grant select on public.season_standings to anon, authenticated;
grant select on public.season_payouts to anon, authenticated;
grant select on public.fee_claims to anon, authenticated;
grant select on public.tape_rounds to anon, authenticated;
grant select on public.tape_stakes to authenticated;
grant select on public.tape_settlements to anon, authenticated;
grant select on public.tape_ranked_results to anon, authenticated;
grant select on public.managed_books to authenticated;
grant select on public.allocations to authenticated;
grant select on public.managed_positions to authenticated;
grant select on public.managed_orders to authenticated;
grant select on public.allocation_settlements to authenticated;
grant select on public.ranked_leaderboard to anon, authenticated;
grant select on public.pm_directory to anon, authenticated;

drop policy if exists "seasons world readable" on public.seasons;
create policy "seasons world readable"
  on public.seasons
  for select
  to anon, authenticated
  using (true);

drop policy if exists "assets world readable" on public.assets;
create policy "assets world readable"
  on public.assets
  for select
  to anon, authenticated
  using (true);

drop policy if exists "season standings world readable" on public.season_standings;
create policy "season standings world readable"
  on public.season_standings
  for select
  to anon, authenticated
  using (true);

drop policy if exists "season payouts world readable" on public.season_payouts;
create policy "season payouts world readable"
  on public.season_payouts
  for select
  to anon, authenticated
  using (true);

drop policy if exists "fee claims world readable" on public.fee_claims;
create policy "fee claims world readable"
  on public.fee_claims
  for select
  to anon, authenticated
  using (true);

drop policy if exists "tape rounds world readable" on public.tape_rounds;
create policy "tape rounds world readable"
  on public.tape_rounds
  for select
  to anon, authenticated
  using (true);

drop policy if exists "tape stakes participant readable" on public.tape_stakes;
create policy "tape stakes participant readable"
  on public.tape_stakes
  for select
  to authenticated
  using (true);

drop policy if exists "tape settlements world readable" on public.tape_settlements;
create policy "tape settlements world readable"
  on public.tape_settlements
  for select
  to anon, authenticated
  using (true);

drop policy if exists "tape ranked results world readable" on public.tape_ranked_results;
create policy "tape ranked results world readable"
  on public.tape_ranked_results
  for select
  to anon, authenticated
  using (true);

drop policy if exists "managed books visible to pm or allocator" on public.managed_books;
create policy "managed books visible to pm or allocator"
  on public.managed_books
  for select
  to authenticated
  using (
    auth.uid() = pm_id
    or exists (
      select 1
      from public.allocations a
      where a.book_id = managed_books.id
        and a.allocator_id = auth.uid()
    )
  );

drop policy if exists "allocations visible to participants" on public.allocations;
create policy "allocations visible to participants"
  on public.allocations
  for select
  to authenticated
  using (auth.uid() = allocator_id or auth.uid() = pm_id);

drop policy if exists "managed positions visible to participants" on public.managed_positions;
create policy "managed positions visible to participants"
  on public.managed_positions
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.managed_books b
      left join public.allocations a on a.book_id = b.id
      where b.id = managed_positions.book_id
        and (b.pm_id = auth.uid() or a.allocator_id = auth.uid())
    )
  );

drop policy if exists "managed orders visible to participants" on public.managed_orders;
create policy "managed orders visible to participants"
  on public.managed_orders
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.managed_books b
      left join public.allocations a on a.book_id = b.id
      where b.id = managed_orders.book_id
        and (b.pm_id = auth.uid() or a.allocator_id = auth.uid())
    )
  );

drop policy if exists "allocation settlements visible to participants" on public.allocation_settlements;
create policy "allocation settlements visible to participants"
  on public.allocation_settlements
  for select
  to authenticated
  using (auth.uid() = allocator_id or auth.uid() = pm_id);

do $$
begin
  if exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
  ) then
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'tape_rounds'
    ) then
      alter publication supabase_realtime add table public.tape_rounds;
    end if;

    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'tape_stakes'
    ) then
      alter publication supabase_realtime add table public.tape_stakes;
    end if;
  end if;
end $$;
