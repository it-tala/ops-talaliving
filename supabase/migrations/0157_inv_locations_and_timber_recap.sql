-- 0157_inv_locations_and_timber_recap.sql — the rack list stops being a
-- migration, and a month gets its own total.
--
-- **Locations.** `0071` seeded three rows and gave `stock_locations` a read
-- policy only: "a location nobody walks to is a location nobody counts" was
-- the right instinct for launch, but it also meant the only door onto the
-- table was `supabase db push`. The owner asked for the opposite of a
-- deploy-per-rack: opname week means agreeing on areas with the floor and
-- typing them in, not filing a migration per team. The gate stays the one
-- `stock_settings` already uses (`inventory.update` — the same authority that
-- edits a minimum or a home location), so the list is still curated by
-- somebody who holds that permission, not thrown open to everyone who can
-- merely read the rack. No delete: a location once counted against stays
-- addressable in `stock_moves` for ever (A5), and `is_active` is how a rack
-- that no longer exists stops being offered without erasing what was ever
-- counted there.
--
-- **Timber by month.** `v_timber_by_vendor` (`0156`) answers *who sells
-- cheaper wood*, which only means anything **within one species** (D153) —
-- averaging across species the other way, by month, would make the same
-- mistake in a new place. So this recap carries no rupiah-per-cubic-metre
-- figure at all, only totals: what came in, what it cost before and after
-- landing it, by month. A blended rate would look precise and mean nothing;
-- the vendor table is where a rate belongs.

do $$ begin
  create policy loc_new on ops_inv.stock_locations for insert to authenticated
    with check ((select ops_core.has_permission('inventory.update')));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy loc_edit on ops_inv.stock_locations for update to authenticated
    using ((select ops_core.has_permission('inventory.update')))
    with check ((select ops_core.has_permission('inventory.update')));
exception when duplicate_object then null; end $$;

-- A location's code is its primary key and its only real identity — renaming
-- it out from under `stock_moves.location`'s foreign key is not a rename, it
-- is a different rack wearing the old one's history. The name is free to
-- change; the code is not, and nothing here grants an update on it because
-- there is no column list to grant against — `with check` above is the
-- entire guard, and the code column has no business rule to relax.

grant insert, update on ops_inv.stock_locations to authenticated;

comment on table ops_inv.stock_locations is
  'Where stock physically is. Seeded few (0071) so a location nobody walks '
  'to is not offered; now addable/renameable/retireable by inventory.update '
  '(0157) so opname areas do not wait on a deploy. No delete — is_active '
  'retires a rack without breaking what was ever counted there.';

-- ── recap by month, totals only ─────────────────────────────────────────────
create or replace view ops_inv.v_timber_by_month as
select
  date_trunc('month', p.received_on)::date        as month,
  count(*)::int                                   as loads,
  count(distinct p.vendor_code)::int              as vendors,
  count(distinct p.species)::int                  as species_count,
  sum(p.total_cost)::bigint                       as wood_cost,
  sum(p.extra_cost)::bigint                       as extra_cost,
  sum(p.landed_cost)::bigint                      as landed_cost,
  round(sum(p.log_m3), 4)                         as log_m3,
  round(sum(p.sawn_m3), 4)                        as sawn_m3,
  round(sum(p.sawn_m2), 4)                        as sawn_m2
from ops_inv.v_log_purchase p
group by 1;

alter view ops_inv.v_timber_by_month set (security_invoker = on);

grant select on ops_inv.v_timber_by_month to authenticated;
