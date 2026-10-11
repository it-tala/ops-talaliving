-- 0256_procure_factory_quotes.sql — factory prices per design item, and a
-- quotation in IDR or USD (O2, kajian F255 §5.3, D414, D415).
--
-- TALA works as an agent: it finds the order, a partner factory makes it.
-- Before a quotation can be priced the factory has to be asked — the
-- drawings and the BOM go out, a price per item comes back. Until now that
-- answer lived in WhatsApp, and a quotation could only be costed from our own
-- BOM or a figure typed by hand (G3).
--
--   vendors.kind                 supplier (default) · factory · qc · other.
--                                Nothing in the 305 existing vendors moves; a
--                                factory is marked, by hand on Master data ›
--                                Suppliers, or by having a price recorded.
--   factory_quotes               one offer from one factory for one project:
--                                currency, date, valid until, the factory's
--                                own paper. Append-only; a mistake is voided
--                                with a reason, never edited (A3).
--   factory_quote_lines          the price per design item, lead time, MOQ.
--   design_items.factory_line_id the offer the item is priced from. The first
--                                offer for an item is chosen on its own; a
--                                newer offer from the factory already chosen
--                                takes over; choosing another factory is one
--                                click. Nobody has to remember to pick.
--
-- A quotation line's cost now has three sources, in this order: a figure
-- typed by hand, the chosen factory offer of the design item it offers, the
-- product's released BOM. Sending freezes which offer (`frozen_factory_line_id`)
-- the way it already froze the BOM revision.
--
-- **Currency (D414).** A quotation is in IDR or USD, and so is a factory
-- offer; every line follows its document and no total adds the two. Where a
-- cost is in the other currency the quotation's **kurs** (rupiah per 1 USD,
-- typed by a person, never fetched — D181) converts it. A USD quotation cannot
-- be sent without its kurs, because that kurs is what reads it in rupiah: the
-- pipeline, the value of a won project, and the order lines an accepted offer
-- becomes are rupiah, at the kurs the offer was made at. A USD price is
-- rounded to the cent, a rupiah price to the rupiah.
--
-- Who sees what (D415): factory prices are procurement's to record (Q90) and
-- are shown to procurement and to whoever may see a quotation's cost
-- (`project.update`, D375). The database also lets a seller read them, because
-- a draft's selling price is computed from them under the seller's own
-- permissions — 0133's rule: cost on screen is a screen rule, not a secret.
-- Procurement may now read the design (`may_design('read')`): the drawings are
-- what it sends the factory.
--
-- New fields go through their own seams (F226): `save_quotation` keeps its
-- signature. Views keep every column they had, in order, and gain new ones
-- last. Applying to production: no drops, and no function body here removes
-- rows.

-- ── 1. what kind of vendor ─────────────────────────────────────────────────

alter table ops_procure.vendors
  add column if not exists kind text not null default 'supplier'
    constraint vendor_kind_known check (kind in ('supplier','factory','qc','other'));
comment on column ops_procure.vendors.kind is
  'supplier (default), factory (a partner factory that makes an order for us), qc (an outsourced QC person or firm), other. (0256, O2)';
create index if not exists vendors_kind_idx on ops_procure.vendors (kind) where kind <> 'supplier';

-- Whoever records or reads factory prices: procurement (Q90), and whoever sees
-- a quotation's cost (D375).
create or replace function ops_procure.may_price_factory(p_level text)
returns boolean
language sql stable set search_path = ops_procure, ops_core, pg_temp as $$
  select ops_core.has_permission('procurement.' || p_level)
      or ops_core.has_permission('project.update');
$$;
revoke all on function ops_procure.may_price_factory(text) from public;
grant execute on function ops_procure.may_price_factory(text) to authenticated;
comment on function ops_procure.may_price_factory(text) is
  'Procurement at the level asked, or project.update (who sees a quotation''s cost). Factory prices. (0256, O2)';

-- A project editor reads the factories, so an offer can say whose it is.
create policy vendors_read_factories on ops_procure.vendors for select to authenticated
  using (kind = 'factory' and ops_procure.may_price_factory('read'));

create or replace function ops_procure.set_vendor_kind(p_code text, p_kind text)
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
declare v ops_procure.vendors; v_kind text := lower(btrim(coalesce(p_kind, '')));
begin
  if not ops_core.has_permission('procurement.update') then
    return ops_core.refused('procurement','vendor', p_code,'set_kind',
      'not_permitted','Mengubah jenis vendor butuh akses procurement (update).');
  end if;
  if v_kind not in ('supplier','factory','qc','other') then
    return ops_core.invalid('procurement','vendor', p_code,'set_kind', 'bad_kind',
      'Jenis vendor: supplier, factory (pabrik), qc, atau other.', jsonb_build_object('field','kind'));
  end if;
  select * into v from ops_procure.vendors where code = btrim(coalesce(p_code, ''));
  if not found then
    return ops_core.not_found('procurement','vendor', p_code,'set_kind', format('Tidak ada vendor %s.', p_code));
  end if;
  if v.merged_into is not null then
    return ops_core.conflict('procurement','vendor', v.code,'set_kind', 'merged',
      format('%s sudah digabung ke vendor lain — ubah vendor yang dipakai sekarang.', v.name));
  end if;
  if v.kind = v_kind then
    return ops_core.noop('procurement','vendor', v.code,'set_kind', 'Jenisnya sudah itu.',
      jsonb_build_object('code', v.code, 'kind', v_kind));
  end if;
  update ops_procure.vendors set kind = v_kind, updated_at = now() where id = v.id;
  return ops_core.ok('procurement','vendor', v.code,'set_kind',
    jsonb_build_object('code', v.code, 'kind', v_kind),
    jsonb_build_object('kind', v.kind), jsonb_build_object('kind', v_kind));
end $$;
revoke all on function ops_procure.set_vendor_kind(text, text) from public;
grant execute on function ops_procure.set_vendor_kind(text, text) to authenticated;

-- `v_vendor_view` keeps every column and gains `kind` last.
create or replace view ops_procure.v_vendor_view as
 SELECT v.id,
    v.code,
    v.name,
    v.aka,
    v.merged_into,
    v.is_curated,
    v.phone,
    v.address,
    v.pic_name,
    v.pic_phone,
    v.bank_account,
    v.bank_account_secondary,
    v.npwp,
    v.supplied_categories,
    v.created_by,
    v.created_at,
    v.updated_at,
    v.archived_at,
    v.archived_by,
    COALESCE(( SELECT array_agg(COALESCE(c.name, s.sc) ORDER BY s.ord) AS array_agg
           FROM unnest(v.supplied_categories) WITH ORDINALITY s(sc, ord)
             LEFT JOIN ops_procure.item_categories c ON c.code = s.sc), '{}'::text[]) AS supplied_category_names,
    COALESCE(t.transaction_count, 0::bigint) AS transaction_count,
    COALESCE(t.total_spend, 0::numeric) AS total_spend,
    t.last_purchase,
    COALESCE(o.open_pr_lines, 0::bigint) AS open_pr_lines,
    COALESCE(( SELECT jsonb_agg(to_jsonb(a.*) ORDER BY a.name) AS jsonb_agg
           FROM ops_procure.vendors a
          WHERE a.merged_into = v.id), '[]'::jsonb) AS absorbed,
    COALESCE(( SELECT jsonb_agg(jsonb_build_object('code', f.category_code, 'name', COALESCE(c.name, f.category_code), 'count', f.cnt) ORDER BY f.cnt DESC, f.category_code) AS jsonb_agg
           FROM ( SELECT pf.category_code,
                    count(*) AS cnt
                   FROM ops_procure.v_purchase_facts pf
                  WHERE pf.vendor_id = v.id
                  GROUP BY pf.category_code) f
             LEFT JOIN ops_procure.item_categories c ON c.code = f.category_code), '[]'::jsonb) AS bought_categories,
    COALESCE(( SELECT jsonb_agg(jsonb_build_object('item_id', s.item_id, 'item_name', s.item_name, 'last_price', s.last_price, 'uom', s.uom, 'last_date', s.last_date, 'times', s.times) ORDER BY s.last_date DESC) AS jsonb_agg
           FROM ( SELECT pf.item_id,
                    max(pf.item_name) AS item_name,
                    (array_agg(pf.unit_price ORDER BY pf.at DESC))[1] AS last_price,
                    (array_agg(pf.uom ORDER BY pf.at DESC))[1] AS uom,
                    max(pf.at) AS last_date,
                    count(*) AS times
                   FROM ops_procure.v_purchase_facts pf
                  WHERE pf.vendor_id = v.id
                  GROUP BY pf.item_id) s), '[]'::jsonb) AS items_bought,
    -- O2 (0256).
    v.kind
   FROM ops_procure.vendors v
     LEFT JOIN ( SELECT f.vendor_id,
            count(*) AS transaction_count,
            sum(t_1.amount_idr) FILTER (WHERE t_1.direction = 'OUT'::ops_acct.direction_t) AS total_spend,
            max(t_1.trx_date) AS last_purchase
           FROM ops_procure.v_vendor_fold f
             JOIN ops_acct.transactions t_1 ON t_1.vendor_id = f.any_id AND t_1.status <> 'VOID'::ops_acct.trx_status_t
          GROUP BY f.vendor_id) t ON t.vendor_id = v.id
     LEFT JOIN ( SELECT f.vendor_id,
            count(*) AS open_pr_lines
           FROM ops_procure.v_vendor_fold f
             JOIN ops_procure.v_pr_line l ON l.vendor_id = f.any_id
          WHERE l.removed_at IS NULL AND l.status <> 'COMPLETED'::ops_procure.line_status_t AND (l.doc_status <> ALL (ARRAY['DRAFT'::ops_procure.pr_doc_status_t, 'CANCELLED'::ops_procure.pr_doc_status_t]))
          GROUP BY f.vendor_id) o ON o.vendor_id = v.id;
