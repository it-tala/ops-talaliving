-- 0203_procure_receiving_inbox.sql — the RECEIVING REPORT space in Google
-- Chat, into procurement; and an order's payment request paid on the order
-- (D358).
--
-- The owner, 2026-10-01: *user upload file ke channel RECEIVING REPORT · user
-- buka ops – role procurement konfirmasi untuk mencocokkan antara transaksi
-- dengan item yang masuk – sehingga di ledger bisa update Item photo dan
-- Receiving report (optional), kemudian barang masuk ke inventory sesuai
-- jenisnya: materials / asset. Untuk item yang masuk berupa PO, Receiving
-- report dihubungkan ke PO mana, isi qty dan tanda terimanya – sehingga bisa
-- diajukan sebagai pengajuan pembayaran / PR – ketika PR sudah approve dan
-- sudah dibayar, ada trx id-nya, maka status di PO juga harus bisa ditautkan.*
--
-- ── What was already there, measured before building ─────────────────────
--
-- The space (`spaces/AAQAiO_aiOA`, display name RECEIVING REPORT) has been
-- captured by the John Lau worker since 2026-09-09: 43 messages, 26 with
-- photos, every photo already in Drive (`public.blobs`) and already read by
-- Gemini (`public.receiving_extractions`: ITEM PHOTO or RECEIVING SHEET, with
-- lines, vendor, PO number). **None of it reached this system** — the only
-- inbound road was accounting's `evidence_inbox`, and nothing filed these
-- there. So the photographs existed, were read, and nobody in ops could see
-- them.
--
-- ── 1. the inbox ──────────────────────────────────────────────────────────
--
-- One row per Chat message, its files beside it (a message often carries the
-- goods and the signed sheet together). Filed by `file_receiving()`, the one
-- verb the bridge (`pg_cron`, every five minutes, D358) needs — idempotent on the message's own id, and **merging**
-- on a second call while the row is still open, because the files and the
-- AI's reading arrive seconds apart and in either order.
--
-- Unlike `file_evidence()`, a sender nobody here recognises is **not**
-- refused. A photo of a crate is evidence whoever took it; the name is kept as
-- Chat gave it, and the files are recorded as uploaded by shared@ (the owner's
-- rule for authorless legacy rows, 2026-09-21) when there is nobody better.
--
-- ── 2. two roads out, and one aside ───────────────────────────────────────
--
-- * **to a ledger transaction** — something bought and already paid (the
--   petty-cash nota, the marketplace order). The photos become the row's
--   *Receiving Item* ("Item photo" in the ledger drawer), a signed sheet its
--   *Receiving Report*, and each line goes where its kind goes: a **material**
--   onto the rack as a `receipt` move (ref = this row's `rr-` number), an
--   **asset** into the register carrying the transaction.
-- * **to a purchase order** — qty per order line and the tanda terima, which
--   is `create_receipt()` per line, unchanged: with the tanda terima the
--   receipt is CONFIRMED and counts (D131), the rack follows by the existing
--   trigger, and the order's *billable now* moves.
-- * **dismissed**, with a reason: a chat reply, a duplicate, a photo of
--   nothing. Never deleted (A2).
--
-- Matching is procurement's act (`procurement.update`). Assets are registered
-- by the same act rather than by sending the person to inventory: the
-- register's own seam asks for `inventory.create`, and the owner's workflow
-- puts this decision with procurement. The insert carries the same checks
-- (`asset_refs_invalid`).
--
-- Choosing the transaction needs to *see* transactions, which RLS keeps to
-- `accounting.read`. `receiving_candidates()` answers procurement with the
-- money-going-OUT rows near the delivery date — the description, vendor,
-- amount and date, the four things that let a person say *that one* — and
-- nothing else from the ledger.
--
-- ── 3. the payment request, and the money reaching the order ──────────────
--
-- `request_po_payment()` raises and submits one request line **against** the
-- order (`against_po_id`, `0158`) for what is billable now, less what is
-- already asked for and not yet paid — so the same delivery cannot be asked
-- for twice. The line goes to the meeting board like any other.
--
-- The gap it closes is one line in `allocate_payment`: a request line *on* an
-- order (`order_of_line`, B8) stamped the order on its payment, a line
-- *against* one did not. So a paid balance-payment request left the order
-- reading UNPAID. Now both do, and the existing readers count it once on each
-- side as `0139` set out — the order's `payment_state` (UNPAID / PARTIAL /
-- SETTLED) and its terms (cicilan, D128) follow from the trx without anybody
-- touching the order.

insert into ops_core.doc_prefixes (prefix, what) values
  ('rr', 'receiving report from chat')
on conflict (prefix) do nothing;

create type ops_procure.rcv_inbox_status_t as enum ('PENDING','MATCHED','DISMISSED');

create table ops_procure.receiving_inbox (
  id            uuid primary key default gen_random_uuid(),
  -- The source's own id — the Chat event the worker captured — so a retry is
  -- recognised (the rule `file_evidence` states, `0019`).
  ref_id        text not null unique,
  rr_no         text not null unique default ops_core.next_doc_number('rr'),
  status        ops_procure.rcv_inbox_status_t not null default 'PENDING',
  message       text,
  sender_name   text,
  reported_by   uuid references ops_core.users(id),
  reported_at   timestamptz not null default now(),
  -- The AI's reading: doc_kind, vendor, po_number, delivery_note_no, lines.
  -- A proposal for the person matching, never a posting.
  extracted     jsonb not null default '{}'::jsonb,

  matched_to    text check (matched_to in ('transaction','po')),
  trx_no        text,
  po_no         text,
  receipt_nos   text[] not null default '{}',
  move_nos      text[] not null default '{}',
  asset_nos     text[] not null default '{}',
  resolved_by   uuid references ops_core.users(id),
  resolved_at   timestamptz,
  resolve_note  text,

  constraint rcv_inbox_decided_is_signed check (
    (status = 'PENDING') = (resolved_at is null)
    and (resolved_at is null) = (resolved_by is null)),
  constraint rcv_inbox_match_names_target check (
    case status
      when 'MATCHED'   then (matched_to = 'transaction' and trx_no is not null)
                         or (matched_to = 'po' and po_no is not null)
      when 'DISMISSED' then matched_to is null and nullif(btrim(resolve_note), '') is not null
      else matched_to is null
    end)
);

create index rcv_inbox_pending_idx on ops_procure.receiving_inbox (reported_at)
  where status = 'PENDING';
create index rcv_inbox_recent_idx on ops_procure.receiving_inbox (reported_at desc);

