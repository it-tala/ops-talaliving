-- 0225_procure_quote_design.sql — a quotation line offers a design item, and
-- its price is locked to the drawing it was based on (P5, kajian F224 §4.3,
-- G9, G14).
--
-- A quotation froze its cost and BOM revision when it was sent (0133), but
-- not the drawing the price was for: the render could change after the offer
-- and nothing would say the two had parted. And an item had nowhere to be
-- between the drawing board and the order. So:
--
--   quotation_lines.design_item_id   the design item a line offers (P4)
--   quotation_lines.design_file_id   the drawing it is priced on, when the PM
--                                    picks one; else the item's latest
--   quotation_lines.frozen_design_file_id
--                                    frozen at send, with the cost: the
--                                    offer names that drawing for good
--   project_lines.design_item_id / design_file_id
--                                    carried over when the client accepts,
--                                    so the chain is whole: design item →
--                                    quotation line → order line → product →
--                                    Job Order
--
-- `v_quotation_line` reads the item, its collection and room (the print
-- groups by them) and says when the item has been drawn again since the
-- offer (`design_changed`). `v_design_item` reads two more states, QUOTED
-- (on a quotation that went out) and ORDERED (on an order line), and the
-- product an order line made of it.
--
-- A revision is a file today: the drawing kinds below, newest first. P6 gives
-- the drafters numbered revisions; this column then names one of theirs.
--
-- New fields go through their own seams (F226): `save_quotation_line` keeps
-- its signature, and the screen already in production keeps working.
--
-- For the production tool (F226): no drops, and no function body here removes
-- rows.

-- ── 1. the columns ────────────────────────────────────────────────────────

alter table ops_procure.quotation_lines
  add column if not exists design_item_id        uuid references ops_procure.design_items(id),
  add column if not exists design_file_id        uuid references ops_core.attachments(id),
  add column if not exists frozen_design_file_id uuid references ops_core.attachments(id);
create index if not exists quotation_lines_design_idx
  on ops_procure.quotation_lines (design_item_id) where design_item_id is not null;

alter table ops_procure.project_lines
  add column if not exists design_item_id uuid references ops_procure.design_items(id),
  add column if not exists design_file_id uuid references ops_core.attachments(id);
create index if not exists project_lines_design_idx
  on ops_procure.project_lines (design_item_id) where design_item_id is not null;

-- ── 2. which drawing is the latest ────────────────────────────────────────

-- The newest drawing filed on the item: ours (render, layout, working
-- drawing) or the client's own drawing. A moodboard is not a drawing a price
-- can rest on.
create or replace function ops_procure.latest_design_file(p_item_id uuid)
returns uuid
language sql stable set search_path = ops_procure, ops_core, pg_temp as $$
  select l.attachment_id
    from ops_procure.design_items i
    join ops_core.attachment_links l
      on l.entity = 'design_item' and l.entity_no = i.item_no and l.unlinked_at is null
   where i.id = p_item_id
     and l.kind in ('render','layout','gambar_kerja','gambar_klien')
   order by l.linked_at desc
   limit 1;
$$;
revoke all on function ops_procure.latest_design_file(uuid) from public;
grant execute on function ops_procure.latest_design_file(uuid) to authenticated;

-- ── 3. what the screens read ──────────────────────────────────────────────