alter view ops_procure.v_vendor_view set (security_invoker = on);
grant select on ops_procure.v_vendor_view to authenticated;

-- ── 2. procurement reads the design it asks prices for ────────────────────

create or replace function ops_procure.may_design(p_level text)
returns boolean
language sql stable set search_path = ops_procure, ops_core, pg_temp as $$
  select ops_procure.may_sell(p_level)
      or ops_core.has_permission('production.' || p_level)
      -- The drawings are what procurement sends a factory (O2, Q90).
      or (p_level = 'read' and ops_core.has_permission('procurement.read'));
$$;
revoke all on function ops_procure.may_design(text) from public;
grant execute on function ops_procure.may_design(text) to authenticated;
comment on function ops_procure.may_design(text) is
  'Whoever sells (D375) and the drafters (production) at the level asked; procurement reads (0256, O2).';

-- ── 3. a factory's offer ──────────────────────────────────────────────────

insert into ops_core.doc_prefixes (prefix, what) values ('fq', 'factory quotation (penawaran pabrik)')
on conflict (prefix) do nothing;

create table ops_procure.factory_quotes (
  id            uuid primary key default gen_random_uuid(),
  fq_no         text not null unique default ops_core.next_doc_number('fq'),
  project_id    uuid not null references ops_procure.projects(id),
  vendor_id     uuid not null references ops_procure.vendors(id),
  currency      text not null default 'IDR' constraint fq_currency_known check (currency in ('IDR','USD')),
  -- The day the factory gave the price. *The newest* offer from a factory is
  -- read by this date, then by when it was recorded.
  quoted_on     date not null default ops_core.office_day(),
  valid_until   date,
  note          text,
  -- The factory's own paper, in PROCUREMENT › ops-talaliving › PENAWARAN
  -- PABRIK › client › project (D313).
  attachment_id uuid references ops_core.attachments(id),
  created_by    uuid references ops_core.users(id),
  created_at    timestamptz not null default now(),
  voided_at     timestamptz,
  voided_by     uuid references ops_core.users(id),
  void_reason   text,
  constraint fq_void_says_why check (voided_at is null or length(btrim(coalesce(void_reason, ''))) > 0),
  constraint fq_valid_after_quote check (valid_until is null or valid_until >= quoted_on)
);
create index factory_quotes_project_idx on ops_procure.factory_quotes (project_id, quoted_on desc);
create index factory_quotes_vendor_idx on ops_procure.factory_quotes (vendor_id);

create table ops_procure.factory_quote_lines (
  id             uuid primary key default gen_random_uuid(),
  quote_id       uuid not null references ops_procure.factory_quotes(id),
  design_item_id uuid not null references ops_procure.design_items(id),
  -- In the offer's currency.
  unit_price     numeric not null check (unit_price > 0),
  lead_time_days int check (lead_time_days is null or lead_time_days >= 0),
  moq            numeric check (moq is null or moq > 0),
  note           text,
  constraint fql_item_once unique (quote_id, design_item_id)
);
create index factory_quote_lines_item_idx on ops_procure.factory_quote_lines (design_item_id);

alter table ops_procure.design_items
  add column if not exists factory_line_id uuid references ops_procure.factory_quote_lines(id);
comment on column ops_procure.design_items.factory_line_id is
  'The factory offer the item is priced from: the first one on its own, a newer one from the same factory after it, another by choice. (0256, O2)';

alter table ops_procure.factory_quotes      enable row level security;
alter table ops_procure.factory_quote_lines enable row level security;
-- Sellers too: a draft's price is computed from the chosen offer under the
-- reader's own permissions (0133: cost on screen is a screen rule).
create policy factory_quotes_read on ops_procure.factory_quotes for select to authenticated
  using (ops_procure.may_price_factory('read') or ops_procure.may_sell('read'));
create policy factory_quote_lines_read on ops_procure.factory_quote_lines for select to authenticated
  using (ops_procure.may_price_factory('read') or ops_procure.may_sell('read'));
grant select on ops_procure.factory_quotes, ops_procure.factory_quote_lines to authenticated;

-- One offer, with a price for one or more of a project's design items:
--   p_lines = [{"item_no": "26007-A-LR-01", "unit_price": 4250000,
--               "lead_time_days": 45, "moq": null, "note": null}, …]
-- A vendor still marked `supplier` becomes `factory` by being given one.
create or replace function ops_procure.record_factory_quote(
  p_project_code  text,
  p_vendor_code   text,
  p_currency      text,
  p_lines         jsonb,
  p_quoted_on     date default null,
  p_valid_until   date default null,
  p_note          text default null,
  p_attachment_id uuid default null,
  p_key           text default null)
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
declare pr ops_procure.projects; v ops_procure.vendors; fq ops_procure.factory_quotes;
        v_cur text := upper(btrim(coalesce(p_currency, 'IDR')));
        v_on date := coalesce(p_quoted_on, ops_core.office_day());
        e jsonb; v_item ops_procure.design_items; v_ids uuid[] := '{}'; v_line uuid;
        v_lines int := 0; v_chosen int := 0; v_n int; v_marked boolean := false;
        replayed jsonb; res jsonb;
