-- 0106_prod_bom_costing.sql — a bill of material that answers *what does one
-- unit cost us to make*.
--
-- The owner's brief (2026-09-23), in his order:
--
--   1. The designer looks at the **gambar kerja** and decides what goes in.
--   2. Clicks **+**, picks a component from the item database — or types a new
--      one, which lands in that same database rather than beside it.
--   3. Every line has a **rate** and a **quantity per unit**: kayu 0,1 m³, cat
--      1 liter, and labour the same way — 1,5 hari × the day rate.
--   4. One **persentase miskalkulasi** on top of the total.
--   5. The answer is the **production cost per item code — not a selling
--      price.**
--
-- What that changes against `0060`:
--
--   **Labour is lines** (`0105` added the kind). `products.labour_cost` stays
--   where it is — nothing is dropped — but nothing reads it for a cost any
--   more: a typed lump sum next to itemised lines is two answers to one
--   question.
--
--   **A line may carry its own rate.** Left empty, a material follows the
--   catalogue (standard price, else last paid) and a sub-assembly follows its
--   own released cost, live, while the draft is being edited. Typed, it is the
--   estimator's number and says so (`rate_source = 'manual'`).
--
--   **Releasing freezes the rates.** A released revision is a fact (A5); a
--   cost that moved every time procurement paid a different price for plywood
--   would make *rev 2 costs Rp 4,2 jt* untrue a week later. So release copies
--   each line's effective rate onto the line, with where it came from. Opening
--   the next draft copies the lines back **without** the frozen catalogue
--   rates — only the manual ones — so the draft follows today's prices again.
--
--   **Miskalkulasi is one percentage per revision**, on the subtotal (owner's
--   choice: *total saja*). It is part of the revision, so it is frozen with it.
--   Per-line `waste_percent` stays in the schema and in the arithmetic, at 0
--   by default; the screen no longer asks for it.
--
--   **Every write goes through a seam** here, not through table grants. The
--   rules — one draft, copy on open, no cycles, freeze on release — are too
--   many to leave to whichever client remembers them.

-- ── 1. columns ────────────────────────────────────────────────────────────
alter table ops_prod.bom_components
  -- What a labour line is called: *Tukang finishing*, *Upah rakit*. A
  -- material's name comes from the catalogue; a labour line has no catalogue.
  add column if not exists label       text,
  -- The estimator's rate while it is a draft; the frozen rate once released.
  add column if not exists unit_rate   numeric check (unit_rate is null or unit_rate >= 0),
  -- 'manual' | 'standard' | 'last_paid' | 'sub_assembly'. Null while the line
  -- follows the catalogue live.
  add column if not exists rate_source text;

alter table ops_prod.bom_components drop constraint if exists rate_source_known;
alter table ops_prod.bom_components add constraint rate_source_known check (
  rate_source is null or rate_source in ('manual','standard','last_paid','sub_assembly'));
alter table ops_prod.bom_components drop constraint if exists rate_has_source;
alter table ops_prod.bom_components add constraint rate_has_source check (
  (unit_rate is null) = (rate_source is null));
-- A labour line is a name and a rate somebody typed. Without either it is not
-- a cost, it is a reminder.
alter table ops_prod.bom_components drop constraint if exists labour_is_named_and_priced;
alter table ops_prod.bom_components add constraint labour_is_named_and_priced check (
  kind <> 'labour'
  or (label is not null and length(btrim(label)) > 0 and unit_rate is not null));

alter table ops_prod.bom_revisions
  add column if not exists miscalc_percent numeric not null default 0
    check (miscalc_percent >= 0 and miscalc_percent <= 100);

-- A released revision's miskalkulasi is part of what was released.
create or replace function ops_prod.release_is_permanent()
returns trigger
language plpgsql set search_path = ops_prod, pg_temp as $$
begin
  if old.released_at is not null and new.released_at is distinct from old.released_at then
    raise exception 'rev % was released on %; a released revision is frozen (A5)',
      old.rev, old.released_at using errcode = 'check_violation';
  end if;
  if old.released_at is not null and new.miscalc_percent is distinct from old.miscalc_percent then
    raise exception 'rev % was released on %; its miskalkulasi is frozen with it (A5)',
      old.rev, old.released_at using errcode = 'check_violation';
  end if;
  return new;
end $$;

-- ── 2. what one line costs ────────────────────────────────────────────────
--
-- `line_rate` and `bom_cost` call each other: a sub-assembly's rate is that
-- sub-assembly's production cost. Cycles are refused on write (below), and
-- the depth guard is the belt to that brace — a tree deeper than eight is a
-- data error, and answering null ("unpriced") is honest about it.

