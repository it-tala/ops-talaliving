-- 0133_procure_quotations.sql — the quotation: from a released BOM to a price
-- the client can say yes to.
--
-- D240 said *no quotation model* (Q37: *saat ini tidak perlu*), and gave the
-- reason a half-model would be worse than none: a quotation is a document with
-- lines, revisions and an expiry. The owner reopened it on 2026-09-23 — *setelah
-- BOM jadi, project manager memberikan quotation ke customer* — so it is built
-- whole, as its own document, not as columns on the project.
--
-- The chain it closes: the BOM gives the production cost per unit (0109); the
-- PM adds marketing, overhead and a margin; the result is a selling price; the
-- client accepts, and the lines become the order (0111), which becomes Job
-- Orders (0130), which are delivered and handed over (0132).
--
-- Four rules, and each is the owner's answer or the reason a number can be
-- trusted later:
--
--   **Margin is of the selling price** (owner, 2026-09-23). Marketing and
--   overhead load the cost; the margin is then taken out of the price:
--     price = cost × (1 + marketing% + overhead%) ÷ (1 − margin%)
--   so *margin 20%* means 20% of what the client pays, the figure a profit
--   report will show — not a 20% markup, which is 16.7% of the price.
--
--   **Nothing is priced from a cost nobody has.** A line's cost is the
--   product's released BOM cost, or a figure typed by hand and marked as such.
--   A quotation with a line that has neither cannot be sent (D149's rule for
--   the BOM, one step on).
--
--   **Sending freezes it.** Cost, price and percentages are copied onto the
--   lines at the moment it goes out. The BOM will be revised; the offer the
--   client holds must not move with it. A change after that is a new revision,
--   and the old one stays readable.
--
--   **Accepting makes the order.** The frozen lines become order lines at the
--   quoted price, marked with the quotation line they came from so it cannot
--   happen twice, and the project moves to DEAL — logged, like every move.
--
-- PPN is optional per quotation (owner): a flag and a rate, shown as its own
-- line under the subtotal. Cost and margin are read by `project.update`
-- only; everybody else with `project.read` sees the price.

insert into ops_core.doc_prefixes (prefix, what) values ('qt', 'quotation')
on conflict (prefix) do nothing;

create type ops_procure.quotation_status_t as enum ('DRAFT','SENT','ACCEPTED','REJECTED','SUPERSEDED');

