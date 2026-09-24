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
-- `ops_acct.file_evidence()`. It has the grant it needs as of `0038`, and the
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
-- ── ref_id is the queue's own `ref_id` ───────────────────────────────────
--
-- `<event uuid>~<slot>`, exactly as `card_ref(event_id, slot)` builds it in
-- `john-lau`. The first cut of this file used `rq-<queue_id>` — a bigint
-- primary key, unique and stable, and **wrong**, for a reason that only shows
-- up one step later: `queue_id` is assigned by the insert, so the worker does
-- not know it at the moment it would call `file_evidence()`. The worker would
-- have filed under `<event>~<slot>` and the bridge under `rq-493`, and the
-- same document would sit in the inbox twice with nothing to tie the two
-- together.
--
-- The rule the seam's header states is the right one and was misapplied here:
-- ref_id is **the source's own id**, and the source's own id is the one the
-- source can compute again from what it holds. The 38 rows already bridged
-- were re-keyed rather than re-filed.

-- ── Run twice: 2026-09-21 (38 rows) and 2026-09-24 (35 rows) ────────────
--
-- The second run is the argument of the section above, arriving on schedule.
-- The mirror in `john-lau` merged on 2026-09-21 and was never deployed, so the
-- legacy queue kept filling and the inbox did not: 35 documents, Rp
-- 149.082.398, every one dated on or after 2026-09-22 — the day after the last
-- mirrored row. Dry run first (35 filed, 0 refused), then for real: 35 filed,
-- 0 refused, 35 rows in `ops_core.legacy_map`.
--
-- Running it a third time is a symptom, not a task. The fix is the deploy.
--
-- ── Re-runnable, and the join is what makes the report worth reading ─────
--
-- The seam is idempotent, so a second run was always safe — it just answered
-- `already_filed` 38 times and buried whatever was new. The left join skips
-- what the inbox already holds, so the `bridged` count below is the number of
-- documents this run actually carried across. It also drops the rows the web
-- app has already decided while the old queue stayed PENDING: those are not
-- open work, they are a stale legacy status, and
-- `supabase/import/09_queue_reconciliation.sql` reports them as GAP 2.
--
\set ON_ERROR_STOP on

begin;

-- Not `on commit drop`: the two reports at the foot of this file read this
-- table *after* the commit, and an on-commit-drop table is gone by then. The
-- first run ended on `relation "_bridged" does not exist` with the bridge
-- itself already committed — a script that did its job and reported a failure,
-- which is the one failure mode that makes people distrust a correct run. It
-- is dropped explicitly at the end instead.
create temp table _bridged as
select q.queue_id,
       ops_acct.file_evidence(
         q.ref_id,
         -- Drive's own file id, plus an extension so the name is openable.
         coalesce(nullif(btrim(q.extracted ->> 'DRIVE FILE NAME'), ''), q.ref_id)
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
           else null end,
         -- When the photograph was taken, not when this script ran. Omitting
         -- it defaults to `now()` and puts every bridged document at the top
         -- of the queue in bridge order, which is why `04_backfill_reported_at
         -- .sql` had to exist. Migration `0096` added this parameter so it
         -- does not have to exist twice.
         coalesce(q.captured_at, q.created_at)
       ) as res
  from public.ledger_review_queue q
  left join ops_acct.evidence_inbox e on e.ref_id = q.ref_id
 where q.status = 'PENDING' and e.ref_id is null
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

drop table _bridged;
