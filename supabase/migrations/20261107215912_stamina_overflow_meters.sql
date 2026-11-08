-- Overflow meters: fill only while another meter is at its cap
-- (e.g. WuWa Waveplate Crystals: +1 per 12 min while Waveplates are full)
alter table public.stamina_meters
  add column fills_when_full_of uuid references public.stamina_meters (id) on delete cascade,
  add constraint stamina_meters_not_self check (fills_when_full_of is null or fills_when_full_of <> id);