begin
  replayed := ops_core.idem_replay('procurement','record_factory_quote', p_key);
  if replayed is not null then return replayed; end if;

  if not ops_procure.may_price_factory('create') then
    return ops_core.refused('procurement','factory_quote', null,'create',
      'not_permitted','Mencatat harga pabrik butuh akses procurement (create) atau pimpinan proyek (project update).');
  end if;
  select * into pr from ops_procure.projects where code = btrim(coalesce(p_project_code, ''));
  if not found then
    return ops_core.not_found('procurement','factory_quote', null,'create', format('Tidak ada proyek %s.', p_project_code));
  end if;
  select * into v from ops_procure.vendors where code = btrim(coalesce(p_vendor_code, ''));
  if not found then
    return ops_core.invalid('procurement','factory_quote', null,'create', 'vendor_unknown',
      format('Tidak ada vendor %s.', p_vendor_code), jsonb_build_object('field','vendor_code'));
  end if;
  if v.merged_into is not null then
    return ops_core.invalid('procurement','factory_quote', null,'create', 'vendor_merged',
      format('%s sudah digabung ke vendor lain — pilih vendor yang dipakai sekarang.', v.name),
      jsonb_build_object('field','vendor_code'));
  end if;
  if v.archived_at is not null then
    return ops_core.invalid('procurement','factory_quote', null,'create', 'vendor_archived',
      format('%s sudah diarsipkan.', v.name), jsonb_build_object('field','vendor_code'));
  end if;
  if v.kind in ('qc','other') then
    return ops_core.invalid('procurement','factory_quote', null,'create', 'not_factory',
      format('%s tercatat sebagai %s, bukan pabrik. Ubah jenisnya di Master data › Supplier kalau memang pabrik.',
             v.name, v.kind), jsonb_build_object('field','vendor_code'));
  end if;
  if v_cur not in ('IDR','USD') then
    return ops_core.invalid('procurement','factory_quote', null,'create', 'bad_currency',
      'Mata uang: IDR atau USD.', jsonb_build_object('field','currency'));
  end if;
  if p_valid_until is not null and p_valid_until < v_on then
    return ops_core.invalid('procurement','factory_quote', null,'create', 'bad_validity',
      'Berlaku sampai tidak bisa sebelum tanggal penawarannya.', jsonb_build_object('field','valid_until'));
  end if;
  if p_attachment_id is not null and not exists (select 1 from ops_core.attachments where id = p_attachment_id) then
    return ops_core.invalid('procurement','factory_quote', null,'create', 'no_such_file',
      'File penawaran itu tidak ada.', jsonb_build_object('field','attachment_id'));
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    return ops_core.invalid('procurement','factory_quote', null,'create', 'no_lines',
      'Harga untuk item mana? Isi minimal satu item.', jsonb_build_object('field','lines'));
  end if;

  -- Every line is checked before anything is written.
  for e in select * from jsonb_array_elements(p_lines) loop
    select i.* into v_item
      from ops_procure.design_items i
      join ops_procure.design_rooms r on r.id = i.room_id
      join ops_procure.design_collections c on c.id = r.collection_id
     where i.item_no = btrim(coalesce(e->>'item_no', '')) and c.project_id = pr.id;
    if not found then
      return ops_core.invalid('procurement','factory_quote', null,'create', 'item_unknown',
        format('%s bukan item desain proyek %s.', coalesce(e->>'item_no', '(kosong)'), pr.code),
        jsonb_build_object('field','item_no','item_no', e->>'item_no'));
    end if;
    if v_item.dropped_at is not null then
      return ops_core.invalid('procurement','factory_quote', null,'create', 'item_dropped',
        format('Item %s sudah dikeluarkan dari desain.', v_item.item_no),
        jsonb_build_object('field','item_no','item_no', v_item.item_no));
    end if;
    if v_item.id = any(v_ids) then
      return ops_core.invalid('procurement','factory_quote', null,'create', 'item_twice',
        format('Item %s tertulis dua kali.', v_item.item_no),
        jsonb_build_object('field','item_no','item_no', v_item.item_no));
    end if;
    -- `case`, not `or`: SQL does not promise to stop at the first true, and a
    -- cast of a string that is not a number throws.
    if (case when jsonb_typeof(e->'unit_price') = 'number' then (e->>'unit_price')::numeric <= 0 else true end) then
      return ops_core.invalid('procurement','factory_quote', null,'create', 'bad_price',
        format('Harga satuan item %s harus lebih dari 0.', v_item.item_no),
        jsonb_build_object('field','unit_price','item_no', v_item.item_no));
    end if;
    if (case jsonb_typeof(e->'lead_time_days')
             when 'number' then (e->>'lead_time_days')::numeric < 0
                             or (e->>'lead_time_days')::numeric <> trunc((e->>'lead_time_days')::numeric)
             when 'null' then false
             else e ? 'lead_time_days' end) then
      return ops_core.invalid('procurement','factory_quote', null,'create', 'bad_lead_time',
        format('Lead time item %s: jumlah hari, 0 atau lebih.', v_item.item_no),
        jsonb_build_object('field','lead_time_days','item_no', v_item.item_no));
    end if;
    if (case jsonb_typeof(e->'moq')
             when 'number' then (e->>'moq')::numeric <= 0
             when 'null' then false
             else e ? 'moq' end) then
      return ops_core.invalid('procurement','factory_quote', null,'create', 'bad_moq',
        format('MOQ item %s harus lebih dari 0, atau kosong.', v_item.item_no),
        jsonb_build_object('field','moq','item_no', v_item.item_no));
    end if;
    v_ids := v_ids || v_item.id;
  end loop;

  if v.kind = 'supplier' then
    update ops_procure.vendors set kind = 'factory', updated_at = now() where id = v.id;
    v_marked := true;
  end if;

  insert into ops_procure.factory_quotes (project_id, vendor_id, currency, quoted_on, valid_until, note,
                                          attachment_id, created_by)
  values (pr.id, v.id, v_cur, v_on, p_valid_until, nullif(btrim(p_note), ''), p_attachment_id, auth.uid())
  returning * into fq;

  for e in select * from jsonb_array_elements(p_lines) loop
    select i.* into v_item
      from ops_procure.design_items i
      join ops_procure.design_rooms r on r.id = i.room_id
      join ops_procure.design_collections c on c.id = r.collection_id
     where i.item_no = btrim(e->>'item_no') and c.project_id = pr.id;
    insert into ops_procure.factory_quote_lines (quote_id, design_item_id, unit_price, lead_time_days, moq, note)
    values (fq.id, v_item.id, (e->>'unit_price')::numeric,
            case when jsonb_typeof(e->'lead_time_days') = 'number' then (e->>'lead_time_days')::int end,
            case when jsonb_typeof(e->'moq') = 'number' then (e->>'moq')::numeric end,
            nullif(btrim(coalesce(e->>'note', '')), ''))
    returning id into v_line;
    v_lines := v_lines + 1;

    -- The choice follows on its own: an item with no offer chosen takes this
    -- one; an item priced from this factory takes its newer price. An item
    -- priced from another factory keeps it — choosing is a person's.
    update ops_procure.design_items i set factory_line_id = v_line, updated_at = now()
     where i.id = v_item.id
       and (i.factory_line_id is null
            or exists (select 1 from ops_procure.factory_quote_lines ol
                         join ops_procure.factory_quotes oq on oq.id = ol.quote_id
                        where ol.id = i.factory_line_id
                          and (oq.voided_at is not null
                               or (oq.vendor_id = v.id and oq.quoted_on <= v_on))));
    get diagnostics v_n = row_count;
    v_chosen := v_chosen + v_n;
  end loop;

  res := ops_core.ok('procurement','factory_quote', fq.fq_no,'create',
    jsonb_build_object('fq_no', fq.fq_no, 'project_code', pr.code, 'vendor_code', v.code,
                       'lines', v_lines, 'chosen', v_chosen, 'vendor_marked_factory', v_marked));
  return ops_core.idem_remember('procurement','record_factory_quote', p_key, res);
end $$;
revoke all on function ops_procure.record_factory_quote(text, text, text, jsonb, date, date, text, uuid, text) from public;
grant execute on function ops_procure.record_factory_quote(text, text, text, jsonb, date, date, text, uuid, text) to authenticated;