create or replace view ops_procure.v_quotation_line as
with base as (
  select
    l.*,
    q.quote_no,
    q.status,
    s.production_cost                                        as bom_unit_cost,
    s.rev                                                    as bom_rev_now,
    (s.product_id is not null)                               as product_exists,
    s.lead_time_days                                         as product_lead_time_days,
    coalesce(l.marketing_pct, q.marketing_pct)               as eff_marketing_pct,
    coalesce(l.overhead_pct,  q.overhead_pct)                as eff_overhead_pct,
    coalesce(l.margin_pct,    q.margin_pct)                  as eff_margin_pct,
    ops_procure.latest_design_file(l.design_item_id)         as latest_design_file_x
  from ops_procure.quotation_lines l
  join ops_procure.quotations q on q.id = l.quotation_id
  left join ops_procure.released_cost s on s.product_code = l.product_code
),
live as (
  select b.*,
    case when b.status = 'DRAFT'
         then coalesce(b.manual_unit_cost, case when b.current_rev_ok then b.bom_unit_cost end)
         else b.frozen_unit_cost end                         as unit_cost_x,
    case when b.status = 'DRAFT'
         then case when b.manual_unit_cost is not null then 'manual'
                   when b.current_rev_ok and b.bom_unit_cost is not null then 'bom' end
         else b.frozen_cost_source end                       as cost_source_x,
    case when b.status = 'DRAFT' then case when b.current_rev_ok then b.bom_rev_now end
         else b.frozen_bom_rev end                           as bom_rev_x
  from (select base.*, (base.bom_rev_now is not null) as current_rev_ok from base) b
)
select
  x.id, x.quotation_id, x.quote_no, x.status, x.line_no, x.product_code, x.description,
  x.qty, x.uom,
  coalesce(x.lead_time_days, x.product_lead_time_days)       as lead_time_days,
  x.product_exists,
  x.note,
  x.manual_unit_cost is not null                             as cost_is_manual,
  (x.unit_cost_x is null)                                    as cost_missing,
  ops_core.has_permission('project.update')                  as cost_visible,
  case when ops_core.has_permission('project.update') then x.unit_cost_x end   as unit_cost,
  case when ops_core.has_permission('project.update') then x.cost_source_x end as cost_source,
  x.bom_rev_x                                                as bom_rev,
  case when ops_core.has_permission('project.update')
       then case when x.status = 'DRAFT' then x.eff_marketing_pct else x.frozen_marketing_pct end end as marketing_pct,
  case when ops_core.has_permission('project.update')
       then case when x.status = 'DRAFT' then x.eff_overhead_pct  else x.frozen_overhead_pct end end  as overhead_pct,
  case when ops_core.has_permission('project.update')
       then case when x.status = 'DRAFT' then x.eff_margin_pct    else x.frozen_margin_pct end end    as margin_pct,
  (x.marketing_pct is not null or x.overhead_pct is not null or x.margin_pct is not null) as pct_overridden,
  -- What the line itself says, for the editor to send back unchanged: the
  -- columns above are the effective figures, and saving those would turn
  -- every inherited percent into an override.
  x.lead_time_days                                           as line_lead_time_days,
  case when ops_core.has_permission('project.update') then x.manual_unit_cost end as manual_unit_cost,
  case when ops_core.has_permission('project.update') then x.marketing_pct end    as line_marketing_pct,
  case when ops_core.has_permission('project.update') then x.overhead_pct end     as line_overhead_pct,
  case when ops_core.has_permission('project.update') then x.margin_pct end       as line_margin_pct,
  case when ops_core.has_permission('project.update')
       then ops_procure.quote_price(x.unit_cost_x, x.eff_marketing_pct, x.eff_overhead_pct, x.eff_margin_pct) end
                                                             as computed_unit_price,
  x.unit_price_override,
  case when x.status = 'DRAFT'
       then coalesce(x.unit_price_override,
                     ops_procure.quote_price(x.unit_cost_x, x.eff_marketing_pct, x.eff_overhead_pct, x.eff_margin_pct))
       else x.frozen_unit_price end                          as unit_price,
  -- P5 (0225): the design item the line offers, and the drawing its price is
  -- based on — the line's choice or the item's latest while a draft, frozen
  -- once sent. `design_changed`: the item has been drawn again since.
  di.item_no                                                 as design_item_no,
  di.name                                                    as design_item_name,
  dc.code                                                    as collection_code,
  dc.name                                                    as collection_name,
  dr.code                                                    as room_code,
  dr.name                                                    as room_name,
  dr.sort                                                    as room_sort,
  x.design_file_id                                           as line_design_file_id,
  d.eff_file                                                 as design_file_id,
  fa.filename                                                as design_file_name,
  x.latest_design_file_x                                     as latest_design_file_id,
  (d.eff_file is not null and x.latest_design_file_x is not null
   and x.latest_design_file_x <> d.eff_file)                 as design_changed
