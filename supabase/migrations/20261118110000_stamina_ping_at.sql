-- SUP-3: an optional stamina threshold per meter. The reminder pings once per fill-up when the meter
-- reaches this value (e.g. 180 of 200). Null = the default, 90% of the cap. Today's "Needs attention"
-- uses the same number. Preset sync never writes this column, so a player's choice survives game updates;
-- if a preset ever lowers the cap below it, the cap is used instead.
--
-- stamina_meters already has row-level security and table-wide grants, so nothing else changes.

alter table public.stamina_meters
  add column ping_at integer
    constraint stamina_meters_ping_at_check check (ping_at is null or ping_at > 0);