-- Which offer an item is priced from. Null: none — the item falls back to its
-- BOM or a typed cost on a draft quotation.
create or replace function ops_procure.choose_factory_line(p_item_no text, p_line_id uuid)
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
declare i ops_procure.design_items; l ops_procure.factory_quote_lines; q ops_procure.factory_quotes;
begin
  if not ops_procure.may_price_factory('update') then
    return ops_core.refused('procurement','design_item', p_item_no,'choose_factory',
      'not_permitted','Memilih harga pabrik butuh akses procurement (update) atau pimpinan proyek (project update).');
  end if;
  select * into i from ops_procure.design_items where item_no = btrim(coalesce(p_item_no, ''));
  if not found then
    return ops_core.not_found('procurement','design_item', p_item_no,'choose_factory', format('Tidak ada item %s.', p_item_no));
  end if;
  if p_line_id is not null then
    select * into l from ops_procure.factory_quote_lines where id = p_line_id;
    if not found or l.design_item_id <> i.id then
      return ops_core.invalid('procurement','design_item', i.item_no,'choose_factory', 'line_not_for_item',
        format('Penawaran itu bukan untuk item %s.', i.item_no), jsonb_build_object('field','line_id'));
    end if;
    select * into q from ops_procure.factory_quotes where id = l.quote_id;
    if q.voided_at is not null then
      return ops_core.conflict('procurement','design_item', i.item_no,'choose_factory', 'voided',
        format('Penawaran %s sudah dibatalkan.', q.fq_no));
    end if;
  end if;
  if i.factory_line_id is not distinct from p_line_id then
    return ops_core.noop('procurement','design_item', i.item_no,'choose_factory', 'Sudah itu yang dipilih.',
      jsonb_build_object('item_no', i.item_no, 'line_id', p_line_id));
  end if;
  update ops_procure.design_items set factory_line_id = p_line_id, updated_at = now() where id = i.id;
  return ops_core.ok('procurement','design_item', i.item_no,'choose_factory',
    jsonb_build_object('item_no', i.item_no, 'line_id', p_line_id, 'fq_no', q.fq_no),
    jsonb_build_object('factory_line_id', i.factory_line_id), jsonb_build_object('factory_line_id', p_line_id));
end $$;
revoke all on function ops_procure.choose_factory_line(text, uuid) from public;
grant execute on function ops_procure.choose_factory_line(text, uuid) to authenticated;

-- A wrong offer is voided, never edited: what was recorded stays readable.
-- An item priced from it falls back to the same factory's newest live offer,
-- else to none. A quotation already sent keeps its frozen figures.
create or replace function ops_procure.void_factory_quote(p_fq_no text, p_reason text)
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
declare q ops_procure.factory_quotes; v_n int;
begin
  if not ops_procure.may_price_factory('update') then
    return ops_core.refused('procurement','factory_quote', p_fq_no,'void',
      'not_permitted','Membatalkan penawaran pabrik butuh akses procurement (update) atau pimpinan proyek (project update).');
  end if;
  select * into q from ops_procure.factory_quotes where fq_no = btrim(coalesce(p_fq_no, '')) for update;
  if not found then
    return ops_core.not_found('procurement','factory_quote', p_fq_no,'void', format('Tidak ada penawaran %s.', p_fq_no));
  end if;
  if q.voided_at is not null then
    return ops_core.conflict('procurement','factory_quote', q.fq_no,'void', 'already_voided',
      format('%s sudah dibatalkan.', q.fq_no));
  end if;
  if length(btrim(coalesce(p_reason, ''))) = 0 then
    return ops_core.invalid('procurement','factory_quote', q.fq_no,'void', 'reason_required',
      'Kenapa dibatalkan? Salah ketik harga, salah item, atau salah pabrik.', jsonb_build_object('field','reason'));
  end if;
  update ops_procure.factory_quotes set voided_at = now(), voided_by = auth.uid(), void_reason = btrim(p_reason)
   where id = q.id;
  update ops_procure.design_items i set updated_at = now(), factory_line_id = (
      select ol.id from ops_procure.factory_quote_lines ol
        join ops_procure.factory_quotes oq on oq.id = ol.quote_id
       where ol.design_item_id = i.id and oq.vendor_id = q.vendor_id and oq.voided_at is null
       order by oq.quoted_on desc, oq.created_at desc limit 1)
   where i.factory_line_id in (select id from ops_procure.factory_quote_lines where quote_id = q.id);
  get diagnostics v_n = row_count;
  return ops_core.ok('procurement','factory_quote', q.fq_no,'void',
    jsonb_build_object('fq_no', q.fq_no, 'items_repriced', v_n),
    jsonb_build_object('voided_at', null), jsonb_build_object('voided_at', now(), 'reason', btrim(p_reason)));
end $$;
revoke all on function ops_procure.void_factory_quote(text, text) from public;
grant execute on function ops_procure.void_factory_quote(text, text) to authenticated;

-- What the screens read: one row per price.
create or replace view ops_procure.v_factory_quote_line as
select fl.id, fq.fq_no, fq.id as quote_id, fq.currency, fq.quoted_on, fq.valid_until, fq.note as quote_note,
       fq.attachment_id, fa.filename as attachment_filename, coalesce(fa.web_view_link, fa.url) as attachment_url,
       fq.voided_at, fq.void_reason,
       v.code as vendor_code, v.name as vendor_name,
       p.code as project_code, p.name as project_name,
       di.item_no, di.name as item_name, di.qty as item_qty,
       fl.unit_price, fl.lead_time_days, fl.moq, fl.note,
       (di.factory_line_id = fl.id)                         as is_chosen,
       -- The newest live offer from this factory for this item.
       (fq.voided_at is null and not exists (
          select 1 from ops_procure.factory_quote_lines nl
            join ops_procure.factory_quotes nq on nq.id = nl.quote_id
           where nl.design_item_id = fl.design_item_id and nq.vendor_id = fq.vendor_id
             and nq.voided_at is null and nl.id <> fl.id
             and (nq.quoted_on, nq.created_at) > (fq.quoted_on, fq.created_at))) as is_latest,
       (fq.valid_until is not null and fq.valid_until < ops_core.office_day()) as expired,
       coalesce(u.full_name, u.email)                       as recorded_by_name,
       fq.created_at                                        as recorded_at
  from ops_procure.factory_quote_lines fl
  join ops_procure.factory_quotes fq on fq.id = fl.quote_id
  join ops_procure.design_items di on di.id = fl.design_item_id
  join ops_procure.projects p on p.id = fq.project_id
  left join ops_procure.vendors v on v.id = fq.vendor_id
  left join ops_core.attachments fa on fa.id = fq.attachment_id
  left join ops_core.users u on u.id = fq.created_by;
alter view ops_procure.v_factory_quote_line set (security_invoker = on);

-- One row per offer, for the list.
create or replace view ops_procure.v_factory_quote as
select fq.id, fq.fq_no, fq.currency, fq.quoted_on, fq.valid_until, fq.note,
       fq.attachment_id, fa.filename as attachment_filename, coalesce(fa.web_view_link, fa.url) as attachment_url,
       fq.voided_at, fq.void_reason,
       v.code as vendor_code, v.name as vendor_name,
       p.code as project_code, p.name as project_name,
       coalesce(c.name, p.client_name) as client_display,
       (select count(*) from ops_procure.factory_quote_lines l where l.quote_id = fq.id)::int as line_count,
       (select count(*) from ops_procure.factory_quote_lines l
          join ops_procure.design_items i on i.factory_line_id = l.id
         where l.quote_id = fq.id)::int as chosen_count,
       (fq.valid_until is not null and fq.valid_until < ops_core.office_day()) as expired,
       coalesce(u.full_name, u.email) as recorded_by_name,
       fq.created_at as recorded_at
  from ops_procure.factory_quotes fq
  join ops_procure.projects p on p.id = fq.project_id
  left join ops_procure.clients c on c.id = p.client_id
  left join ops_procure.vendors v on v.id = fq.vendor_id
  left join ops_core.attachments fa on fa.id = fq.attachment_id
  left join ops_core.users u on u.id = fq.created_by;
alter view ops_procure.v_factory_quote set (security_invoker = on);

grant select on ops_procure.v_factory_quote_line, ops_procure.v_factory_quote to authenticated;