from live x
cross join lateral (
  select case when x.status = 'DRAFT' then coalesce(x.design_file_id, x.latest_design_file_x)
              else x.frozen_design_file_id end as eff_file
) d
left join ops_procure.design_items di on di.id = x.design_item_id
left join ops_procure.design_rooms dr on dr.id = di.room_id
left join ops_procure.design_collections dc on dc.id = dr.collection_id
left join ops_core.attachments fa on fa.id = d.eff_file;
-- `create or replace view` drops the view's options (F229).
alter view ops_procure.v_quotation_line set (security_invoker = on);


create or replace view ops_procure.v_design_item as
select
  i.id, i.item_no, i.seq, i.name, i.qty, i.length_mm, i.width_mm, i.height_mm,
  i.origin,
  -- The product it became: set on the item, or the order line's (0225).
  coalesce(i.product_code, od.product_code) as product_code,
  i.note, i.dropped_at, i.drop_reason, i.created_at, i.updated_at,
  r.code  as room_code,  r.name as room_name, r.sort as room_sort,
  c.code  as collection_code, c.name as collection_name,
  p.code  as project_code, p.name as project_name,
  cl.code as client_code, coalesce(cl.name, p.client_name) as client_display,
  coalesce(f.design_files, 0)  as design_files,
  coalesce(f.client_files, 0)  as client_files,
  coalesce(f.all_files, 0)     as all_files,
  ap.decision      as approval_decision,
  ap.decided_on    as approval_on,
  ap.channel       as approval_channel,
  ap.client_person as approval_by,
  case
    when i.dropped_at is not null       then 'DROPPED'
    when od.ordered                     then 'ORDERED'
    when qt.quote_no is not null        then 'QUOTED'
    when ap.decision = 'approved'       then 'APPROVED'
    when coalesce(f.drawn, 0) > 0       then 'DRAWN'
    else 'CONCEPT'
  end as status,
  -- P5 (0225): the latest quotation sent with the item, and whether an order
  -- line carries it.
  qt.quote_no      as quote_no,
  qt.quote_status  as quote_status,
  qt.unit_price    as quoted_unit_price,
  coalesce(od.ordered, false) as ordered
from ops_procure.design_items i
join ops_procure.design_rooms r on r.id = i.room_id
join ops_procure.design_collections c on c.id = r.collection_id
join ops_procure.projects p on p.id = c.project_id
left join ops_procure.clients cl on cl.id = p.client_id
left join lateral (
  select count(*) filter (where l.kind in ('render','moodboard','layout','gambar_kerja','gambar_jadi'))::int as design_files,
         count(*) filter (where l.kind in ('gambar_klien','referensi_klien'))::int                         as client_files,
         count(*)::int                                                                                      as all_files,
         count(*) filter (where l.kind in ('render','layout','gambar_kerja','gambar_jadi','gambar_klien'))::int as drawn
    from ops_core.attachment_links l
   where l.entity = 'design_item' and l.entity_no = i.item_no and l.unlinked_at is null
) f on true
left join lateral (
  select a.decision, a.decided_on, a.channel, a.client_person
    from ops_procure.design_approvals a
   where a.item_id = i.id
   order by a.recorded_at desc limit 1
) ap on true
left join lateral (
  select q.quote_no, q.status::text as quote_status, ql.frozen_unit_price as unit_price
    from ops_procure.quotation_lines ql
    join ops_procure.quotations q on q.id = ql.quotation_id
   where ql.design_item_id = i.id and q.status <> 'DRAFT'
   order by q.sent_at desc nulls last limit 1
) qt on true
left join lateral (
  select true as ordered, max(pl.product_code) as product_code
    from ops_procure.project_lines pl
   where pl.design_item_id = i.id
  having count(*) > 0
) od on true;
-- `create or replace view` drops the view's options (F229).
alter view ops_procure.v_design_item set (security_invoker = on);


