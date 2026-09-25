-- ops_procure — a request line can stand on the order it is against (`0158`).
--
-- ── What this is for ─────────────────────────────────────────────────────
--
-- The meeting board refuses a line with nothing behind it (D125). Until `0158`
-- the only way to satisfy that was to attach a document — so a balance payment
-- against an order we already hold meant photographing or re-uploading the PO,
-- filing a copy of a record that is already in this database.
--
-- Measured before building: ten open orders, **none carrying a single
-- attachment**. "Pick a PO and reuse its document" had no document to reuse.
-- The order is the better evidence anyway: a record with its own lines, prices
-- and approval, not a picture of one.
--
-- ── The structural change, and why it needed one ─────────────────────────
--
-- `v_line_evidence` used to start from `attachment_links`, so a line with
-- nothing filed produced **no row at all**. That was survivable while an
-- attachment was the only possible support. It is not survivable now: a line
-- whose only support is the order it is against has no attachment, and would
-- have been missing from the one view whose job is to answer "is this
-- supported". §1 asserts the view answers for every line.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('dddddddd-0000-0000-0000-0000000000a5','andi@talaliving.com','{"full_name":"Andi Prasetyo"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('dddddddd-0000-0000-0000-0000000000a5','procurement','admin');

insert into ops_procure.vendors (id, code, name, is_curated) values
  ('11110000-0000-0000-0000-0000000000a5','V-8501','TOKO PO', true);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"dddddddd-0000-0000-0000-0000000000a5","role":"authenticated"}', true);

/* ── 1. every line gets an answer, supported or not ─────────────────────── */
do $$
declare r jsonb; doc text; n int;
begin
  r := ops_procure.create_pr(jsonb_build_array(
        jsonb_build_object('description','Kayu tanpa apa-apa di belakangnya',
                           'qty',1,'unit_price',100000,'uom','pcs')));
  assert ops_core.said_ok(r), format('got %s', r);
  doc := r -> 'data' ->> 'doc_no';

  select count(*) into n
    from ops_procure.pr_lines l
    join ops_procure.v_line_evidence e on e.line_id = l.id
   where l.doc_no = doc;
  assert n = 1,
    'a line with nothing filed against it must still HAVE a row in v_line_evidence — '
    || 'otherwise the one view that answers "is this supported" is silent about exactly '
    || 'the lines that are not, got ' || n;

  assert not (select e.has_support
                from ops_procure.pr_lines l
                join ops_procure.v_line_evidence e on e.line_id = l.id
               where l.doc_no = doc),
    'nothing is behind this line, and the view has to say so';
end $$;

/* ── 2. an order the line is against IS what stands behind it ───────────── */
do $$
declare r jsonb; po text; doc text; supported boolean; against uuid;
begin
  r := ops_procure.create_po('V-8501', jsonb_build_array(
        jsonb_build_object('description','Kusen jati','qty',4,'uom','unit','unit_price',2500000)));
  assert ops_core.said_ok(r), format('po: %s', r);
  po := r -> 'data' ->> 'po_no';

  r := ops_procure.create_pr(jsonb_build_array(
        jsonb_build_object('description','Pelunasan ' || po,
                           'item_total',3000000, 'against_po_no', po)));
  assert ops_core.said_ok(r), format('pr: %s', r);
  doc := r -> 'data' ->> 'doc_no';

  select e.has_support, l.against_po_id into supported, against
    from ops_procure.pr_lines l
    join ops_procure.v_line_evidence e on e.line_id = l.id
   where l.doc_no = doc;

  assert against is not null, 'the order was named and has to be recorded on the line';
  assert supported,
    'a line raised against an open order stands on that order — no attachment, and none needed';
end $$;

/* ── 3. an order we do not hold is refused, by name, before anything is written */
--
-- Silently filing it as null would be the worst answer available: the line
-- would be saved having lost the one thing standing behind it, and refused at
-- the meeting with nobody able to say why.
do $$
declare r jsonb; n_before int; n_after int;
begin
  select count(*) into n_before from ops_procure.pr_documents;

  r := ops_procure.create_pr(jsonb_build_array(
        jsonb_build_object('description','Pelunasan pesanan hantu',
                           'item_total',1000, 'against_po_no','po-26-01-01_99')));
  assert r ->> 'outcome' <> 'ok', format('an order we do not hold is not evidence, got %s', r);
  assert r -> 'error' ->> 'message' like '%po-26-01-01_99%',
    format('and the refusal names which order, got %s', r);

  select count(*) into n_after from ops_procure.pr_documents;
  assert n_before = n_after,
    'refused before anything was written — a half-made request is worse than none';
end $$;

/* ── 4. a closed order is not an open one ───────────────────────────────── */
do $$
declare r jsonb; po text;
begin
  r := ops_procure.create_po('V-8501', jsonb_build_array(
        jsonb_build_object('description','Pesanan yang sudah ditutup',
                           'qty',1,'uom','unit','unit_price',500000)));
  assert ops_core.said_ok(r), format('po: %s', r);
  po := r -> 'data' ->> 'po_no';

  set local role postgres;
  update ops_procure.purchase_orders set status = 'CLOSED' where po_no = po;
  set local role authenticated;

  r := ops_procure.create_pr(jsonb_build_array(
        jsonb_build_object('description','Pelunasan pesanan tertutup',
                           'item_total',1000, 'against_po_no', po)));
  assert r ->> 'outcome' <> 'ok',
    format('a closed order cannot be what a new request is raised against, got %s', r);
  assert r -> 'error' ->> 'message' like '%' || po || '%', format('got %s', r);
end $$;

/* ── 5. nothing else about the seam moved ───────────────────────────────── */
--
-- `0158` rewrites `create_pr` whole, which is how a refusal gets dropped by
-- transcription. It happened on the first draft of this migration: the
-- `lines_required` check went missing and three smoke files caught it. Asserted
-- here too, next to the change that endangered it.
do $$
declare r jsonb;
begin
  r := ops_procure.create_pr('[]'::jsonb);
  assert r -> 'error' ->> 'code' = 'lines_required',
    format('a request with no lines is still refused, got %s', r);

  r := ops_procure.create_pr(jsonb_build_array(
        jsonb_build_object('description','Ongkos kirim','item_total',300000)),
       'tidak-ada-proyek-ini');
  assert r ->> 'outcome' <> 'ok', format('an unknown project is still a 404, got %s', r);
end $$;

rollback;