create type ops_prod.bom_cost_t as (
  lines            int,
  unpriced         int,
  labour_lines     int,
  material_cost    numeric,   -- materials + sub-assemblies, priced lines only
  labour_cost      numeric,
  subtotal         numeric,   -- priced lines only
  miscalc_percent  numeric,
  miscalc_amount   numeric,
  -- Null while any line is unpriced: a total that silently omits a line is
  -- the number somebody quotes from (the rule `v_product_cost` always had).
  production_cost  numeric
);

create or replace function ops_prod.line_rate(
  p_component_id uuid, p_depth int default 0,
  out rate numeric, out source text)
language plpgsql stable set search_path = ops_prod, ops_procure, pg_temp as $$
declare c ops_prod.bom_components; v_sub uuid; v_cost ops_prod.bom_cost_t;
begin
  select * into c from ops_prod.bom_components where id = p_component_id;
  if not found then return; end if;

  if c.unit_rate is not null then
    rate := c.unit_rate; source := c.rate_source; return;
  end if;

  if c.kind = 'material' then
    select coalesce(i.standard_price, i.last_price),
           case when i.standard_price is not null then 'standard'
                when i.last_price     is not null then 'last_paid' end
      into rate, source
      from ops_procure.items i where i.code = c.ref_code;
  elsif c.kind = 'product' and p_depth < 8 then
    select id into v_sub from ops_prod.products where product_code = c.ref_code;
    if v_sub is not null and ops_prod.released_rev(v_sub) is not null then
      v_cost := ops_prod.bom_cost(v_sub, ops_prod.released_rev(v_sub), p_depth + 1);
      if v_cost.production_cost is not null then
        rate := v_cost.production_cost; source := 'sub_assembly';
      end if;
    end if;
  end if;
end $$;

create or replace function ops_prod.bom_cost(
  p_product_id uuid, p_rev int, p_depth int default 0)
returns ops_prod.bom_cost_t
language plpgsql stable set search_path = ops_prod, pg_temp as $$
declare r ops_prod.bom_cost_t; c record; v_rate numeric; v_sub numeric;
begin
  r.lines := 0; r.unpriced := 0; r.labour_lines := 0;
  r.material_cost := 0; r.labour_cost := 0;
  select coalesce(miscalc_percent, 0) into r.miscalc_percent
    from ops_prod.bom_revisions where product_id = p_product_id and rev = p_rev;
  r.miscalc_percent := coalesce(r.miscalc_percent, 0);

  for c in select * from ops_prod.bom_components
            where product_id = p_product_id and rev = p_rev loop
    r.lines := r.lines + 1;
    if c.kind = 'labour' then r.labour_lines := r.labour_lines + 1; end if;
    select lr.rate into v_rate from ops_prod.line_rate(c.id, p_depth) lr;
    if v_rate is null then
      r.unpriced := r.unpriced + 1;
      continue;
    end if;
    v_sub := round(c.qty * (1 + c.waste_percent / 100) * v_rate);
    if c.kind = 'labour' then r.labour_cost := r.labour_cost + v_sub;
    else r.material_cost := r.material_cost + v_sub; end if;
  end loop;

  r.subtotal := r.material_cost + r.labour_cost;
  r.miscalc_amount := round(r.subtotal * r.miscalc_percent / 100);
  r.production_cost := case when r.unpriced > 0 or r.lines = 0 then null
                            else r.subtotal + r.miscalc_amount end;
  return r;
end $$;

-- ── 3. the views, re-cut ──────────────────────────────────────────────────
--
-- Same columns in the same order as `0060` — `create or replace` refuses
-- anything else — with the new ones after. `unit_price`, `price_source` and
-- `subtotal` now mean the line's **effective** rate, whatever set it.
create or replace view ops_prod.v_product_bom as
select
  c.id,
  c.product_id,
  p.product_code,
  c.rev,
  c.kind,
  c.ref_code,
  case when c.kind = 'labour' then c.label else coalesce(i.name, sub.name) end as ref_name,
  c.qty,
  c.uom,
  c.waste_percent,
  round(c.qty * (1 + c.waste_percent / 100), 4)        as qty_with_waste,
  lr.rate                                              as unit_price,
  lr.source                                            as price_source,
  case when lr.rate is null then null
       else round(c.qty * (1 + c.waste_percent / 100) * lr.rate) end as subtotal,
  c.note,
  c.label,
  c.unit_rate,
  c.rate_source,
  -- What the catalogue would say today, beside whatever the line says. The
  -- screen shows both when they differ — a manual rate far from the last price
  -- paid is a question worth seeing.
  coalesce(i.standard_price, i.last_price)             as catalogue_price,
  i.category_code                                      as item_category_code
from ops_prod.bom_components c
join ops_prod.products p on p.id = c.product_id
left join ops_procure.items i on i.code = c.ref_code and c.kind = 'material'
left join ops_prod.products sub on sub.product_code = c.ref_code and c.kind = 'product'
left join lateral ops_prod.line_rate(c.id) lr on true;