-- The design item reads its chosen offer, for whoever may see factory prices.
create or replace view ops_procure.v_design_item as
 SELECT i.id,
    i.item_no,
    i.seq,
    i.name,
    i.qty,
    i.length_mm,
    i.width_mm,
    i.height_mm,
    i.origin,
    COALESCE(i.product_code, od.product_code) AS product_code,
    i.note,
    i.dropped_at,
    i.drop_reason,
    i.created_at,
    i.updated_at,
    r.code AS room_code,
    r.name AS room_name,
    r.sort AS room_sort,
    c.code AS collection_code,
    c.name AS collection_name,
    p.code AS project_code,
    p.name AS project_name,
    cl.code AS client_code,
    COALESCE(cl.name, p.client_name) AS client_display,
    COALESCE(f.design_files, 0) AS design_files,
    COALESCE(f.client_files, 0) AS client_files,
    COALESCE(f.all_files, 0) AS all_files,
    ap.decision AS approval_decision,
    ap.decided_on AS approval_on,
    ap.channel AS approval_channel,
    ap.client_person AS approval_by,
        CASE
            WHEN i.dropped_at IS NOT NULL THEN 'DROPPED'::text
            WHEN od.ordered THEN 'ORDERED'::text
            WHEN qt.quote_no IS NOT NULL THEN 'QUOTED'::text
            WHEN ap.decision = 'approved'::text THEN 'APPROVED'::text
            WHEN COALESCE(f.drawn, 0) > 0 THEN 'DRAWN'::text
            ELSE 'CONCEPT'::text
        END AS status,
    qt.quote_no,
    qt.quote_status,
    qt.unit_price AS quoted_unit_price,
    COALESCE(od.ordered, false) AS ordered,
    -- O2 (0256): the chosen factory offer, for whoever may see factory prices.
    CASE WHEN ops_procure.may_price_factory('read') THEN fo.fq_no END AS factory_quote_no,
    CASE WHEN ops_procure.may_price_factory('read') THEN fo.vendor_name END AS factory_vendor_name,
    CASE WHEN ops_procure.may_price_factory('read') THEN fo.unit_price END AS factory_unit_price,
    CASE WHEN ops_procure.may_price_factory('read') THEN fo.currency END AS factory_currency,
    CASE WHEN ops_procure.may_price_factory('read') THEN fo.lead_time_days END AS factory_lead_time_days,
    CASE WHEN ops_procure.may_price_factory('read') THEN COALESCE(fc.offers, 0) ELSE 0 END AS factory_offers
   FROM ops_procure.design_items i
     JOIN ops_procure.design_rooms r ON r.id = i.room_id
     JOIN ops_procure.design_collections c ON c.id = r.collection_id
     JOIN ops_procure.projects p ON p.id = c.project_id
     LEFT JOIN ops_procure.clients cl ON cl.id = p.client_id
     LEFT JOIN LATERAL ( SELECT count(*) FILTER (WHERE l.kind = ANY (ARRAY['render'::ops_core.doc_kind_t, 'moodboard'::ops_core.doc_kind_t, 'layout'::ops_core.doc_kind_t, 'gambar_kerja'::ops_core.doc_kind_t, 'gambar_jadi'::ops_core.doc_kind_t]))::integer AS design_files,
            count(*) FILTER (WHERE l.kind = ANY (ARRAY['gambar_klien'::ops_core.doc_kind_t, 'referensi_klien'::ops_core.doc_kind_t]))::integer AS client_files,
            count(*)::integer AS all_files,
            count(*) FILTER (WHERE l.kind = ANY (ARRAY['render'::ops_core.doc_kind_t, 'layout'::ops_core.doc_kind_t, 'gambar_kerja'::ops_core.doc_kind_t, 'gambar_jadi'::ops_core.doc_kind_t, 'gambar_klien'::ops_core.doc_kind_t]))::integer AS drawn
           FROM ops_core.attachment_links l
          WHERE l.entity = 'design_item'::ops_core.link_entity_t AND l.entity_no = i.item_no AND l.unlinked_at IS NULL) f ON true
     LEFT JOIN LATERAL ( SELECT a.decision,
            a.decided_on,
            a.channel,
            a.client_person
           FROM ops_procure.design_approvals a
          WHERE a.item_id = i.id
          ORDER BY a.recorded_at DESC
         LIMIT 1) ap ON true
     LEFT JOIN LATERAL ( SELECT q.quote_no,
            q.status::text AS quote_status,
            ql.frozen_unit_price AS unit_price
           FROM ops_procure.quotation_lines ql
             JOIN ops_procure.quotations q ON q.id = ql.quotation_id
          WHERE ql.design_item_id = i.id AND q.status <> 'DRAFT'::ops_procure.quotation_status_t
          ORDER BY q.sent_at DESC NULLS LAST
         LIMIT 1) qt ON true
     LEFT JOIN LATERAL ( SELECT true AS ordered,
            max(pl.product_code) AS product_code
           FROM ops_procure.project_lines pl
          WHERE pl.design_item_id = i.id
         HAVING count(*) > 0) od ON true
     LEFT JOIN LATERAL ( SELECT fq.fq_no, fv.name AS vendor_name, fl.unit_price, fq.currency, fl.lead_time_days
           FROM ops_procure.factory_quote_lines fl
             JOIN ops_procure.factory_quotes fq ON fq.id = fl.quote_id
             LEFT JOIN ops_procure.vendors fv ON fv.id = fq.vendor_id
          WHERE fl.id = i.factory_line_id AND fq.voided_at IS NULL) fo ON true
     LEFT JOIN LATERAL ( SELECT count(*)::integer AS offers
           FROM ops_procure.factory_quote_lines fl
             JOIN ops_procure.factory_quotes fq ON fq.id = fl.quote_id
          WHERE fl.design_item_id = i.id AND fq.voided_at IS NULL) fc ON true;
alter view ops_procure.v_design_item set (security_invoker = on);
grant select on ops_procure.v_design_item to authenticated;

-- ── 4. the factory's paper, filed (D313) ──────────────────────────────────

insert into ops_core.doc_kind_labels (kind, label) values ('penawaran_pabrik', 'Factory Quotation')
on conflict (kind) do nothing;
insert into ops_core.doc_kind_drive (kind, slug, rationale) values
  ('penawaran_pabrik', 'procurement', 'A partner factory''s price offer for a project''s design items — procurement asks and records it (Q90, O2).')
on conflict (kind) do nothing;
insert into ops_core.drive_paths (kind, entity, path, note) values
  ('penawaran_pabrik', 'project', 'PENAWARAN PABRIK/{CLIENT}/{PROJECT}', 'A factory''s offer, per client and project (O2, D313).'),
  ('penawaran_pabrik', null,      'PENAWARAN PABRIK',                    null)
on conflict (kind, entity) do nothing;

-- ── 5. a quotation in IDR or USD ──────────────────────────────────────────

alter table ops_procure.quotations
  add column if not exists currency text not null default 'IDR'
    constraint quote_currency_known check (currency in ('IDR','USD')),
  -- Rupiah per 1 USD, typed by a person (D181). Converts a cost in the other
  -- currency, and reads a USD quotation in rupiah.
  add column if not exists fx_rate numeric constraint quote_fx_positive check (fx_rate is null or fx_rate > 0);
alter table ops_procure.quotation_lines
  add column if not exists frozen_factory_line_id uuid references ops_procure.factory_quote_lines(id);

-- An amount in one currency, in another, at a kurs of rupiah per 1 USD. Null
-- where it needs a kurs nobody has typed — never a guess (D181).
create or replace function ops_procure.money_in(p_amount numeric, p_from text, p_to text, p_fx_rate numeric)
returns numeric
language sql immutable as $$
  select case when p_amount is null or p_from is null or p_to is null then null
              when p_from = p_to then p_amount
              when p_fx_rate is null then null
              when p_from = 'IDR' and p_to = 'USD' then round(p_amount / p_fx_rate, 2)
              when p_from = 'USD' and p_to = 'IDR' then round(p_amount * p_fx_rate)
         end
$$;
grant execute on function ops_procure.money_in(numeric, text, text, numeric) to authenticated;

-- `quote_price` in a currency: the same formula, rounded to the rupiah or to
-- the cent.
create or replace function ops_procure.quote_price_in(
  p_cost numeric, p_marketing_pct numeric, p_overhead_pct numeric, p_margin_pct numeric, p_currency text)
returns numeric
language sql immutable as $$
  select case when p_cost is null then null
              else round(p_cost * (1 + (coalesce(p_marketing_pct, 0) + coalesce(p_overhead_pct, 0)) / 100)
                         / (1 - coalesce(p_margin_pct, 0) / 100),
                         case when p_currency = 'USD' then 2 else 0 end) end
$$;
grant execute on function ops_procure.quote_price_in(numeric, numeric, numeric, numeric, text) to authenticated;

