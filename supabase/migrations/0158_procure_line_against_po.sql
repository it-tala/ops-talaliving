-- 0158 — a request line can say which order it is against, and that counts as
--        what stands behind it.
--
-- ── The gap ──────────────────────────────────────────────────────────────
--
-- The meeting board refuses a line with nothing behind it (D125), and the only
-- way to satisfy that was to attach a document. For a balance payment against
-- an order we already hold, that meant photographing or re-uploading the PO —
-- a copy of a record already sitting in this database, filed as though it were
-- an outside document.
--
-- The owner, 2026-09-24: *daripada upload link pdf sebagai support document
-- tipe PO, dia mencari dari daftar PO kita yang terbuka.* And the workflow is
-- already named in the bot — "buatkan PR untuk balance payment PO HADI GLASS".
--
-- Measured before building: **ten open orders, none of them carrying a single
-- attachment.** So "pick a PO and reuse its document" had no document to reuse.
-- The order itself is the better evidence anyway: it is a record in this
-- database with its own lines, prices and approval, not a picture of one.
--
-- ── Why a column and not an attachment ───────────────────────────────────
--
-- `attachment_links` files *documents* against records. A purchase order is not
-- a document here, it is a record — giving it a row in `attachments` so a line
-- could point at it would be inventing a file that does not exist, which is the
-- thing this repo's import rules refuse to do anywhere else.
--
-- The relationship in the other direction already exists: `po_lines.pr_line_id`
-- says an order line was raised *from* a request line. This is its mirror, for
-- the case that runs the other way — a request raised *against* an order that
-- is already open.

alter table ops_procure.pr_lines
  add column against_po_id uuid references ops_procure.purchase_orders(id);

comment on column ops_procure.pr_lines.against_po_id is
  'The open order this request is against — a balance payment, a call-off. '
  'Counts as what stands behind the line (v_line_evidence.has_support).';

-- Partial: almost every line is against nothing, and an index over all of them
-- would be mostly nulls.
create index pr_lines_against_po_idx
  on ops_procure.pr_lines (against_po_id) where against_po_id is not null;

-- ── The evidence view, rewritten to answer for every line ────────────────
--
-- It used to start from `attachment_links`, so a line with nothing filed
-- against it produced **no row at all** and every caller had to remember
-- `coalesce(…, false)`. That was survivable while the only possible support was
-- an attachment. It is not survivable now: a line whose only support is the
-- order it is against has no attachment, and would have been absent from the
-- one view whose job is to say whether it is supported.
--
-- So it starts from the lines. Every line has a row; `evidence_count` is 0 and
-- `kinds` is empty where nothing is filed, which is the honest answer to "what
-- is on this line" rather than the absence of one.
create or replace view ops_procure.v_line_evidence as
  with direct as (
    select l.id as line_id, k.kind, 1 as counts_as_own
      from ops_procure.pr_lines l
      join ops_core.attachment_links k
        on k.entity = 'pr_line' and k.entity_no = l.line_no_full
       and k.unlinked_at is null
  ), via_money as (
    select l.id as line_id, k.kind, 0 as counts_as_own
      from ops_procure.pr_lines l
      join ops_acct.payment_allocations al
        on al.pr_line_no = l.line_no_full and al.superseded_by is null
      join ops_acct.transactions t on t.id = al.trx_id and t.status <> 'VOID'
      join ops_core.attachment_links k
        on k.entity = 'transaction' and k.entity_no = t.trx_no
       and k.unlinked_at is null
  ), all_kinds as (
    select * from direct union all select * from via_money
  ), filed as (
    select line_id,
           array_agg(distinct kind)                  as kinds,
           -- The strip on the row counts what is filed **on the line**; the
           -- kinds above include what is filed on the money, because that is
           -- what answers "is this paid for". Two questions, two numbers.
           count(*) filter (where counts_as_own = 1)  as evidence_count,
           bool_or(kind = 'transfer_proof')           as has_payment_proof,
           bool_or(kind in ('quotation','nota','purchase_order','other')) as has_filed_support
      from all_kinds
     group by line_id
  )
  select l.id                                        as line_id,
         coalesce(f.kinds, '{}'::ops_core.doc_kind_t[]) as kinds,
         coalesce(f.evidence_count, 0)::bigint        as evidence_count,
         coalesce(f.has_payment_proof, false)         as has_payment_proof,
         -- Does anything stand behind this request — a shop link, an invoice, a
         -- bill, an order? Nobody should be asked to approve a number with
         -- nothing behind it (D125). An open order this line is against is one
         -- of those things, and a stronger one than a photograph of it.
         coalesce(f.has_filed_support, false) or l.against_po_id is not null
                                                      as has_support,
         l.against_po_id                              as against_po_id
    from ops_procure.pr_lines l
    left join filed f on f.line_id = l.id;

alter view ops_procure.v_line_evidence set (security_invoker = on);
grant select on ops_procure.v_line_evidence to authenticated;

-- ── The line can be raised against an order in the first act ─────────────
--
-- `against_po_no` on each line of `p_lines`, additive, so every existing caller
-- keeps working unchanged (F137).
--
-- An unknown or closed order is **refused before anything is written**, naming
-- the order, rather than quietly filed as null — a line that silently lost the
-- one thing standing behind it would be refused at the meeting with nobody able
-- to say why.
create or replace function ops_procure.create_pr(
  p_lines jsonb,
  p_project_code text default null,
  p_doc_type ops_procure.pr_doc_type_t default 'PR',
  p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
declare
  v_doc_no text; v_doc_id uuid; proj uuid; n int;
  bad_po text;
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

  -- Every order named has to be one we hold and one still open.
  select string_agg(distinct x.po_no, ', ' order by x.po_no) into bad_po
    from (select nullif(btrim(l ->> 'against_po_no'), '') as po_no
            from jsonb_array_elements(p_lines) l) x
   where x.po_no is not null
     and not exists (select 1 from ops_procure.purchase_orders p
                      where p.po_no = x.po_no
                        and p.status in ('DRAFT','ISSUED'));
  if bad_po is not null then
    return ops_core.not_found('procurement','pr_document', null,'create',
      format('No open order %s. A request can only be raised against an order we hold '
             || 'that is still open.', bad_po));
  end if;

  v_doc_no := ops_core.next_doc_number('pr');

  insert into ops_procure.pr_documents (doc_no, doc_type, status, requested_by, project_id)
  values (v_doc_no, p_doc_type, 'DRAFT', auth.uid(), proj)
  returning id into v_doc_id;

  insert into ops_procure.pr_lines
    (doc_id, doc_no, line_no, item_id, description, qty, uom, unit_price,
     item_total, vendor_id, category, purpose, need_by, source_wo_no, against_po_id)
  select v_doc_id, v_doc_no, ord,
         nullif(l ->> 'item_id','')::uuid,
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
         nullif(l ->> 'source_wo_no',''),
         (select p.id from ops_procure.purchase_orders p
           where p.po_no = nullif(btrim(l ->> 'against_po_no'), ''))
    from jsonb_array_elements(p_lines) with ordinality as t(l, ord);

  get diagnostics n = row_count;

  perform ops_core.emit('procurement','procurement.pr.created', v_doc_no,
    jsonb_build_object('doc_no', v_doc_no, 'lines', n));

  res := ops_core.ok('procurement','pr_document', v_doc_no,'create',
    jsonb_build_object('doc_no', v_doc_no, 'status','DRAFT','lines', n));
  return ops_core.idem_remember('procurement','create_pr', p_key, res);
end $$;