create or replace view ops_prod.v_product_cost as
select
  r.product_id,
  p.product_code,
  r.rev,
  bc.lines                                             as components,
  bc.unpriced,
  (select count(*)::int from ops_prod.v_product_bom b
    where b.product_id = r.product_id and b.rev = r.rev and b.ref_name is null) as unresolved,
  case when bc.unpriced > 0 then null else bc.material_cost::bigint end as material_cost,
  bc.subtotal::bigint                                  as priced_subtotal,
  -- Null where the revision has no labour line at all: *nobody has put the
  -- workshop's time on this* is not the same claim as *it takes none*.
  case when bc.labour_lines = 0 then null else bc.labour_cost::bigint end as labour_cost,
  bc.miscalc_percent,
  bc.miscalc_amount::bigint                            as miscalc_amount,
  bc.production_cost::bigint                           as production_cost,
  r.released_at is null                                as is_draft
from ops_prod.bom_revisions r
join ops_prod.products p on p.id = r.product_id
cross join lateral ops_prod.bom_cost(r.product_id, r.rev) bc;

-- One row per product for the catalogue: which revision a person is looking
-- at (the draft where one is open, else the newest released) and what it
-- comes to.
create or replace view ops_prod.v_product_summary as
select
  p.*,
  ops_prod.released_rev(p.id)                          as current_rev,
  d.rev                                                as draft_rev,
  coalesce(d.rev, ops_prod.released_rev(p.id))         as viewing_rev,
  coalesce(pc.components, 0)                           as component_count,
  coalesce(pc.unpriced, 0)                             as unpriced,
  coalesce(pc.unresolved, 0)                           as unresolved,
  pc.material_cost,
  pc.labour_cost                                       as bom_labour_cost,
  pc.priced_subtotal,
  coalesce(pc.miscalc_percent, 0)                      as miscalc_percent,
  pc.miscalc_amount,
  pc.production_cost
from ops_prod.products p
left join ops_prod.bom_revisions d on d.product_id = p.id and d.released_at is null
left join ops_prod.v_product_cost pc
  on pc.product_id = p.id and pc.rev = coalesce(d.rev, ops_prod.released_rev(p.id));

-- The run summary keeps its shape (`v_wo_materials` and `wo_requirements`
-- read it); labour now comes from the lines of the revision being run.
create or replace function ops_prod.explode_summary(
  p_product_code text, p_qty numeric, p_rev int default null)
returns ops_prod.bom_explosion_t
language sql stable set search_path = ops_prod, pg_temp as $$
  select (
    p.product_code,
    p_qty,
    coalesce(p_rev, ops_prod.start_rev(p.id)),
    count(l.*)::int,
    count(*) filter (where l.subtotal is null)::int,
    count(*) filter (where l.unexploded)::int,
    coalesce(bool_or(l.cycle), false),
    case when count(*) filter (where l.subtotal is null) > 0 then null
         else sum(l.subtotal)::bigint end,
    lab.per_unit,
    case when lab.per_unit is null then null
         else round(lab.per_unit * p_qty)::bigint end
  )::ops_prod.bom_explosion_t
  from ops_prod.products p
  left join lateral ops_prod.explode_bom(p_product_code, p_qty, p_rev) l on true
  left join lateral (
    select case when count(*) = 0 then null
                when count(*) filter (where b.subtotal is null) > 0 then null
                else sum(b.subtotal)::bigint end as per_unit
      from ops_prod.v_product_bom b
     where b.product_id = p.id and b.rev = coalesce(p_rev, ops_prod.start_rev(p.id))
       and b.kind = 'labour'
  ) lab on true
  where p.product_code = p_product_code
  group by p.product_code, p.id, lab.per_unit
$$;

alter view ops_prod.v_product_bom     set (security_invoker = on);
alter view ops_prod.v_product_cost    set (security_invoker = on);
alter view ops_prod.v_product_summary set (security_invoker = on);
grant select on ops_prod.v_product_summary to authenticated;
grant execute on function ops_prod.line_rate(uuid, int),
                          ops_prod.bom_cost(uuid, int, int) to authenticated;

-- ── 4. the seams ──────────────────────────────────────────────────────────

-- Would putting `p_ref` on `p_parent`'s BOM close a loop? True when `p_ref`
-- is the parent itself or reaches it through any revision of any
-- sub-assembly — the draft included, because the draft is about to be
-- released.
create or replace function ops_prod.would_cycle(p_parent text, p_ref text)
returns boolean
language sql stable set search_path = ops_prod, pg_temp as $$
  with recursive down(code, depth) as (
    select p_ref, 0
    union
    select c.ref_code, d.depth + 1
      from down d
      join ops_prod.products s on s.product_code = d.code
      join ops_prod.bom_components c on c.product_id = s.id and c.kind = 'product'
     where d.depth < 16
  )
  select exists (select 1 from down where code = p_parent)
$$;