-- Where each line's cost comes from, in the quotation's currency — computed
-- once, for the screens (`v_quotation_line`) and for the freeze
-- (`send_quotation`). A draft reads live; a sent one, what was frozen.
create or replace view ops_procure.v_quotation_line_basis as
select
  l.id, l.quotation_id, q.quote_no, q.status, q.currency, q.fx_rate,
  s.production_cost                                  as bom_unit_cost,
  s.rev                                              as bom_rev_now,
  (s.product_id is not null)                         as product_exists,
  s.lead_time_days                                   as product_lead_time_days,
  coalesce(l.marketing_pct, q.marketing_pct)         as eff_marketing_pct,
  coalesce(l.overhead_pct,  q.overhead_pct)          as eff_overhead_pct,
  coalesce(l.margin_pct,    q.margin_pct)            as eff_margin_pct,
  f.id                                               as factory_line_id,
  f.unit_price                                       as factory_unit_price,
  f.currency                                         as factory_currency,
  f.fq_no                                            as factory_quote_no,
  f.vendor_name                                      as factory_vendor_name,
  src.cost_source,
  src.cost_currency,
  src.cost_original,
  case when q.status = 'DRAFT'
       then ops_procure.money_in(src.cost_original, src.cost_currency, q.currency, q.fx_rate)
       else l.frozen_unit_cost end                   as unit_cost,
  (q.status = 'DRAFT' and src.cost_original is not null
   and src.cost_currency <> q.currency and q.fx_rate is null) as cost_needs_rate
from ops_procure.quotation_lines l
join ops_procure.quotations q on q.id = l.quotation_id
left join ops_procure.released_cost s on s.product_code = l.product_code
left join lateral (
  select fl.id, fl.unit_price, fq.currency, fq.fq_no, fv.name as vendor_name
    from ops_procure.factory_quote_lines fl
    join ops_procure.factory_quotes fq on fq.id = fl.quote_id
    left join ops_procure.vendors fv on fv.id = fq.vendor_id
   where fl.id = case when q.status = 'DRAFT'
                      then (select di.factory_line_id from ops_procure.design_items di where di.id = l.design_item_id)
                      else l.frozen_factory_line_id end
     and (q.status <> 'DRAFT' or fq.voided_at is null)
) f on true
cross join lateral (
  select
    case when q.status <> 'DRAFT' then l.frozen_cost_source
         when l.manual_unit_cost is not null then 'manual'
         when f.id is not null then 'factory'
         when s.rev is not null and s.production_cost is not null then 'bom' end as cost_source,
    case when q.status <> 'DRAFT'
         then case when l.frozen_cost_source = 'factory' then f.currency else q.currency end
         when l.manual_unit_cost is not null then q.currency
         when f.id is not null then f.currency
         when s.rev is not null and s.production_cost is not null then 'IDR' end as cost_currency,
    case when q.status <> 'DRAFT'
         then case when l.frozen_cost_source = 'factory' then f.unit_price else l.frozen_unit_cost end
         when l.manual_unit_cost is not null then l.manual_unit_cost
         when f.id is not null then f.unit_price
         when s.rev is not null then s.production_cost::numeric end as cost_original
) src;
alter view ops_procure.v_quotation_line_basis set (security_invoker = on);
grant select on ops_procure.v_quotation_line_basis to authenticated;

-- Every column it had, in order, read from the basis; then the currency, the
-- cost in its own currency and the factory it came from (cost readers only).
create or replace view ops_procure.v_quotation_line as
select
  x.id, x.quotation_id, b.quote_no, b.status, x.line_no, x.product_code, x.description,
  x.qty, x.uom,
  coalesce(x.lead_time_days, b.product_lead_time_days)       as lead_time_days,
  b.product_exists,
  x.note,
  x.manual_unit_cost is not null                             as cost_is_manual,
  (b.unit_cost is null)                                      as cost_missing,
  ops_core.has_permission('project.update')                  as cost_visible,
  case when ops_core.has_permission('project.update') then b.unit_cost end   as unit_cost,
  case when ops_core.has_permission('project.update') then b.cost_source end as cost_source,
  case when b.status = 'DRAFT' then b.bom_rev_now else x.frozen_bom_rev end  as bom_rev,
  case when ops_core.has_permission('project.update')
       then case when b.status = 'DRAFT' then b.eff_marketing_pct else x.frozen_marketing_pct end end as marketing_pct,
  case when ops_core.has_permission('project.update')
       then case when b.status = 'DRAFT' then b.eff_overhead_pct  else x.frozen_overhead_pct end end  as overhead_pct,
  case when ops_core.has_permission('project.update')
       then case when b.status = 'DRAFT' then b.eff_margin_pct    else x.frozen_margin_pct end end    as margin_pct,
  (x.marketing_pct is not null or x.overhead_pct is not null or x.margin_pct is not null) as pct_overridden,
  x.lead_time_days                                           as line_lead_time_days,
  case when ops_core.has_permission('project.update') then x.manual_unit_cost end as manual_unit_cost,
  case when ops_core.has_permission('project.update') then x.marketing_pct end    as line_marketing_pct,
  case when ops_core.has_permission('project.update') then x.overhead_pct end     as line_overhead_pct,
  case when ops_core.has_permission('project.update') then x.margin_pct end       as line_margin_pct,
  case when ops_core.has_permission('project.update')
       then ops_procure.quote_price_in(b.unit_cost, b.eff_marketing_pct, b.eff_overhead_pct, b.eff_margin_pct, b.currency) end
                                                             as computed_unit_price,
  x.unit_price_override,
  case when b.status = 'DRAFT'
       then coalesce(x.unit_price_override,
                     ops_procure.quote_price_in(b.unit_cost, b.eff_marketing_pct, b.eff_overhead_pct, b.eff_margin_pct, b.currency))
       else x.frozen_unit_price end                          as unit_price,
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
  d.latest_file                                              as latest_design_file_id,
  (d.eff_file is not null and d.latest_file is not null and d.latest_file <> d.eff_file) as design_changed,
  -- O2 (0256).
  b.currency,
  b.fx_rate,
  case when ops_core.has_permission('project.update') then b.cost_currency end       as cost_currency,
  case when ops_core.has_permission('project.update') then b.cost_original end       as cost_original,
  case when ops_core.has_permission('project.update') then b.factory_line_id end     as factory_line_id,
  case when ops_core.has_permission('project.update') then b.factory_quote_no end    as factory_quote_no,
  case when ops_core.has_permission('project.update') then b.factory_vendor_name end as factory_vendor_name,
  b.cost_needs_rate
from ops_procure.quotation_lines x
join ops_procure.v_quotation_line_basis b on b.id = x.id
cross join lateral (
  select ops_procure.latest_design_file(x.design_item_id) as latest_file
) lf
cross join lateral (
  select case when b.status = 'DRAFT' then coalesce(x.design_file_id, lf.latest_file)
              else x.frozen_design_file_id end as eff_file,
         lf.latest_file
) d
left join ops_procure.design_items di on di.id = x.design_item_id
left join ops_procure.design_rooms dr on dr.id = di.room_id
left join ops_procure.design_collections dc on dc.id = dr.collection_id
left join ops_core.attachments fa on fa.id = d.eff_file;
alter view ops_procure.v_quotation_line set (security_invoker = on);