-- The collection counts approvals by the approval itself: an approved item
-- that was then quoted is still approved.
create or replace view ops_procure.v_design_collection as
select c.id, c.code, c.name, c.note, c.created_at, p.code as project_code, p.name as project_name,
       (select count(*) from ops_procure.design_rooms r where r.collection_id = c.id)::int as room_count,
       (select count(*) from ops_procure.v_design_item i
         where i.project_code = p.code and i.collection_code = c.code and i.status <> 'DROPPED')::int as item_count,
       (select count(*) from ops_procure.v_design_item i
         where i.project_code = p.code and i.collection_code = c.code and i.status <> 'DROPPED'
           and i.approval_decision = 'approved')::int as approved_count
  from ops_procure.design_collections c
  join ops_procure.projects p on p.id = c.project_id;
alter view ops_procure.v_design_collection set (security_invoker = on);

-- ── 4. the seams ──────────────────────────────────────────────────────────

-- The checks a line's design passes, wherever it is set.
create or replace function ops_procure.quote_design_invalid(
  q ops_procure.quotations, p_item ops_procure.design_items, p_file_id uuid)
returns jsonb
language plpgsql stable set search_path = ops_procure, ops_core, pg_temp as $$
declare v_project uuid;
begin
  select dc.project_id into v_project
    from ops_procure.design_rooms dr join ops_procure.design_collections dc on dc.id = dr.collection_id
   where dr.id = p_item.room_id;
  if v_project is distinct from q.project_id then
    return ops_core.invalid('project','quotation', q.quote_no,'design', 'item_other_project',
      format('Item %s bukan item desain proyek quotation ini.', p_item.item_no), jsonb_build_object('field','item_no'));
  end if;
  if p_item.dropped_at is not null then
    return ops_core.invalid('project','quotation', q.quote_no,'design', 'item_dropped',
      format('Item %s sudah dikeluarkan dari desain.', p_item.item_no), jsonb_build_object('field','item_no'));
  end if;
  if p_file_id is not null and not exists (
       select 1 from ops_core.attachment_links l
        where l.attachment_id = p_file_id and l.entity = 'design_item' and l.entity_no = p_item.item_no
          and l.unlinked_at is null) then
    return ops_core.invalid('project','quotation', q.quote_no,'design', 'file_not_on_item',
      'Gambar yang dipakai harus file item itu.', jsonb_build_object('field','design_file_id'));
  end if;
  return null;
end $$;
revoke all on function ops_procure.quote_design_invalid(ops_procure.quotations, ops_procure.design_items, uuid) from public;

-- Offer design items: one line each, named and sized from the item, its qty,
-- and the product it already is where it is one. Items already on the
-- quotation are left as they are.
create or replace function ops_procure.add_quotation_lines_from_design(p_quote_no text, p_item_nos text[])
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
declare q ops_procure.quotations; i ops_procure.design_items; v_no int; v_bad jsonb; v_added int := 0;
        v_item text; v_desc text; v_uom text;
