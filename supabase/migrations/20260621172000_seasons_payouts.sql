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

create table if not exists public.season_standings (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id) on delete cascade,
  wallet text not null,
  "rank" int not null check ("rank" > 0),
  score bigint not null,
  snapshotted_at timestamptz not null default now(),
  unique (season_id, wallet)
);

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

alter table public.seasons enable row level security;
alter table public.season_standings enable row level security;
alter table public.season_payouts enable row level security;
alter table public.fee_claims enable row level security;

revoke all on public.seasons from anon, authenticated;
revoke all on public.season_standings from anon, authenticated;
revoke all on public.season_payouts from anon, authenticated;
revoke all on public.fee_claims from anon, authenticated;

grant select on public.seasons to anon, authenticated;
grant select on public.season_standings to anon, authenticated;
grant select on public.season_payouts to anon, authenticated;
grant select on public.fee_claims to anon, authenticated;

drop policy if exists "seasons world readable" on public.seasons;
create policy "seasons world readable"
  on public.seasons
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

create or replace function public.open_season(
  p_season_number bigint,
  p_started_at timestamptz,
  p_ends_at timestamptz
)
returns table (
  season_id uuid,
  season_number bigint,
  status text,
  started_at timestamptz,
  ends_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.seasons (season_number, started_at, ends_at)
  values (p_season_number, p_started_at, p_ends_at)
  on conflict (season_number) do nothing;

  select s.id, s.season_number, s.status, s.started_at, s.ends_at
  into season_id, open_season.season_number, status, started_at, ends_at
  from public.seasons s
  where s.season_number = p_season_number;

  return next;
end;
$$;

create or replace function public.snapshot_season(
  p_season_id uuid
)
returns table (
  season_id uuid,
  standings_count bigint,
  status text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  season_record public.seasons%rowtype;
begin
  select *
  into season_record
  from public.seasons s
  where s.id = p_season_id
  for update;

  if not found then
    raise exception 'Season not found';
  end if;

  if season_record.status in ('snapshotted', 'paid') then
    select count(*) into standings_count from public.season_standings ss where ss.season_id = p_season_id;
    season_id := p_season_id;
    status := season_record.status;
    return next;
    return;
  end if;

  update public.seasons
  set status = 'closing'
  where id = p_season_id;

  insert into public.season_standings (season_id, wallet, "rank", score)
  select
    p_season_id,
    rl.wallet_address,
    row_number() over (order by rl.ranked_pnl desc, rl.ranked_wins desc)::int as "rank",
    rl.ranked_pnl
  from public.ranked_leaderboard rl
  where rl.wallet_address is not null
  on conflict (season_id, wallet) do nothing;

  update public.seasons
  set status = 'snapshotted'
  where id = p_season_id;

  select count(*) into standings_count from public.season_standings ss where ss.season_id = p_season_id;
  season_id := p_season_id;
  status := 'snapshotted';
  return next;
end;
$$;

create or replace function public.record_fee_claim(
  p_claim_window text,
  p_season_id uuid,
  p_amount_claimed bigint,
  p_status text,
  p_tx_signature text,
  p_dry_run boolean
)
returns table (
  claim_id uuid,
  season_id uuid,
  claim_window text,
  amount_claimed bigint,
  status text,
  dry_run boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed_amount bigint := greatest(0, coalesce(p_amount_claimed, 0));
  resolved_season_id uuid;
begin
  if p_status not in ('pending', 'claimed', 'failed', 'skipped') then
    raise exception 'Invalid fee claim status';
  end if;

  insert into public.fee_claims (season_id, claim_window, amount_claimed, status, tx_signature, dry_run)
  values (p_season_id, p_claim_window, claimed_amount, p_status, p_tx_signature, p_dry_run)
  on conflict (claim_window) do update
  set season_id = coalesce(public.fee_claims.season_id, excluded.season_id),
      amount_claimed = case
        when public.fee_claims.dry_run = true and excluded.dry_run = false then excluded.amount_claimed
        else coalesce(public.fee_claims.amount_claimed, excluded.amount_claimed)
      end,
      status = case
        when public.fee_claims.dry_run = true and excluded.dry_run = false then excluded.status
        else public.fee_claims.status
      end,
      tx_signature = case
        when public.fee_claims.dry_run = true and excluded.dry_run = false then excluded.tx_signature
        else coalesce(public.fee_claims.tx_signature, excluded.tx_signature)
      end,
      dry_run = case
        when public.fee_claims.dry_run = true and excluded.dry_run = false then false
        else public.fee_claims.dry_run
      end
  returning id, fee_claims.season_id, fee_claims.claim_window, fee_claims.amount_claimed, fee_claims.status, fee_claims.dry_run
  into claim_id, resolved_season_id, claim_window, amount_claimed, status, dry_run;

  season_id := resolved_season_id;

  if season_id is not null and status = 'claimed' and not dry_run then
    update public.seasons
    set pool_amount = (
      select coalesce(sum(fc.amount_claimed), 0)
      from public.fee_claims fc
      where fc.season_id = resolved_season_id
        and fc.status = 'claimed'
        and fc.dry_run = false
    )
    where id = season_id;
  end if;

  return next;
end;
$$;

revoke all on function public.open_season(bigint, timestamptz, timestamptz) from public;
revoke all on function public.snapshot_season(uuid) from public;
revoke all on function public.record_fee_claim(text, uuid, bigint, text, text, boolean) from public;