create table ops_procure.receiving_inbox_files (
  inbox_id      uuid not null references ops_procure.receiving_inbox(id) on delete restrict,
  attachment_id uuid not null references ops_core.attachments(id) on delete restrict,
  -- The worker's own id for the file (the blob), so filing the same message
  -- twice adds nothing.
  source_ref    text not null,
  added_at      timestamptz not null default now(),
  primary key (inbox_id, attachment_id),
  unique (inbox_id, source_ref)
);

alter table ops_procure.receiving_inbox       enable row level security;
alter table ops_procure.receiving_inbox_files enable row level security;

create policy rcv_inbox_read on ops_procure.receiving_inbox
  for select to authenticated using (ops_core.has_permission('procurement.read'));
create policy rcv_inbox_files_read on ops_procure.receiving_inbox_files
  for select to authenticated using (ops_core.has_permission('procurement.read'));

grant select on ops_procure.receiving_inbox, ops_procure.receiving_inbox_files to authenticated;

-- ── the view the screen reads ─────────────────────────────────────────────
create or replace view ops_procure.v_receiving_inbox as
  select i.rr_no,
         i.ref_id,
         i.status,
         i.message,
         coalesce(u.full_name, i.sender_name) as sender_name,
         i.reported_at,
         i.extracted,
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'attachment_id', a.id, 'url', a.url, 'filename', a.filename,
                    'mime', a.mime) order by f.added_at, a.filename)
             from ops_procure.receiving_inbox_files f
             join ops_core.attachments a on a.id = f.attachment_id
            where f.inbox_id = i.id), '[]'::jsonb) as files,
         i.matched_to,
         i.trx_no,
         i.po_no,
         i.receipt_nos,
         i.move_nos,
         i.asset_nos,
         r.full_name as resolved_by_name,
         i.resolved_at,
         i.resolve_note
    from ops_procure.receiving_inbox i
    left join ops_core.users u on u.id = i.reported_by
    left join ops_core.users r on r.id = i.resolved_by;

alter view ops_procure.v_receiving_inbox set (security_invoker = on);
grant select on ops_procure.v_receiving_inbox to authenticated;

-- ── the door in ───────────────────────────────────────────────────────────
-- `p_files`: [{"url","filename","source_ref","mime","bytes","sha256"}]
create or replace function ops_procure.file_receiving(
  p_ref_id      text,
  p_files       jsonb,
  p_message     text        default null,
  p_reported_by text        default null,
  p_reported_at timestamptz default null,
  p_extracted   jsonb       default null,
  p_key         text        default null)
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
declare
  ib       ops_procure.receiving_inbox;
  who       text := nullif(btrim(coalesce(p_reported_by, '')), '');
  reporter  uuid;
  uploader  uuid;
  n_match   int;
  f         jsonb;
  att       uuid;
  added     int := 0;
  bad       text;
  replayed  jsonb;
  res       jsonb;
begin
  replayed := ops_core.idem_replay('procurement','file_receiving:' || coalesce(p_ref_id, ''), p_key);
  if replayed is not null then return replayed; end if;

  -- The worker calls with no session; a person calling from a screen must be
  -- somebody who may record an arrival.
  if auth.uid() is not null and not ops_core.has_permission('procurement.create') then
    return ops_core.refused('procurement','receiving_inbox', p_ref_id,'file',
      'not_permitted','Filing an arrival needs procurement access.');
  end if;

  if coalesce(btrim(p_ref_id), '') = '' then
    return ops_core.invalid('procurement','receiving_inbox', null,'file',
      'ref_required','Every filed message needs the source''s own id, so a retry can be recognised.',
      jsonb_build_object('field','ref_id'));
  end if;
  if p_files is null or jsonb_typeof(p_files) <> 'array' or jsonb_array_length(p_files) = 0 then
    return ops_core.invalid('procurement','receiving_inbox', p_ref_id,'file',
      'files_required','A receiving report from chat is a photograph — a message with no file is a conversation.',
      jsonb_build_object('field','files'));
  end if;
  select min(coalesce(x ->> 'filename', '?')) into bad
    from jsonb_array_elements(p_files) x
   where coalesce(btrim(x ->> 'url'), '') = ''
      or coalesce(btrim(x ->> 'filename'), '') = ''
      or coalesce(btrim(x ->> 'source_ref'), '') = '';
  if bad is not null then
    return ops_core.invalid('procurement','receiving_inbox', p_ref_id,'file',
      'file_incomplete', format('Every file needs where it is, its name and the source''s id for it (%s).', bad),
      jsonb_build_object('field','files'));
  end if;

  -- Who sent it: by email, then by name. Nobody is a fact, not a refusal.
  if who is not null then
    select count(*), (array_agg(u.id))[1] into n_match, reporter
      from ops_core.users u where lower(u.email::text) = lower(who) and u.is_active;
    if n_match = 0 then
      select count(*), (array_agg(u.id))[1] into n_match, reporter
        from ops_core.users u where lower(u.full_name) = lower(who) and u.is_active;
    end if;
    if n_match <> 1 then reporter := null; end if;
  end if;

  select * into ib from ops_procure.receiving_inbox where ref_id = p_ref_id;

  if found and ib.status <> 'PENDING' then
    return ops_core.ok('procurement','receiving_inbox', ib.rr_no,'file',
      jsonb_build_object('rr_no', ib.rr_no, 'status', ib.status, 'already_filed', true));
  end if;

  uploader := coalesce(reporter, ib.reported_by, auth.uid(),
                       (select id from ops_core.users where email = 'shared@talaliving.com'));
  if uploader is null then
    return ops_core.invalid('procurement','receiving_inbox', p_ref_id,'file',
      'uploader_unresolved',
      'Nobody to record the files against: the sender is unknown, there is no session, and shared@ does not exist.',
      jsonb_build_object('field','reported_by','value', who));
  end if;

  if not found then
    insert into ops_procure.receiving_inbox
      (ref_id, message, sender_name, reported_by, reported_at, extracted)
    values (p_ref_id, nullif(btrim(coalesce(p_message, '')), ''), who, reporter,
            coalesce(p_reported_at, now()), coalesce(p_extracted, '{}'::jsonb))
    returning * into ib;
  else
    -- Still open: the reading and the message may arrive after the files.
    update ops_procure.receiving_inbox
       set extracted   = case when coalesce(p_extracted, '{}'::jsonb) <> '{}'::jsonb
                              then p_extracted else extracted end,
           message     = coalesce(message, nullif(btrim(coalesce(p_message, '')), '')),
           reported_by = coalesce(reported_by, reporter),
           sender_name = coalesce(sender_name, who)
     where id = ib.id
     returning * into ib;
  end if;

  for f in select * from jsonb_array_elements(p_files) loop
    continue when exists (select 1 from ops_procure.receiving_inbox_files x
                           where x.inbox_id = ib.id and x.source_ref = btrim(f ->> 'source_ref'));
    insert into ops_core.attachments (url, filename, sha256, mime, bytes, source, uploaded_by)
    values (btrim(f ->> 'url'), btrim(f ->> 'filename'),
            nullif(btrim(coalesce(f ->> 'sha256', '')), ''),
            nullif(btrim(coalesce(f ->> 'mime', '')), ''),
            nullif(f ->> 'bytes', '')::bigint,
            'chat', uploader)
    returning id into att;
    insert into ops_procure.receiving_inbox_files (inbox_id, attachment_id, source_ref)
    values (ib.id, att, btrim(f ->> 'source_ref'));
    added := added + 1;
  end loop;

  if added > 0 then
    perform ops_core.emit('procurement','procurement.receiving.filed', ib.rr_no,
      jsonb_build_object('rr_no', ib.rr_no, 'ref_id', p_ref_id, 'files', added,
                         'reported_by', reporter));
  end if;

  res := ops_core.ok('procurement','receiving_inbox', ib.rr_no,'file',
    jsonb_build_object('rr_no', ib.rr_no, 'status', ib.status, 'files_added', added,
                       'reported_by', reporter));
  return ops_core.idem_remember('procurement','file_receiving:' || p_ref_id, p_key, res);
