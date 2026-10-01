-- 0205_procure_receiving_nota_lines.sql — a receipt / nota as a file of a
-- Chat arrival, and an inventory line that can be completed (D361, F213).
--
-- Written as its own migration because `0204` (D360) reached production
-- first: PR #114 was merged on its first commit, and an applied migration is
-- never edited. Everything here is a restatement of what `0204` defined, plus
-- one helper.
--
-- ── the nota's folder ─────────────────────────────────────────────────────
--
-- A file marked as the receipt / nota is filed where every nota is filed: its
-- kind decides the drive (`doc_kind_drive`: ACCOUNTING) and the folder
-- (`drive_paths`: `NOTA`, or the TRANSACTIONS month tree once IT adds that
-- row, D359). `receiving_file_kind` answers *what was this file used as*, for
-- the plan and for the recorded copy's drive.

-- The kind a file was used as decides its folder and its drive: the nota
-- goes where every nota goes (ACCOUNTING, `doc_kind_drive`), the rest to
-- RECEIVING REPORT in PROCUREMENT.
create or replace function ops_procure.receiving_file_kind(p_attachment_id uuid)
returns ops_core.doc_kind_t
language sql stable security definer set search_path = ops_procure, ops_core, pg_temp as $$
  select case
           when bool_or(k.kind = 'nota')             then 'nota'
           when bool_or(k.kind = 'receiving_report') then 'receiving_report'
           when bool_or(k.kind = 'delivery_note')    then 'delivery_note'
           else 'goods_photo' end::ops_core.doc_kind_t
    from ops_core.attachment_links k
   where k.attachment_id = p_attachment_id and k.unlinked_at is null
$$;
revoke all on function ops_procure.receiving_file_kind(uuid) from public;
grant execute on function ops_procure.receiving_file_kind(uuid) to authenticated;

-- ── what to copy, and where: the kind now includes the nota ──────────────
create or replace function ops_procure.receiving_archive_plan(p_rr_no text)
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
declare ib ops_procure.receiving_inbox; v_day date; v_files jsonb;
begin
  if not ops_core.has_permission('procurement.update') then
    return ops_core.refused('procurement','receiving_inbox', p_rr_no,'archive',
      'not_permitted','Filing an arrival''s photos needs procurement write access.');
  end if;
  select * into ib from ops_procure.receiving_inbox where rr_no = p_rr_no;
  if not found then
    return ops_core.not_found('procurement','receiving_inbox', p_rr_no,'archive',
      format('No receiving report %s.', p_rr_no));
  end if;
  if ib.status <> 'MATCHED' then
    return ops_core.conflict('procurement','receiving_inbox', p_rr_no,'archive',
      'not_matched', format('%s is %s — its photos are filed once it is matched.', p_rr_no, lower(ib.status::text)));
  end if;

  v_day := ops_core.office_day(ib.reported_at);

  -- A file is filed under the kind it was used as: a signed sheet as the
  -- receiving report, the tanda terima as the delivery note, else a photo.
  select coalesce(jsonb_agg(jsonb_build_object(
           'attachment_id', a.id, 'url', a.url, 'filename', a.filename, 'mime', a.mime,
           'kind', x.kind,
           'path', ops_core.drive_path_for(x.kind, null, v_day)) order by f.added_at), '[]'::jsonb)
    into v_files
    from ops_procure.receiving_inbox_files f
    join ops_core.attachments a on a.id = f.attachment_id
    cross join lateral (
      select ops_procure.receiving_file_kind(a.id) as kind,
             (select count(*) from ops_core.attachment_links k
               where k.attachment_id = a.id and k.unlinked_at is null) as n
    ) x
   where f.inbox_id = ib.id
     and f.original_attachment_id is null
     and a.url is not null
     and x.n > 0;

  return jsonb_build_object('outcome','ok','status',200,'data', jsonb_build_object(
    'rr_no', ib.rr_no, 'day', v_day, 'files', v_files));
end $$;

-- ── the copy, recorded in the drive of its kind ──────────────────────────
create or replace function ops_procure.receiving_file_archived(
  p_rr_no          text,
  p_attachment_id  uuid,
  p_drive_file_id  text,
  p_web_view_link  text,
  p_folder_id      text,
  p_path           text,
  p_bytes          bigint default null,
  p_sha256         text   default null)
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
declare
  ib    ops_procure.receiving_inbox;
  v_old ops_core.attachments;
  v_new uuid;
  k     ops_core.attachment_links;
  n     int := 0;
  v_link text := nullif(btrim(coalesce(p_web_view_link, '')), '');
