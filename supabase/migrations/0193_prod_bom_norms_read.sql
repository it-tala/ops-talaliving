-- 0193_prod_bom_norms_read.sql — the business's own estimating rules, read
-- by the app: the norms the AI's BOM proposal is held to, and the finishing
-- recipes offered as rates (D338).
--
-- ── What was there ────────────────────────────────────────────────────────
--
-- `ops_prod.bom_norms` (28 rows in production) and `ops_prod.finishing_recipes`
-- (13) were imported on 2026-09-25 and written into the ladder by `0174` with
-- RLS on and no policy, so nothing could read them (D315). They are the
-- business's own estimating rules: *Panel | Plywood cutting waste 12 %*,
-- *Wood | Square to finished component yield 80 %*, *Finishing | NC sanding
-- sealer coverage 9 m²/L/coat*, and two finishing systems step by step with a
-- cost per m² each.
--
-- Meanwhile the BOM suggestion (D324, `0182`) asked the model for a
-- `waste_percent` from its own general knowledge — *kayu solid 10–20, panel
-- 5–15* — while the business had already written down 12 % for plywood.
--
-- ── What this adds ────────────────────────────────────────────────────────
--
-- 1. A read policy on both tables for whoever holds `production.read` — the
--    module the BOM, the rate list and the AI panel all sit in. The norms carry
--    the factory's overhead and contingency, so not every signed-in person
--    (the rate list, by contrast, is read like the BOM it prices: by all).
--    Still no insert, update or delete policy: the rules are changed where
--    they were written, not from a screen, until the owner says otherwise.
-- 2. `ops_prod.v_bom_norm`: the norms in force on the office's today. The
--    suggest route passes these to the model and holds the answer to them.
-- 3. `ops_prod.v_finishing_system`: one row per finishing system — the total
--    of its steps' `cost_per_m2`, the part of it that is optional, the steps
--    themselves, and the rate on the list that already carries it (by name),
--    so `/produksi/rate` can offer it as a candidate `finishing` rate. It is
--    offered, never written: the owner decides the list (D324 default 2).
--
-- Nothing here writes a row, and nothing changes the tables' contents.

-- ── 1. read, by production ────────────────────────────────────────────────

drop policy if exists bomnorm_read on ops_prod.bom_norms;
create policy bomnorm_read on ops_prod.bom_norms for select to authenticated
  using ((select ops_core.has_permission('production.read')));
grant select on ops_prod.bom_norms to authenticated;

drop policy if exists finrecipe_read on ops_prod.finishing_recipes;
create policy finrecipe_read on ops_prod.finishing_recipes for select to authenticated
  using ((select ops_core.has_permission('production.read')));
grant select on ops_prod.finishing_recipes to authenticated;

comment on table ops_prod.bom_norms is
  'Rules of thumb a BOM is estimated from, per category, with where each came from. '
  'Read by production (0193): the BOM suggestion is held to the ones in force (v_bom_norm). '
  'No write policy — changed where they were written.';
comment on table ops_prod.finishing_recipes is
  'Finishing systems step by step, with coverage and cost per m². Read by production (0193); '
  'each system''s total is offered as a candidate finishing rate (v_finishing_system), never written as one.';

-- ── 2. the norms in force ─────────────────────────────────────────────────
--
-- `(category, norm)` is unique, so a norm is not superseded by a newer row of
-- the same name; *in force* only means its `effective_on` has arrived on the
-- office's calendar. A norm with no value (*Packing material per m³ product*,
-- *Foam volume*) stays: its basis and remarks say how the figure is worked
-- out, which is the rule.

create or replace view ops_prod.v_bom_norm as
select
  n.id,
  n.category,
  n.norm,
  n.value,
  n.unit,
  n.basis,
  n.remarks,
  n.source_kind,
  n.effective_on
from ops_prod.bom_norms n
where n.effective_on is null or n.effective_on <= ops_core.office_day();

-- ── 3. each finishing system, as a rate it could be ───────────────────────
--
-- The total is the sum of the steps' own `cost_per_m2`, as the recipe states
-- it (unit price ÷ coverage × coats), not recomputed here. A step the recipe
-- marks *(optional)* is in the total and also summed apart, so the screen can
-- say what the system costs without it. `rate_name` is the name the candidate
-- would take on the list; `rate_code`/`listed_rate` are the active rate that
-- already has that name — the list's one-name-one-price index (0182) is what
-- makes a name a sufficient match.

create or replace view ops_prod.v_finishing_system as
with f as (
  select r.*, (r.step ~* '\m(optional|opsional)\M') as optional
    from ops_prod.finishing_recipes r
   where r.effective_on is null or r.effective_on <= ops_core.office_day()
), s as (
  select
    f.system,
    count(*)::int                                                   as steps,
    count(*) filter (where f.cost_per_m2 is null)::int              as unpriced_steps,
    round(coalesce(sum(f.cost_per_m2), 0))                          as cost_per_m2,
    round(coalesce(sum(f.cost_per_m2) filter (where f.optional), 0)) as optional_cost_per_m2,
    max(f.effective_on)                                             as effective_on,
    jsonb_agg(jsonb_build_object(
      'step', f.step, 'product', f.product, 'unit_price', f.unit_price, 'uom', f.uom,
      'coverage_m2_per_unit', f.coverage_m2_per_unit, 'coats', f.coats,
      'cost_per_m2', f.cost_per_m2, 'optional', f.optional, 'remarks', f.remarks)
      order by f.optional, f.step)                                  as breakdown
  from f
  group by f.system
)
select
  s.system,
  s.steps,
  s.unpriced_steps,
  s.cost_per_m2,
  s.optional_cost_per_m2,
  s.effective_on,
  s.breakdown,
  'Finishing ' || s.system                                          as rate_name,
  rt.code                                                           as rate_code,
  rt.unit_rate                                                      as listed_rate
from s
left join ops_prod.bom_rates rt
  on rt.active and lower(btrim(rt.name)) = lower('Finishing ' || s.system);

alter view ops_prod.v_bom_norm         set (security_invoker = on);
alter view ops_prod.v_finishing_system set (security_invoker = on);
grant select on ops_prod.v_bom_norm, ops_prod.v_finishing_system to authenticated;

analyze ops_prod.bom_norms;
analyze ops_prod.finishing_recipes;