-- Every column it had — PPN now to the cent on a USD quotation — then the
-- currency, the kurs, and the total in rupiah: what the pipeline and a won
-- project's value add up (D414).
create or replace view ops_procure.v_quotation as
select b.*, q.currency, q.fx_rate,
       case when q.currency = 'IDR' then b.grand_total
            when q.fx_rate is null or b.grand_total is null then null
            else round(b.grand_total * q.fx_rate) end as grand_total_idr
  from (
   SELECT q.id,
      q.quote_no,
      q.project_id,
      q.rev,
      q.supersedes_id,
      q.status,
      q.valid_until,
      q.marketing_pct,
      q.overhead_pct,
      q.margin_pct,
      q.vat,
      q.vat_pct,
      q.terms,
      q.note,
      q.sent_at,
      q.sent_by,
      q.decided_at,
      q.decided_by,
      q.decision_reason,
      q.created_by,
      q.created_at,
      q.updated_at,
      p.code AS project_code,
      p.name AS project_name,
      COALESCE(c.name, p.client_name) AS client_name,
      c.code AS client_code,
      c.contact_name AS client_contact,
      c.address AS client_address,
      p.location,
      COALESCE(t.lines, 0) AS line_count,
      COALESCE(t.missing, 0) AS lines_without_cost,
      t.subtotal,
          CASE
              WHEN q.vat AND t.subtotal IS NOT NULL THEN round(t.subtotal * q.vat_pct / 100::numeric, CASE WHEN q.currency = 'USD'::text THEN 2 ELSE 0 END)
              ELSE NULL::numeric
          END AS vat_amount,
          CASE
              WHEN t.subtotal IS NULL THEN NULL::numeric
              ELSE t.subtotal +
              CASE
                  WHEN q.vat THEN round(t.subtotal * q.vat_pct / 100::numeric, CASE WHEN q.currency = 'USD'::text THEN 2 ELSE 0 END)
                  ELSE 0::numeric
              END
          END AS grand_total,
          CASE
              WHEN ops_core.has_permission('project.update'::text) THEN t.cost_total
              ELSE NULL::numeric
          END AS cost_total,
      t.max_lead_time_days,
      q.status = 'SENT'::ops_procure.quotation_status_t AND q.valid_until IS NOT NULL AND q.valid_until < ops_core.office_day() AS expired,
      (q.status = ANY (ARRAY['DRAFT'::ops_procure.quotation_status_t, 'SENT'::ops_procure.quotation_status_t])) AND NOT (EXISTS ( SELECT 1
             FROM ops_procure.quotations n
            WHERE n.supersedes_id = q.id)) AS is_current
     FROM ops_procure.quotations q
       JOIN ops_procure.projects p ON p.id = q.project_id
       LEFT JOIN ops_procure.clients c ON c.id = p.client_id
       LEFT JOIN LATERAL ( SELECT count(*)::integer AS lines,
              count(*) FILTER (WHERE v.cost_missing)::integer AS missing,
                  CASE
                      WHEN count(*) = 0 OR count(*) FILTER (WHERE v.unit_price IS NULL) > 0 THEN NULL::numeric
                      ELSE sum(v.unit_price * v.qty)
                  END AS subtotal,
                  CASE
                      WHEN count(*) FILTER (WHERE v.unit_cost IS NULL) > 0 THEN NULL::numeric
                      ELSE sum(v.unit_cost * v.qty)
                  END AS cost_total,
              max(v.lead_time_days) AS max_lead_time_days
             FROM ops_procure.v_quotation_line v
            WHERE v.quotation_id = q.id) t ON true
  ) b
  join ops_procure.quotations q on q.id = b.id;
alter view ops_procure.v_quotation set (security_invoker = on);

-- A project's quotation in play, in rupiah for the pipeline's sums; its own
-- currency and figure last, for the card.
create or replace view ops_procure.v_project as
 SELECT p.id,
    p.code,
    p.name,
    p.is_active,
    p.client_name,
    p.location,
    p.pic,
    p.started_on,
    p.target_date,
    p.contract_value,
    p.note,
    p.created_by,
    p.created_at,
    p.client_id,
    p.status,
    p.status_changed_at,
    p.updated_at,
    c.code AS client_code,
    COALESCE(c.name, p.client_name) AS client_display,
    c.contact_name AS client_contact,
    c.phone AS client_phone,
    COALESCE(ls.lines, 0) AS line_count,
    COALESCE(ls.unlinked, 0) AS lines_without_item_code,
    ls.order_value,
    COALESCE(ls.unpriced, 0) AS unpriced_lines,
    ls.next_delivery,
    p.sales_pic,
    su.full_name AS sales_pic_name,
    su.email AS sales_pic_email,
    p.source_note,
    p.expected_value,
    p.expected_close_on,
    ops_core.office_day() - (COALESCE(p.status_changed_at, p.created_at) AT TIME ZONE ops_core.office_tz())::date AS days_in_status,
    cq.quote_no AS current_quote_no,
    cq.status::text AS current_quote_status,
    cq.grand_total_idr AS current_quote_total,
    cl.reason_code AS closing_reason_code,
    cl.reason AS closing_reason,
    cl.changed_at AS closed_at,
    -- O2 (0256): the quotation in play in its own currency.
    cq.currency AS current_quote_currency,
    cq.grand_total AS current_quote_total_own
   FROM ops_procure.projects p
     LEFT JOIN ops_procure.clients c ON c.id = p.client_id
     LEFT JOIN ops_core.users su ON su.id = p.sales_pic
     LEFT JOIN LATERAL ( SELECT count(*)::integer AS lines,
            count(*) FILTER (WHERE l.product_code IS NULL)::integer AS unlinked,
                CASE
                    WHEN count(*) FILTER (WHERE l.unit_price IS NOT NULL) = 0 THEN NULL::numeric
                    ELSE sum(l.qty * l.unit_price) FILTER (WHERE l.unit_price IS NOT NULL)
                END AS order_value,
            count(*) FILTER (WHERE l.unit_price IS NULL)::integer AS unpriced,
            min(l.delivery_date) AS next_delivery
           FROM ops_procure.project_lines l
          WHERE l.project_id = p.id) ls ON true
     LEFT JOIN LATERAL ( SELECT q.quote_no,
            q.status,
            q.grand_total,
            q.grand_total_idr,
            q.currency
           FROM ops_procure.v_quotation q
          WHERE q.project_id = p.id AND q.is_current
          ORDER BY q.rev DESC
         LIMIT 1) cq ON true
     LEFT JOIN LATERAL ( SELECT g.reason_code,
            g.reason,
            g.changed_at
           FROM ops_procure.project_status_log g
          WHERE g.project_id = p.id AND g.to_status = p.status AND (p.status = ANY (ARRAY['LOST'::ops_procure.project_status_t, 'CANCELLED'::ops_procure.project_status_t]))
          ORDER BY g.changed_at DESC
         LIMIT 1) cl ON true;
alter view ops_procure.v_project set (security_invoker = on);

create or replace view ops_procure.v_project_outcome as
 SELECT v.code AS project_code,
    v.name AS project_name,
    v.client_display,
    v.status::text AS status,
    v.sales_pic,
    v.sales_pic_name,
    v.source_note,
    COALESCE(acc.total, v.current_quote_total, v.expected_value, v.contract_value) AS value,
    ops_core.office_day(v.created_at) AS opened_on,
    COALESCE(ops_core.office_day(lg.deal_at),
        CASE
            WHEN v.status = ANY (ARRAY['DEAL'::ops_procure.project_status_t, 'IN_PRODUCTION'::ops_procure.project_status_t, 'SHIPPED'::ops_procure.project_status_t, 'DONE'::ops_procure.project_status_t, 'CANCELLED'::ops_procure.project_status_t]) THEN ops_core.office_day(v.status_changed_at)
            ELSE NULL::date
        END) AS deal_on,
        CASE
            WHEN v.status = 'LOST'::ops_procure.project_status_t THEN ops_core.office_day(v.closed_at)
            ELSE NULL::date
        END AS lost_on,
        CASE
            WHEN lg.deal_at IS NOT NULL OR (v.status = ANY (ARRAY['DEAL'::ops_procure.project_status_t, 'IN_PRODUCTION'::ops_procure.project_status_t, 'SHIPPED'::ops_procure.project_status_t, 'DONE'::ops_procure.project_status_t, 'CANCELLED'::ops_procure.project_status_t])) THEN 'won'::text
            WHEN v.status = 'LOST'::ops_procure.project_status_t THEN 'lost'::text
            ELSE 'open'::text
        END AS outcome,
    ops_core.office_day(lg.deal_at) - ops_core.office_day(v.created_at) AS days_to_deal,
    v.days_in_status,
    v.closing_reason_code
   FROM ops_procure.v_project v
     LEFT JOIN LATERAL ( SELECT q.grand_total_idr AS total
           FROM ops_procure.v_quotation q
          WHERE q.project_id = v.id AND q.status = 'ACCEPTED'::ops_procure.quotation_status_t
          ORDER BY q.decided_at DESC
         LIMIT 1) acc ON true
     LEFT JOIN LATERAL ( SELECT min(l.changed_at) AS deal_at
           FROM ops_procure.project_status_log l
          WHERE l.project_id = v.id AND (l.to_status = ANY (ARRAY['DEAL'::ops_procure.project_status_t, 'IN_PRODUCTION'::ops_procure.project_status_t, 'SHIPPED'::ops_procure.project_status_t, 'DONE'::ops_procure.project_status_t]))) lg ON true
  WHERE ops_procure.may_sell('read'::text);
