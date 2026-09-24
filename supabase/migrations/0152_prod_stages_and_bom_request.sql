-- 0152 — two things the production walk could not do from the screens (F155).
--
-- ── 1. A product's own stages ────────────────────────────────────────────
--
-- `products.stages` says which of the owner's four stages a product goes
-- through (Q52): a dining table is sanded, finished and packed; it has no
-- lamps, cables or mechanisms, so it never visits *Machinery*. A product with
-- no list falls back to its route's four stages (0061), and F92 already said
-- what that costs: a *Machinery* column a table never fills, so the order never
-- reads finished and every later stage looks like it jumped a step.
--
-- The column existed and nothing could write it. `save_product` had no
-- argument for it and the product drawer no field — the demo's `saveProduct`
-- took `stages`, the live one dropped it. So every product made on screen ran
-- through all four stages.
--
-- `p_stages` is added. Null leaves the list as it is (so every existing caller
-- keeps its meaning); an empty array clears it back to the route's stages;
-- anything else must name live stages. A stage is not taken away while an open
-- order has progress in it — that progress would silently stop counting.
--
-- ── 2. A request raised from a BOM names the items it is for ──────────────
--
-- *Buat PR dari BOM* sends each exploded line's description, quantity and
-- unit, and the BOM knows exactly which item each line is — but `create_pr`
-- takes an `item_id`, and the screen has the item's **code** (ADR-004: another
-- service knows the code and nothing else). So every line arrived unlinked,
-- and the request lost the item's last price, last vendor and stock.
--
-- `create_pr` now also reads `item_code`, resolved here to the item it names
-- (following a merge to what it was merged into). An `item_id`, when given,
-- still wins; a code that names nothing leaves the line unlinked rather than
-- refusing the request, because a person reads and prices every draft anyway.

-- ── 1 ──────────────────────────────────────────────────────────────────────
drop function if exists ops_prod.save_product(text, text, text, text, text, int, int, int, text, int, boolean, text);

create or replace function ops_prod.save_product(
  p_product_code text, p_name text, p_category text, p_uom text,
  p_description text default null,
  p_length_mm int default null, p_width_mm int default null, p_height_mm int default null,
  p_dimension_note text default null, p_lead_time_days int default null,
  p_active boolean default null, p_note text default null,
  p_stages text[] default null)
returns jsonb
language plpgsql security definer set search_path = ops_prod, ops_core, pg_temp as $$
declare
  v_code text := upper(btrim(coalesce(p_product_code, ''))); p ops_prod.products;
  v_stages text[]; v_unknown text; v_used text;
begin
  if v_code = '' then
    return ops_core.invalid('production','product', null,'save',
      'code_required','Kode produk dipakai di gambar dan di SPK.', jsonb_build_object('field','product_code'));
  end if;
  if coalesce(btrim(p_name), '') = '' then
    return ops_core.invalid('production','product', v_code,'save',
      'name_required','Namanya apa?', jsonb_build_object('field','name'));
  end if;

  -- The list, in the stages' own order, each once. Empty means *follow the
  -- route*, which is stored as null — the table refuses an empty array.
  if p_stages is not null then
    select array_agg(distinct upper(btrim(s))) filter (where btrim(s) <> '') into v_stages from unnest(p_stages) s;
    select string_agg(s, ', ') into v_unknown from unnest(coalesce(v_stages, '{}')) s
     where not exists (select 1 from ops_prod.process_stages ps where ps.code = s);
    if v_unknown is not null then
      return ops_core.invalid('production','product', v_code,'save',
        'unknown_stage', format('Tahap %s tidak dikenal.', v_unknown), jsonb_build_object('field','stages'));
    end if;
    select array_agg(ps.code order by ps.seq) into v_stages
      from ops_prod.process_stages ps where ps.code = any(coalesce(v_stages, '{}'));
  end if;

  select * into p from ops_prod.products where product_code = v_code;
  if not found then
    if not ops_core.has_permission('production.create') then
      return ops_core.refused('production','product', v_code,'create',
        'not_permitted','Menambah produk butuh akses produksi (create).');
    end if;
    insert into ops_prod.products (product_code, name, category, uom, description,
      length_mm, width_mm, height_mm, dimension_note, lead_time_days, active, note, stages, created_by)
    values (v_code, btrim(p_name), coalesce(nullif(btrim(p_category), ''), 'Lain-lain'),
      coalesce(nullif(btrim(p_uom), ''), 'unit'), nullif(btrim(p_description), ''),
      nullif(p_length_mm, 0), nullif(p_width_mm, 0), nullif(p_height_mm, 0),
      nullif(btrim(p_dimension_note), ''), p_lead_time_days, coalesce(p_active, true),
      nullif(btrim(p_note), ''), v_stages, auth.uid());
    return ops_core.ok('production','product', v_code,'create',
      jsonb_build_object('product_code', v_code, 'stages', v_stages));
  end if;

  if not ops_core.has_permission('production.update') then
    return ops_core.refused('production','product', v_code,'update',
      'not_permitted','Mengubah produk butuh akses produksi (update).');
  end if;

  -- A stage an open order has already recorded work in stays until that order
  -- is closed: dropping it would make the work stop counting, silently.
  if p_stages is not null then
    select string_agg(distinct w.wo_no || ' (' || e.stage || ')', ', ') into v_used
      from ops_prod.work_orders w
      join ops_prod.progress_entries e on e.wo_id = w.id
     where w.product_code = v_code and w.status = 'OPEN'
       and not (e.stage = any(coalesce(v_stages,
             (select array_agg(rs.stage_code) from ops_prod.route_stages rs where rs.route_code = w.route))));
    if v_used is not null then
      return ops_core.conflict('production','product', v_code,'update',
        'stage_in_use', format('Masih ada progres di tahap itu pada Job Order yang terbuka: %s. Tutup Job Order-nya dulu.', v_used));
    end if;
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
    stages         = case when p_stages is null then stages else v_stages end,
    updated_at     = now()
  where id = p.id;
  return ops_core.ok('production','product', v_code,'update',
    jsonb_build_object('product_code', v_code), to_jsonb(p),
    (select to_jsonb(x) from ops_prod.products x where x.id = p.id));