end $$;

-- ── what a row could be matched to ────────────────────────────────────────
create or replace function ops_procure.receiving_candidates(p_rr_no text, p_query text default null)
returns jsonb
language plpgsql security definer
set search_path = ops_procure, ops_acct, ops_core, pg_temp as $$
declare
  ib   ops_procure.receiving_inbox;
  q     text := nullif(btrim(coalesce(p_query, '')), '');
  ven   text;
  v_day   date;
  trx   jsonb;
  v_pos   jsonb;
begin
  if not ops_core.has_permission('procurement.read') then
    return ops_core.refused('procurement','receiving_inbox', p_rr_no,'candidates',
      'not_permitted','Reading arrivals needs procurement access.');
  end if;
  select * into ib from ops_procure.receiving_inbox where rr_no = p_rr_no;
  if not found then
    return ops_core.not_found('procurement','receiving_inbox', p_rr_no,'candidates',
      format('No receiving report %s.', p_rr_no));
  end if;

  ven := nullif(btrim(coalesce(ib.extracted ->> 'vendor', '')), '');
  v_day := (ib.reported_at at time zone 'Asia/Jakarta')::date;

  -- Money that went OUT, around the day it arrived (three weeks before, three
  -- days after), the vendor the AI read first. Typing searches every date.
  select coalesce(jsonb_agg(c order by c.vendor_hit desc, c.days_off, c.trx_no desc), '[]'::jsonb)
    into trx
    from (
      select t.trx_no, t.trx_date, t.amount_idr, t.description, t.remark,
             v.name as vendor_name, a.code as account_code,
             (ven is not null and v.name ilike '%' || ven || '%') as vendor_hit,
             abs(t.trx_date - v_day) as days_off,
             exists (select 1 from ops_core.attachment_links k
                      where k.entity = 'transaction' and k.entity_no = t.trx_no
                        and k.kind = 'goods_photo' and k.unlinked_at is null) as has_item_photo
        from ops_acct.transactions t
        join ops_acct.accounts a on a.id = t.account_id
        left join ops_procure.vendors v on v.id = t.vendor_id
       where t.direction = 'OUT' and t.status <> 'VOID'
         and (case when q is null
                   then t.trx_date between v_day - 21 and v_day + 3
                   else (t.trx_no ilike '%' || q || '%' or t.description ilike '%' || q || '%'
                         or coalesce(t.remark, '') ilike '%' || q || '%'
                         or coalesce(v.name, '') ilike '%' || q || '%')
              end)
       order by (ven is not null and v.name ilike '%' || ven || '%') desc,
                abs(t.trx_date - v_day), t.trx_no desc
       limit 40
    ) c;

  -- Every order still waiting for goods, with what is still owed per line.
  select coalesce(jsonb_agg(o order by o.vendor_hit desc, o.po_hit desc, o.po_no desc), '[]'::jsonb)
    into v_pos
    from (
      select p.po_no, p.status, v.name as vendor_name, s.delivery_state, s.payment_state,
             (ven is not null and v.name ilike '%' || ven || '%') as vendor_hit,
             (nullif(btrim(coalesce(ib.extracted ->> 'po_number', '')), '') is not null
              and p.po_no ilike '%' || btrim(ib.extracted ->> 'po_number') || '%') as po_hit,
             (select coalesce(jsonb_agg(jsonb_build_object(
                       'po_line_id', d.po_line_id, 'line_no', d.line_no, 'description', d.description,
                       'qty', d.qty, 'uom', d.uom, 'received', d.received, 'reported', d.reported)
                       order by d.line_no), '[]'::jsonb)
                from ops_procure.v_po_line_delivery d where d.po_id = p.id) as lines
        from ops_procure.purchase_orders p
        join ops_procure.vendors v on v.id = p.vendor_id
        join ops_procure.v_po_status s on s.po_id = p.id
       where p.status = 'ISSUED'
         and (q is null or p.po_no ilike '%' || q || '%' or v.name ilike '%' || q || '%')
    ) o;

  return jsonb_build_object('outcome','ok','status',200,
    'data', jsonb_build_object('rr_no', p_rr_no, 'transactions', trx, 'orders', v_pos));
end $$;

-- ── road 1: to a ledger transaction ───────────────────────────────────────
-- `p_lines`: [{"kind":"material","item_code","qty","location"?}
--            | {"kind":"asset","name","category_code","count"?,"unit_cost"?}]
create or replace function ops_procure.match_receiving_to_trx(
  p_rr_no   text,
  p_trx_no  text,
  p_photos  uuid[],
  p_reports uuid[] default '{}',
  p_lines   jsonb  default '[]'::jsonb,
  p_note    text   default null,
  p_key     text   default null)
