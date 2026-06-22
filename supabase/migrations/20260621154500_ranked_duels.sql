alter table public.players
  add column if not exists wallet_address text,
  add column if not exists ranked boolean not null default false,
  add column if not exists ranked_checked_at timestamptz,
  add column if not exists gate_balance bigint not null default 0;

create unique index if not exists players_ranked_wallet_address_idx
  on public.players (wallet_address)
  where ranked = true and wallet_address is not null;

revoke update on public.players from anon, authenticated;
grant update (name, last_seen) on public.players to authenticated;

create table if not exists public.duels (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets(id) on delete restrict,
  stake bigint not null check (stake > 0),
  player_a uuid not null references public.players(id) on delete cascade,
  player_b uuid references public.players(id) on delete cascade,
  player_a_side text not null check (player_a_side in ('long', 'short')),
  player_b_side text check (player_b_side in ('long', 'short')),
  status text not null default 'open' check (status in ('open', 'locked', 'revealing', 'settled', 'cancelled')),
  ranked boolean not null default false,
  commit_hash text not null,
  seed text not null,
  winner uuid references public.players(id),
  player_a_pnl bigint,
  player_b_pnl bigint,
  start_price bigint not null,
  end_price bigint,
  idempotency_key text not null,
  accept_idempotency_key text,
  settle_idempotency_key text,
  started_at timestamptz,
  settled_at timestamptz,
  created_at timestamptz not null default now(),
  unique (player_a, idempotency_key),
  unique (player_b, accept_idempotency_key),
  unique (settle_idempotency_key)
);