end $$;

-- A new function is executable by PUBLIC, which `anon` inherits (0125).
revoke execute on function ops_prod.save_product(text, text, text, text, text, int, int, int, text, int, boolean, text, text[]) from public;
grant execute on function ops_prod.save_product(text, text, text, text, text, int, int, int, text, int, boolean, text, text[]) to authenticated;

-- ── 2 ──────────────────────────────────────────────────────────────────────
create or replace function ops_procure.create_pr(
  p_lines jsonb,
  p_project_code text default null,
  p_doc_type ops_procure.pr_doc_type_t default 'PR',
  p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
declare
  v_doc_no text; v_doc_id uuid; proj uuid; n int; linked int;
  replayed jsonb; res jsonb;
begin
  replayed := ops_core.idem_replay('procurement','create_pr', p_key);
  if replayed is not null then return replayed; end if;

  if not ops_core.has_permission('procurement.create') then
    return ops_core.refused('procurement','pr_document', null,'create',
      'not_permitted','Raising a request needs procurement access.');
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    return ops_core.invalid('procurement','pr_document', null,'create',
      'lines_required','A purchase request needs at least one line.',
      jsonb_build_object('field','lines'));
  end if;

  -- By **code**, never by id: another service knows the code and nothing else
  -- (ADR-004). A project code that names nothing is a 404 rather than a silent
  -- null, because a request filed against the wrong job is worse than one
  -- filed against none.
  if p_project_code is not null then
    select id into proj from ops_procure.projects where code = p_project_code;
    if not found then
      return ops_core.not_found('procurement','pr_document', null,'create',
        format('No project %s.', p_project_code));
    end if;
  end if;

  v_doc_no := ops_core.next_doc_number('pr');

  insert into ops_procure.pr_documents (doc_no, doc_type, status, requested_by, project_id)
  values (v_doc_no, p_doc_type, 'DRAFT', auth.uid(), proj)
  returning id into v_doc_id;

  insert into ops_procure.pr_lines
    (doc_id, doc_no, line_no, item_id, description, qty, uom, unit_price,
     item_total, vendor_id, category, purpose, need_by, source_wo_no)
  select v_doc_id, v_doc_no, ord,
         -- An id when the caller has one; otherwise the item its code names,
         -- following a merge to the item that absorbed it (0152, F155).
         coalesce(nullif(l ->> 'item_id','')::uuid,
                  (select coalesce(i.merged_into, i.id) from ops_procure.items i
                    where i.code = nullif(btrim(l ->> 'item_code'), '') limit 1)),
         l ->> 'description',
         nullif(l ->> 'qty','')::numeric,
         nullif(l ->> 'uom',''),
         nullif(l ->> 'unit_price','')::numeric,
         -- The amount is quantity × price when there is a quantity and a price,
         -- and whatever the caller says otherwise. Plenty of real lines have
         -- neither — a service, a delivery charge, a lump sum the vendor quoted
         -- — and deriving those from a missing quantity would silently zero the
         -- one number that mattered (D75).
         coalesce(
           nullif(l ->> 'item_total','')::numeric,
           round(coalesce(nullif(l ->> 'qty','')::numeric, 0)
               * coalesce(nullif(l ->> 'unit_price','')::numeric, 0))),
         nullif(l ->> 'vendor_id','')::uuid,
         nullif(l ->> 'category','')::ops_procure.pr_category_t,
         nullif(l ->> 'purpose',''),
         nullif(l ->> 'need_by','')::date,
         nullif(l ->> 'source_wo_no','')
    from jsonb_array_elements(p_lines) with ordinality as t(l, ord);

  get diagnostics n = row_count;
  select count(*) into linked from ops_procure.pr_lines where doc_id = v_doc_id and item_id is not null;

  perform ops_core.emit('procurement','procurement.pr.created', v_doc_no,
    jsonb_build_object('doc_no', v_doc_no, 'lines', n));

  res := ops_core.ok('procurement','pr_document', v_doc_no,'create',
    jsonb_build_object('doc_no', v_doc_no, 'status','DRAFT','lines', n, 'linked_items', linked));
  return ops_core.idem_remember('procurement','create_pr', p_key, res);
end $$;
