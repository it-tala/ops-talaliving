-- 03_bridge_review_queue.sql — the legacy review queue, into the new inbox.
--
-- Reads `public.ledger_review_queue` and calls `ops_acct.file_evidence()` for
-- each row. It names a legacy schema, so it cannot be a migration
-- (`check_schema_isolation.sh`) and lives here.
--
-- ── A bridge, not the answer ─────────────────────────────────────────────
--
-- The capture worker is **still running and still writing to the legacy
-- queue**: 29 rows were PENDING when this was measured at 03:00, and 38 forty
-- minutes later. Anything this script copies on Monday is stale on Tuesday.
--
-- So this exists for exactly two jobs, and then it should stop being run:
--
--   1. move the open work across, so Verifikasi opens onto a real backlog
--      rather than an empty table nobody believes
--   2. prove the seam against real rows — 1.020 imported items proved nothing
--      about a document pipeline
--
-- The actual fix is step 3 of `README.md`: repoint the worker at
-- `ops_acct.file_evidence()`. It has the grant it needs as of `0033`, and the
-- function is idempotent on `ref_id`, so the worker can be switched over
-- without draining anything first — a row already bridged is answered
-- `already_filed` rather than duplicated.
--
-- ── PENDING only, deliberately ───────────────────────────────────────────
--
-- 483 rows in the queue, 445 of them CONFIRMED, REJECTED or ATTACHED. Those
-- were resolved against *legacy* transactions, which do not exist in
-- `ops_acct` — importing them would produce inbox rows pointing at ledger rows
-- that are not there, which is a worse answer than not importing them. The
-- resolved history stays in the legacy queue, where it is still readable and
-- still true. What moves is the open work.
--
-- ── The keys are translated, not copied ──────────────────────────────────
--
-- Gemini writes `IDR AMOUNT`, `IN / OUT`, `AI CONFIDENCE` — a spreadsheet's
-- column headings, because that is where the old pipeline ended. The contract
-- in `src/services/accounting/contracts.ts` reads `amount_idr`, `doc_type`,
-- `confidence`. Copying the object across verbatim would produce an inbox row
-- that looks full in the database and renders **entirely blank** on the
-- screen, which is the most expensive shape a bug can take here: it survives
-- review, because the data is visibly present.
--
-- `jsonb_strip_nulls` drops what the model could not read, so an empty string
-- in the spreadsheet becomes an absent key rather than a confident "".
--
-- ── ref_id is `rq-<queue_id>` ────────────────────────────────────────────
--
-- Not the queue's own `ref_id`, which is `<event uuid>~<slot>` and encodes a
-- PR line the row may later be detached from. `queue_id` is a bigint primary
-- key: unique, stable, and something the worker can recompute after a restart
-- without asking us anything, which is what makes the idempotency real.

\set ON_ERROR_STOP on

begin;

create temp table _bridged on commit drop as
select q.queue_id,
       ops_acct.file_evidence(
         'rq-' || q.queue_id,
         -- Drive's own file id, plus an extension so the name is openable.
         coalesce(nullif(btrim(q.extracted ->> 'DRIVE FILE NAME'), ''), 'rq-' || q.queue_id)
           || case q.mime_type
                when 'image/webp'      then '.webp'
                when 'image/jpeg'      then '.jpg'
                when 'image/png'       then '.png'
                when 'application/pdf' then '.pdf'
                else '' end,
         q.drive_link,
         'chat',
         q.uploaded_by,
         q.mime_type,
         q.size_bytes::bigint,
         null,
         jsonb_strip_nulls(jsonb_build_object(
           'vendor_name',   nullif(btrim(coalesce(q.extracted ->> 'VENDOR', '')), ''),
           'document_date', nullif(btrim(coalesce(q.extracted ->> 'DOCUMENT DATE', '')), ''),
           'amount_idr',    (nullif(btrim(coalesce(q.extracted ->> 'IDR AMOUNT', '')), ''))::numeric,
           'doc_type',      nullif(btrim(coalesce(q.extracted ->> 'DOCUMENT TYPE', '')), ''),
           'confidence',    (nullif(btrim(coalesce(q.extracted ->> 'AI CONFIDENCE', '')), ''))::numeric,
           'note',          nullif(btrim(coalesce(q.extracted ->> 'DESCRIPTION', '')), '')
         )),
         case upper(btrim(coalesce(q.extracted ->> 'IN / OUT', '')))
           when 'IN'  then 'IN'::ops_acct.direction_t
           when 'OUT' then 'OUT'::ops_acct.direction_t
           else null end
       ) as res
  from public.ledger_review_queue q
 where q.status = 'PENDING'
 order by q.queue_id;

-- The refusals are the deliverable, same as every other file here: a document
-- whose sender matches nobody is a profile somebody has to fix, not a row to
-- force through with a made-up name.
insert into ops_core.legacy_map
  (source_table, source_id, target_table, target_id, outcome, note, run_id)
select 'public.ledger_review_queue',
       b.queue_id::text,
       'ops_acct.evidence_inbox',
       null,
       case when b.res ->> 'outcome' = 'ok' then 'imported' else 'refused' end,
       case when b.res ->> 'outcome' = 'ok'
            then nullif(case when (b.res -> 'data' ->> 'already_filed')::boolean
                             then 'already filed by an earlier run' end, '')
            else coalesce(b.res -> 'error' ->> 'code', 'unknown') || ': '
                 || coalesce(b.res -> 'error' ->> 'message', '') end,
       gen_random_uuid()
  from _bridged b
 on conflict (source_table, source_id) do nothing;

commit;

\echo ''
\echo '── bridged ─────────────────────────────────────────────────────────'
select res ->> 'outcome' as outcome,
       coalesce(res -> 'error' ->> 'code', '') as code,
       count(*) as rows
  from _bridged group by 1, 2 order by 3 desc;

\echo ''
\echo '── the inbox now ───────────────────────────────────────────────────'
select status, count(*) as rows from ops_acct.evidence_inbox group by status order by 1;
