-- PumpSt backend remap.
-- Additive strategy: preserve existing Floor/Tape data and add PumpSt domain tables,
-- views, and RPCs beside it. No destructive renames; this keeps current routes/data safe
-- while the new city/property backend is verified.

create extension if not exists pgcrypto;

create table if not exists public.operators (
  player_id uuid primary key references public.players(id) on delete cascade,
  wallet_address text not null unique,
  tier text not null default 'street' check (tier in ('street', 'block', 'district', 'mayor', 'sandbox')),
  gate_balance numeric not null default 0,
  verified_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.addresses (
  id uuid primary key default gen_random_uuid(),
  address_number int unique not null check (address_number between 1 and 100),
  label text not null,
  district text not null,
  base_rent bigint not null default 100 check (base_rent >= 0),
  heat int not null default 0 check (heat >= 0),
  owner_operator_id uuid references public.operators(player_id) on delete set null,
  auction_date date,
  auction_status text not null default 'open' check (auction_status in ('open', 'closing', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.bids (
  id uuid primary key default gen_random_uuid(),
  address_id uuid not null references public.addresses(id) on delete cascade,
  operator_id uuid references public.operators(player_id) on delete set null,
  auction_date date not null default current_date,
  amount bigint not null check (amount > 0),
  source text not null default 'operator' check (source in ('operator', 'bot')),
  status text not null default 'placed' check (status in ('placed', 'winning', 'lost', 'refunded')),
  idempotency_key text not null unique,
  created_at timestamptz not null default now()
);

create index if not exists bids_address_auction_amount_idx
  on public.bids (address_id, auction_date, amount desc, created_at asc);

create table if not exists public.holdings (
  id uuid primary key default gen_random_uuid(),
  address_id uuid not null unique references public.addresses(id) on delete cascade,
  operator_id uuid not null references public.operators(player_id) on delete cascade,
  acquired_bid_id uuid references public.bids(id) on delete set null,
  principal bigint not null check (principal >= 0),
  status text not null default 'active' check (status in ('active', 'closed')),
  idempotency_key text not null unique,
  acquired_at timestamptz not null default now(),
  closed_at timestamptz
);

create table if not exists public.rent_ledger (
  id uuid primary key default gen_random_uuid(),
  holding_id uuid references public.holdings(id) on delete set null,
  address_id uuid not null references public.addresses(id) on delete cascade,
  operator_id uuid not null references public.operators(player_id) on delete cascade,
  amount bigint not null,
  reason text not null,
  idempotency_key text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.fee_payouts (
  id uuid primary key default gen_random_uuid(),
  season_id uuid references public.seasons(id) on delete set null,
  operator_id uuid references public.operators(player_id) on delete set null,
  wallet_address text not null,
  tier text not null,
  amount bigint not null check (amount >= 0),
  reason text not null,
  status text not null default 'dry_run' check (status in ('dry_run', 'pending', 'sent', 'failed', 'skipped')),
  dry_run boolean not null default true,
  tx_signature text,
  idempotency_key text not null unique,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create table if not exists public.deals (
  id uuid primary key default gen_random_uuid(),
  address_id uuid references public.addresses(id) on delete set null,
  status text not null default 'open' check (status in ('open', 'revealing', 'settled')),
  commit_hash text not null,
  server_seed text,
  public_entropy text not null,
  outcome_entry_id uuid,
  pot bigint not null default 0 check (pot >= 0),
  opened_at timestamptz not null default now(),
  revealed_at timestamptz,
  settled_at timestamptz,
  idempotency_key text not null unique,
  settle_idempotency_key text unique
);

create table if not exists public.deal_entries (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  operator_id uuid not null references public.operators(player_id) on delete cascade,
  amount bigint not null check (amount > 0),
  paid_out bigint not null default 0 check (paid_out >= 0),
  pnl bigint not null default 0,
  idempotency_key text not null unique,
  created_at timestamptz not null default now(),
  unique (deal_id, operator_id)
);

alter table public.deals
  drop constraint if exists deals_outcome_entry_id_fkey;
alter table public.deals
  add constraint deals_outcome_entry_id_fkey
  foreign key (outcome_entry_id) references public.deal_entries(id) on delete set null;

create table if not exists public.deal_reveal_attempts (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  supplied_seed text not null,
  supplied_hash text not null,
  expected_hash text not null,
  valid boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.deal_settlements (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null unique references public.deals(id) on delete cascade,
  total_staked bigint not null,
  total_paid bigint not null,
  reconciliation_ok boolean not null,
  idempotency_key text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.heat_state (
  address_id uuid primary key references public.addresses(id) on delete cascade,
  heat int not null default 0 check (heat >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.reputation_state (
  operator_id uuid primary key references public.operators(player_id) on delete cascade,
  score bigint not null default 0,
  tier text not null default 'street',
  updated_at timestamptz not null default now()
);

create table if not exists public.helius_scan_watermarks (
  scanner text primary key,
  last_signature text,
  last_scanned_at timestamptz not null default now()
);

insert into public.addresses (address_number, label, district, base_rent)
select
  n,
  'PumpSt #' || lpad(n::text, 3, '0'),
  case
    when n <= 20 then 'Launch Row'
    when n <= 40 then 'Bond Block'
    when n <= 60 then 'Neon Yard'
    when n <= 80 then 'Tower Lane'
    else 'Mayor Loop'
  end,
  100 + (n * 7)
from generate_series(1, 100) as n
on conflict (address_number) do nothing;

create or replace view public.tier_leaderboard as
select
  rl.player_id as operator_id,
  rl.wallet_address,
  coalesce(rl.ranked_pnl, 0)::bigint as score,
  case
    when coalesce(rl.ranked_pnl, 0) >= 100000 then 'mayor'
    when coalesce(rl.ranked_pnl, 0) >= 50000 then 'district'
    when coalesce(rl.ranked_pnl, 0) >= 10000 then 'block'
    else 'street'
  end as tier
from public.ranked_leaderboard rl
where rl.wallet_address is not null;

grant select on public.tier_leaderboard to anon, authenticated;

create or replace function public.pumpst_hash(p_value text)
returns text
language sql
immutable
as $$
  select encode(digest(coalesce(p_value, ''), 'sha256'), 'hex');
$$;

create or replace function public.pumpst_hex16_to_bigint(p_hex text)
returns numeric
language sql
immutable
as $$
  select coalesce(sum(
    (strpos('0123456789abcdef', substr(lower(lpad(substr(coalesce(p_hex, '0'), 1, 16), 16, '0')), idx, 1))::numeric - 1)
    * power(16::numeric, 16 - idx)
  ), 0)
  from generate_series(1, 16) as idx;
$$;

create or replace function public.sync_pumpst_operator(p_player_id uuid)
returns table (
  operator_id uuid,
  wallet_address text,
  tier text,
  gate_balance numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  player_record public.players%rowtype;
  resolved_tier text;
begin
  select * into player_record
  from public.players p
  where p.id = p_player_id
  for update;

  if not found or not player_record.ranked or player_record.wallet_address is null then
    raise exception 'Verified PumpSt wallet required';
  end if;

  select coalesce(tl.tier, 'street')
  into resolved_tier
  from public.tier_leaderboard tl
  where tl.operator_id = p_player_id;

  insert into public.operators (player_id, wallet_address, tier, gate_balance, verified_at, updated_at)
  values (p_player_id, player_record.wallet_address, coalesce(resolved_tier, 'street'), coalesce(player_record.gate_balance, 0), now(), now())
  on conflict (player_id) do update
  set wallet_address = excluded.wallet_address,
      tier = excluded.tier,
      gate_balance = excluded.gate_balance,
      verified_at = now(),
      updated_at = now()
  returning operators.player_id, operators.wallet_address, operators.tier, operators.gate_balance
  into operator_id, wallet_address, tier, gate_balance;

  insert into public.reputation_state (operator_id, score, tier, updated_at)
  values (operator_id, 0, tier, now())
  on conflict (operator_id) do update
  set tier = excluded.tier,
      updated_at = now();

  return next;
end;
$$;

create or replace function public.record_pumpst_fee_payout(
  p_operator_id uuid,
  p_wallet_address text,
  p_tier text,
  p_amount bigint,
  p_reason text,
  p_idempotency_key text,
  p_dry_run boolean
)
returns table (
  payout_id uuid,
  wallet_address text,
  amount bigint,
  status text,
  dry_run boolean,
  idempotency_key text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_idempotency_key is null or length(trim(p_idempotency_key)) < 8 then
    raise exception 'Invalid idempotency key';
  end if;

  insert into public.fee_payouts (operator_id, wallet_address, tier, amount, reason, status, dry_run, idempotency_key)
  values (
    p_operator_id,
    p_wallet_address,
    p_tier,
    greatest(0, coalesce(p_amount, 0)),
    p_reason,
    case when p_dry_run then 'dry_run' else 'pending' end,
    p_dry_run,
    p_idempotency_key
  )
  on conflict (idempotency_key) do nothing;

  select fp.id, fp.wallet_address, fp.amount, fp.status, fp.dry_run, fp.idempotency_key
  into payout_id, wallet_address, amount, status, dry_run, idempotency_key
  from public.fee_payouts fp
  where fp.idempotency_key = p_idempotency_key;

  return next;
end;
$$;

create or replace function public.queue_tier_fee_payouts(
  p_pool_amount bigint,
  p_checkpoint_id text,
  p_dry_run boolean
)
returns table (
  payouts_count bigint,
  total_amount bigint,
  dry_run boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  weights int[] := array[40,25,15,8,5,3,2,1,1];
  standing record;
  idx int := 1;
  payout_amount bigint;
begin
  if p_checkpoint_id is null or length(trim(p_checkpoint_id)) < 8 then
    raise exception 'Invalid checkpoint id';
  end if;

  payouts_count := 0;
  total_amount := 0;
  dry_run := p_dry_run;

  for standing in
    select operator_id, wallet_address, tier
    from public.tier_leaderboard
    order by score desc
    limit array_length(weights, 1)
  loop
    payout_amount := (greatest(0, coalesce(p_pool_amount, 0)) * weights[idx]) / 100;

    perform public.record_pumpst_fee_payout(
      standing.operator_id,
      standing.wallet_address,
      standing.tier,
      payout_amount,
      'tier_creator_fee',
      p_checkpoint_id || ':' || standing.wallet_address,
      p_dry_run
    );

    payouts_count := payouts_count + 1;
    total_amount := total_amount + payout_amount;
    idx := idx + 1;
  end loop;

  return next;
end;
$$;

create or replace function public.place_property_bid(
  p_player_id uuid,
  p_address_id uuid,
  p_amount bigint,
  p_idempotency_key text
)
returns table (
  bid_id uuid,
  address_id uuid,
  operator_id uuid,
  amount bigint,
  status text,
  idempotency_key text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  op record;
  existing_bid public.bids%rowtype;
  credits_record public.player_credits%rowtype;
begin
  if p_amount <= 0 or p_idempotency_key is null or length(trim(p_idempotency_key)) < 8 then
    raise exception 'Invalid bid payload';
  end if;

  select * into existing_bid from public.bids b where b.idempotency_key = p_idempotency_key;
  if found then
    bid_id := existing_bid.id;
    address_id := existing_bid.address_id;
    operator_id := existing_bid.operator_id;
    amount := existing_bid.amount;
    status := existing_bid.status;
    idempotency_key := existing_bid.idempotency_key;
    return next;
    return;
  end if;

  select * into op from public.sync_pumpst_operator(p_player_id);

  perform 1 from public.addresses a where a.id = p_address_id and a.auction_status = 'open';
  if not found then
    raise exception 'Address auction is not open';
  end if;

  select * into credits_record
  from public.player_credits pc
  where pc.player_id = p_player_id
  for update;

  if not found or credits_record.credits < p_amount then
    raise exception 'Insufficient Credits';
  end if;

  update public.player_credits
  set credits = credits - p_amount,
      updated_at = now()
  where player_id = p_player_id;

  insert into public.bids (address_id, operator_id, amount, source, idempotency_key)
  values (p_address_id, op.operator_id, p_amount, 'operator', p_idempotency_key)
  returning bids.id, bids.address_id, bids.operator_id, bids.amount, bids.status, bids.idempotency_key
  into bid_id, address_id, operator_id, amount, status, idempotency_key;

  return next;
end;
$$;

create or replace function public.place_bot_property_bid(
  p_address_id uuid,
  p_amount bigint,
  p_idempotency_key text
)
returns table (
  bid_id uuid,
  address_id uuid,
  amount bigint,
  status text,
  idempotency_key text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_amount <= 0 or p_idempotency_key is null or length(trim(p_idempotency_key)) < 8 then
    raise exception 'Invalid bot bid payload';
  end if;

  insert into public.bids (address_id, amount, source, idempotency_key)
  values (p_address_id, p_amount, 'bot', p_idempotency_key)
  on conflict (idempotency_key) do nothing;

  select b.id, b.address_id, b.amount, b.status, b.idempotency_key
  into bid_id, address_id, amount, status, idempotency_key
  from public.bids b
  where b.idempotency_key = p_idempotency_key;

  return next;
end;
$$;

create or replace function public.close_address_auction(
  p_address_id uuid,
  p_auction_date date,
  p_idempotency_key text,
  p_dry_run boolean
)
returns table (
  address_id uuid,
  winning_bid_id uuid,
  owner_operator_id uuid,
  winning_amount bigint,
  payout_audit_count bigint,
  dry_run boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  address_record public.addresses%rowtype;
  winning_bid public.bids%rowtype;
  holding_id uuid;
  fee_pool bigint;
  payout_result record;
begin
  if p_idempotency_key is null or length(trim(p_idempotency_key)) < 8 then
    raise exception 'Invalid idempotency key';
  end if;

  select * into address_record
  from public.addresses a
  where a.id = p_address_id
  for update;

  if not found then
    raise exception 'Address not found';
  end if;

  select * into winning_bid
  from public.bids b
  where b.address_id = p_address_id
    and b.auction_date = coalesce(p_auction_date, current_date)
    and b.status in ('placed', 'winning')
  order by b.amount desc, b.created_at asc
  limit 1
  for update;

  if not found then
    update public.addresses
    set auction_status = 'open',
        auction_date = coalesce(p_auction_date, current_date),
        updated_at = now()
    where id = p_address_id;

    close_address_auction.address_id := p_address_id;
    winning_bid_id := null;
    owner_operator_id := null;
    winning_amount := 0;
    payout_audit_count := 0;
    dry_run := p_dry_run;
    return next;
    return;
  end if;

  update public.bids
  set status = case when id = winning_bid.id then 'winning' else 'lost' end
  where bids.address_id = p_address_id
    and bids.auction_date = coalesce(p_auction_date, current_date);

  if winning_bid.operator_id is not null then
    insert into public.holdings (address_id, operator_id, acquired_bid_id, principal, idempotency_key)
    values (p_address_id, winning_bid.operator_id, winning_bid.id, winning_bid.amount, p_idempotency_key)
    on conflict (address_id) do update
    set operator_id = excluded.operator_id,
        acquired_bid_id = excluded.acquired_bid_id,
        principal = excluded.principal,
        status = 'active',
        idempotency_key = excluded.idempotency_key,
        acquired_at = now(),
        closed_at = null
    returning id into holding_id;

    update public.addresses
    set owner_operator_id = winning_bid.operator_id,
        auction_status = 'closed',
        auction_date = coalesce(p_auction_date, current_date),
        updated_at = now()
    where id = p_address_id;

    insert into public.rent_ledger (holding_id, address_id, operator_id, amount, reason, idempotency_key)
    values (holding_id, p_address_id, winning_bid.operator_id, address_record.base_rent, 'daily_rent_accrual', p_idempotency_key || ':rent')
    on conflict (idempotency_key) do nothing;
  else
    update public.addresses
    set auction_status = 'closed',
        auction_date = coalesce(p_auction_date, current_date),
        updated_at = now()
    where id = p_address_id;
  end if;

  fee_pool := greatest(0, winning_bid.amount / 100);
  select * into payout_result
  from public.queue_tier_fee_payouts(fee_pool, p_idempotency_key || ':tier-fee', p_dry_run);

  close_address_auction.address_id := p_address_id;
  winning_bid_id := winning_bid.id;
  owner_operator_id := winning_bid.operator_id;
  winning_amount := winning_bid.amount;
  payout_audit_count := coalesce(payout_result.payouts_count, 0);
  dry_run := p_dry_run;
  return next;
end;
$$;

create or replace function public.open_deal(
  p_address_id uuid,
  p_server_seed text,
  p_public_entropy text,
  p_idempotency_key text
)
returns table (
  deal_id uuid,
  address_id uuid,
  status text,
  commit_hash text,
  pot bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_server_seed is null or length(p_server_seed) < 16 or p_idempotency_key is null or length(trim(p_idempotency_key)) < 8 then
    raise exception 'Invalid deal payload';
  end if;

  insert into public.deals (address_id, commit_hash, server_seed, public_entropy, idempotency_key)
  values (p_address_id, public.pumpst_hash(p_server_seed), p_server_seed, p_public_entropy, p_idempotency_key)
  on conflict (idempotency_key) do nothing;

  select d.id, d.address_id, d.status, d.commit_hash, d.pot
  into deal_id, address_id, status, commit_hash, pot
  from public.deals d
  where d.idempotency_key = p_idempotency_key;

  return next;
end;
$$;

create or replace function public.join_deal(
  p_player_id uuid,
  p_deal_id uuid,
  p_amount bigint,
  p_idempotency_key text
)
returns table (
  entry_id uuid,
  deal_id uuid,
  operator_id uuid,
  amount bigint,
  pot bigint,
  idempotency_key text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  op record;
  deal_record public.deals%rowtype;
  existing_entry public.deal_entries%rowtype;
  credits_record public.player_credits%rowtype;
begin
  if p_amount <= 0 or p_idempotency_key is null or length(trim(p_idempotency_key)) < 8 then
    raise exception 'Invalid deal entry payload';
  end if;

  select * into existing_entry
  from public.deal_entries e
  where e.idempotency_key = p_idempotency_key;

  if found then
    select d.pot into pot from public.deals d where d.id = existing_entry.deal_id;
    entry_id := existing_entry.id;
    deal_id := existing_entry.deal_id;
    operator_id := existing_entry.operator_id;
    amount := existing_entry.amount;
    idempotency_key := existing_entry.idempotency_key;
    return next;
    return;
  end if;

  select * into op from public.sync_pumpst_operator(p_player_id);

  select * into deal_record
  from public.deals d
  where d.id = p_deal_id
  for update;

  if not found or deal_record.status <> 'open' then
    raise exception 'Deal is not open';
  end if;

  select * into credits_record
  from public.player_credits pc
  where pc.player_id = p_player_id
  for update;

  if not found or credits_record.credits < p_amount then
    raise exception 'Insufficient Credits';
  end if;

  update public.player_credits
  set credits = credits - p_amount,
      updated_at = now()
  where player_id = p_player_id;

  insert into public.deal_entries (deal_id, operator_id, amount, idempotency_key)
  values (p_deal_id, op.operator_id, p_amount, p_idempotency_key)
  returning id, deal_entries.deal_id, deal_entries.operator_id, deal_entries.amount, deal_entries.idempotency_key
  into entry_id, deal_id, operator_id, amount, idempotency_key;

  update public.deals
  set pot = pot + p_amount
  where id = p_deal_id
  returning deals.pot into pot;

  return next;
end;
$$;

create or replace function public.reveal_deal(
  p_deal_id uuid,
  p_server_seed text
)
returns table (
  deal_id uuid,
  status text,
  commit_hash text,
  reveal_valid boolean,
  outcome_entry_id uuid,
  pot bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  deal_record public.deals%rowtype;
  supplied_hash text := public.pumpst_hash(p_server_seed);
  total_amount bigint;
  target numeric;
  running numeric := 0;
  entry_record public.deal_entries%rowtype;
begin
  select * into deal_record
  from public.deals d
  where d.id = p_deal_id
  for update;

  if not found then
    raise exception 'Deal not found';
  end if;

  if supplied_hash <> deal_record.commit_hash then
    insert into public.deal_reveal_attempts (deal_id, supplied_seed, supplied_hash, expected_hash, valid)
    values (p_deal_id, coalesce(p_server_seed, ''), supplied_hash, deal_record.commit_hash, false);

    reveal_deal.deal_id := p_deal_id;
    status := deal_record.status;
    commit_hash := deal_record.commit_hash;
    reveal_valid := false;
    outcome_entry_id := deal_record.outcome_entry_id;
    pot := deal_record.pot;
    return next;
    return;
  end if;

  insert into public.deal_reveal_attempts (deal_id, supplied_seed, supplied_hash, expected_hash, valid)
  values (p_deal_id, p_server_seed, supplied_hash, deal_record.commit_hash, true);

  if deal_record.status in ('revealing', 'settled') then
    reveal_deal.deal_id := p_deal_id;
    status := deal_record.status;
    commit_hash := deal_record.commit_hash;
    reveal_valid := true;
    outcome_entry_id := deal_record.outcome_entry_id;
    pot := deal_record.pot;
    return next;
    return;
  end if;

  select coalesce(sum(amount), 0)
  into total_amount
  from public.deal_entries
  where deal_entries.deal_id = p_deal_id;

  if total_amount <= 0 then
    update public.deals
    set status = 'revealing',
        revealed_at = now()
    where id = p_deal_id
    returning deals.id, deals.status, deals.commit_hash, deals.outcome_entry_id, deals.pot
    into reveal_deal.deal_id, status, commit_hash, outcome_entry_id, pot;

    reveal_valid := true;
    return next;
    return;
  end if;

  target := mod(public.pumpst_hex16_to_bigint(public.pumpst_hash(p_server_seed || ':' || deal_record.public_entropy)), total_amount::numeric) + 1;

  for entry_record in
    select * from public.deal_entries
    where deal_entries.deal_id = p_deal_id
    order by created_at asc, id asc
  loop
    running := running + entry_record.amount;
    if running >= target then
      exit;
    end if;
  end loop;

  update public.deals
  set status = 'revealing',
      outcome_entry_id = entry_record.id,
      revealed_at = now()
  where id = p_deal_id
  returning deals.id, deals.status, deals.commit_hash, deals.outcome_entry_id, deals.pot
  into reveal_deal.deal_id, status, commit_hash, outcome_entry_id, pot;

  reveal_valid := true;
  return next;
end;
$$;

create or replace function public.settle_deal(
  p_deal_id uuid,
  p_idempotency_key text,
  p_dry_run boolean
)
returns table (
  deal_id uuid,
  status text,
  winner_operator_id uuid,
  total_staked bigint,
  total_paid bigint,
  reconciliation_ok boolean,
  dry_run boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  deal_record public.deals%rowtype;
  winner_entry public.deal_entries%rowtype;
  entry_record public.deal_entries%rowtype;
  existing_settlement public.deal_settlements%rowtype;
  paid_sum bigint := 0;
  staked_sum bigint := 0;
begin
  if p_idempotency_key is null or length(trim(p_idempotency_key)) < 8 then
    raise exception 'Invalid idempotency key';
  end if;

  select * into existing_settlement
  from public.deal_settlements ds
  where ds.idempotency_key = p_idempotency_key
     or ds.deal_id = p_deal_id;

  if found then
    select * into deal_record from public.deals d where d.id = p_deal_id;
    select * into winner_entry from public.deal_entries e where e.id = deal_record.outcome_entry_id;
    deal_id := p_deal_id;
    status := deal_record.status;
    winner_operator_id := winner_entry.operator_id;
    total_staked := existing_settlement.total_staked;
    total_paid := existing_settlement.total_paid;
    reconciliation_ok := existing_settlement.reconciliation_ok;
    dry_run := p_dry_run;
    return next;
    return;
  end if;

  select * into deal_record
  from public.deals d
  where d.id = p_deal_id
  for update;

  if not found then
    raise exception 'Deal not found';
  end if;

  if deal_record.status = 'open' then
    perform * from public.reveal_deal(p_deal_id, deal_record.server_seed);
    select * into deal_record from public.deals d where d.id = p_deal_id for update;
  end if;

  select coalesce(sum(amount), 0) into staked_sum from public.deal_entries where deal_entries.deal_id = p_deal_id;

  if staked_sum = 0 or deal_record.outcome_entry_id is null then
    for entry_record in select * from public.deal_entries where deal_entries.deal_id = p_deal_id for update loop
      update public.player_credits
      set credits = credits + entry_record.amount,
          updated_at = now()
      where player_id = entry_record.operator_id;

      update public.deal_entries
      set paid_out = entry_record.amount,
          pnl = 0
      where id = entry_record.id;
      paid_sum := paid_sum + entry_record.amount;
    end loop;
  else
    select * into winner_entry from public.deal_entries e where e.id = deal_record.outcome_entry_id for update;

    update public.player_credits
    set credits = credits + staked_sum,
        updated_at = now()
    where player_id = winner_entry.operator_id;

    for entry_record in select * from public.deal_entries where deal_entries.deal_id = p_deal_id for update loop
      update public.deal_entries
      set paid_out = case when id = winner_entry.id then staked_sum else 0 end,
          pnl = case when id = winner_entry.id then staked_sum - entry_record.amount else -entry_record.amount end
      where id = entry_record.id;
    end loop;

    paid_sum := staked_sum;
  end if;

  insert into public.deal_settlements (deal_id, total_staked, total_paid, reconciliation_ok, idempotency_key)
  values (p_deal_id, staked_sum, paid_sum, staked_sum = paid_sum, p_idempotency_key);

  update public.deals
  set status = 'settled',
      settled_at = now(),
      settle_idempotency_key = p_idempotency_key
  where id = p_deal_id;

  deal_id := p_deal_id;
  status := 'settled';
  winner_operator_id := winner_entry.operator_id;
  total_staked := staked_sum;
  total_paid := paid_sum;
  reconciliation_ok := staked_sum = paid_sum;
  dry_run := p_dry_run;
  return next;
end;
$$;

alter table public.operators enable row level security;
alter table public.addresses enable row level security;
alter table public.bids enable row level security;
alter table public.holdings enable row level security;
alter table public.rent_ledger enable row level security;
alter table public.fee_payouts enable row level security;
alter table public.deals enable row level security;
alter table public.deal_entries enable row level security;
alter table public.deal_reveal_attempts enable row level security;
alter table public.deal_settlements enable row level security;
alter table public.heat_state enable row level security;
alter table public.reputation_state enable row level security;
alter table public.helius_scan_watermarks enable row level security;

revoke all on public.operators, public.addresses, public.bids, public.holdings, public.rent_ledger, public.fee_payouts, public.deals, public.deal_entries, public.deal_reveal_attempts, public.deal_settlements, public.heat_state, public.reputation_state, public.helius_scan_watermarks from anon, authenticated;

grant select on public.addresses, public.deals, public.deal_settlements, public.heat_state, public.reputation_state, public.fee_payouts to anon, authenticated;
grant select on public.operators, public.bids, public.holdings, public.rent_ledger, public.deal_entries to authenticated;

drop policy if exists "pumpst public addresses readable" on public.addresses;
create policy "pumpst public addresses readable" on public.addresses for select to anon, authenticated using (true);

drop policy if exists "pumpst public deals readable" on public.deals;
create policy "pumpst public deals readable" on public.deals for select to anon, authenticated using (true);

drop policy if exists "pumpst public settlements readable" on public.deal_settlements;
create policy "pumpst public settlements readable" on public.deal_settlements for select to anon, authenticated using (true);

drop policy if exists "pumpst fee payouts readable" on public.fee_payouts;
create policy "pumpst fee payouts readable" on public.fee_payouts for select to anon, authenticated using (true);

drop policy if exists "pumpst operator self readable" on public.operators;
create policy "pumpst operator self readable" on public.operators for select to authenticated using (auth.uid() = player_id);

drop policy if exists "pumpst bids participant readable" on public.bids;
create policy "pumpst bids participant readable" on public.bids for select to authenticated using (operator_id = auth.uid() or source = 'bot');

drop policy if exists "pumpst holdings participant readable" on public.holdings;
create policy "pumpst holdings participant readable" on public.holdings for select to authenticated using (operator_id = auth.uid());

drop policy if exists "pumpst rent participant readable" on public.rent_ledger;
create policy "pumpst rent participant readable" on public.rent_ledger for select to authenticated using (operator_id = auth.uid());

drop policy if exists "pumpst deal entries participant readable" on public.deal_entries;
create policy "pumpst deal entries participant readable" on public.deal_entries for select to authenticated using (operator_id = auth.uid());

drop policy if exists "pumpst heat public readable" on public.heat_state;
create policy "pumpst heat public readable" on public.heat_state for select to anon, authenticated using (true);

drop policy if exists "pumpst reputation public readable" on public.reputation_state;
create policy "pumpst reputation public readable" on public.reputation_state for select to anon, authenticated using (true);

revoke all on function public.sync_pumpst_operator(uuid) from public;
revoke all on function public.record_pumpst_fee_payout(uuid, text, text, bigint, text, text, boolean) from public;
revoke all on function public.queue_tier_fee_payouts(bigint, text, boolean) from public;
revoke all on function public.place_property_bid(uuid, uuid, bigint, text) from public;
revoke all on function public.place_bot_property_bid(uuid, bigint, text) from public;
revoke all on function public.close_address_auction(uuid, date, text, boolean) from public;
revoke all on function public.open_deal(uuid, text, text, text) from public;
revoke all on function public.join_deal(uuid, uuid, bigint, text) from public;
revoke all on function public.reveal_deal(uuid, text) from public;
revoke all on function public.settle_deal(uuid, text, boolean) from public;
