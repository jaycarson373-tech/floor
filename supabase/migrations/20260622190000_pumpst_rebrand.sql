-- PumpSt rebrand display update.
-- Keeps existing asset ids and all price/order/position references intact.

update public.assets
set
  symbol = 'PUMPST',
  name = 'PumpSt Index'
where id = '10000000-0000-4000-8000-000000000001'
  and symbol <> 'PUMPST';

update public.assets
set name = 'PumpSt Index'
where symbol = 'PUMPST';