create table if not exists public.ranked_duel_results (
  id uuid primary key default gen_random_uuid(),
  duel_id uuid not null references public.duels(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  pnl bigint not null,
  won boolean not null,
  created_at timestamptz not null default now(),
  unique (duel_id, player_id)
);

alter table public.duels enable row level security;
alter table public.ranked_duel_results enable row level security;

revoke all on public.duels from anon, authenticated;
revoke all on public.ranked_duel_results from anon, authenticated;
grant select on public.ranked_duel_results to anon, authenticated;

drop policy if exists "ranked duel results world readable" on public.ranked_duel_results;
create policy "ranked duel results world readable"
  on public.ranked_duel_results
  for select
  to anon, authenticated
  using (true);

create or replace view public.sandbox_leaderboard as
select
  p.id as player_id,
  p.name,
  p.wallet_address,
  p.ranked,
  coalesce(sum(
    case
      when d.player_a = p.id then coalesce(d.player_a_pnl, 0)
      when d.player_b = p.id then coalesce(d.player_b_pnl, 0)
      else 0
    end
  ), 0)::bigint as sandbox_pnl,
  count(d.id)::bigint as duels_played
from public.players p
left join public.duels d
  on d.status = 'settled'
  and (d.player_a = p.id or d.player_b = p.id)
group by p.id, p.name, p.wallet_address, p.ranked
order by sandbox_pnl desc, duels_played desc;

create or replace view public.ranked_leaderboard as
select
  p.id as player_id,
  p.name,
  p.wallet_address,
  coalesce(sum(r.pnl), 0)::bigint as ranked_pnl,
  count(r.id)::bigint as ranked_duels,
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
join public.ranked_duel_results r
  on r.player_id = p.id
where p.ranked = true
group by p.id, p.name, p.wallet_address
order by ranked_pnl desc, ranked_wins desc;

grant select on public.sandbox_leaderboard to anon, authenticated;
grant select on public.ranked_leaderboard to anon, authenticated;

create or replace function public.set_player_wallet_ranked(
  p_player_id uuid,
  p_wallet_address text,
  p_ranked boolean,
  p_gate_balance bigint
)
returns table (
  player_id uuid,
  wallet_address text,
  ranked boolean,
  gate_balance bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.players
  set wallet_address = p_wallet_address,
      ranked = p_ranked,
      gate_balance = greatest(0, p_gate_balance),
      ranked_checked_at = now()
  where id = p_player_id
  returning id, players.wallet_address, players.ranked, players.gate_balance
  into player_id, wallet_address, ranked, gate_balance;

  if player_id is null then
    raise exception 'Player not found';
  end if;

  return next;
end;
$$;

create or replace function public.create_duel(
  p_player_id uuid,
  p_asset_id uuid,
  p_stake bigint,
  p_side text,
  p_seed text,
  p_commit_hash text,
  p_idempotency_key text
)
returns table (
  duel_id uuid,
  credits bigint,
  status text,
  commit_hash text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_duel public.duels%rowtype;
  current_price bigint;
  current_credits bigint;
begin
  if p_stake <= 0 then
    raise exception 'Invalid stake';
  end if;

  if p_side not in ('long', 'short') then
    raise exception 'Invalid side';
  end if;

  select *
  into existing_duel
  from public.duels d
  where d.player_a = p_player_id
    and d.idempotency_key = p_idempotency_key;

  if found then
    select pc.credits into current_credits from public.player_credits pc where pc.player_id = p_player_id;
    duel_id := existing_duel.id;
    credits := current_credits;
    status := existing_duel.status;
    commit_hash := existing_duel.commit_hash;
    return next;
    return;
  end if;

  select pt.price
  into current_price
  from public.price_ticks pt
  where pt.asset_id = p_asset_id
  order by pt.created_at desc
  limit 1;

  if current_price is null then
    raise exception 'No current price';
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

  insert into public.duels (
    asset_id, stake, player_a, player_a_side, status, commit_hash, seed, start_price, idempotency_key
  )
  values (
    p_asset_id, p_stake, p_player_id, p_side, 'open', p_commit_hash, p_seed, current_price, p_idempotency_key
  )
  returning id, duels.status, duels.commit_hash
  into duel_id, status, commit_hash;

  credits := current_credits;
  return next;
end;
$$;

create or replace function public.accept_duel(
  p_player_id uuid,
  p_duel_id uuid,
  p_side text,
  p_idempotency_key text
)
returns table (
  duel_id uuid,
  credits bigint,
  status text,
  ranked boolean,
  commit_hash text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  duel_record public.duels%rowtype;
  current_credits bigint;
  player_a_ranked boolean;
  player_b_ranked boolean;
begin
  if p_side not in ('long', 'short') then
    raise exception 'Invalid side';
  end if;

  select *
  into duel_record
  from public.duels d
  where d.id = p_duel_id
  for update;

  if not found then
    raise exception 'Duel not found';
  end if;

  if duel_record.status <> 'open' then
    if duel_record.player_b = p_player_id and duel_record.accept_idempotency_key = p_idempotency_key then
      select pc.credits into current_credits from public.player_credits pc where pc.player_id = p_player_id;
      duel_id := duel_record.id;
      credits := current_credits;
      status := duel_record.status;
      ranked := duel_record.ranked;
      commit_hash := duel_record.commit_hash;
      return next;
      return;
    end if;

    raise exception 'Duel is not open';
  end if;

  if duel_record.player_a = p_player_id then
    raise exception 'Cannot accept own duel';
  end if;

  select pc.credits
  into current_credits
  from public.player_credits pc
  where pc.player_id = p_player_id
  for update;

  if current_credits is null or current_credits < duel_record.stake then
    raise exception 'Insufficient credits';
  end if;

  select p.ranked into player_a_ranked from public.players p where p.id = duel_record.player_a;
  select p.ranked into player_b_ranked from public.players p where p.id = p_player_id;

  update public.player_credits
  set credits = credits - duel_record.stake
  where player_id = p_player_id
  returning player_credits.credits into current_credits;

  update public.duels
  set player_b = p_player_id,
      player_b_side = p_side,
      status = 'locked',
      ranked = coalesce(player_a_ranked, false) and coalesce(player_b_ranked, false),
      accept_idempotency_key = p_idempotency_key,
      started_at = now()
  where id = duel_record.id
  returning id, duels.status, duels.ranked, duels.commit_hash
  into duel_id, status, ranked, commit_hash;

  credits := current_credits;
  return next;
end;
$$;

create or replace function public.hex8_to_bigint(hex_input text)
returns numeric
language sql
immutable
strict
as $$
  select sum(
    (strpos('0123456789abcdef', substr(lower(hex_input), idx, 1))::numeric - 1)
    * power(16::numeric, length(hex_input) - idx)
  )
  from generate_series(1, length(hex_input)) as idx;
$$;

create or replace function public.settle_duel(
  p_duel_id uuid,
  p_idempotency_key text
)
returns table (
  duel_id uuid,
  status text,
  winner uuid,
  player_a_pnl bigint,
  player_b_pnl bigint,
  start_price bigint,
  end_price bigint,
  seed text,
  ranked boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  duel_record public.duels%rowtype;
  random_unit numeric;
  move bigint;
  v_end_price bigint;
  player_a_result bigint;
  player_b_result bigint;
  winning_player uuid;
begin
  select *
  into duel_record
  from public.duels d
  where d.id = p_duel_id
  for update;

  if not found then
    raise exception 'Duel not found';
  end if;

  if duel_record.status = 'settled' then
    duel_id := duel_record.id;
    status := duel_record.status;
    winner := duel_record.winner;
    player_a_pnl := coalesce(duel_record.player_a_pnl, 0);
    player_b_pnl := coalesce(duel_record.player_b_pnl, 0);
    start_price := duel_record.start_price;
    end_price := duel_record.end_price;
    seed := duel_record.seed;
    ranked := duel_record.ranked;
    return next;
    return;
  end if;

  if duel_record.status <> 'locked' then
    raise exception 'Duel is not locked';
  end if;

  update public.duels
  set status = 'revealing'
  where id = duel_record.id;

  random_unit := public.hex8_to_bigint(substr(encode(digest(duel_record.seed || ':' || duel_record.id::text, 'sha256'), 'hex'), 1, 8)) / 4294967295.0;
  move := round((random_unit * 2 - 1) * greatest(1, duel_record.start_price / 10))::bigint;
  v_end_price := greatest(1, duel_record.start_price + move);

  player_a_result := case
    when duel_record.player_a_side = 'long' then v_end_price - duel_record.start_price
    else duel_record.start_price - v_end_price
  end;
  player_b_result := case
    when duel_record.player_b_side = 'long' then v_end_price - duel_record.start_price
    else duel_record.start_price - v_end_price
  end;

  if player_a_result >= player_b_result then
    winning_player := duel_record.player_a;
  else
    winning_player := duel_record.player_b;
  end if;

  update public.player_credits
  set credits = credits + (duel_record.stake * 2)
  where player_id = winning_player;

  update public.duels
  set status = 'settled',
      winner = winning_player,
      player_a_pnl = player_a_result,
      player_b_pnl = player_b_result,
      end_price = v_end_price,
      settle_idempotency_key = p_idempotency_key,
      settled_at = now()
  where id = duel_record.id
  returning id, duels.status, duels.winner, duels.player_a_pnl, duels.player_b_pnl, duels.start_price, duels.end_price, duels.seed, duels.ranked
  into duel_id, status, winner, player_a_pnl, player_b_pnl, start_price, end_price, seed, ranked;

  if ranked then
    insert into public.ranked_duel_results (duel_id, player_id, pnl, won)
    values
      (duel_record.id, duel_record.player_a, player_a_result, winning_player = duel_record.player_a),
      (duel_record.id, duel_record.player_b, player_b_result, winning_player = duel_record.player_b)
    on conflict (duel_id, player_id) do nothing;
  end if;

  return next;
end;
$$;

revoke all on function public.set_player_wallet_ranked(uuid, text, boolean, bigint) from public;
revoke all on function public.create_duel(uuid, uuid, bigint, text, text, text, text) from public;
revoke all on function public.accept_duel(uuid, uuid, text, text) from public;
revoke all on function public.hex8_to_bigint(text) from public;
revoke all on function public.settle_duel(uuid, text) from public;