create table ops_procure.quotations (
  id               uuid primary key default gen_random_uuid(),
  quote_no         text not null unique default ops_core.next_doc_number('qt'),
  project_id       uuid not null references ops_procure.projects(id),
  rev              int not null default 1 check (rev > 0),
  supersedes_id    uuid references ops_procure.quotations(id),
  status           ops_procure.quotation_status_t not null default 'DRAFT',
  valid_until      date,
  -- The defaults every line uses unless it says otherwise. Percent, 0–100.
  marketing_pct    numeric not null default 0 check (marketing_pct >= 0 and marketing_pct < 100),
  overhead_pct     numeric not null default 0 check (overhead_pct >= 0 and overhead_pct < 100),
  margin_pct       numeric not null default 0 check (margin_pct >= 0 and margin_pct < 100),
  vat              boolean not null default false,
  vat_pct          numeric not null default 11 check (vat_pct >= 0 and vat_pct < 100),
  terms            text,
  note             text,
  sent_at          timestamptz,
  sent_by          uuid references ops_core.users(id),
  decided_at       timestamptz,
  decided_by       uuid references ops_core.users(id),
  decision_reason  text,
  created_by       uuid references ops_core.users(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint rev_once unique (project_id, rev),
  constraint sent_is_signed check (status = 'DRAFT' or (sent_at is not null)),
  constraint rejection_says_why check (
    status <> 'REJECTED' or (decision_reason is not null and length(btrim(decision_reason)) > 0))
);
create index quotations_project_idx on ops_procure.quotations (project_id, rev desc);

create table ops_procure.quotation_lines (
  id                 uuid primary key default gen_random_uuid(),
  quotation_id       uuid not null references ops_procure.quotations(id) on delete cascade,
  line_no            int not null,
  -- A code at the seam, like an order line's (ADR-004).
  product_code       text,
  description        text not null check (length(btrim(description)) > 0),
  qty                numeric not null check (qty > 0),
  uom                text not null,
  -- How long this takes to make. Defaults from the product's lead time.
  lead_time_days     int check (lead_time_days is null or lead_time_days >= 0),
  -- A cost typed by hand, for a line with no released BOM. Null means *read
  -- it from the BOM*.
  manual_unit_cost   numeric check (manual_unit_cost is null or manual_unit_cost >= 0),
  -- Per-line overrides of the quotation's percentages. Null = the default.
  marketing_pct      numeric check (marketing_pct is null or (marketing_pct >= 0 and marketing_pct < 100)),
  overhead_pct       numeric check (overhead_pct is null or (overhead_pct >= 0 and overhead_pct < 100)),
  margin_pct         numeric check (margin_pct is null or (margin_pct >= 0 and margin_pct < 100)),
  -- The price the PM settled on, where it differs from the computed one (a
  -- rounding, a negotiated figure). The computed one stays visible beside it.
  unit_price_override numeric check (unit_price_override is null or unit_price_override >= 0),
  note               text,
  -- Frozen at send: what the offer actually said.
  frozen_unit_cost   numeric,
  frozen_cost_source text,
  frozen_bom_rev     int,
  frozen_marketing_pct numeric,
  frozen_overhead_pct  numeric,
  frozen_margin_pct    numeric,
  frozen_unit_price  numeric,
  constraint line_no_once unique (quotation_id, line_no)
);

-- An order line made from an accepted quotation line, so accepting twice
-- cannot order twice.
alter table ops_procure.project_lines
  add column if not exists quotation_line_id uuid references ops_procure.quotation_lines(id);
create unique index if not exists project_lines_from_quote_idx
  on ops_procure.project_lines (quotation_line_id) where quotation_line_id is not null;

-- ── the one formula ───────────────────────────────────────────────────────
create or replace function ops_procure.quote_price(
  p_cost numeric, p_marketing_pct numeric, p_overhead_pct numeric, p_margin_pct numeric)
returns numeric
language sql immutable as $$
  select case when p_cost is null then null
              else round(p_cost * (1 + (coalesce(p_marketing_pct, 0) + coalesce(p_overhead_pct, 0)) / 100)
                         / (1 - coalesce(p_margin_pct, 0) / 100)) end
$$;
grant execute on function ops_procure.quote_price(numeric, numeric, numeric, numeric) to authenticated;

-- ── reading ───────────────────────────────────────────────────────────────
alter table ops_procure.quotations      enable row level security;
alter table ops_procure.quotation_lines enable row level security;
create policy quotations_read on ops_procure.quotations for select to authenticated
  using (ops_core.has_permission('project.read'));
create policy qlines_read on ops_procure.quotation_lines for select to authenticated
  using (ops_core.has_permission('project.read'));
grant select on ops_procure.quotations, ops_procure.quotation_lines to authenticated;

-- The cost a quotation may use: the **released** revision's, never a draft's.
-- A draft is somebody's working copy, and a price quoted from it moves when
-- they save. Released revisions freeze their rates (0109), so this is stable.
create or replace view ops_procure.released_cost as
select p.id as product_id, p.product_code, p.name, p.lead_time_days,
       r.rev, pc.production_cost
  from ops_prod.products p
  left join lateral (select ops_prod.released_rev(p.id) as rev) r on true
  left join ops_prod.v_product_cost pc on pc.product_id = p.id and pc.rev = r.rev;

-- One line as it stands: live from the BOM while a draft, frozen once sent.
-- Cost and margin are withheld from anybody without `project.update` — null,
-- and `cost_visible` says why, never a zero that reads as *free*.
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
    coalesce(l.margin_pct,    q.margin_pct)                  as eff_margin_pct
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
       else x.frozen_unit_price end                          as unit_price
from live x;

create or replace view ops_procure.v_quotation as
select
  q.*,
  p.code                                         as project_code,
  p.name                                         as project_name,
  coalesce(c.name, p.client_name)                as client_name,
  c.contact_name                                 as client_contact,
  c.address                                      as client_address,
  p.location,
  coalesce(t.lines, 0)                           as line_count,
  coalesce(t.missing, 0)                         as lines_without_cost,
  t.subtotal,
  case when q.vat and t.subtotal is not null then round(t.subtotal * q.vat_pct / 100) end as vat_amount,
  case when t.subtotal is null then null
       else t.subtotal + case when q.vat then round(t.subtotal * q.vat_pct / 100) else 0 end end as grand_total,
  case when ops_core.has_permission('project.update') then t.cost_total end              as cost_total,
  t.max_lead_time_days,
  (q.status = 'SENT' and q.valid_until is not null and q.valid_until < ops_core.office_day()) as expired,
  (q.status in ('DRAFT','SENT')
   and not exists (select 1 from ops_procure.quotations n where n.supersedes_id = q.id)) as is_current
from ops_procure.quotations q
join ops_procure.projects p on p.id = q.project_id
left join ops_procure.clients c on c.id = p.client_id
left join lateral (
  select count(*)::int                                   as lines,
         count(*) filter (where v.cost_missing)::int     as missing,
         case when count(*) = 0 or count(*) filter (where v.unit_price is null) > 0 then null
              else sum(v.unit_price * v.qty) end         as subtotal,
         case when count(*) filter (where v.unit_cost is null) > 0 then null
              else sum(v.unit_cost * v.qty) end          as cost_total,
         max(v.lead_time_days)                           as max_lead_time_days
    from ops_procure.v_quotation_line v where v.quotation_id = q.id
) t on true;

alter view ops_procure.released_cost    set (security_invoker = on);
alter view ops_procure.v_quotation_line set (security_invoker = on);
alter view ops_procure.v_quotation      set (security_invoker = on);
grant select on ops_procure.released_cost, ops_procure.v_quotation_line, ops_procure.v_quotation to authenticated;

-- ── writing ───────────────────────────────────────────────────────────────

-- A new quotation for a project (p_quote_no null), or the draft's header.
create or replace function ops_procure.save_quotation(
  p_quote_no text, p_project_code text default null,
  p_valid_until date default null,
  p_marketing_pct numeric default 0, p_overhead_pct numeric default 0, p_margin_pct numeric default 0,
  p_vat boolean default false, p_vat_pct numeric default 11,
  p_terms text default null, p_note text default null, p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
declare q ops_procure.quotations; pr ops_procure.projects; v_rev int; res jsonb; replayed jsonb;
begin
  replayed := ops_core.idem_replay('project', 'save_quotation', p_key);
  if replayed is not null then return replayed; end if;

  if coalesce(p_marketing_pct, 0) < 0 or coalesce(p_overhead_pct, 0) < 0 or coalesce(p_margin_pct, 0) < 0
     or coalesce(p_marketing_pct, 0) >= 100 or coalesce(p_overhead_pct, 0) >= 100 or coalesce(p_margin_pct, 0) >= 100 then
    return ops_core.invalid('project','quotation', p_quote_no,'save', 'bad_percent',
      'Persentase harus 0 sampai di bawah 100.', jsonb_build_object('field','margin_pct'));
  end if;

  if p_quote_no is null or btrim(p_quote_no) = '' then
    if not ops_core.has_permission('project.create') then
      return ops_core.refused('project','quotation', null,'create',
        'not_permitted','Membuat quotation butuh akses proyek (create).');
    end if;
    select * into pr from ops_procure.projects where code = p_project_code;
    if not found then
      return ops_core.not_found('project','quotation', null,'create', format('Tidak ada proyek %s.', p_project_code));
    end if;
    if exists (select 1 from ops_procure.quotations where project_id = pr.id and status = 'DRAFT') then
      return ops_core.conflict('project','quotation', null,'create', 'draft_exists',
        format('Proyek %s sudah punya quotation draft. Lanjutkan yang itu.', pr.code),
        jsonb_build_object('quote_no', (select quote_no from ops_procure.quotations where project_id = pr.id and status = 'DRAFT' limit 1)));
    end if;
    select coalesce(max(rev), 0) + 1 into v_rev from ops_procure.quotations where project_id = pr.id;
    insert into ops_procure.quotations (project_id, rev, valid_until, marketing_pct, overhead_pct, margin_pct,
                                        vat, vat_pct, terms, note, created_by)
    values (pr.id, v_rev, coalesce(p_valid_until, ops_core.office_day() + 30),
            coalesce(p_marketing_pct, 0), coalesce(p_overhead_pct, 0), coalesce(p_margin_pct, 0),
            coalesce(p_vat, false), coalesce(p_vat_pct, 11), nullif(btrim(p_terms), ''), nullif(btrim(p_note), ''), auth.uid())
    returning * into q;
    res := ops_core.ok('project','quotation', q.quote_no,'create', jsonb_build_object('quote_no', q.quote_no));
    return ops_core.idem_remember('project', 'save_quotation', p_key, res);
  end if;

  if not ops_core.has_permission('project.update') then
    return ops_core.refused('project','quotation', p_quote_no,'update',
      'not_permitted','Mengubah quotation butuh akses proyek (update).');
  end if;
  select * into q from ops_procure.quotations where quote_no = p_quote_no;
  if not found then
    return ops_core.not_found('project','quotation', p_quote_no,'update', format('Tidak ada quotation %s.', p_quote_no));
  end if;
  if q.status <> 'DRAFT' then
    return ops_core.conflict('project','quotation', p_quote_no,'update', 'not_draft',
      format('%s sudah %s — angka yang sudah dikirim tidak diubah. Buat revisi.', q.quote_no, q.status));
  end if;
  update ops_procure.quotations set
    valid_until = p_valid_until, marketing_pct = coalesce(p_marketing_pct, 0),
    overhead_pct = coalesce(p_overhead_pct, 0), margin_pct = coalesce(p_margin_pct, 0),
    vat = coalesce(p_vat, false), vat_pct = coalesce(p_vat_pct, 11),
    terms = nullif(btrim(p_terms), ''), note = nullif(btrim(p_note), ''), updated_at = now()
  where id = q.id;
  return ops_core.ok('project','quotation', q.quote_no,'update', jsonb_build_object('quote_no', q.quote_no));
end $$;

create or replace function ops_procure.save_quotation_line(
  p_quote_no text, p_line_id uuid default null,
  p_product_code text default null, p_description text default null,
  p_qty numeric default null, p_uom text default 'unit',
  p_lead_time_days int default null, p_manual_unit_cost numeric default null,
  p_marketing_pct numeric default null, p_overhead_pct numeric default null, p_margin_pct numeric default null,
  p_unit_price_override numeric default null, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
declare q ops_procure.quotations; v_code text := nullif(upper(btrim(coalesce(p_product_code, ''))), '');
        v_desc text := btrim(coalesce(p_description, '')); v_id uuid; v_no int; v_name text;
begin
  if not ops_core.has_permission('project.update') then
    return ops_core.refused('project','quotation', p_quote_no,'save_line',
      'not_permitted','Mengubah quotation butuh akses proyek (update).');
  end if;
  select * into q from ops_procure.quotations where quote_no = p_quote_no;
  if not found then
    return ops_core.not_found('project','quotation', p_quote_no,'save_line', format('Tidak ada quotation %s.', p_quote_no));
  end if;
  if q.status <> 'DRAFT' then
    return ops_core.conflict('project','quotation', p_quote_no,'save_line', 'not_draft',
      format('%s sudah %s. Buat revisi untuk mengubah isinya.', q.quote_no, q.status));
  end if;
  if v_code is not null then
    select name into v_name from ops_prod.products where product_code = v_code;
    if v_name is null then
      return ops_core.invalid('project','quotation', p_quote_no,'save_line', 'product_not_found',
        format('Tidak ada item code %s di katalog.', v_code), jsonb_build_object('field','product_code'));
    end if;
    if v_desc = '' then v_desc := v_name; end if;
  end if;
  if v_desc = '' then
    return ops_core.invalid('project','quotation', p_quote_no,'save_line', 'description_required',
      'Itemnya apa? Klien membaca baris ini.', jsonb_build_object('field','description'));
  end if;
  if p_qty is null or p_qty <= 0 then
    return ops_core.invalid('project','quotation', p_quote_no,'save_line', 'qty_required',
      'Berapa unit?', jsonb_build_object('field','qty'));
  end if;
  if not exists (select 1 from ops_procure.uom where code = p_uom) then
    return ops_core.invalid('project','quotation', p_quote_no,'save_line', 'no_such_uom',
      format('Tidak ada satuan %s.', p_uom), jsonb_build_object('field','uom'));
  end if;
  if coalesce(p_manual_unit_cost, 0) < 0 or coalesce(p_unit_price_override, 0) < 0 then
    return ops_core.invalid('project','quotation', p_quote_no,'save_line', 'negative',
      'Ongkos dan harga tidak bisa negatif.', jsonb_build_object('field','manual_unit_cost'));
  end if;
  if coalesce(p_marketing_pct, 0) not between 0 and 99.99 or coalesce(p_overhead_pct, 0) not between 0 and 99.99
     or coalesce(p_margin_pct, 0) not between 0 and 99.99 then
    return ops_core.invalid('project','quotation', p_quote_no,'save_line', 'bad_percent',
      'Persentase harus 0 sampai di bawah 100.', jsonb_build_object('field','margin_pct'));
  end if;

  if p_line_id is not null then
    update ops_procure.quotation_lines set
      product_code = v_code, description = v_desc, qty = p_qty, uom = p_uom,
      lead_time_days = p_lead_time_days, manual_unit_cost = p_manual_unit_cost,
      marketing_pct = p_marketing_pct, overhead_pct = p_overhead_pct, margin_pct = p_margin_pct,
      unit_price_override = p_unit_price_override, note = nullif(btrim(p_note), '')
    where id = p_line_id and quotation_id = q.id
    returning id into v_id;
    if v_id is null then
      return ops_core.not_found('project','quotation', p_quote_no,'save_line', 'Baris itu tidak ada.');
    end if;
  else
    select coalesce(max(line_no), 0) + 1 into v_no from ops_procure.quotation_lines where quotation_id = q.id;
    insert into ops_procure.quotation_lines
      (quotation_id, line_no, product_code, description, qty, uom, lead_time_days, manual_unit_cost,
       marketing_pct, overhead_pct, margin_pct, unit_price_override, note)
    values (q.id, v_no, v_code, v_desc, p_qty, p_uom, p_lead_time_days, p_manual_unit_cost,
            p_marketing_pct, p_overhead_pct, p_margin_pct, p_unit_price_override, nullif(btrim(p_note), ''))
    returning id into v_id;
  end if;
  update ops_procure.quotations set updated_at = now() where id = q.id;
  return ops_core.ok('project','quotation', q.quote_no,
    case when p_line_id is null then 'add_line' else 'update_line' end,
    jsonb_build_object('quote_no', q.quote_no, 'line_id', v_id));
end $$;

create or replace function ops_procure.remove_quotation_line(p_quote_no text, p_line_id uuid)
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
declare q ops_procure.quotations;
begin
  if not ops_core.has_permission('project.update') then
    return ops_core.refused('project','quotation', p_quote_no,'remove_line',
      'not_permitted','Mengubah quotation butuh akses proyek (update).');
  end if;
  select * into q from ops_procure.quotations where quote_no = p_quote_no;
  if not found then
    return ops_core.not_found('project','quotation', p_quote_no,'remove_line', format('Tidak ada quotation %s.', p_quote_no));
  end if;
  if q.status <> 'DRAFT' then
    return ops_core.conflict('project','quotation', p_quote_no,'remove_line', 'not_draft',
      format('%s sudah %s. Buat revisi untuk mengubah isinya.', q.quote_no, q.status));
  end if;
  delete from ops_procure.quotation_lines where id = p_line_id and quotation_id = q.id;
  if not found then
    return ops_core.not_found('project','quotation', p_quote_no,'remove_line', 'Baris itu tidak ada.');
  end if;
  -- Numbers stay contiguous for the printed page.
  update ops_procure.quotation_lines l set line_no = r.n
    from (select id, row_number() over (order by line_no) as n from ops_procure.quotation_lines where quotation_id = q.id) r
   where l.id = r.id and l.line_no <> r.n;
  return ops_core.ok('project','quotation', q.quote_no,'remove_line', jsonb_build_object('quote_no', q.quote_no));
end $$;

-- Sending: freeze every figure, and the project is now waiting on the client.
create or replace function ops_procure.send_quotation(p_quote_no text)
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
declare q ops_procure.quotations; pr ops_procure.projects; v_missing text; v_n int;
begin
  if not ops_core.has_permission('project.update') then
    return ops_core.refused('project','quotation', p_quote_no,'send',
      'not_permitted','Mengirim quotation butuh akses proyek (update).');
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
    frozen_unit_price = coalesce(l.unit_price_override, ops_procure.quote_price(v.unit_cost_raw, v.mkt, v.ovh, v.mrg))
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
end $$;

-- A new revision from a sent or rejected one: a fresh draft with the same
-- lines, the old one marked superseded and kept.
create or replace function ops_procure.revise_quotation(p_quote_no text)
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
declare q ops_procure.quotations; n ops_procure.quotations; v_rev int;
begin
  if not ops_core.has_permission('project.update') then
    return ops_core.refused('project','quotation', p_quote_no,'revise',
      'not_permitted','Merevisi quotation butuh akses proyek (update).');
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
  insert into ops_procure.quotation_lines (quotation_id, line_no, product_code, description, qty, uom, lead_time_days,
    manual_unit_cost, marketing_pct, overhead_pct, margin_pct, unit_price_override, note)
  select n.id, line_no, product_code, description, qty, uom, lead_time_days,
         manual_unit_cost, marketing_pct, overhead_pct, margin_pct, unit_price_override, note
    from ops_procure.quotation_lines where quotation_id = q.id;
  if q.status = 'SENT' then
    update ops_procure.quotations set status = 'SUPERSEDED', updated_at = now() where id = q.id;
  end if;
  return ops_core.ok('project','quotation', n.quote_no,'revise',
    jsonb_build_object('quote_no', n.quote_no, 'rev', n.rev, 'from', q.quote_no));
end $$;

-- The client's answer. Yes makes the order; no says why.
create or replace function ops_procure.decide_quotation(p_quote_no text, p_accepted boolean, p_reason text default null)
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
declare q ops_procure.quotations; pr ops_procure.projects; v_next int; v_added int := 0;
begin
  if not ops_core.has_permission('project.update') then
    return ops_core.refused('project','quotation', p_quote_no,'decide',
      'not_permitted','Mencatat jawaban klien butuh akses proyek (update).');
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
    insert into ops_procure.project_lines (project_id, line_no, product_code, description, qty, uom, unit_price,
                                           note, quotation_line_id)
    select pr.id, v_next + row_number() over (order by l.line_no), l.product_code, l.description, l.qty, l.uom,
           l.frozen_unit_price, format('dari %s', q.quote_no), l.id
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
end $$;

grant execute on function
  ops_procure.save_quotation(text, text, date, numeric, numeric, numeric, boolean, numeric, text, text, text),
  ops_procure.save_quotation_line(text, uuid, text, text, numeric, text, int, numeric, numeric, numeric, numeric, numeric, text),
  ops_procure.remove_quotation_line(text, uuid),
  ops_procure.send_quotation(text),
  ops_procure.revise_quotation(text),
  ops_procure.decide_quotation(text, boolean, text)
  to authenticated;

-- Signed-in callers only (`core_execute_grants`).
revoke execute on function
  ops_procure.save_quotation(text, text, date, numeric, numeric, numeric, boolean, numeric, text, text, text),
  ops_procure.save_quotation_line(text, uuid, text, text, numeric, text, int, numeric, numeric, numeric, numeric, numeric, text),
  ops_procure.remove_quotation_line(text, uuid),
  ops_procure.send_quotation(text),
  ops_procure.revise_quotation(text),
  ops_procure.decide_quotation(text, boolean, text)
  from public;