-- The draft to write into, opened if there is none: a copy of the newest
-- released revision, manual rates kept, catalogue rates let go again.
create or replace function ops_prod.open_draft(p_product_id uuid)
returns int
language plpgsql security definer set search_path = ops_prod, pg_temp as $$
declare v_rev int; v_from int; v_misc numeric;
begin
  select rev into v_rev from ops_prod.bom_revisions
   where product_id = p_product_id and released_at is null;
  if v_rev is not null then return v_rev; end if;

  v_from := ops_prod.released_rev(p_product_id);
  v_rev := coalesce((select max(rev) from ops_prod.bom_revisions where product_id = p_product_id), 0) + 1;
  select miscalc_percent into v_misc from ops_prod.bom_revisions
   where product_id = p_product_id and rev = v_from;

  insert into ops_prod.bom_revisions (product_id, rev, miscalc_percent, created_by)
  values (p_product_id, v_rev, coalesce(v_misc, 0), auth.uid());

  if v_from is not null then
    insert into ops_prod.bom_components
      (product_id, rev, kind, ref_code, qty, uom, waste_percent, note, label, unit_rate, rate_source)
    select product_id, v_rev, kind, ref_code, qty, uom, waste_percent, note, label,
           case when rate_source = 'manual' or kind = 'labour' then unit_rate end,
           case when rate_source = 'manual' or kind = 'labour' then 'manual' end
      from ops_prod.bom_components
     where product_id = p_product_id and rev = v_from;
  end if;
  return v_rev;
end $$;
-- Not granted: reachable only from the seams below.
revoke all on function ops_prod.open_draft(uuid) from public;