returns jsonb
language plpgsql security definer
set search_path = ops_procure, ops_inv, ops_acct, ops_core, pg_temp as $$
declare
  ib     ops_procure.receiving_inbox;
  t       ops_acct.transactions;
  v_ven   text;
  ln      jsonb;
  v_kind  text;
  v_code  text;
  v_uom   text;
  v_qty   numeric;
  v_loc   text;
  v_cnt   int;
  v_name  text;
  v_cat   text;
  v_cost  numeric;
  v_no    text;
  bad     jsonb;
  moves   text[] := '{}';
  assets  text[] := '{}';
  stray   int;
  i       int;
  replayed jsonb; res jsonb;
  photos  uuid[] := coalesce(p_photos, '{}');
  reports uuid[] := coalesce(p_reports, '{}');
  v_lines   jsonb := coalesce(p_lines, '[]'::jsonb);
begin
  replayed := ops_core.idem_replay('procurement','match_receiving:' || coalesce(p_rr_no, ''), p_key);
  if replayed is not null then return replayed; end if;

  if not ops_core.has_permission('procurement.update') then
    return ops_core.refused('procurement','receiving_inbox', p_rr_no,'match',
      'not_permitted','Matching an arrival needs procurement write access.');
  end if;

  select * into ib from ops_procure.receiving_inbox where rr_no = p_rr_no for update;
  if not found then
    return ops_core.not_found('procurement','receiving_inbox', p_rr_no,'match',
      format('No receiving report %s.', p_rr_no));
  end if;
  if ib.status <> 'PENDING' then
    return ops_core.conflict('procurement','receiving_inbox', p_rr_no,'match',
      'already_resolved', format('%s is already %s.', p_rr_no, lower(ib.status::text)));
  end if;

  select * into t from ops_acct.transactions where trx_no = btrim(coalesce(p_trx_no, ''));
  if not found then
    return ops_core.not_found('procurement','receiving_inbox', p_rr_no,'match',
      format('No ledger transaction %s.', p_trx_no));
  end if;
  if t.status = 'VOID' then
    return ops_core.conflict('procurement','receiving_inbox', p_rr_no,'match',
      'transaction_void', format('%s is VOID — goods cannot arrive against money that never moved.', t.trx_no));
  end if;
  if t.direction <> 'OUT' then
    return ops_core.invalid('procurement','receiving_inbox', p_rr_no,'match',
      'not_a_purchase', format('%s is money coming in. Goods arrive against a purchase.', t.trx_no),
      jsonb_build_object('field','trx_no'));
  end if;

  if cardinality(photos) = 0 then
    return ops_core.invalid('procurement','receiving_inbox', p_rr_no,'match',
      'photo_required','Pick at least one photo of the goods — it is what the ledger ib shows as the item photo.',
      jsonb_build_object('field','photos'));
  end if;
  select count(*) into stray
    from unnest(photos || reports) a
   where not exists (select 1 from ops_procure.receiving_inbox_files f
                      where f.inbox_id = ib.id and f.attachment_id = a);
  if stray > 0 then
    return ops_core.invalid('procurement','receiving_inbox', p_rr_no,'match',
      'file_not_on_report', 'Only the files that came with this message can be filed from it.',
      jsonb_build_object('field','photos'));
  end if;
  if photos && reports then
    return ops_core.invalid('procurement','receiving_inbox', p_rr_no,'match',
      'file_twice','A file is either the photo of the goods or the receiving report, not both.',
      jsonb_build_object('field','reports'));
  end if;

  if jsonb_typeof(v_lines) <> 'array' then
    return ops_core.invalid('procurement','receiving_inbox', p_rr_no,'match',
      'lines_malformed','Lines are a list.', jsonb_build_object('field','lines'));
  end if;
  -- The same item twice in one arrival is one line with the two counts added.
  select min(x ->> 'item_code') into v_code
    from jsonb_array_elements(v_lines) x
   where x ->> 'kind' = 'material'
   group by x ->> 'item_code' having count(*) > 1;
  if v_code is not null then
    return ops_core.invalid('procurement','receiving_inbox', p_rr_no,'match',
      'item_twice', format('%s is listed twice — add the two counts into one line.', v_code),
      jsonb_build_object('field','lines'));
  end if;

  select v.code into v_ven from ops_procure.vendors v where v.id = t.vendor_id;

  -- Validate every line before writing any, so a refusal leaves nothing half done.
  for ln in select * from jsonb_array_elements(v_lines) loop
    v_kind := ln ->> 'kind';
    if v_kind = 'material' then
      v_code := btrim(coalesce(ln ->> 'item_code', ''));
      v_qty := nullif(ln ->> 'qty', '')::numeric;
      if ops_inv.stock_item_uom(v_code) is null then
        return ops_core.invalid('procurement','receiving_inbox', p_rr_no,'match',
          'item_not_stocked',
          format('%s is not a counted catalogue item — pick the item, or file it as an asset.', coalesce(nullif(v_code, ''), '(none)')),
          jsonb_build_object('field','lines','item_code', v_code));
      end if;
      if v_qty is null or v_qty <= 0 then
        return ops_core.invalid('procurement','receiving_inbox', p_rr_no,'match',
          'bad_qty', format('How many %s arrived?', v_code), jsonb_build_object('field','lines','item_code', v_code));
      end if;
      v_loc := nullif(btrim(coalesce(ln ->> 'location', '')), '');
      if v_loc is not null and not exists (select 1 from ops_inv.stock_locations where code = v_loc) then
        return ops_core.invalid('procurement','receiving_inbox', p_rr_no,'match',
          'location_unknown', format('No stock location %s.', v_loc), jsonb_build_object('field','lines'));
      end if;
    elsif v_kind = 'asset' then
      v_cnt := coalesce(nullif(ln ->> 'count', '')::int, 1);
      if coalesce(btrim(ln ->> 'name'), '') = '' then
        return ops_core.invalid('procurement','receiving_inbox', p_rr_no,'match',
          'name_required','An asset needs a name.', jsonb_build_object('field','lines'));
      end if;
      if v_cnt < 1 or v_cnt > 50 then
        return ops_core.invalid('procurement','receiving_inbox', p_rr_no,'match',
          'bad_count','Between 1 and 50 of one asset at a time — each one is its own ib in the register.',
          jsonb_build_object('field','lines'));
      end if;
      if nullif(ln ->> 'unit_cost', '')::numeric < 0 then
        return ops_core.invalid('procurement','receiving_inbox', p_rr_no,'match',
          'cost_negative','A purchase cost cannot be negative.', jsonb_build_object('field','lines'));
      end if;
      bad := ops_inv.asset_refs_invalid(null, 'create', nullif(ln ->> 'category_code', ''), null, null);
      if bad is not null then return bad; end if;
      if nullif(ln ->> 'category_code', '') is null then
        return ops_core.invalid('procurement','receiving_inbox', p_rr_no,'match',
          'category_required','Pick the asset''s category.', jsonb_build_object('field','lines'));
      end if;
    else
      return ops_core.invalid('procurement','receiving_inbox', p_rr_no,'match',
        'kind_unknown', 'Each line is a material or an asset.', jsonb_build_object('field','lines'));
    end if;
  end loop;

  -- The ledger row: the item photo, and the receiving report when there is one.
  insert into ops_core.attachment_links (attachment_id, entity, entity_no, kind, linked_by)
  select a, 'transaction', t.trx_no, 'goods_photo', auth.uid() from unnest(photos) a
  on conflict (attachment_id, entity, entity_no, kind) where unlinked_at is null do nothing;
  insert into ops_core.attachment_links (attachment_id, entity, entity_no, kind, linked_by)
  select a, 'transaction', t.trx_no, 'receiving_report', auth.uid() from unnest(reports) a
  on conflict (attachment_id, entity, entity_no, kind) where unlinked_at is null do nothing;

  for ln in select * from jsonb_array_elements(v_lines) loop
    if ln ->> 'kind' = 'material' then
      v_code := btrim(ln ->> 'item_code');
      v_uom  := ops_inv.stock_item_uom(v_code);
      v_qty  := (ln ->> 'qty')::numeric;
      v_loc  := coalesce(nullif(btrim(coalesce(ln ->> 'location', '')), ''),
                         (select s.home_location from ops_inv.stock_settings s where s.item_code = v_code),
                         'GUDANG');
      insert into ops_inv.stock_moves (item_code, location, kind, qty, uom, ref_no, reason, moved_by)
      values (v_code, v_loc, 'receipt', v_qty, v_uom, ib.rr_no,
              format('Diterima (%s), dibayar %s', ib.rr_no, t.trx_no), auth.uid())
      returning move_no into v_no;
      moves := moves || v_no;
      perform ops_core.emit('inventory','inventory.stock.received', ib.rr_no,
        jsonb_build_object('rr_no', ib.rr_no, 'trx_no', t.trx_no, 'item_code', v_code,
                           'qty', v_qty, 'uom', v_uom, 'location', v_loc));
    else
      v_name := btrim(ln ->> 'name');
      v_cat  := ln ->> 'category_code';
      v_cost := nullif(ln ->> 'unit_cost', '')::numeric;
      v_cnt  := coalesce(nullif(ln ->> 'count', '')::int, 1);
      for i in 1 .. v_cnt loop
        insert into ops_inv.assets (name, category_code, status, acquired_on, purchase_cost,
                                    vendor_code, trx_no, notes, created_by, ownership)
        values (v_name, v_cat, 'in_use', t.trx_date, v_cost, v_ven, t.trx_no,
                format('Dari laporan penerimaan %s', ib.rr_no), auth.uid(), 'owned')
        returning asset_no into v_no;
        assets := assets || v_no;
        insert into ops_core.attachment_links (attachment_id, entity, entity_no, kind, linked_by)
        values (photos[1], 'asset', v_no, ops_core.doc_kind_of('Foto'), auth.uid())
        on conflict (attachment_id, entity, entity_no, kind) where unlinked_at is null do nothing;
      end loop;
    end if;
  end loop;

  update ops_procure.receiving_inbox
     set status = 'MATCHED', matched_to = 'transaction', trx_no = t.trx_no,
         move_nos = moves, asset_nos = assets,
         resolved_by = auth.uid(), resolved_at = now(),
         resolve_note = nullif(btrim(coalesce(p_note, '')), '')
   where id = ib.id;

  perform ops_core.emit('procurement','procurement.receiving.matched', ib.rr_no,
    jsonb_build_object('rr_no', ib.rr_no, 'trx_no', t.trx_no,
                       'moves', to_jsonb(moves), 'assets', to_jsonb(assets)));

  res := ops_core.ok('procurement','receiving_inbox', ib.rr_no,'match',
    jsonb_build_object('rr_no', ib.rr_no, 'matched_to','transaction', 'trx_no', t.trx_no,
                       'move_nos', to_jsonb(moves), 'asset_nos', to_jsonb(assets),
                       'item_photos', cardinality(photos), 'receiving_reports', cardinality(reports)),
    jsonb_build_object('status','PENDING'),
    jsonb_build_object('status','MATCHED','trx_no', t.trx_no));
  return ops_core.idem_remember('procurement','match_receiving:' || p_rr_no, p_key, res);