begin
  if not ops_core.has_permission('procurement.update') then
    return ops_core.refused('procurement','receiving_inbox', p_rr_no,'archive',
      'not_permitted','Filing an arrival''s photos needs procurement write access.');
  end if;
  select * into ib from ops_procure.receiving_inbox where rr_no = p_rr_no for update;
  if not found then
    return ops_core.not_found('procurement','receiving_inbox', p_rr_no,'archive',
      format('No receiving report %s.', p_rr_no));
  end if;
  if ib.status <> 'MATCHED' then
    return ops_core.conflict('procurement','receiving_inbox', p_rr_no,'archive',
      'not_matched', format('%s is %s — its photos are filed once it is matched.', p_rr_no, lower(ib.status::text)));
  end if;

  -- Already filed: the row now points at the copy and remembers the capture.
  if exists (select 1 from ops_procure.receiving_inbox_files f
              where f.inbox_id = ib.id and f.original_attachment_id = p_attachment_id) then
    return ops_core.noop('procurement','receiving_inbox', p_rr_no,'archive',
      'already_filed', jsonb_build_object('rr_no', p_rr_no, 'attachment_id', p_attachment_id));
  end if;
  if not exists (select 1 from ops_procure.receiving_inbox_files f
                  where f.inbox_id = ib.id and f.attachment_id = p_attachment_id) then
    return ops_core.invalid('procurement','receiving_inbox', p_rr_no,'archive',
      'file_not_on_report', 'Only a file that came with this message can be filed from it.',
      jsonb_build_object('field','attachment_id'));
  end if;
  if coalesce(btrim(p_drive_file_id), '') = '' or coalesce(btrim(p_folder_id), '') = ''
     or coalesce(btrim(p_path), '') = '' then
    return ops_core.invalid('procurement','receiving_inbox', p_rr_no,'archive',
      'drive_file_required','Say which Drive file the copy is, the folder it is in, and its path.',
      jsonb_build_object('field','drive_file_id'));
  end if;
  if v_link is not null and v_link !~ '^https://(drive|docs)\.google\.com/' then
    return ops_core.invalid('procurement','receiving_inbox', p_rr_no,'archive',
      'not_a_drive_link','The link recorded for a filed copy must be the one Google Drive gave it.',
      jsonb_build_object('field','web_view_link'));
  end if;

  select * into v_old from ops_core.attachments where id = p_attachment_id;

  insert into ops_core.attachments (storage_path, filename, mime, bytes, sha256, source, uploaded_by,
                                    web_view_link, drive_slug, drive_path, drive_folder_id)
  values (btrim(p_drive_file_id), v_old.filename, v_old.mime, coalesce(p_bytes, v_old.bytes),
          coalesce(nullif(btrim(coalesce(p_sha256, '')), ''), v_old.sha256),
          'chat', auth.uid(),
          coalesce(v_link, format('https://drive.google.com/file/d/%s/view', btrim(p_drive_file_id))),
          (select d.slug from ops_core.doc_kind_drive d where d.kind = ops_procure.receiving_file_kind(v_old.id)),
          btrim(p_path), btrim(p_folder_id))
  returning id into v_new;

  -- Every record that shows the capture now shows the copy: the old link is
  -- unlinked, the same link made for the copy.
  for k in
    select * from ops_core.attachment_links
     where attachment_id = v_old.id and unlinked_at is null
  loop
    update ops_core.attachment_links
       set unlinked_at = now(), unlinked_by = auth.uid()
     where id = k.id;
    insert into ops_core.attachment_links (attachment_id, entity, entity_no, kind, note, linked_by)
    values (v_new, k.entity, k.entity_no, k.kind,
            coalesce(k.note, format('Filed in RECEIVING REPORT from %s', p_rr_no)), auth.uid())
    on conflict (attachment_id, entity, entity_no, kind) where unlinked_at is null do nothing;
    n := n + 1;
  end loop;

  update ops_procure.receiving_inbox_files
     set attachment_id = v_new, original_attachment_id = v_old.id
   where inbox_id = ib.id and attachment_id = v_old.id;

  perform ops_core.emit('procurement','procurement.receiving.archived', p_rr_no,
    jsonb_build_object('rr_no', p_rr_no, 'from', v_old.id, 'attachment_id', v_new,
                       'drive_file_id', btrim(p_drive_file_id), 'path', btrim(p_path), 'links', n));

  return ops_core.ok('procurement','receiving_inbox', p_rr_no,'archive',
    jsonb_build_object('rr_no', p_rr_no, 'attachment_id', v_new, 'from', v_old.id,
                       'path', btrim(p_path), 'links_moved', n));
end $$;

revoke execute on function
  ops_procure.receiving_archive_plan(text),
  ops_procure.receiving_file_archived(text, uuid, text, text, text, text, bigint, text)
  from public;