-- Adding a product, or correcting one. The code is set once (`0060`'s
-- trigger); everything else is editable.
create or replace function ops_prod.save_product(
  p_product_code text, p_name text, p_category text, p_uom text,
  p_description text default null,
  p_length_mm int default null, p_width_mm int default null, p_height_mm int default null,
  p_dimension_note text default null, p_lead_time_days int default null,
  p_active boolean default null, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = ops_prod, ops_core, pg_temp as $$
declare v_code text := upper(btrim(coalesce(p_product_code, ''))); p ops_prod.products;
begin
  if v_code = '' then
    return ops_core.invalid('production','product', null,'save',
      'code_required','Kode produk dipakai di gambar dan di SPK.', jsonb_build_object('field','product_code'));
  end if;
  if coalesce(btrim(p_name), '') = '' then
    return ops_core.invalid('production','product', v_code,'save',
      'name_required','Namanya apa?', jsonb_build_object('field','name'));
  end if;

  select * into p from ops_prod.products where product_code = v_code;
  if not found then
    if not ops_core.has_permission('production.create') then
      return ops_core.refused('production','product', v_code,'create',
        'not_permitted','Menambah produk butuh akses produksi (create).');
    end if;
    insert into ops_prod.products (product_code, name, category, uom, description,
      length_mm, width_mm, height_mm, dimension_note, lead_time_days, active, note, created_by)
    values (v_code, btrim(p_name), coalesce(nullif(btrim(p_category), ''), 'Lain-lain'),
      coalesce(nullif(btrim(p_uom), ''), 'unit'), nullif(btrim(p_description), ''),
      nullif(p_length_mm, 0), nullif(p_width_mm, 0), nullif(p_height_mm, 0),
      nullif(btrim(p_dimension_note), ''), p_lead_time_days, coalesce(p_active, true),
      nullif(btrim(p_note), ''), auth.uid());
    return ops_core.ok('production','product', v_code,'create',
      jsonb_build_object('product_code', v_code));
  end if;

  if not ops_core.has_permission('production.update') then
    return ops_core.refused('production','product', v_code,'update',
      'not_permitted','Mengubah produk butuh akses produksi (update).');
  end if;
  update ops_prod.products set
    name           = btrim(p_name),
    category       = coalesce(nullif(btrim(p_category), ''), category),
    uom            = coalesce(nullif(btrim(p_uom), ''), uom),
    description    = coalesce(nullif(btrim(p_description), ''), description),
    length_mm      = coalesce(nullif(p_length_mm, 0), length_mm),
    width_mm       = coalesce(nullif(p_width_mm, 0), width_mm),
    height_mm      = coalesce(nullif(p_height_mm, 0), height_mm),
    dimension_note = coalesce(nullif(btrim(p_dimension_note), ''), dimension_note),
    lead_time_days = coalesce(p_lead_time_days, lead_time_days),
    active         = coalesce(p_active, active),
    note           = coalesce(nullif(btrim(p_note), ''), note),
    updated_at     = now()
  where id = p.id;
  return ops_core.ok('production','product', v_code,'update',
    jsonb_build_object('product_code', v_code), to_jsonb(p),
    (select to_jsonb(x) from ops_prod.products x where x.id = p.id));
end $$;

-- A line on the draft: added, or changed in place.
create or replace function ops_prod.save_bom_line(
  p_product_code text,
  p_component_id uuid default null,
  p_kind text default 'material',
  p_ref_code text default null,
  p_label text default null,
  p_qty numeric default null,
  p_uom text default null,
  p_unit_rate numeric default null,
  p_waste_percent numeric default 0,
  p_note text default null)
returns jsonb
language plpgsql security definer set search_path = ops_prod, ops_core, pg_temp as $$
declare p ops_prod.products; v_kind ops_prod.bom_ref_t; v_rev int; v_ref text;
        v_label text := nullif(btrim(coalesce(p_label, '')), '');
        existing ops_prod.bom_components; v_id uuid;
begin
  if not ops_core.has_permission('production.update') then
    return ops_core.refused('production','bom', p_product_code,'save_line',
      'not_permitted','Mengubah BOM butuh akses produksi (update).');
  end if;
  select * into p from ops_prod.products where product_code = p_product_code;
  if not found then
    return ops_core.not_found('production','bom', p_product_code,'save_line',
      format('Tidak ada produk %s.', p_product_code));
  end if;

  begin
    v_kind := p_kind::ops_prod.bom_ref_t;
  exception when invalid_text_representation then
    return ops_core.invalid('production','bom', p_product_code,'save_line',
      'unknown_kind', format('"%s" bukan jenis komponen.', p_kind), jsonb_build_object('field','kind'));
  end;

  if p_qty is null or p_qty <= 0 then
    return ops_core.invalid('production','bom', p_product_code,'save_line',
      'qty_required','Kebutuhan per unit harus lebih dari nol.', jsonb_build_object('field','qty'));
  end if;
  if p_unit_rate is not null and p_unit_rate < 0 then
    return ops_core.invalid('production','bom', p_product_code,'save_line',
      'negative_rate','Rate tidak bisa negatif.', jsonb_build_object('field','unit_rate'));
  end if;
  if coalesce(p_waste_percent, 0) < 0 or coalesce(p_waste_percent, 0) > 90 then
    return ops_core.invalid('production','bom', p_product_code,'save_line',
      'waste_out_of_range','Susut antara 0 dan 90%.', jsonb_build_object('field','waste_percent'));
  end if;

  if v_kind = 'labour' then
    if v_label is null then
      return ops_core.invalid('production','bom', p_product_code,'save_line',
        'label_required','Tenaga kerja apa? Mis. "Tukang finishing".', jsonb_build_object('field','label'));
    end if;
    if p_unit_rate is null then
      return ops_core.invalid('production','bom', p_product_code,'save_line',
        'rate_required','Tenaga kerja butuh rate — upah per hari, per jam, atau per unit.',
        jsonb_build_object('field','unit_rate'));
    end if;
    -- The label is the identity of a labour line; the code is derived from it
    -- so *one line per component per revision* still holds.
    v_ref := 'LABOUR:' || upper(left(regexp_replace(v_label, '[^A-Za-z0-9]+', '-', 'g'), 40));
  else
    v_ref := upper(btrim(coalesce(p_ref_code, '')));
    if v_ref = '' then
      return ops_core.invalid('production','bom', p_product_code,'save_line',
        'ref_required','Komponennya apa?', jsonb_build_object('field','ref_code'));
    end if;
    if v_kind = 'product' and ops_prod.would_cycle(p.product_code, v_ref) then
      return ops_core.invalid('production','bom', p_product_code,'save_line',
        'bom_cycle', format('%s memuat %s (langsung atau lewat sub-rakitan) — rakitan yang memuat dirinya sendiri tidak punya biaya yang terhingga.', v_ref, p.product_code),
        jsonb_build_object('field','ref_code'));
    end if;
  end if;

  if p_component_id is not null then
    select * into existing from ops_prod.bom_components where id = p_component_id and product_id = p.id;
    if not found then
      return ops_core.not_found('production','bom', p_product_code,'save_line','Baris itu tidak ada.');
    end if;
  end if;

  v_rev := ops_prod.open_draft(p.id);

  -- Edited from a released revision: the edit lands on that line's copy in
  -- the draft. The released line itself is never touched (A5).
  if existing.id is not null and existing.rev <> v_rev then
    select id into v_id from ops_prod.bom_components
     where product_id = p.id and rev = v_rev and ref_code = existing.ref_code;
    p_component_id := v_id;
    v_id := null;
  end if;

  if exists (select 1 from ops_prod.bom_components
              where product_id = p.id and rev = v_rev and ref_code = v_ref
                and id is distinct from p_component_id) then
    return ops_core.conflict('production','bom', p_product_code,'save_line',
      'already_on_bom', format('%s sudah ada di BOM ini — ubah jumlahnya, jangan tambah baris kedua.',
        coalesce(v_label, v_ref)));
  end if;

  if p_component_id is not null then
    update ops_prod.bom_components set
      kind = v_kind, ref_code = v_ref, label = v_label, qty = p_qty,
      uom = coalesce(nullif(btrim(p_uom), ''), uom),
      waste_percent = coalesce(p_waste_percent, 0),
      unit_rate = p_unit_rate,
      rate_source = case when p_unit_rate is null then null else 'manual' end,
      note = nullif(btrim(p_note), '')
    where id = p_component_id
    returning id into v_id;
  else
    insert into ops_prod.bom_components
      (product_id, rev, kind, ref_code, label, qty, uom, waste_percent, unit_rate, rate_source, note)
    values (p.id, v_rev, v_kind, v_ref, v_label, p_qty,
      coalesce(nullif(btrim(p_uom), ''), 'pcs'), coalesce(p_waste_percent, 0),
      p_unit_rate, case when p_unit_rate is null then null else 'manual' end,
      nullif(btrim(p_note), ''))
    returning id into v_id;
  end if;

  return ops_core.ok('production','bom', p_product_code,
    case when p_component_id is null then 'add_line' else 'update_line' end,
    jsonb_build_object('component_id', v_id, 'rev', v_rev, 'ref_code', v_ref),
    case when existing.id is null then null else to_jsonb(existing) end,
    (select to_jsonb(x) from ops_prod.bom_components x where x.id = v_id));
end $$;

create or replace function ops_prod.remove_bom_line(p_product_code text, p_component_id uuid)
returns jsonb
language plpgsql security definer set search_path = ops_prod, ops_core, pg_temp as $$
declare p ops_prod.products; c ops_prod.bom_components; v_rev int; v_ref text;
begin
  if not ops_core.has_permission('production.update') then
    return ops_core.refused('production','bom', p_product_code,'remove_line',
      'not_permitted','Mengubah BOM butuh akses produksi (update).');
  end if;
  select * into p from ops_prod.products where product_code = p_product_code;
  if not found then
    return ops_core.not_found('production','bom', p_product_code,'remove_line',
      format('Tidak ada produk %s.', p_product_code));
  end if;
  select * into c from ops_prod.bom_components where id = p_component_id and product_id = p.id;
  if not found then
    return ops_core.not_found('production','bom', p_product_code,'remove_line','Baris itu tidak ada.');
  end if;

  -- A line of a released revision: open the draft and remove its copy there,
  -- so *hapus* on the screen does what it says without touching the release.
  if exists (select 1 from ops_prod.bom_revisions r
              where r.product_id = p.id and r.rev = c.rev and r.released_at is not null) then
    v_ref := c.ref_code;
    v_rev := ops_prod.open_draft(p.id);
    select * into c from ops_prod.bom_components
     where product_id = p.id and rev = v_rev and ref_code = v_ref;
    if not found then
      return ops_core.noop('production','bom', p_product_code,'remove_line',
        'Baris itu sudah tidak ada di draft.');
    end if;
  end if;

  delete from ops_prod.bom_components where id = c.id;
  return ops_core.ok('production','bom', p_product_code,'remove_line',
    jsonb_build_object('component_id', c.id, 'rev', c.rev), to_jsonb(c), null);
end $$;

create or replace function ops_prod.set_bom_miscalc(p_product_code text, p_percent numeric)
returns jsonb
language plpgsql security definer set search_path = ops_prod, ops_core, pg_temp as $$
declare p ops_prod.products; v_rev int; v_before numeric;
begin
  if not ops_core.has_permission('production.update') then
    return ops_core.refused('production','bom', p_product_code,'set_miscalc',
      'not_permitted','Mengubah BOM butuh akses produksi (update).');
  end if;
  select * into p from ops_prod.products where product_code = p_product_code;
  if not found then
    return ops_core.not_found('production','bom', p_product_code,'set_miscalc',
      format('Tidak ada produk %s.', p_product_code));
  end if;
  if p_percent is null or p_percent < 0 or p_percent > 100 then
    return ops_core.invalid('production','bom', p_product_code,'set_miscalc',
      'percent_out_of_range','Miskalkulasi antara 0 dan 100%.', jsonb_build_object('field','miscalc_percent'));
  end if;

  v_rev := ops_prod.open_draft(p.id);
  select miscalc_percent into v_before from ops_prod.bom_revisions where product_id = p.id and rev = v_rev;
  update ops_prod.bom_revisions set miscalc_percent = p_percent where product_id = p.id and rev = v_rev;
  return ops_core.ok('production','bom', p_product_code,'set_miscalc',
    jsonb_build_object('rev', v_rev, 'miscalc_percent', p_percent),
    to_jsonb(v_before), to_jsonb(p_percent));
end $$;

-- Freezing the draft. Refused when empty, when a line has no rate (a
-- released cost with a hole in it is the number somebody quotes from), and
-- when nothing differs from the release before it.
create or replace function ops_prod.release_bom(p_product_code text, p_note text)
returns jsonb
language plpgsql security definer set search_path = ops_prod, ops_core, pg_temp as $$
declare p ops_prod.products; v_rev int; v_from int; v_unpriced text[]; v_changed boolean;
begin
  if not ops_core.has_permission('production.update') then
    return ops_core.refused('production','bom', p_product_code,'release',
      'not_permitted','Merilis BOM butuh akses produksi (update).');
  end if;
  select * into p from ops_prod.products where product_code = p_product_code;
  if not found then
    return ops_core.not_found('production','bom', p_product_code,'release',
      format('Tidak ada produk %s.', p_product_code));
  end if;
  select rev into v_rev from ops_prod.bom_revisions where product_id = p.id and released_at is null;
  if v_rev is null then
    return ops_core.conflict('production','bom', p_product_code,'release',
      'no_draft','Tidak ada draft yang terbuka. Ubah satu komponen dan drafnya terbuka sendiri.');
  end if;
  if coalesce(btrim(p_note), '') = '' then
    return ops_core.invalid('production','bom', p_product_code,'release',
      'note_required','Kenapa versi ini ada? Satu kalimat — dibaca orang yang nanti bertanya soal selisih.',
      jsonb_build_object('field','note'));
  end if;
  if not exists (select 1 from ops_prod.bom_components where product_id = p.id and rev = v_rev) then
    return ops_core.invalid('production','bom', p_product_code,'release',
      'empty_revision','BOM tanpa komponen tidak bisa dirilis.', jsonb_build_object('field','components'));
  end if;

  select array_agg(b.ref_name || ' (' || b.ref_code || ')' order by b.ref_code) into v_unpriced
    from ops_prod.v_product_bom b
   where b.product_id = p.id and b.rev = v_rev and b.unit_price is null;
  if v_unpriced is not null then
    return ops_core.invalid('production','bom', p_product_code,'release',
      'unpriced_lines', format('Belum ada rate untuk: %s. Isi rate-nya dulu — biaya yang dirilis tidak boleh bolong.',
        array_to_string(v_unpriced, ', ')),
      jsonb_build_object('field','unit_rate','lines', to_jsonb(v_unpriced)));
  end if;

  v_from := ops_prod.released_rev(p.id);
  if v_from is not null then
    select exists (
        (select kind, ref_code, qty, uom, waste_percent, coalesce(label,''), round(unit_price, 2)
           from ops_prod.v_product_bom where product_id = p.id and rev = v_rev
         except
         select kind, ref_code, qty, uom, waste_percent, coalesce(label,''), round(unit_price, 2)
           from ops_prod.v_product_bom where product_id = p.id and rev = v_from)
        union all
        (select kind, ref_code, qty, uom, waste_percent, coalesce(label,''), round(unit_price, 2)
           from ops_prod.v_product_bom where product_id = p.id and rev = v_from
         except
         select kind, ref_code, qty, uom, waste_percent, coalesce(label,''), round(unit_price, 2)
           from ops_prod.v_product_bom where product_id = p.id and rev = v_rev))
      or (select miscalc_percent from ops_prod.bom_revisions where product_id = p.id and rev = v_rev)
         is distinct from
         (select miscalc_percent from ops_prod.bom_revisions where product_id = p.id and rev = v_from)
      into v_changed;
    if not v_changed then
      return ops_core.invalid('production','bom', p_product_code,'release',
        'nothing_changed', format('Draft rev %s sama persis dengan rev %s — komponen, jumlah, rate dan miskalkulasi.', v_rev, v_from),
        jsonb_build_object('field','components'));
    end if;
  end if;

  -- Freeze: every line keeps the rate it is costed at today, and says where
  -- that rate came from.
  update ops_prod.bom_components c
     set unit_rate = lr.rate, rate_source = lr.source
    from ops_prod.bom_components c2
    cross join lateral ops_prod.line_rate(c2.id) lr
   where c.id = c2.id and c.product_id = p.id and c.rev = v_rev and c.unit_rate is null;

  update ops_prod.bom_revisions
     set released_at = now(), released_by = auth.uid(), note = btrim(p_note)
   where product_id = p.id and rev = v_rev;

  perform ops_core.emit('production','production.bom.released', p.product_code,
    jsonb_build_object('product_code', p.product_code, 'rev', v_rev, 'from_rev', v_from));
  return ops_core.ok('production','bom', p_product_code,'release',
    jsonb_build_object('rev', v_rev, 'from_rev', v_from,
      'production_cost', (ops_prod.bom_cost(p.id, v_rev)).production_cost));
end $$;

-- Throwing a draft away. Nothing to keep: a draft was never a fact.
create or replace function ops_prod.discard_bom_draft(p_product_code text)
returns jsonb
language plpgsql security definer set search_path = ops_prod, ops_core, pg_temp as $$
declare p ops_prod.products; v_rev int;
begin
  if not ops_core.has_permission('production.update') then
    return ops_core.refused('production','bom', p_product_code,'discard_draft',
      'not_permitted','Mengubah BOM butuh akses produksi (update).');
  end if;
  select * into p from ops_prod.products where product_code = p_product_code;
  if not found then
    return ops_core.not_found('production','bom', p_product_code,'discard_draft',
      format('Tidak ada produk %s.', p_product_code));
  end if;
  select rev into v_rev from ops_prod.bom_revisions where product_id = p.id and released_at is null;
  if v_rev is null then
    return ops_core.noop('production','bom', p_product_code,'discard_draft','Tidak ada draft.');
  end if;
  delete from ops_prod.bom_components where product_id = p.id and rev = v_rev;
  delete from ops_prod.bom_revisions where product_id = p.id and rev = v_rev;
  return ops_core.ok('production','bom', p_product_code,'discard_draft',
    jsonb_build_object('rev', v_rev));
end $$;

-- A component the catalogue does not have yet, typed from the BOM.
--
-- It goes **into `ops_procure.items`**, not into a list of production's own:
-- the owner's words were *terhubung ke database items*, and a second list is
-- two names for one plywood by the end of the month. Uncurated, like every
-- item that arrives by use rather than by curation — procurement files and
-- prices it later in Master Data.
--
-- The one write this schema makes into procurement's. `create_item` asks for
-- `procurement.create`, which a designer does not hold and should not be
-- handed for this; the rules it enforces (a name, a known category and unit,
-- the next `I-` code) are repeated here rather than loosened there.
create or replace function ops_prod.create_bom_item(
  p_name text, p_category_code text default 'uncurated',
  p_base_uom text default 'pcs', p_kind ops_procure.item_kind_t default 'goods',
  p_standard_price numeric default null)
returns jsonb
language plpgsql security definer set search_path = ops_prod, ops_procure, ops_core, pg_temp as $$
declare v_name text := btrim(coalesce(p_name, '')); v_code text; n int; v_existing text;
begin
  if not ops_core.has_permission('production.update') then
    return ops_core.refused('production','item', null,'create_from_bom',
      'not_permitted','Menambah item dari BOM butuh akses produksi (update).');
  end if;
  if v_name = '' then
    return ops_core.invalid('production','item', null,'create_from_bom',
      'name_required','Nama itemnya apa?', jsonb_build_object('field','name'));
  end if;
  if not exists (select 1 from ops_procure.item_categories where code = p_category_code) then
    return ops_core.invalid('production','item', null,'create_from_bom',
      'no_such_category', format('Tidak ada kategori %s.', p_category_code), jsonb_build_object('field','category_code'));
  end if;
  if not exists (select 1 from ops_procure.uom where code = p_base_uom) then
    return ops_core.invalid('production','item', null,'create_from_bom',
      'no_such_uom', format('Tidak ada satuan %s.', p_base_uom), jsonb_build_object('field','base_uom'));
  end if;
  if p_standard_price is not null and p_standard_price < 0 then
    return ops_core.invalid('production','item', null,'create_from_bom',
      'negative_price','Harga tidak bisa negatif.', jsonb_build_object('field','standard_price'));
  end if;

  -- Same name already there: hand it back rather than make its twin.
  select code into v_existing from ops_procure.items
   where lower(name) = lower(v_name) and merged_into is null and archived_at is null
   limit 1;
  if v_existing is not null then
    return ops_core.noop('production','item', v_existing,'create_from_bom',
      format('%s sudah ada di database items (%s) — dipakai yang itu.', v_name, v_existing),
      jsonb_build_object('code', v_existing, 'existing', true));
  end if;

  select count(*) + 1 into n from ops_procure.items;
  v_code := 'I-' || lpad(n::text, 4, '0');
  while exists (select 1 from ops_procure.items i where i.code = v_code) loop
    n := n + 1;
    v_code := 'I-' || lpad(n::text, 4, '0');
  end loop;

  insert into ops_procure.items (code, name, category_code, base_uom, kind, is_curated, standard_price, created_by)
  values (v_code, v_name, p_category_code, p_base_uom, p_kind, false, p_standard_price, auth.uid());

  return ops_core.ok('production','item', v_code,'create_from_bom',
    jsonb_build_object('code', v_code, 'name', v_name, 'existing', false));
end $$;

grant execute on function
  ops_prod.save_product(text, text, text, text, text, int, int, int, text, int, boolean, text),
  ops_prod.save_bom_line(text, uuid, text, text, text, numeric, text, numeric, numeric, text),
  ops_prod.remove_bom_line(text, uuid),
  ops_prod.set_bom_miscalc(text, numeric),
  ops_prod.release_bom(text, text),
  ops_prod.discard_bom_draft(text),
  ops_prod.create_bom_item(text, text, text, ops_procure.item_kind_t, numeric),
  ops_prod.would_cycle(text, text)
  to authenticated;