begin
  if not ops_procure.may_sell('update') then
    return ops_core.refused('project','quotation', p_quote_no,'add_design',
      'not_permitted','Mengubah quotation butuh akses proyek atau marketing (update).');
  end if;
  select * into q from ops_procure.quotations where quote_no = p_quote_no;
  if not found then
    return ops_core.not_found('project','quotation', p_quote_no,'add_design', format('Tidak ada quotation %s.', p_quote_no));
  end if;
  if q.status <> 'DRAFT' then
    return ops_core.conflict('project','quotation', p_quote_no,'add_design', 'not_draft',
      format('%s sudah %s. Buat revisi untuk mengubah isinya.', q.quote_no, q.status));
  end if;
  if coalesce(array_length(p_item_nos, 1), 0) = 0 then
    return ops_core.invalid('project','quotation', p_quote_no,'add_design', 'no_items',
      'Pilih item desain yang ditawarkan.', jsonb_build_object('field','item_nos'));
  end if;
  -- Every item checked before one line is written.
  foreach v_item in array p_item_nos loop
    select * into i from ops_procure.design_items where item_no = btrim(v_item);
    if not found then
      return ops_core.invalid('project','quotation', p_quote_no,'add_design', 'item_unknown',
        format('Tidak ada item %s.', v_item), jsonb_build_object('field','item_nos'));
    end if;
    v_bad := ops_procure.quote_design_invalid(q, i, null);
    if v_bad is not null then return v_bad; end if;
  end loop;

  select coalesce(max(line_no), 0) into v_no from ops_procure.quotation_lines where quotation_id = q.id;
  v_uom := case when exists (select 1 from ops_procure.uom where code = 'unit') then 'unit'
                else (select min(code) from ops_procure.uom) end;
  foreach v_item in array p_item_nos loop
    select * into i from ops_procure.design_items where item_no = btrim(v_item);
    continue when exists (select 1 from ops_procure.quotation_lines x
                           where x.quotation_id = q.id and x.design_item_id = i.id);
    v_desc := i.name || case when coalesce(i.length_mm, i.width_mm, i.height_mm) is not null
                             then format(' — %s × %s × %s mm', coalesce(i.length_mm::text, '–'),
                                         coalesce(i.width_mm::text, '–'), coalesce(i.height_mm::text, '–'))
                             else '' end;
    v_no := v_no + 1;
    insert into ops_procure.quotation_lines (quotation_id, line_no, product_code, description, qty, uom, design_item_id)
    values (q.id, v_no,
            (select p.product_code from ops_prod.products p where p.product_code = i.product_code),
            v_desc, i.qty, v_uom, i.id);
    v_added := v_added + 1;
  end loop;
  update ops_procure.quotations set updated_at = now() where id = q.id;
  return ops_core.ok('project','quotation', q.quote_no,'add_design',
    jsonb_build_object('quote_no', q.quote_no, 'added', v_added));
end $$;
revoke all on function ops_procure.add_quotation_lines_from_design(text, text[]) from public;
grant execute on function ops_procure.add_quotation_lines_from_design(text, text[]) to authenticated;

-- Which design item a draft line offers, and which of its drawings the price
-- rests on (null: the latest). No item: the line offers none.
create or replace function ops_procure.set_quotation_line_design(
  p_quote_no text, p_line_id uuid, p_item_no text default null, p_design_file_id uuid default null)
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
declare q ops_procure.quotations; i ops_procure.design_items; v_bad jsonb; v_id uuid;
begin
  if not ops_procure.may_sell('update') then
    return ops_core.refused('project','quotation', p_quote_no,'design',
      'not_permitted','Mengubah quotation butuh akses proyek atau marketing (update).');
  end if;
  select * into q from ops_procure.quotations where quote_no = p_quote_no;
  if not found then
    return ops_core.not_found('project','quotation', p_quote_no,'design', format('Tidak ada quotation %s.', p_quote_no));
  end if;
  if q.status <> 'DRAFT' then
    return ops_core.conflict('project','quotation', p_quote_no,'design', 'not_draft',
      format('%s sudah %s. Buat revisi untuk mengubah isinya.', q.quote_no, q.status));
  end if;
  if nullif(btrim(p_item_no), '') is null then
    if p_design_file_id is not null then
      return ops_core.invalid('project','quotation', p_quote_no,'design', 'file_without_item',
        'Gambar dipilih dari item desainnya — pilih itemnya dulu.', jsonb_build_object('field','design_file_id'));
    end if;
    update ops_procure.quotation_lines set design_item_id = null, design_file_id = null
     where id = p_line_id and quotation_id = q.id returning id into v_id;
  else
    select * into i from ops_procure.design_items where item_no = btrim(p_item_no);
    if not found then
      return ops_core.invalid('project','quotation', p_quote_no,'design', 'item_unknown',
        format('Tidak ada item %s.', p_item_no), jsonb_build_object('field','item_no'));
    end if;
    v_bad := ops_procure.quote_design_invalid(q, i, p_design_file_id);
    if v_bad is not null then return v_bad; end if;
    update ops_procure.quotation_lines set design_item_id = i.id, design_file_id = p_design_file_id
     where id = p_line_id and quotation_id = q.id returning id into v_id;
  end if;
  if v_id is null then
    return ops_core.not_found('project','quotation', p_quote_no,'design', 'Baris itu tidak ada.');
  end if;
  update ops_procure.quotations set updated_at = now() where id = q.id;
  return ops_core.ok('project','quotation', q.quote_no,'design',
    jsonb_build_object('quote_no', q.quote_no, 'line_id', v_id));