grant execute on function
  ops_procure.receiving_archive_plan(text),
  ops_procure.receiving_file_archived(text, uuid, text, text, text, text, bigint, text)
  to authenticated;

-- ── the match, with a receipt / nota and a fuller inventory line ───────
--
-- The owner, 2026-10-01, on the match drawer: *tambah opsi sebagai "Receipt /
-- Nota"*, and *ketika masuk ke inventory selalu error — perbaiki dan lengkapi
-- kolom isiannya*. Production showed no failed call at all: ten matches went
-- through **with the inventory lines removed**, and the assets were then
-- registered by hand in inventory and edited for brand and location. The line
-- could not be completed (the screen's fault, F213), and the line it would
-- have written was missing the fields people then typed elsewhere.
--
--   * `p_notas`: files that are the receipt / nota. Against a transaction,
--     the ledger row's *Receipt / Invoice / Nota*; against an order, the
--     order's. A message that is only the nota is enough against a
--     transaction (a photo or a nota, not necessarily a photo).
--   * a material line may carry a price per unit (never zero, D172);
--   * an asset line may carry its brand, its place (a location on the list,
--     by code or name, as the register's trigger resolves it) and who holds it.
--
-- Restated whole from 0203 with the changes above; the old signatures are
-- dropped (`00_no_overloads`), the new parameter is last so positional
-- callers keep working.
drop function if exists ops_procure.match_receiving_to_trx(text, text, uuid[], uuid[], jsonb, text, text);
drop function if exists ops_procure.match_receiving_to_po(text, text, jsonb, uuid[], uuid[], uuid[], uuid, text, text);

create or replace function ops_procure.match_receiving_to_trx(
  p_rr_no   text,
  p_trx_no  text,
  p_photos  uuid[],
  p_reports uuid[] default '{}',
  p_lines   jsonb  default '[]'::jsonb,
  p_note    text   default null,
  p_key     text   default null,
  p_notas   uuid[] default '{}')
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
  notas   uuid[] := coalesce(p_notas, '{}');
  v_brand text;
  v_holder text;
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

  -- A photo of the goods, or the nota itself: a message that is only the
  -- receipt is still evidence for the ledger row (D360).
  if cardinality(photos) = 0 and cardinality(notas) = 0 then
    return ops_core.invalid('procurement','receiving_inbox', p_rr_no,'match',
      'photo_required','Pick at least one file — a photo of the goods, or the receipt / nota.',
      jsonb_build_object('field','photos'));
  end if;
  select count(*) into stray
    from unnest(photos || reports || notas) a
   where not exists (select 1 from ops_procure.receiving_inbox_files f
                      where f.inbox_id = ib.id and f.attachment_id = a);
  if stray > 0 then
    return ops_core.invalid('procurement','receiving_inbox', p_rr_no,'match',
      'file_not_on_report', 'Only the files that came with this message can be filed from it.',
      jsonb_build_object('field','photos'));
  end if;
  if photos && reports or photos && notas or reports && notas then
    return ops_core.invalid('procurement','receiving_inbox', p_rr_no,'match',
      'file_twice','A file is one thing: the photo of the goods, the receiving report, or the receipt / nota.',
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
      -- Never zero: an unpriced line leaves the move unpriced (D172).
      if nullif(ln ->> 'unit_cost', '')::numeric <= 0 then
        return ops_core.invalid('procurement','receiving_inbox', p_rr_no,'match',
          'cost_not_positive', format('The price of %s is above zero, or left empty.', v_code),
          jsonb_build_object('field','lines','item_code', v_code));
      end if;
    elsif v_kind = 'asset' then
      v_cnt := coalesce(nullif(ln ->> 'count', '')::int, 1);
      if coalesce(btrim(ln ->> 'name'), '') = '' then
        return ops_core.invalid('procurement','receiving_inbox', p_rr_no,'match',
          'name_required','An asset needs a name.', jsonb_build_object('field','lines'));
      end if;
      if v_cnt < 1 or v_cnt > 50 then
        return ops_core.invalid('procurement','receiving_inbox', p_rr_no,'match',
          'bad_count','Between 1 and 50 of one asset at a time — each one is its own row in the register.',
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
      -- The register's own rule (0197): a place on the list, by code or name.
      v_loc := nullif(btrim(coalesce(ln ->> 'location', '')), '');
      if v_loc is not null and not exists (
           select 1 from ops_inv.stock_locations l
            where l.code = upper(v_loc) or lower(l.name) = lower(v_loc)) then
        return ops_core.invalid('procurement','receiving_inbox', p_rr_no,'match',
          'location_unknown', format('No location %s on the list.', v_loc), jsonb_build_object('field','lines'));
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
  insert into ops_core.attachment_links (attachment_id, entity, entity_no, kind, linked_by)
  select a, 'transaction', t.trx_no, 'nota', auth.uid() from unnest(notas) a
  on conflict (attachment_id, entity, entity_no, kind) where unlinked_at is null do nothing;

  for ln in select * from jsonb_array_elements(v_lines) loop
    if ln ->> 'kind' = 'material' then
      v_code := btrim(ln ->> 'item_code');
      v_uom  := ops_inv.stock_item_uom(v_code);
      v_qty  := (ln ->> 'qty')::numeric;
      v_loc  := coalesce(nullif(btrim(coalesce(ln ->> 'location', '')), ''),
                         (select s.home_location from ops_inv.stock_settings s where s.item_code = v_code),
                         'GUDANG');
      v_cost := nullif(ln ->> 'unit_cost', '')::numeric;
      insert into ops_inv.stock_moves (item_code, location, kind, qty, uom, unit_cost, ref_no, reason, moved_by)
      values (v_code, v_loc, 'receipt', v_qty, v_uom, v_cost, ib.rr_no,
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
      v_brand  := nullif(btrim(coalesce(ln ->> 'brand', '')), '');
      v_holder := nullif(btrim(coalesce(ln ->> 'holder', '')), '');
      v_loc    := nullif(btrim(coalesce(ln ->> 'location', '')), '');
      for i in 1 .. v_cnt loop
        -- `location` is resolved to its code by the register's own trigger.
        insert into ops_inv.assets (name, category_code, brand, location, holder, status, acquired_on,
                                    purchase_cost, vendor_code, trx_no, notes, created_by, ownership)
        values (v_name, v_cat, v_brand, v_loc, v_holder, 'in_use', t.trx_date, v_cost, v_ven, t.trx_no,
                format('Dari laporan penerimaan %s', ib.rr_no), auth.uid(), 'owned')
        returning asset_no into v_no;
        assets := assets || v_no;
        if cardinality(photos) > 0 then
          insert into ops_core.attachment_links (attachment_id, entity, entity_no, kind, linked_by)
          values (photos[1], 'asset', v_no, ops_core.doc_kind_of('Foto'), auth.uid())
          on conflict (attachment_id, entity, entity_no, kind) where unlinked_at is null do nothing;
        end if;
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
                       'item_photos', cardinality(photos), 'receiving_reports', cardinality(reports),
                       'notas', cardinality(notas)),
    jsonb_build_object('status','PENDING'),
    jsonb_build_object('status','MATCHED','trx_no', t.trx_no));
  return ops_core.idem_remember('procurement','match_receiving:' || p_rr_no, p_key, res);
end $$;

create or replace function ops_procure.match_receiving_to_po(
  p_rr_no   text,
  p_po_no   text,
  p_lines   jsonb,
  p_photos  uuid[],
  p_notes   uuid[] default '{}',
  p_reports uuid[] default '{}',
  p_qc_by   uuid   default null,
  p_note    text   default null,
  p_key     text   default null,
  p_notas   uuid[] default '{}')
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
  notas    uuid[] := coalesce(p_notas, '{}');
  everything uuid[];
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
    from unnest(photos || v_notes || reports || notas) a
   where not exists (select 1 from ops_procure.receiving_inbox_files f
                      where f.inbox_id = ib.id and f.attachment_id = a);
  if stray > 0 then
    return ops_core.invalid('procurement','receiving_inbox', p_rr_no,'match',
      'file_not_on_report', 'Only the files that came with this message can be filed from it.',
      jsonb_build_object('field','photos'));
  end if;
  everything := photos || v_notes || reports || notas;
  if cardinality(everything) <> (select count(distinct x) from unnest(everything) x) then
    return ops_core.invalid('procurement','receiving_inbox', p_rr_no,'match',
      'file_twice','Each file is one thing: the goods, the tanda terima, the receiving report, or the receipt / nota.',
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

  -- The vendor's nota is the order's: it is what the order is paid against.
  insert into ops_core.attachment_links (attachment_id, entity, entity_no, kind, linked_by)
  select a, 'purchase_order', po.po_no, 'nota', auth.uid() from unnest(notas) a
  on conflict (attachment_id, entity, entity_no, kind) where unlinked_at is null do nothing;

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

revoke execute on function
  ops_procure.match_receiving_to_trx(text, text, uuid[], uuid[], jsonb, text, text, uuid[]),
  ops_procure.match_receiving_to_po(text, text, jsonb, uuid[], uuid[], uuid[], uuid, text, text, uuid[])
  from public;
grant execute on function
  ops_procure.match_receiving_to_trx(text, text, uuid[], uuid[], jsonb, text, text, uuid[]),
  ops_procure.match_receiving_to_po(text, text, jsonb, uuid[], uuid[], uuid[], uuid, text, text, uuid[])
  to authenticated;
