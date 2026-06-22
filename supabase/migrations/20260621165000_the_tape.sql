create table if not exists public.tape_rounds (
  id uuid primary key default gen_random_uuid(),
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

alter table public.tape_rounds enable row level security;
alter table public.tape_stakes enable row level security;
alter table public.tape_settlements enable row level security;
alter table public.tape_ranked_results enable row level security;

revoke all on public.tape_rounds from anon, authenticated;
revoke all on public.tape_stakes from anon, authenticated;
revoke all on public.tape_settlements from anon, authenticated;
revoke all on public.tape_ranked_results from anon, authenticated;

grant select on public.tape_rounds to anon, authenticated;
grant select on public.tape_stakes to authenticated;
grant select on public.tape_settlements to anon, authenticated;
grant select on public.tape_ranked_results to anon, authenticated;

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

create or replace view public.ranked_leaderboard as
with combined_results as (
  select player_id, pnl, won from public.ranked_duel_results
  union all
  select player_id, pnl, won from public.tape_ranked_results
)
select
  p.id as player_id,
  p.name,
  p.wallet_address,
  coalesce(sum(r.pnl), 0)::bigint as ranked_pnl,
  count(r.player_id)::bigint as ranked_duels,
  sum(case when r.won then 1 else 0 end)::bigint as ranked_wins,
  case
    when coalesce(sum(r.pnl), 0) >= 50000
      and dense_rank() over (order by coalesce(sum(r.pnl), 0) desc, sum(case when r.won then 1 else 0 end) desc) = 1
      then 'Boss'
    when coalesce(sum(r.pnl), 0) >= 25000 then 'Desk Head'
    when coalesce(sum(r.pnl), 0) >= 10000 then 'PM'
    else 'Analyst'
  end as tier
from public.players p
join combined_results r
  on r.player_id = p.id
where p.ranked = true
group by p.id, p.name, p.wallet_address
order by ranked_pnl desc, ranked_wins desc;

create or replace function public.current_tape_round_number()
returns bigint
language sql
stable
as $$
  select floor(extract(epoch from now()) / 60)::bigint;
$$;

create or replace function public.open_tape_round(
  p_round_number bigint,
  p_server_seed text,
  p_commit_hash text,
  p_public_entropy text
)
returns table (
  round_id uuid,
  round_number bigint,
  status text,
  commit_hash text,
  public_entropy text,
  opened_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.tape_rounds (round_number, commit_hash, server_seed, public_entropy)
  values (p_round_number, p_commit_hash, p_server_seed, p_public_entropy)
  on conflict (round_number) do nothing;

  select r.id, r.round_number, r.status, r.commit_hash, r.public_entropy, r.opened_at
  into round_id, open_tape_round.round_number, status, commit_hash, public_entropy, opened_at
  from public.tape_rounds r
  where r.round_number = p_round_number;

  return next;
end;
$$;

create or replace function public.join_tape_round(
  p_player_id uuid,
  p_round_id uuid,
  p_side text,
  p_stake bigint,
  p_idempotency_key text
)
returns table (
  stake_id uuid,
  round_id uuid,
  side text,
  stake bigint,
  credits bigint,
  pot bigint,
  ranked boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  round_record public.tape_rounds%rowtype;
  existing_stake public.tape_stakes%rowtype;
  player_record public.players%rowtype;
  current_credits bigint;
begin
  if p_side not in ('up', 'down') then
    raise exception 'Invalid Tape side';
  end if;

  if p_stake <= 0 then
    raise exception 'Invalid stake';
  end if;

  select *
  into round_record
  from public.tape_rounds r
  where r.id = p_round_id
  for update;

  if not found then
    raise exception 'Tape round not found';
  end if;

  if round_record.status <> 'open' then
    raise exception 'Tape round is not open';
  end if;

  select *
  into existing_stake
  from public.tape_stakes s
  where s.round_id = p_round_id
    and s.player_id = p_player_id;

  if found then
    select pc.credits into current_credits from public.player_credits pc where pc.player_id = p_player_id;
    stake_id := existing_stake.id;
    round_id := existing_stake.round_id;
    side := existing_stake.side;
    stake := existing_stake.stake;
    credits := current_credits;
    pot := round_record.pot;
    ranked := existing_stake.ranked;
    return next;
    return;
  end if;

  select *
  into player_record
  from public.players p
  where p.id = p_player_id;

  if not found then
    raise exception 'Player not found';
  end if;

  if not (
    (p_side = 'up' and player_record.gx in (4, 5) and player_record.gy in (11, 12))
    or (p_side = 'down' and player_record.gx in (10, 11) and player_record.gy in (11, 12))
  ) then
    raise exception 'Avatar is not standing on the requested Tape pad';
  end if;

  select pc.credits
  into current_credits
  from public.player_credits pc
  where pc.player_id = p_player_id
  for update;

  if current_credits is null or current_credits < p_stake then
    raise exception 'Insufficient credits';
  end if;

  update public.player_credits
  set credits = credits - p_stake
  where player_id = p_player_id
  returning player_credits.credits into current_credits;

  insert into public.tape_stakes (round_id, player_id, side, stake, ranked, idempotency_key)
  values (p_round_id, p_player_id, p_side, p_stake, coalesce(player_record.ranked, false), p_idempotency_key)
  returning id into stake_id;

  update public.tape_rounds
  set pot = pot + p_stake
  where id = p_round_id
  returning tape_rounds.pot into pot;

  round_id := p_round_id;
  side := p_side;
  stake := p_stake;
  credits := current_credits;
  ranked := coalesce(player_record.ranked, false);
  return next;
end;
$$;

create or replace function public.reveal_tape_round(
  p_round_id uuid
)
returns table (
  round_id uuid,
  status text,
  server_seed text,
  public_entropy text,
  outcome text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  round_record public.tape_rounds%rowtype;
  outcome_bit numeric;
  derived_outcome text;
begin
  select *
  into round_record
  from public.tape_rounds r
  where r.id = p_round_id
  for update;

  if not found then
    raise exception 'Tape round not found';
  end if;

  if round_record.status = 'settled' then
    round_id := round_record.id;
    status := round_record.status;
    server_seed := round_record.server_seed;
    public_entropy := round_record.public_entropy;
    outcome := round_record.outcome;
    return next;
    return;
  end if;

  outcome_bit := public.hex8_to_bigint(substr(encode(digest(round_record.server_seed || ':' || round_record.public_entropy, 'sha256'), 'hex'), 1, 8));
  derived_outcome := case when mod(outcome_bit::bigint, 2) = 0 then 'up' else 'down' end;

  update public.tape_rounds
  set status = 'revealing',
      locked_at = coalesce(locked_at, now()),
      outcome = derived_outcome
  where id = round_record.id
  returning id, tape_rounds.status, tape_rounds.server_seed, tape_rounds.public_entropy, tape_rounds.outcome
  into round_id, status, server_seed, public_entropy, outcome;

  return next;
end;
$$;

create or replace function public.settle_tape_round(
  p_round_id uuid,
  p_idempotency_key text
)
returns table (
  round_id uuid,
  status text,
  outcome text,
  total_staked bigint,
  total_paid bigint,
  rake bigint,
  reconciliation_ok boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  round_record public.tape_rounds%rowtype;
  existing_settlement public.tape_settlements%rowtype;
  winning_total bigint;
  losing_total bigint;
  stake_record record;
  payout bigint;
  paid_sum bigint := 0;
  dust bigint := 0;
begin
  select *
  into round_record
  from public.tape_rounds r
  where r.id = p_round_id
  for update;

  if not found then
    raise exception 'Tape round not found';
  end if;

  select *
  into existing_settlement
  from public.tape_settlements s
  where s.round_id = p_round_id;

  if found then
    round_id := round_record.id;
    status := round_record.status;
    outcome := round_record.outcome;
    total_staked := existing_settlement.total_staked;
    total_paid := existing_settlement.total_paid;
    rake := existing_settlement.rake;
    reconciliation_ok := existing_settlement.reconciliation_ok;
    return next;
    return;
  end if;

  if round_record.outcome is null then
    perform 1 from public.reveal_tape_round(p_round_id);
    select * into round_record from public.tape_rounds r where r.id = p_round_id for update;
  end if;

  select coalesce(sum(stake), 0)
  into total_staked
  from public.tape_stakes
  where tape_stakes.round_id = p_round_id;

  select coalesce(sum(stake), 0)
  into winning_total
  from public.tape_stakes
  where tape_stakes.round_id = p_round_id
    and tape_stakes.side = round_record.outcome;

  losing_total := total_staked - winning_total;
  rake := 0;

  if total_staked = 0 then
    paid_sum := 0;
  elsif winning_total = 0 or losing_total = 0 then
    for stake_record in
      select * from public.tape_stakes where tape_stakes.round_id = p_round_id
    loop
      payout := stake_record.stake;
      update public.player_credits
      set credits = credits + payout
      where player_id = stake_record.player_id;
      update public.tape_stakes
      set paid_out = payout,
          pnl = 0
      where id = stake_record.id;
      paid_sum := paid_sum + payout;
    end loop;
  else
    for stake_record in
      select * from public.tape_stakes where tape_stakes.round_id = p_round_id
    loop
      if stake_record.side = round_record.outcome then
        payout := stake_record.stake + ((losing_total * stake_record.stake) / winning_total);
      else
        payout := 0;
      end if;

      update public.player_credits
      set credits = credits + payout
      where player_id = stake_record.player_id;

      update public.tape_stakes
      set paid_out = payout,
          pnl = payout - stake_record.stake
      where id = stake_record.id;

      if stake_record.ranked then
        insert into public.tape_ranked_results (round_id, player_id, pnl, won)
        values (p_round_id, stake_record.player_id, payout - stake_record.stake, payout > stake_record.stake)
        on conflict (round_id, player_id) do nothing;
      end if;

      paid_sum := paid_sum + payout;
    end loop;

    dust := total_staked - paid_sum;
    if dust > 0 then
      rake := dust;
    end if;
  end if;

  reconciliation_ok := (total_staked = paid_sum + rake);

  insert into public.tape_settlements (round_id, total_staked, total_paid, rake, reconciliation_ok, idempotency_key)
  values (p_round_id, total_staked, paid_sum, rake, reconciliation_ok, p_idempotency_key);

  update public.tape_rounds
  set status = 'settled',
      settled_at = now()
  where id = p_round_id
  returning id, tape_rounds.status, tape_rounds.outcome
  into round_id, status, outcome;

  total_paid := paid_sum;
  return next;
end;
$$;

revoke all on function public.current_tape_round_number() from public;
revoke all on function public.open_tape_round(bigint, text, text, text) from public;
revoke all on function public.join_tape_round(uuid, uuid, text, bigint, text) from public;
revoke all on function public.reveal_tape_round(uuid) from public;
revoke all on function public.settle_tape_round(uuid, text) from public;

do $$
begin
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
end $$;