end $$;
revoke all on function ops_procure.set_quotation_line_design(text, uuid, text, uuid) from public;
grant execute on function ops_procure.set_quotation_line_design(text, uuid, text, uuid) to authenticated;

-- ── 5. send freezes the drawing; a revision and the order carry the item ──
--
-- The three bodies are 0219's, with only the lines marked (0225) added.

CREATE OR REPLACE FUNCTION ops_procure.send_quotation(p_quote_no text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'ops_procure', 'ops_core', 'pg_temp'
AS $function$
declare q ops_procure.quotations; pr ops_procure.projects; v_missing text; v_n int;
begin
  if not ops_procure.may_sell('update') then
    return ops_core.refused('project','quotation', p_quote_no,'send',
      'not_permitted','Mengirim quotation butuh akses proyek atau marketing (update).');
  end if;
  select * into q from ops_procure.quotations where quote_no = p_quote_no;
  if not found then
    return ops_core.not_found('project','quotation', p_quote_no,'send', format('Tidak ada quotation %s.', p_quote_no));
  end if;
  if q.status <> 'DRAFT' then
    return ops_core.conflict('project','quotation', p_quote_no,'send', 'not_draft', format('%s sudah %s.', q.quote_no, q.status));
  end if;
  select count(*) into v_n from ops_procure.quotation_lines where quotation_id = q.id;
  if v_n = 0 then
    return ops_core.invalid('project','quotation', p_quote_no,'send', 'no_lines',
      'Quotation tanpa item bukan penawaran.', jsonb_build_object('field','lines'));
  end if;
  select string_agg(format('baris %s (%s)', line_no, description), ', ' order by line_no) into v_missing
    from ops_procure.v_quotation_line where quotation_id = q.id and cost_missing and unit_price_override is null;
  if v_missing is not null then
    return ops_core.invalid('project','quotation', p_quote_no,'send', 'cost_missing',
      format('Belum ada ongkos produksi untuk %s. Rilis BOM-nya, isi ongkos manual, atau tetapkan harga jualnya.', v_missing),
      jsonb_build_object('field','lines'));
  end if;
  if q.valid_until is not null and q.valid_until < ops_core.office_day() then
    return ops_core.invalid('project','quotation', p_quote_no,'send', 'already_expired',
      format('Berlaku sampai %s — tanggal itu sudah lewat.', q.valid_until), jsonb_build_object('field','valid_until'));
  end if;

  -- The view computes; the freeze copies what it says, so the frozen figures
  -- are exactly the ones the PM was looking at.
  update ops_procure.quotation_lines l set
    frozen_unit_cost = v.unit_cost_raw, frozen_cost_source = v.cost_source_raw, frozen_bom_rev = v.bom_rev,
    frozen_marketing_pct = v.mkt, frozen_overhead_pct = v.ovh, frozen_margin_pct = v.mrg,
    frozen_unit_price = coalesce(l.unit_price_override, ops_procure.quote_price(v.unit_cost_raw, v.mkt, v.ovh, v.mrg)),
    -- The drawing goes with the price (0225, G14).
    frozen_design_file_id = coalesce(l.design_file_id, ops_procure.latest_design_file(l.design_item_id))
  from (
    select l2.id,
           coalesce(l2.manual_unit_cost, s.production_cost) as unit_cost_raw,
           case when l2.manual_unit_cost is not null then 'manual'
                when s.production_cost is not null then 'bom' end as cost_source_raw,
           s.rev as bom_rev,
           coalesce(l2.marketing_pct, q.marketing_pct) as mkt,
           coalesce(l2.overhead_pct,  q.overhead_pct)  as ovh,
           coalesce(l2.margin_pct,    q.margin_pct)    as mrg
      from ops_procure.quotation_lines l2
      left join ops_procure.released_cost s on s.product_code = l2.product_code
     where l2.quotation_id = q.id
  ) v
  where l.id = v.id;

  update ops_procure.quotations set status = 'SENT', sent_at = now(), sent_by = auth.uid(), updated_at = now()
   where id = q.id;

  select * into pr from ops_procure.projects where id = q.project_id;
  if pr.status = 'INQUIRY' then
    update ops_procure.projects set status = 'QUOTATION_SENT', status_changed_at = now(), updated_at = now()
     where id = pr.id;
    insert into ops_procure.project_status_log (project_id, from_status, to_status, reason, changed_by)
    values (pr.id, pr.status, 'QUOTATION_SENT', format('Quotation %s dikirim', q.quote_no), auth.uid());
  end if;
  return ops_core.ok('project','quotation', q.quote_no,'send', jsonb_build_object('quote_no', q.quote_no));
end $function$;

CREATE OR REPLACE FUNCTION ops_procure.revise_quotation(p_quote_no text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'ops_procure', 'ops_core', 'pg_temp'
AS $function$
declare q ops_procure.quotations; n ops_procure.quotations; v_rev int;
begin
  if not ops_procure.may_sell('update') then
    return ops_core.refused('project','quotation', p_quote_no,'revise',
      'not_permitted','Merevisi quotation butuh akses proyek atau marketing (update).');
  end if;
  select * into q from ops_procure.quotations where quote_no = p_quote_no;
  if not found then
    return ops_core.not_found('project','quotation', p_quote_no,'revise', format('Tidak ada quotation %s.', p_quote_no));
  end if;
  if q.status not in ('SENT','REJECTED') then
    return ops_core.conflict('project','quotation', p_quote_no,'revise', 'not_revisable',
      case q.status when 'DRAFT' then 'Masih draft — ubah langsung saja.'
                    when 'ACCEPTED' then 'Sudah disetujui dan menjadi pesanan. Perubahan setelah ini diurus di pesanannya.'
                    else format('%s sudah %s.', q.quote_no, q.status) end);
  end if;
  if exists (select 1 from ops_procure.quotations where project_id = q.project_id and status = 'DRAFT') then
    return ops_core.conflict('project','quotation', p_quote_no,'revise', 'draft_exists',
      'Proyek ini sudah punya quotation draft.');
  end if;
  select coalesce(max(rev), 0) + 1 into v_rev from ops_procure.quotations where project_id = q.project_id;
  insert into ops_procure.quotations (project_id, rev, supersedes_id, valid_until, marketing_pct, overhead_pct,
                                      margin_pct, vat, vat_pct, terms, note, created_by)
  values (q.project_id, v_rev, q.id, greatest(coalesce(q.valid_until, ops_core.office_day()), ops_core.office_day() + 30),
          q.marketing_pct, q.overhead_pct, q.margin_pct, q.vat, q.vat_pct, q.terms, q.note, auth.uid())
  returning * into n;
  -- The design item goes with the line; the drawing is chosen afresh only
  -- where the PM had pinned one (else the new revision prices the latest).
  insert into ops_procure.quotation_lines (quotation_id, line_no, product_code, description, qty, uom, lead_time_days,
    manual_unit_cost, marketing_pct, overhead_pct, margin_pct, unit_price_override, note,
    design_item_id, design_file_id)
  select n.id, line_no, product_code, description, qty, uom, lead_time_days,
         manual_unit_cost, marketing_pct, overhead_pct, margin_pct, unit_price_override, note,
         design_item_id, design_file_id
    from ops_procure.quotation_lines where quotation_id = q.id;
  if q.status = 'SENT' then
    update ops_procure.quotations set status = 'SUPERSEDED', updated_at = now() where id = q.id;
  end if;
  return ops_core.ok('project','quotation', n.quote_no,'revise',
    jsonb_build_object('quote_no', n.quote_no, 'rev', n.rev, 'from', q.quote_no));
end $function$;

CREATE OR REPLACE FUNCTION ops_procure.decide_quotation(p_quote_no text, p_accepted boolean, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'ops_procure', 'ops_core', 'pg_temp'
AS $function$
declare q ops_procure.quotations; pr ops_procure.projects; v_next int; v_added int := 0;
begin
  if not ops_procure.may_sell('update') then
    return ops_core.refused('project','quotation', p_quote_no,'decide',
      'not_permitted','Mencatat jawaban klien butuh akses proyek atau marketing (update).');
  end if;
  select * into q from ops_procure.quotations where quote_no = p_quote_no;
  if not found then
    return ops_core.not_found('project','quotation', p_quote_no,'decide', format('Tidak ada quotation %s.', p_quote_no));
  end if;
  if q.status <> 'SENT' then
    return ops_core.conflict('project','quotation', p_quote_no,'decide', 'not_sent',
      case q.status when 'DRAFT' then 'Belum dikirim ke klien.'
                    else format('%s sudah %s.', q.quote_no, q.status) end);
  end if;
  if not p_accepted and coalesce(btrim(p_reason), '') = '' then
    return ops_core.invalid('project','quotation', p_quote_no,'decide', 'reason_required',
      'Kenapa ditolak? Harga, waktu, atau desain — pertanyaan ini pasti datang lagi di penawaran berikutnya.',
      jsonb_build_object('field','reason'));
  end if;

  update ops_procure.quotations
     set status = case when p_accepted then 'ACCEPTED'::ops_procure.quotation_status_t else 'REJECTED' end,
         decided_at = now(), decided_by = auth.uid(), decision_reason = nullif(btrim(p_reason), ''), updated_at = now()
   where id = q.id;

  select * into pr from ops_procure.projects where id = q.project_id;
  if p_accepted then
    select coalesce(max(line_no), 0) into v_next from ops_procure.project_lines where project_id = pr.id;
    -- The design item and the drawing it was priced on go to the order (0225).
    insert into ops_procure.project_lines (project_id, line_no, product_code, description, qty, uom, unit_price,
                                           note, quotation_line_id, design_item_id, design_file_id)
    select pr.id, v_next + row_number() over (order by l.line_no), l.product_code, l.description, l.qty, l.uom,
           l.frozen_unit_price, format('dari %s', q.quote_no), l.id, l.design_item_id, l.frozen_design_file_id
      from ops_procure.quotation_lines l
     where l.quotation_id = q.id
       and not exists (select 1 from ops_procure.project_lines x where x.quotation_line_id = l.id);
    get diagnostics v_added = row_count;
    if pr.status in ('INQUIRY','QUOTATION_SENT') then
      update ops_procure.projects set status = 'DEAL', status_changed_at = now(), updated_at = now(), is_active = true
       where id = pr.id;
      insert into ops_procure.project_status_log (project_id, from_status, to_status, reason, changed_by)
      values (pr.id, pr.status, 'DEAL', format('Quotation %s disetujui', q.quote_no), auth.uid());
    end if;
  end if;
  return ops_core.ok('project','quotation', q.quote_no, case when p_accepted then 'accept' else 'reject' end,
    jsonb_build_object('quote_no', q.quote_no, 'project_code', pr.code, 'order_lines_added', v_added));
end $function$;

analyze ops_procure.quotation_lines;
analyze ops_procure.project_lines;