alter view ops_procure.v_project_outcome set (security_invoker = on);
grant select on ops_procure.v_project_outcome to authenticated;

-- The currency and the kurs of a draft. The kurs is kept whatever the
-- currency: an IDR quotation needs it too when a factory priced in USD.
create or replace function ops_procure.set_quotation_currency(p_quote_no text, p_currency text, p_fx_rate numeric)
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
declare q ops_procure.quotations; v_cur text := upper(btrim(coalesce(p_currency, '')));
begin
  if not ops_procure.may_sell('update') then
    return ops_core.refused('project','quotation', p_quote_no,'set_currency',
      'not_permitted','Mengubah quotation butuh akses proyek atau marketing (update).');
  end if;
  select * into q from ops_procure.quotations where quote_no = btrim(coalesce(p_quote_no, ''));
  if not found then
    return ops_core.not_found('project','quotation', p_quote_no,'set_currency', format('Tidak ada quotation %s.', p_quote_no));
  end if;
  if q.status <> 'DRAFT' then
    return ops_core.conflict('project','quotation', q.quote_no,'set_currency', 'not_draft',
      format('%s sudah %s — angka yang sudah dikirim tidak diubah. Buat revisi.', q.quote_no, q.status));
  end if;
  if v_cur not in ('IDR','USD') then
    return ops_core.invalid('project','quotation', q.quote_no,'set_currency', 'bad_currency',
      'Mata uang: IDR atau USD.', jsonb_build_object('field','currency'));
  end if;
  if p_fx_rate is not null and p_fx_rate <= 0 then
    return ops_core.invalid('project','quotation', q.quote_no,'set_currency', 'bad_rate',
      'Kurs: rupiah untuk 1 USD, lebih dari 0.', jsonb_build_object('field','fx_rate'));
  end if;
  if q.currency = v_cur and q.fx_rate is not distinct from p_fx_rate then
    return ops_core.noop('project','quotation', q.quote_no,'set_currency', 'Tidak ada yang berubah.',
      jsonb_build_object('quote_no', q.quote_no, 'currency', v_cur, 'fx_rate', p_fx_rate));
  end if;
  update ops_procure.quotations set currency = v_cur, fx_rate = p_fx_rate, updated_at = now() where id = q.id;
  return ops_core.ok('project','quotation', q.quote_no,'set_currency',
    jsonb_build_object('quote_no', q.quote_no, 'currency', v_cur, 'fx_rate', p_fx_rate),
    jsonb_build_object('currency', q.currency, 'fx_rate', q.fx_rate),
    jsonb_build_object('currency', v_cur, 'fx_rate', p_fx_rate));
end $$;
revoke all on function ops_procure.set_quotation_currency(text, text, numeric) from public;
grant execute on function ops_procure.set_quotation_currency(text, text, numeric) to authenticated;

-- ── 6. sending, revising and accepting carry the currency ─────────────────
--
-- The bodies of 0225 (send, decide) and 0219 (revise) as they stand, with
-- what O2 adds marked.

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
  -- O2 (0256): a USD offer is read in rupiah at its own kurs, so it goes out
  -- with one; and a cost in the other currency needs it to be a cost at all.
  if q.currency = 'USD' and q.fx_rate is null then
    return ops_core.invalid('project','quotation', p_quote_no,'send', 'rate_required',
      'Quotation dalam USD perlu kurs (Rp untuk 1 USD) sebelum dikirim — kurs itu yang membaca nilainya dalam rupiah.',
      jsonb_build_object('field','fx_rate'));
  end if;
  select string_agg(format('baris %s (%s)', l.line_no, l.description), ', ' order by l.line_no) into v_missing
    from ops_procure.v_quotation_line_basis b
    join ops_procure.quotation_lines l on l.id = b.id
   where b.quotation_id = q.id and b.cost_needs_rate and l.unit_price_override is null;
  if v_missing is not null then
    return ops_core.invalid('project','quotation', p_quote_no,'send', 'rate_required',
      format('Isi kurs (Rp untuk 1 USD): ongkos %s dalam mata uang lain.', v_missing),
      jsonb_build_object('field','fx_rate'));
  end if;
  select string_agg(format('baris %s (%s)', line_no, description), ', ' order by line_no) into v_missing
    from ops_procure.v_quotation_line where quotation_id = q.id and cost_missing and unit_price_override is null;
  if v_missing is not null then
    return ops_core.invalid('project','quotation', p_quote_no,'send', 'cost_missing',
      format('Belum ada ongkos produksi untuk %s. Rilis BOM-nya, catat harga pabrik, isi ongkos manual, atau tetapkan harga jualnya.', v_missing),
      jsonb_build_object('field','lines'));
  end if;
  if q.valid_until is not null and q.valid_until < ops_core.office_day() then
    return ops_core.invalid('project','quotation', p_quote_no,'send', 'already_expired',
      format('Berlaku sampai %s — tanggal itu sudah lewat.', q.valid_until), jsonb_build_object('field','valid_until'));
  end if;

  -- The basis computes; the freeze copies what it says, so the frozen figures
  -- are exactly the ones the PM was looking at — now with the factory offer
  -- the cost came from (O2).
  update ops_procure.quotation_lines l set
    frozen_unit_cost = b.unit_cost, frozen_cost_source = b.cost_source, frozen_bom_rev = b.bom_rev_now,
    frozen_factory_line_id = case when b.cost_source = 'factory' then b.factory_line_id end,
    frozen_marketing_pct = b.eff_marketing_pct, frozen_overhead_pct = b.eff_overhead_pct, frozen_margin_pct = b.eff_margin_pct,
    frozen_unit_price = coalesce(l.unit_price_override,
      ops_procure.quote_price_in(b.unit_cost, b.eff_marketing_pct, b.eff_overhead_pct, b.eff_margin_pct, b.currency)),
    -- The drawing goes with the price (0225, G14).
    frozen_design_file_id = coalesce(l.design_file_id, ops_procure.latest_design_file(l.design_item_id))
  from ops_procure.v_quotation_line_basis b
  where b.id = l.id and l.quotation_id = q.id;

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
  -- O2 (0256): the currency and the kurs go with the revision.
  insert into ops_procure.quotations (project_id, rev, supersedes_id, valid_until, marketing_pct, overhead_pct,
                                      margin_pct, vat, vat_pct, terms, note, created_by, currency, fx_rate)
  values (q.project_id, v_rev, q.id, greatest(coalesce(q.valid_until, ops_core.office_day()), ops_core.office_day() + 30),
          q.marketing_pct, q.overhead_pct, q.margin_pct, q.vat, q.vat_pct, q.terms, q.note, auth.uid(),
          q.currency, q.fx_rate)
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
    -- O2 (0256): an order line is rupiah. A USD offer's price becomes rupiah
    -- at the kurs it was sent with, and the line says what it was.
    insert into ops_procure.project_lines (project_id, line_no, product_code, description, qty, uom, unit_price,
                                           note, quotation_line_id, design_item_id, design_file_id)
    select pr.id, v_next + row_number() over (order by l.line_no), l.product_code, l.description, l.qty, l.uom,
           ops_procure.money_in(l.frozen_unit_price, q.currency, 'IDR', q.fx_rate),
           case when q.currency = 'IDR' then format('dari %s', q.quote_no)
                else format('dari %s · %s %s × kurs %s', q.quote_no, q.currency, l.frozen_unit_price, q.fx_rate) end,
           l.id, l.design_item_id, l.frozen_design_file_id
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

analyze ops_procure.factory_quotes;
analyze ops_procure.factory_quote_lines;
analyze ops_procure.vendors;
analyze ops_procure.quotations;
