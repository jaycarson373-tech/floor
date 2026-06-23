create table if not exists public.player_credits (
  player_id uuid primary key references public.players(id) on delete cascade,
  credits bigint not null default 0 check (credits >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.assets (
  id uuid primary key default gen_random_uuid(),
  symbol text unique not null,
  name text not null,
  base_price bigint not null check (base_price > 0),
  volatility int not null check (volatility > 0),
  created_at timestamptz not null default now()
);

create table if not exists public.price_ticks (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets(id) on delete cascade,
  price bigint not null check (price > 0),
  tick_seed text not null,
  tick_window timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists price_ticks_asset_created_at_idx
  on public.price_ticks (asset_id, created_at desc);

create unique index if not exists price_ticks_asset_tick_window_idx
  on public.price_ticks (asset_id, tick_window);

create table if not exists public.positions (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  asset_id uuid not null references public.assets(id) on delete cascade,
  qty bigint not null default 0 check (qty >= 0),
  avg_cost bigint not null default 0 check (avg_cost >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (player_id, asset_id)
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  asset_id uuid not null references public.assets(id) on delete restrict,
  side text not null check (side in ('buy', 'sell')),
  qty bigint not null check (qty > 0),
  fill_price bigint not null check (fill_price > 0),
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  unique (player_id, idempotency_key)
);

alter table public.player_credits enable row level security;
alter table public.assets enable row level security;
alter table public.price_ticks enable row level security;
alter table public.positions enable row level security;
alter table public.orders enable row level security;

revoke all on public.player_credits from anon, authenticated;
revoke all on public.assets from anon, authenticated;
revoke all on public.price_ticks from anon, authenticated;
revoke all on public.positions from anon, authenticated;
revoke all on public.orders from anon, authenticated;

grant select on public.player_credits to authenticated;
grant select on public.assets to anon, authenticated;
grant select on public.price_ticks to anon, authenticated;
grant select on public.positions to authenticated;
grant select on public.orders to authenticated;

revoke insert on public.players from anon, authenticated;
grant insert (id, name, gx, gy, facing, last_seen, created_at) on public.players to authenticated;

drop policy if exists "credits readable by owner" on public.player_credits;
create policy "credits readable by owner"
  on public.player_credits
  for select
  to authenticated
  using (auth.uid() = player_id);

drop policy if exists "assets world readable" on public.assets;
create policy "assets world readable"
  on public.assets
  for select
  to anon, authenticated
  using (true);

drop policy if exists "price ticks world readable" on public.price_ticks;
create policy "price ticks world readable"
  on public.price_ticks
  for select
  to anon, authenticated
  using (true);

drop policy if exists "positions readable by owner" on public.positions;
create policy "positions readable by owner"
  on public.positions
  for select
  to authenticated
  using (auth.uid() = player_id);

drop policy if exists "orders readable by owner" on public.orders;
create policy "orders readable by owner"
  on public.orders
  for select
  to authenticated
  using (auth.uid() = player_id);

insert into public.assets (id, symbol, name, base_price, volatility)
values
  ('10000000-0000-4000-8000-000000000001', 'PUMPST', 'PumpSt Index', 2500, 95),
  ('10000000-0000-4000-8000-000000000002', 'NUGT', 'Nugget Trust', 1800, 70),
  ('10000000-0000-4000-8000-000000000003', 'TAPE', 'Tape Futures', 940, 45),
  ('10000000-0000-4000-8000-000000000004', 'GLIM', 'Glimmer Basket', 3200, 130),
  ('10000000-0000-4000-8000-000000000005', 'VAULT', 'Vault Notes', 5200, 160)
on conflict (symbol) do update
set
  name = excluded.name,
  base_price = excluded.base_price,
  volatility = excluded.volatility;

insert into public.price_ticks (asset_id, price, tick_seed, tick_window)
select
  id,
  base_price,
  'genesis:' || symbol,
  date_trunc('minute', now())
from public.assets
on conflict (asset_id, tick_window) do nothing;

create or replace function public.grant_starting_credits()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.player_credits (player_id, credits)
  values (new.id, 10000)
  on conflict (player_id) do nothing;

  return new;
end;
$$;

drop trigger if exists grant_starting_credits_after_player_insert on public.players;
create trigger grant_starting_credits_after_player_insert
after insert on public.players
for each row
execute function public.grant_starting_credits();

insert into public.player_credits (player_id, credits)
select id, 10000
from public.players
on conflict (player_id) do nothing;

create or replace function public.hex16_to_bigint(hex_input text)
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

create or replace function public.advance_market_tick(p_tick_window timestamptz)
returns table (
  asset_id uuid,
  symbol text,
  price bigint,
  tick_seed text,
  tick_window timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  asset_record record;
  last_price bigint;
  next_seed text;
  random_unit numeric;
  signed_step bigint;
  next_price bigint;
  floor_price bigint;
  ceil_price bigint;
begin
  for asset_record in
    select id, symbol, base_price, volatility
    from public.assets
    order by symbol
  loop
    if exists (
      select 1
      from public.price_ticks
      where price_ticks.asset_id = asset_record.id
        and price_ticks.tick_window = p_tick_window
    ) then
      select pt.price, pt.tick_seed
      into next_price, next_seed
      from public.price_ticks pt
      where pt.asset_id = asset_record.id
        and pt.tick_window = p_tick_window
      limit 1;
    else
      select coalesce(
        (
          select pt.price
          from public.price_ticks pt
          where pt.asset_id = asset_record.id
          order by pt.created_at desc
          limit 1
        ),
        asset_record.base_price
      )
      into last_price;

      next_seed := encode(
        digest(asset_record.id::text || ':' || p_tick_window::text || ':' || last_price::text, 'sha256'),
        'hex'
      );
      random_unit := public.hex16_to_bigint(substr(next_seed, 1, 16)) / 18446744073709551615.0;
      signed_step := round((random_unit * 2 - 1) * asset_record.volatility)::bigint;
      floor_price := greatest(1, asset_record.base_price / 5);
      ceil_price := asset_record.base_price * 5;
      next_price := least(ceil_price, greatest(floor_price, last_price + signed_step));

      insert into public.price_ticks (asset_id, price, tick_seed, tick_window)
      values (asset_record.id, next_price, next_seed, p_tick_window);
    end if;

    asset_id := asset_record.id;
    symbol := asset_record.symbol;
    price := next_price;
    tick_seed := next_seed;
    tick_window := p_tick_window;
    return next;
  end loop;
end;
$$;

create or replace function public.execute_trade(
  p_player_id uuid,
  p_asset_id uuid,
  p_side text,
  p_qty bigint,
  p_idempotency_key text
)
returns table (
  order_id uuid,
  credits bigint,
  position_qty bigint,
  avg_cost bigint,
  fill_price bigint,
  side text,
  qty bigint,
  asset_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_order public.orders%rowtype;
  current_price bigint;
  current_credits bigint;
  position_record public.positions%rowtype;
  new_qty bigint;
  new_avg_cost bigint;
  notional bigint;
begin
  if p_side not in ('buy', 'sell') then
    raise exception 'Invalid side';
  end if;

  if p_qty is null or p_qty <= 0 then
    raise exception 'Invalid quantity';
  end if;

  if p_idempotency_key is null or length(trim(p_idempotency_key)) < 8 then
    raise exception 'Invalid idempotency key';
  end if;

  select *
  into existing_order
  from public.orders o
  where o.player_id = p_player_id
    and o.idempotency_key = p_idempotency_key;

  if found then
    select pc.credits
    into current_credits
    from public.player_credits pc
    where pc.player_id = p_player_id;

    select *
    into position_record
    from public.positions p
    where p.player_id = p_player_id
      and p.asset_id = existing_order.asset_id;

    order_id := existing_order.id;
    credits := current_credits;
    position_qty := coalesce(position_record.qty, 0);
    avg_cost := coalesce(position_record.avg_cost, 0);
    fill_price := existing_order.fill_price;
    side := existing_order.side;
    qty := existing_order.qty;
    asset_id := existing_order.asset_id;
    return next;
    return;
  end if;

  perform 1
  from public.assets a
  where a.id = p_asset_id;

  if not found then
    raise exception 'Unknown asset';
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

  if current_credits is null then
    insert into public.player_credits (player_id, credits)
    values (p_player_id, 10000)
    on conflict (player_id) do nothing;

    select pc.credits
    into current_credits
    from public.player_credits pc
    where pc.player_id = p_player_id
    for update;
  end if;

  select *
  into position_record
  from public.positions p
  where p.player_id = p_player_id
    and p.asset_id = p_asset_id
  for update;

  if not found then
    insert into public.positions (player_id, asset_id, qty, avg_cost)
    values (p_player_id, p_asset_id, 0, 0)
    returning * into position_record;
  end if;

  notional := p_qty * current_price;

  if p_side = 'buy' then
    if current_credits < notional then
      raise exception 'Insufficient credits';
    end if;

    new_qty := position_record.qty + p_qty;
    new_avg_cost := ((position_record.qty * position_record.avg_cost) + notional) / new_qty;

    insert into public.orders (player_id, asset_id, side, qty, fill_price, idempotency_key)
    values (p_player_id, p_asset_id, p_side, p_qty, current_price, p_idempotency_key)
    returning id into order_id;

    update public.player_credits
    set credits = credits - notional
    where player_id = p_player_id
    returning player_credits.credits into current_credits;

    update public.positions
    set qty = new_qty,
        avg_cost = new_avg_cost,
        updated_at = now()
    where id = position_record.id
    returning positions.qty, positions.avg_cost
    into position_qty, avg_cost;
  else
    if position_record.qty < p_qty then
      raise exception 'Insufficient position';
    end if;

    new_qty := position_record.qty - p_qty;
    new_avg_cost := case when new_qty = 0 then 0 else position_record.avg_cost end;

    insert into public.orders (player_id, asset_id, side, qty, fill_price, idempotency_key)
    values (p_player_id, p_asset_id, p_side, p_qty, current_price, p_idempotency_key)
    returning id into order_id;

    update public.player_credits
    set credits = credits + notional
    where player_id = p_player_id
    returning player_credits.credits into current_credits;

    update public.positions
    set qty = new_qty,
        avg_cost = new_avg_cost,
        updated_at = now()
    where id = position_record.id
    returning positions.qty, positions.avg_cost
    into position_qty, avg_cost;
  end if;

  credits := current_credits;
  fill_price := current_price;
  side := p_side;
  qty := p_qty;
  asset_id := p_asset_id;
  return next;
end;
$$;

revoke all on function public.grant_starting_credits() from public;
revoke all on function public.hex16_to_bigint(text) from public;
revoke all on function public.advance_market_tick(timestamptz) from public;
revoke all on function public.execute_trade(uuid, uuid, text, bigint, text) from public;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'price_ticks'
  ) then
    alter publication supabase_realtime add table public.price_ticks;
  end if;
end $$;
