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

create table if not exists public.managed_positions (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.managed_books(id) on delete cascade,
  asset_id uuid not null references public.assets(id) on delete cascade,
  qty bigint not null default 0 check (qty >= 0),
  avg_cost bigint not null default 0 check (avg_cost >= 0),
  updated_at timestamptz not null default now(),
  unique (book_id, asset_id)
);

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

alter table public.managed_books enable row level security;
alter table public.allocations enable row level security;
alter table public.managed_positions enable row level security;
alter table public.managed_orders enable row level security;
alter table public.allocation_settlements enable row level security;

revoke all on public.managed_books from anon, authenticated;
revoke all on public.allocations from anon, authenticated;
revoke all on public.managed_positions from anon, authenticated;
revoke all on public.managed_orders from anon, authenticated;
revoke all on public.allocation_settlements from anon, authenticated;

grant select on public.managed_books to authenticated;
grant select on public.allocations to authenticated;
grant select on public.managed_positions to authenticated;
grant select on public.managed_orders to authenticated;
grant select on public.allocation_settlements to authenticated;

drop policy if exists "managed books visible to pm or allocator" on public.managed_books;
create policy "managed books visible to pm or allocator"
  on public.managed_books
  for select
  to authenticated
  using (
    auth.uid() = pm_id
    or exists (
      select 1 from public.allocations a
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
      select 1 from public.managed_books b
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
      select 1 from public.managed_books b
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

grant select on public.pm_directory to anon, authenticated;

create or replace function public.ensure_managed_book(p_pm_id uuid, p_ranked boolean)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_book_id uuid;
begin
  insert into public.managed_books (pm_id, ranked)
  values (p_pm_id, p_ranked)
  on conflict (pm_id) do update
    set ranked = managed_books.ranked or excluded.ranked,
        updated_at = now()
  returning id into v_book_id;

  return v_book_id;
end;
$$;

create or replace function public.is_pm_eligible(p_pm_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.pm_directory p
    where p.pm_id = p_pm_id
      and p.pm_eligible = true
  );
$$;

create or replace function public.allocate_capital(
  p_allocator_id uuid,
  p_pm_id uuid,
  p_amount bigint,
  p_idempotency_key text
)
returns table (
  allocation_id uuid,
  book_id uuid,
  credits bigint,
  book_cash bigint,
  ranked boolean,
  status text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_allocation public.allocations%rowtype;
  allocator_ranked boolean;
  pm_ranked boolean;
  v_book_id uuid;
  current_credits bigint;
  is_ranked_allocation boolean;
begin
  if p_allocator_id = p_pm_id then
    raise exception 'Cannot allocate to yourself';
  end if;

  if p_amount <= 0 then
    raise exception 'Invalid allocation amount';
  end if;

  select *
  into existing_allocation
  from public.allocations a
  where a.allocator_id = p_allocator_id
    and a.idempotency_key = p_idempotency_key;

  if found then
    select pc.credits into current_credits from public.player_credits pc where pc.player_id = p_allocator_id;
    select b.cash_credits into book_cash from public.managed_books b where b.id = existing_allocation.book_id;
    allocation_id := existing_allocation.id;
    book_id := existing_allocation.book_id;
    credits := current_credits;
    ranked := existing_allocation.ranked;
    status := existing_allocation.status;
    return next;
    return;
  end if;

  select p.ranked into allocator_ranked from public.players p where p.id = p_allocator_id;
  select p.ranked into pm_ranked from public.players p where p.id = p_pm_id;

  if allocator_ranked is null or pm_ranked is null then
    raise exception 'Unknown player';
  end if;

  is_ranked_allocation := allocator_ranked and pm_ranked;

  if is_ranked_allocation and not public.is_pm_eligible(p_pm_id) then
    raise exception 'Target is not PM eligible';
  end if;

  v_book_id := public.ensure_managed_book(p_pm_id, is_ranked_allocation);

  select pc.credits
  into current_credits
  from public.player_credits pc
  where pc.player_id = p_allocator_id
  for update;

  if current_credits is null or current_credits < p_amount then
    raise exception 'Insufficient credits';
  end if;

  update public.player_credits
  set credits = credits - p_amount
  where player_id = p_allocator_id
  returning player_credits.credits into current_credits;

  update public.managed_books
  set cash_credits = cash_credits + p_amount,
      updated_at = now()
  where id = v_book_id
  returning managed_books.cash_credits into book_cash;

  insert into public.allocations (
    allocator_id, pm_id, book_id, principal, principal_remaining, ranked, idempotency_key
  )
  values (
    p_allocator_id, p_pm_id, v_book_id, p_amount, p_amount, is_ranked_allocation, p_idempotency_key
  )
  returning id, allocations.status
  into allocation_id, status;

  book_id := v_book_id;
  credits := current_credits;
  ranked := is_ranked_allocation;
  return next;
end;
$$;

create or replace function public.execute_managed_trade(
  p_pm_id uuid,
  p_asset_id uuid,
  p_side text,
  p_qty bigint,
  p_idempotency_key text
)
returns table (
  order_id uuid,
  book_id uuid,
  book_cash bigint,
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
  book_record public.managed_books%rowtype;
  existing_order public.managed_orders%rowtype;
  current_price bigint;
  position_record public.managed_positions%rowtype;
  notional bigint;
  new_qty bigint;
  new_avg_cost bigint;
begin
  if p_side not in ('buy', 'sell') then
    raise exception 'Invalid side';
  end if;

  if p_qty <= 0 then
    raise exception 'Invalid quantity';
  end if;

  select *
  into book_record
  from public.managed_books b
  where b.pm_id = p_pm_id
  for update;

  if not found then
    raise exception 'Managed book not found';
  end if;

  select *
  into existing_order
  from public.managed_orders o
  where o.book_id = book_record.id
    and o.idempotency_key = p_idempotency_key;

  if found then
    select * into position_record from public.managed_positions p where p.book_id = book_record.id and p.asset_id = existing_order.asset_id;
    order_id := existing_order.id;
    book_id := book_record.id;
    book_cash := book_record.cash_credits;
    position_qty := coalesce(position_record.qty, 0);
    avg_cost := coalesce(position_record.avg_cost, 0);
    fill_price := existing_order.fill_price;
    side := existing_order.side;
    qty := existing_order.qty;
    asset_id := existing_order.asset_id;
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

  select *
  into position_record
  from public.managed_positions p
  where p.book_id = book_record.id
    and p.asset_id = p_asset_id
  for update;

  if not found then
    insert into public.managed_positions (book_id, asset_id, qty, avg_cost)
    values (book_record.id, p_asset_id, 0, 0)
    returning * into position_record;
  end if;

  notional := p_qty * current_price;

  if p_side = 'buy' then
    if book_record.cash_credits < notional then
      raise exception 'Insufficient managed cash';
    end if;

    new_qty := position_record.qty + p_qty;
    new_avg_cost := ((position_record.qty * position_record.avg_cost) + notional) / new_qty;

    insert into public.managed_orders (book_id, pm_id, asset_id, side, qty, fill_price, idempotency_key)
    values (book_record.id, p_pm_id, p_asset_id, p_side, p_qty, current_price, p_idempotency_key)
    returning id into order_id;

    update public.managed_books
    set cash_credits = cash_credits - notional,
        updated_at = now()
    where id = book_record.id
    returning cash_credits into book_cash;

    update public.managed_positions
    set qty = new_qty,
        avg_cost = new_avg_cost,
        updated_at = now()
    where id = position_record.id
    returning managed_positions.qty, managed_positions.avg_cost into position_qty, avg_cost;
  else
    if position_record.qty < p_qty then
      raise exception 'Insufficient managed position';
    end if;

    new_qty := position_record.qty - p_qty;
    new_avg_cost := case when new_qty = 0 then 0 else position_record.avg_cost end;

    insert into public.managed_orders (book_id, pm_id, asset_id, side, qty, fill_price, idempotency_key)
    values (book_record.id, p_pm_id, p_asset_id, p_side, p_qty, current_price, p_idempotency_key)
    returning id into order_id;

    update public.managed_books
    set cash_credits = cash_credits + notional,
        updated_at = now()
    where id = book_record.id
    returning cash_credits into book_cash;

    update public.managed_positions
    set qty = new_qty,
        avg_cost = new_avg_cost,
        updated_at = now()
    where id = position_record.id
    returning managed_positions.qty, managed_positions.avg_cost into position_qty, avg_cost;
  end if;

  book_id := book_record.id;
  fill_price := current_price;
  side := p_side;
  qty := p_qty;
  asset_id := p_asset_id;
  return next;
end;
$$;

create or replace function public.settle_allocation(
  p_actor_id uuid,
  p_allocation_id uuid,
  p_withdraw boolean,
  p_pm_fee_bps int,
  p_idempotency_key text
)
returns table (
  allocation_id uuid,
  book_id uuid,
  credits bigint,
  book_cash bigint,
  gross_pnl bigint,
  fee bigint,
  allocator_delta bigint,
  status text,
  reconciliation_ok boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  allocation_record public.allocations%rowtype;
  existing_settlement public.allocation_settlements%rowtype;
  book_record public.managed_books%rowtype;
  active_principal bigint;
  excess_cash bigint;
  pnl_share bigint;
  fee_amount bigint;
  return_amount bigint;
  v_credits bigint;
begin
  if p_pm_fee_bps < 0 or p_pm_fee_bps > 5000 then
    raise exception 'Invalid PM fee';
  end if;

  select *
  into allocation_record
  from public.allocations a
  where a.id = p_allocation_id
  for update;

  if not found then
    raise exception 'Allocation not found';
  end if;

  if p_actor_id not in (allocation_record.allocator_id, allocation_record.pm_id) then
    raise exception 'Not an allocation participant';
  end if;

  select *
  into existing_settlement
  from public.allocation_settlements s
  where s.allocation_id = p_allocation_id
    and s.idempotency_key = p_idempotency_key;

  if found then
    select pc.credits into v_credits from public.player_credits pc where pc.player_id = allocation_record.allocator_id;
    select b.cash_credits into book_cash from public.managed_books b where b.id = allocation_record.book_id;
    allocation_id := allocation_record.id;
    book_id := allocation_record.book_id;
    credits := v_credits;
    gross_pnl := existing_settlement.gross_pnl;
    fee := existing_settlement.fee;
    allocator_delta := existing_settlement.allocator_delta;
    status := allocation_record.status;
    reconciliation_ok := true;
    return next;
    return;
  end if;

  if allocation_record.status = 'closed' then
    raise exception 'Allocation is closed';
  end if;

  select *
  into book_record
  from public.managed_books b
  where b.id = allocation_record.book_id
  for update;

  select coalesce(sum(a.principal_remaining), 0)
  into active_principal
  from public.allocations a
  where a.book_id = allocation_record.book_id
    and a.status in ('active', 'withdrawing');

  if active_principal <= 0 then
    raise exception 'No active principal';
  end if;

  excess_cash := book_record.cash_credits - active_principal;
  pnl_share := trunc((excess_cash::numeric * allocation_record.principal_remaining::numeric) / active_principal::numeric)::bigint;
  fee_amount := case when pnl_share > 0 then (pnl_share * p_pm_fee_bps) / 10000 else 0 end;
  return_amount := case
    when p_withdraw then greatest(0, allocation_record.principal_remaining + pnl_share - fee_amount)
    else greatest(0, pnl_share - fee_amount)
  end;

  if return_amount > book_record.cash_credits then
    raise exception 'Managed book has insufficient cash; sell positions before settlement';
  end if;

  update public.managed_books
  set cash_credits = cash_credits - return_amount - fee_amount,
      updated_at = now()
  where id = allocation_record.book_id
  returning managed_books.cash_credits into book_cash;

  if return_amount > 0 then
    update public.player_credits
    set credits = credits + return_amount
    where player_id = allocation_record.allocator_id
    returning player_credits.credits into v_credits;
  else
    select pc.credits into v_credits from public.player_credits pc where pc.player_id = allocation_record.allocator_id;
  end if;

  if fee_amount > 0 then
    update public.player_credits
    set credits = credits + fee_amount
    where player_id = allocation_record.pm_id;
  end if;

  update public.allocations
  set realized_pnl = realized_pnl + pnl_share,
      fee_paid = fee_paid + fee_amount,
      principal_remaining = case when p_withdraw then 0 else principal_remaining end,
      status = case when p_withdraw then 'closed' else status end,
      updated_at = now()
  where id = allocation_record.id
  returning allocations.status into status;

  insert into public.allocation_settlements (
    allocation_id, book_id, pm_id, allocator_id, gross_pnl, fee, allocator_delta, status, idempotency_key
  )
  values (
    allocation_record.id,
    allocation_record.book_id,
    allocation_record.pm_id,
    allocation_record.allocator_id,
    pnl_share,
    fee_amount,
    return_amount,
    case when p_withdraw then 'withdrawn' else 'settled' end,
    p_idempotency_key
  );

  allocation_id := allocation_record.id;
  book_id := allocation_record.book_id;
  credits := v_credits;
  gross_pnl := pnl_share;
  fee := fee_amount;
  allocator_delta := return_amount;
  reconciliation_ok := (return_amount + fee_amount <= book_record.cash_credits);
  return next;
end;
$$;

revoke all on function public.ensure_managed_book(uuid, boolean) from public;
revoke all on function public.is_pm_eligible(uuid) from public;
revoke all on function public.allocate_capital(uuid, uuid, bigint, text) from public;
revoke all on function public.execute_managed_trade(uuid, uuid, text, bigint, text) from public;
revoke all on function public.settle_allocation(uuid, uuid, boolean, int, text) from public;