end $$;

-- ── road 2: to a purchase order ───────────────────────────────────────────
-- `p_lines`: [{"po_line_id","qty","condition"?}]
create or replace function ops_procure.match_receiving_to_po(
  p_rr_no   text,
  p_po_no   text,
  p_lines   jsonb,
  p_photos  uuid[],
  p_notes   uuid[] default '{}',
  p_reports uuid[] default '{}',
  p_qc_by   uuid   default null,
  p_note    text   default null,
  p_key     text   default null)
returns jsonb
language plpgsql security definer
set search_path = ops_procure, ops_core, pg_temp as $$
declare
  ib      ops_procure.receiving_inbox;
  po       ops_procure.purchase_orders;
  ln       jsonb;
  docs     jsonb;
  r        jsonb;
  failed   jsonb;
  nos      text[] := '{}';
  stray    int;
  bad      text;
  v_cond   ops_procure.receipt_condition_t;
  billable numeric;
  replayed jsonb; res jsonb;
  photos   uuid[] := coalesce(p_photos, '{}');
  v_notes    uuid[] := coalesce(p_notes, '{}');
  reports  uuid[] := coalesce(p_reports, '{}');
begin
  replayed := ops_core.idem_replay('procurement','match_receiving:' || coalesce(p_rr_no, ''), p_key);
  if replayed is not null then return replayed; end if;

  if not ops_core.has_permission('procurement.update') then
    return ops_core.refused('procurement','receiving_inbox', p_rr_no,'match',
      'not_permitted','Matching an arrival needs procurement write access.');
  end if;

  select * into ib from ops_procure.receiving_inbox where rr_no = p_rr_no for update;
  if not found then
    return ops_core.not_found('procurement','receiving_inbox', p_rr_no,'match',
      format('No receiving report %s.', p_rr_no));
  end if;
  if ib.status <> 'PENDING' then
    return ops_core.conflict('procurement','receiving_inbox', p_rr_no,'match',
      'already_resolved', format('%s is already %s.', p_rr_no, lower(ib.status::text)));
  end if;

  select * into po from ops_procure.purchase_orders where po_no = btrim(coalesce(p_po_no, ''));
  if not found then
    return ops_core.not_found('procurement','receiving_inbox', p_rr_no,'match',
      format('No purchase order %s.', p_po_no));
  end if;
  if po.status <> 'ISSUED' then
    return ops_core.conflict('procurement','receiving_inbox', p_rr_no,'match',
      'order_not_open', format('%s is %s — goods arrive against an order that has been sent and is still open.',
                               po.po_no, po.status));
  end if;

  if cardinality(photos) = 0 then
    return ops_core.invalid('procurement','receiving_inbox', p_rr_no,'match',
      'photo_required','Pick at least one photo of the goods.', jsonb_build_object('field','photos'));
  end if;
  select count(*) into stray
    from unnest(photos || v_notes || reports) a
   where not exists (select 1 from ops_procure.receiving_inbox_files f
                      where f.inbox_id = ib.id and f.attachment_id = a);
  if stray > 0 then
    return ops_core.invalid('procurement','receiving_inbox', p_rr_no,'match',
      'file_not_on_report', 'Only the files that came with this message can be filed from it.',
      jsonb_build_object('field','photos'));
  end if;
  if photos && v_notes or photos && reports or v_notes && reports then
    return ops_core.invalid('procurement','receiving_inbox', p_rr_no,'match',
      'file_twice','Each file is one thing: the goods, the tanda terima, or the receiving report.',
      jsonb_build_object('field','notes'));
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    return ops_core.invalid('procurement','receiving_inbox', p_rr_no,'match',
      'lines_required','Say which lines of the order arrived, and how many.',
      jsonb_build_object('field','lines'));
  end if;
  select min(x ->> 'po_line_id') into bad
    from jsonb_array_elements(p_lines) x
   where not exists (select 1 from ops_procure.po_lines l
                      where l.id::text = x ->> 'po_line_id' and l.po_id = po.id
                        and l.superseded_by is null)
      or coalesce(nullif(x ->> 'qty', '')::numeric, 0) <= 0;
  if bad is not null then
    return ops_core.invalid('procurement','receiving_inbox', p_rr_no,'match',
      'line_not_on_order', format('Every line has to be a live line of %s, with a quantity above zero.', po.po_no),
      jsonb_build_object('field','lines','po_line_id', bad));
  end if;
  select min(x ->> 'po_line_id') into bad
    from jsonb_array_elements(p_lines) x group by x ->> 'po_line_id' having count(*) > 1;
  if bad is not null then
    return ops_core.invalid('procurement','receiving_inbox', p_rr_no,'match',
      'line_twice','An order line is listed twice — add the two counts into one.',
      jsonb_build_object('field','lines','po_line_id', bad));
  end if;
  begin
    select min(coalesce(nullif(x ->> 'condition', ''), 'GOOD')::ops_procure.receipt_condition_t::text)
      into bad from jsonb_array_elements(p_lines) x;
  exception when invalid_text_representation then
    return ops_core.invalid('procurement','receiving_inbox', p_rr_no,'match',
      'condition_unknown','A condition this system does not know.', jsonb_build_object('field','lines'));
  end;

  -- The documents every receipt carries: the goods, the tanda terima (which is
  -- what makes it CONFIRMED, D131), the signed sheet when there is one.
  select coalesce(jsonb_agg(d), '[]'::jsonb) into docs from (
    select jsonb_build_object('attachment_id', a, 'kind', 'goods_photo') d from unnest(photos) a
    union all
    select jsonb_build_object('attachment_id', a, 'kind', 'delivery_note') from unnest(v_notes) a
    union all
    select jsonb_build_object('attachment_id', a, 'kind', 'receiving_report') from unnest(reports) a
  ) x;

  begin
    for ln in select * from jsonb_array_elements(p_lines) loop
      v_cond := coalesce(nullif(ln ->> 'condition', ''), 'GOOD')::ops_procure.receipt_condition_t;
      r := ops_procure.create_receipt(
             (ln ->> 'qty')::numeric, v_cond, docs, null, (ln ->> 'po_line_id')::uuid,
             p_qc_by, coalesce(nullif(btrim(coalesce(p_note, '')), ''), 'Dari chat ' || ib.rr_no));
      if not ops_core.said_ok(r) then
        failed := r;
        raise exception using errcode = 'P0001', message = 'receipt refused';
      end if;
      nos := nos || (r -> 'data' ->> 'receipt_no');
    end loop;
  exception when sqlstate 'P0001' then
    -- Every receipt of this arrival, or none of them.
    if failed is not null then return failed; end if;
    raise;
  end;

  update ops_procure.receiving_inbox
     set status = 'MATCHED', matched_to = 'po', po_no = po.po_no, receipt_nos = nos,
         resolved_by = auth.uid(), resolved_at = now(),
         resolve_note = nullif(btrim(coalesce(p_note, '')), '')
   where id = ib.id;

  select j.billable_now into billable from ops_procure.v_po_journey j where j.po_id = po.id;

  perform ops_core.emit('procurement','procurement.receiving.matched', ib.rr_no,
    jsonb_build_object('rr_no', ib.rr_no, 'po_no', po.po_no, 'receipts', to_jsonb(nos)));

  res := ops_core.ok('procurement','receiving_inbox', ib.rr_no,'match',
    jsonb_build_object('rr_no', ib.rr_no, 'matched_to','po', 'po_no', po.po_no,
                       'receipt_nos', to_jsonb(nos),
                       'status', case when cardinality(v_notes) > 0 then 'CONFIRMED' else 'REPORTED' end,
                       'billable_now', coalesce(billable, 0)),
    jsonb_build_object('status','PENDING'),
    jsonb_build_object('status','MATCHED','po_no', po.po_no));
  return ops_core.idem_remember('procurement','match_receiving:' || p_rr_no, p_key, res);
end $$;

-- ── the aside ─────────────────────────────────────────────────────────────
create or replace function ops_procure.dismiss_receiving(p_rr_no text, p_reason text, p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
declare ib ops_procure.receiving_inbox; replayed jsonb; res jsonb;
begin
  replayed := ops_core.idem_replay('procurement','dismiss_receiving:' || coalesce(p_rr_no, ''), p_key);
  if replayed is not null then return replayed; end if;

  if not ops_core.has_permission('procurement.update') then
    return ops_core.refused('procurement','receiving_inbox', p_rr_no,'dismiss',
      'not_permitted','Setting an arrival aside needs procurement write access.');
  end if;
  select * into ib from ops_procure.receiving_inbox where rr_no = p_rr_no for update;
  if not found then
    return ops_core.not_found('procurement','receiving_inbox', p_rr_no,'dismiss',
      format('No receiving report %s.', p_rr_no));
  end if;
  if ib.status <> 'PENDING' then
    return ops_core.conflict('procurement','receiving_inbox', p_rr_no,'dismiss',
      'already_resolved', format('%s is already %s.', p_rr_no, lower(ib.status::text)));
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    return ops_core.invalid('procurement','receiving_inbox', p_rr_no,'dismiss',
      'reason_required','Say why — a duplicate, a chat reply, not a delivery.',
      jsonb_build_object('field','reason'));
  end if;

  update ops_procure.receiving_inbox
     set status = 'DISMISSED', resolved_by = auth.uid(), resolved_at = now(),
         resolve_note = btrim(p_reason)
   where id = ib.id;

  res := ops_core.ok('procurement','receiving_inbox', ib.rr_no,'dismiss',
    jsonb_build_object('rr_no', ib.rr_no, 'status','DISMISSED'),
    jsonb_build_object('status','PENDING'), jsonb_build_object('status','DISMISSED','reason', btrim(p_reason)));
  return ops_core.idem_remember('procurement','dismiss_receiving:' || p_rr_no, p_key, res);
end $$;

-- ── the payment request against an order ──────────────────────────────────
-- What is still being asked for on an order: request lines against it, live,
-- less what has already been paid on them.
create or replace function ops_procure.po_requested_open(p_po_id uuid)
returns numeric
language sql stable security definer set search_path = ops_procure, ops_acct, pg_temp as $$
  select coalesce(sum(greatest(l.item_total - coalesce((
           select sum(a.amount) from ops_acct.payment_allocations a
             join ops_acct.transactions t on t.id = a.trx_id and t.status <> 'VOID'
            where a.pr_line_no = l.line_no_full and a.superseded_by is null), 0), 0)), 0)
    from ops_procure.pr_lines l
    join ops_procure.pr_documents d on d.id = l.doc_id
   where l.against_po_id = p_po_id and l.removed_at is null and d.status <> 'CANCELLED'
$$;
revoke all on function ops_procure.po_requested_open(uuid) from public;
grant execute on function ops_procure.po_requested_open(uuid) to authenticated;

create or replace function ops_procure.request_po_payment(
  p_po_no  text,
  p_amount numeric default null,
  p_note   text    default null,
  p_key    text    default null)
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
declare
  po        ops_procure.purchase_orders;
  v_vendor  ops_procure.vendors;
  billable  numeric;
  v_asked     numeric;
  avail     numeric;
  amt       numeric;
  created   jsonb;
  submitted jsonb;
  v_doc     text;
  v_line    text;
  replayed  jsonb; res jsonb;
begin
  replayed := ops_core.idem_replay('procurement','request_po_payment:' || coalesce(p_po_no, ''), p_key);
  if replayed is not null then return replayed; end if;

  if not (ops_core.has_permission('procurement.create') and ops_core.has_permission('procurement.update')) then
    return ops_core.refused('procurement','purchase_order', p_po_no,'request_payment',
      'not_permitted','Asking for a payment needs procurement write access.');
  end if;

  select * into po from ops_procure.purchase_orders where po_no = btrim(coalesce(p_po_no, ''));
  if not found then
    return ops_core.not_found('procurement','purchase_order', p_po_no,'request_payment',
      format('No purchase order %s.', p_po_no));
  end if;
  if po.status <> 'ISSUED' then
    return ops_core.conflict('procurement','purchase_order', po.po_no,'request_payment',
      'order_not_open', format('%s is %s — a payment is asked for on an order that is open.', po.po_no, po.status));
  end if;
  select * into v_vendor from ops_procure.vendors where id = po.vendor_id;

  select j.billable_now into billable from ops_procure.v_po_journey j where j.po_id = po.id;
  v_asked := ops_procure.po_requested_open(po.id);
  avail := greatest(coalesce(billable, 0) - v_asked, 0);
  amt   := coalesce(p_amount, avail);

  if avail <= 0 then
    return ops_core.conflict('procurement','purchase_order', po.po_no,'request_payment',
      'nothing_billable',
      case when v_asked > 0
           then format('Everything billable on %s is already asked for (%s) and waiting to be paid.', po.po_no, v_asked)
           else format('Nothing on %s is billable yet — confirm what arrived first.', po.po_no) end,
      jsonb_build_object('billable_now', coalesce(billable, 0), 'already_requested', v_asked));
  end if;
  if amt <= 0 then
    return ops_core.invalid('procurement','purchase_order', po.po_no,'request_payment',
      'amount_positive','The amount asked for has to be above zero.', jsonb_build_object('field','amount'));
  end if;
  if amt > avail then
    return ops_core.invalid('procurement','purchase_order', po.po_no,'request_payment',
      'over_billable',
      format('%s is billable on %s now (%s received and owed, %s already asked for). Ask for that or less.',
             avail, po.po_no, coalesce(billable, 0), v_asked),
      jsonb_build_object('field','amount','available', avail, 'billable_now', coalesce(billable, 0),
                         'already_requested', v_asked, 'attempted', amt));
  end if;

  created := ops_procure.create_pr(jsonb_build_array(jsonb_build_object(
    'description', format('Pembayaran %s — %s', po.po_no, v_vendor.name),
    'item_total', amt,
    'vendor_id', po.vendor_id,
    'purpose', nullif(btrim(coalesce(p_note, '')), ''),
    'against_po_no', po.po_no)));
  if not ops_core.said_ok(created) then return created; end if;
  v_doc := created -> 'data' ->> 'doc_no';

  submitted := ops_procure.submit_pr(v_doc);
  if not ops_core.said_ok(submitted) then
    raise exception 'request % could not be submitted: %', v_doc, submitted;
  end if;
  select line_no_full into v_line from ops_procure.pr_lines where doc_no = v_doc order by line_no limit 1;

  perform ops_core.emit('procurement','procurement.po.payment_requested', po.po_no,
    jsonb_build_object('po_no', po.po_no, 'line_no', v_line, 'amount', amt));

  res := ops_core.ok('procurement','purchase_order', po.po_no,'request_payment',
    jsonb_build_object('po_no', po.po_no, 'doc_no', v_doc, 'line_no', v_line, 'amount', amt,
                       'billable_now', coalesce(billable, 0), 'already_requested', v_asked + amt));
  return ops_core.idem_remember('procurement','request_po_payment:' || po.po_no, p_key, res);
end $$;

-- ── a line against an order is paid on that order ────────────────────────
-- Restated whole from `0139`; the one change is marked.
create or replace function ops_acct.allocate_payment(p_trx_no text, p_amount numeric, p_pr_line_no text DEFAULT NULL::text, p_po_no text DEFAULT NULL::text, p_method ops_acct.alloc_method_t DEFAULT 'transfer'::ops_acct.alloc_method_t, p_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'ops_acct', 'ops_core', 'ops_procure', 'pg_temp'
AS $$
declare
  t ops_acct.transactions; l ops_procure.pr_lines; already numeric;
  v_target text; replayed jsonb; res jsonb; v_po_no text;
begin
  v_target := coalesce(p_pr_line_no, p_po_no);
  replayed := ops_core.idem_replay('accounting','allocate:' || coalesce(v_target, '?'), p_key);
  if replayed is not null then return replayed; end if;

  if not ops_core.has_authority('post_ledger') then
    return ops_core.refused('accounting','allocation', v_target,'allocate',
      'authority_required','Applying money to a decision belongs to Accounting.');
  end if;

  if (p_pr_line_no is null) = (p_po_no is null) then
    return ops_core.invalid('accounting','allocation', v_target,'allocate',
      'target_required',
      'An allocation points at a request line or at an order, and at exactly one.',
      jsonb_build_object('field','pr_line_no'));
  end if;
  if p_amount is null or p_amount <= 0 then
    return ops_core.invalid('accounting','allocation', v_target,'allocate',
      'amount_positive','Allocation amount must be greater than zero.',
      jsonb_build_object('field','amount'));
  end if;

  select * into t from ops_acct.transactions where trx_no = p_trx_no;
  if not found then
    return ops_core.not_found('accounting','allocation', v_target,'allocate',
      format('Transaction %s not found.', p_trx_no));
  end if;
  if t.status = 'VOID' then
    return ops_core.conflict('accounting','allocation', v_target,'allocate',
      'transaction_void', format('%s is VOID and cannot fund anything.', p_trx_no));
  end if;

  if p_pr_line_no is not null then
    select * into l from ops_procure.pr_lines where line_no_full = p_pr_line_no;
    if not found then
      return ops_core.invalid('accounting','allocation', v_target,'allocate',
        'pr_line_not_found',
        format('Line %s does not exist in procurement.', p_pr_line_no),
        jsonb_build_object('field','pr_line_no'));
    end if;
    if l.removed_at is not null then
      return ops_core.conflict('accounting','allocation', v_target,'allocate',
        'line_removed', format('Line %s has been removed.', p_pr_line_no));
    end if;
  elsif not exists (select 1 from ops_procure.purchase_orders where po_no = p_po_no) then
    return ops_core.invalid('accounting','allocation', v_target,'allocate',
      'po_not_found', format('Order %s does not exist in procurement.', p_po_no),
      jsonb_build_object('field','po_no'));
  end if;

  select coalesce(allocated_total, 0) into already
    from ops_acct.v_allocated where trx_id = t.id;

  if coalesce(already, 0) + p_amount > t.amount_idr then
    return ops_core.invalid('accounting','allocation', v_target,'allocate',
      'over_allocated',
      format('This transaction only moved %s; %s is already allocated. A transaction never funds more than it moved.',
             t.amount_idr, coalesce(already, 0)),
      jsonb_build_object('field','amount','moved', t.amount_idr,
                         'already', coalesce(already, 0), 'attempted', p_amount));
  end if;

  -- A request line that is on an order is paid on that order as well (B8).
  -- The caller still names exactly one target; the order is found here, from
  -- the link, so a screen cannot claim a line belongs to an order it does not.
  v_po_no := p_po_no;
  if p_pr_line_no is not null then
    -- 0203: … and so is a line raised *against* an order — a balance payment,
    -- a payment request from a receiving report (D358).
    v_po_no := coalesce(ops_procure.order_of_line(p_pr_line_no),
                        (select p.po_no from ops_procure.purchase_orders p where p.id = l.against_po_id));
  end if;

  insert into ops_acct.payment_allocations
    (trx_id, pr_line_no, po_no, amount, method, allocated_by)
  values (t.id, p_pr_line_no, v_po_no, p_amount, p_method, auth.uid());

  perform ops_core.emit('accounting','accounting.allocation.recorded', v_target,
    jsonb_build_object('trx_no', p_trx_no, 'pr_line_no', p_pr_line_no,
                       'po_no', v_po_no, 'amount', p_amount));

  res := ops_core.ok('accounting','allocation', v_target,'allocate',
    jsonb_build_object('trx_no', p_trx_no, 'pr_line_no', p_pr_line_no,
                       'po_no', v_po_no, 'amount', p_amount,
                       'unallocated', t.amount_idr - coalesce(already, 0) - p_amount));
  return ops_core.idem_remember('accounting','allocate:' || coalesce(v_target, '?'), p_key, res);
end $$;

-- Money already paid on a line against an order, restated as reaching it.
-- Measured on production before writing this: no line is against an order
-- yet, so this restamps nothing there — it exists so the ladder is true from
-- nothing, not as a backfill (Q58).
do $$
declare r record;
begin
  for r in
    select l.line_no_full, p.po_no
      from ops_procure.pr_lines l
      join ops_procure.purchase_orders p on p.id = l.against_po_id
     where ops_procure.order_of_line(l.line_no_full) is null
  loop
    perform ops_procure.restamp_line_money(r.line_no_full, r.po_no);
  end loop;
end $$;

revoke execute on function
  ops_procure.file_receiving(text, jsonb, text, text, timestamptz, jsonb, text),
  ops_procure.receiving_candidates(text, text),
  ops_procure.match_receiving_to_trx(text, text, uuid[], uuid[], jsonb, text, text),
  ops_procure.match_receiving_to_po(text, text, jsonb, uuid[], uuid[], uuid[], uuid, text, text),
  ops_procure.dismiss_receiving(text, text, text),
  ops_procure.request_po_payment(text, numeric, text, text)
  from public;

grant execute on function
  ops_procure.file_receiving(text, jsonb, text, text, timestamptz, jsonb, text),
  ops_procure.receiving_candidates(text, text),
  ops_procure.match_receiving_to_trx(text, text, uuid[], uuid[], jsonb, text, text),
  ops_procure.match_receiving_to_po(text, text, jsonb, uuid[], uuid[], uuid[], uuid, text, text),
  ops_procure.dismiss_receiving(text, text, text),
  ops_procure.request_po_payment(text, numeric, text, text)
  to authenticated;

-- No `service_role` grant. The bridge (`supabase/legacy/05_bridge_receiving.sql`)
-- runs inside the database from `pg_cron`, as the owner, so the worker needs no
-- key to reach this; widening the service_role list (`A2_core_execute_grants`)
-- is a decision for the day the worker calls the seam itself.

analyze ops_procure.receiving_inbox;
analyze ops_procure.receiving_inbox_files;
