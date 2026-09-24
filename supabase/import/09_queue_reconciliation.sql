-- 09_queue_reconciliation.sql — nothing waiting in the old queue is invisible
-- in the new one.
--
-- ── The owner's rule, and why it needs a script ─────────────────────────
--
-- Owner, 2026-09-24: *kita harus pastikan setiap di ledger review queue harus
-- bersih, jika ada yang belum di confirm harus bisa tampil di queue web app.*
--
-- That is one invariant, and it is the whole cutover condition:
--
--     every row still PENDING in `public.ledger_review_queue`
--     appears in `ops_acct.evidence_inbox` as PENDING
--
-- Until it holds, turning the old screens off loses work — not documents, which
-- are safe in Drive either way, but the *knowledge that somebody still has to
-- decide about them*. That knowledge lives only in a queue, and a queue nobody
-- can see is an empty queue.
--
-- ── Why this is a script here and not a view in `ops_acct` ──────────────
--
-- It has to read `public.*`, and `check_schema_isolation.sh` refuses any
-- migration that names a schema outside `ops_*`. That guard is the reason both
-- systems can share one database at all, so the reconciliation lives on this
-- side of the line — in `supabase/import/`, which reads the old system by
-- definition. The new system never learns that `public` exists.
--
-- ── What it does NOT flag, and why that took a wrong turn to learn ──────
--
-- `CONFIRMED` in the old queue with `REJECTED` in the web app looks like the
-- two systems contradicting each other about real money, and on 2026-09-24 it
-- was reported that way. It is not. Twenty rows carry exactly that pair and
-- every one of them is rejected `duplicate upload` — which is **correct**: the
-- document was booked once, in the old system, and the copy the bridge carried
-- across is a second sighting of it. Rejecting the copy is what stops it being
-- booked twice.
--
-- So the pattern is reported as **agreement**, not as a fault. The lesson is
-- worth keeping: two systems holding different statuses for one document is
-- not automatically a disagreement, and the reason column is what tells you
-- which it is. A check that flagged this would cry wolf twenty times and get
-- switched off.
--
-- ── What it read on 2026-09-24, and what that proved ───────────────────
--
--   GAP 1   35 rows · Rp 149.082.398 · 2026-09-22 … 2026-09-24
--   GAP 2    7 rows (5 rejected `duplicate upload`, 1 confirmed, 1 attached)
--
-- The dates are the finding. Every one of the 35 invisible rows was created on
-- or after 2026-09-22, and `ops_acct.evidence_inbox` has nothing newer than
-- 2026-09-21 04:04. The gap is not scattered loss — it is exactly *everything
-- since the mirror stopped running*, which is what a mirror that was merged
-- but never deployed looks like from the database.
--
-- That also settles a separate question the same day: the old queue's newest
-- row is 2026-09-24 00:02, so Chat → Drive → Gemini → `ledger_review_queue`
-- is alive. Only the last hop is dead. The fix is a deploy, not a repair, and
-- the gap closes on `ref_id` with no backfill to write by hand.
--
--   psql … -f supabase/import/09_queue_reconciliation.sql
--
-- Read-only. It writes nothing and decides nothing.

\set ON_ERROR_STOP on
\timing off

\echo ''
\echo '── the shape: old queue status × web app status ─────────────────────'
select coalesce(q.status::text, '(none)')            as di_antrean_lama,
       coalesce(e.status::text, '— belum tercermin')  as di_web_app,
       count(*)                                      as jumlah,
       case
         when e.ref_id is null and q.status = 'PENDING'
           then 'GAP — pekerjaan tak terlihat'
         when e.ref_id is null
           then 'sudah selesai di sistem lama, belum disalin'
         when q.status::text = e.status::text
           then 'sepakat'
         when q.status = 'CONFIRMED' and e.status = 'REJECTED'
           then 'sepakat — dibukukan di lama, salinannya ditolak sebagai duplikat'
         else 'beda — baca alasannya'
       end                                           as arti
  from public.ledger_review_queue q
  left join ops_acct.evidence_inbox e on e.ref_id = q.ref_id
 group by 1, 2, 4
 order by 3 desc;

-- ── Two gaps, not one, because the fix differs ──────────────────────────
--
-- `PENDING` in the old queue and not `PENDING` in the web app splits into two
-- populations that read the same in a count and need opposite actions:
--
--   NOT MIRRORED       the document never arrived. Real work, invisible.
--                      Fix: deploy the mirror; it catches up on `ref_id`.
--   DECIDED IN THE WEB the web app already resolved it and the OLD queue is
--                      the stale one. Nothing is lost and nothing is waiting —
--                      the old screen is showing work that is done.
--
-- Counting them together produces one number that overstates the loss and
-- understates the cutover progress, which is how a reconciliation stops being
-- believed.

\echo ''
\echo '── GAP 1: belum tercermin — pekerjaan nyata, tak terlihat ───────────'
select q.ref_id,
       q.created_at::date                                        as tgl,
       coalesce(nullif(q.extracted ->> 'VENDOR', ''), '(tanpa vendor)') as vendor,
       nullif(regexp_replace(coalesce(q.extracted ->> 'IDR AMOUNT', ''),
                             '[^0-9]', '', 'g'), '')::numeric     as nilai,
       coalesce(e.status::text, '— tidak ada di web app')          as di_web_app
  from public.ledger_review_queue q
  left join ops_acct.evidence_inbox e on e.ref_id = q.ref_id
 where q.status = 'PENDING' and e.ref_id is null
 order by q.created_at;

\echo ''
\echo '── GAP 2: sudah diputuskan di web app, antrean LAMA yang basi ───────'
select q.ref_id, q.created_at::date as tgl,
       e.status::text                                  as diputuskan_di_web,
       coalesce(nullif(left(e.resolve_note, 44), ''), '(tanpa alasan)') as alasan
  from public.ledger_review_queue q
  join ops_acct.evidence_inbox e on e.ref_id = q.ref_id
 where q.status = 'PENDING' and e.status <> 'PENDING'
 order by q.created_at;

\echo ''
\echo '── verdict ─────────────────────────────────────────────────────────'
select case when n = 0
            then 'BERSIH — setiap yang belum diputuskan terlihat di web app'
            else n || ' baris menunggu keputusan dan belum tercermin sama sekali'
                 || coalesce(' · ' || ops_acct.rupiah(v) || ' terbaca', '')
                 || ' · ' || coalesce(d1::text, '?') || ' … ' || coalesce(d2::text, '?')
       end as hasil
  from (
    select count(*) as n,
           sum(nullif(regexp_replace(coalesce(q.extracted ->> 'IDR AMOUNT', ''),
                                     '[^0-9]', '', 'g'), '')::numeric) as v,
           min(q.created_at)::date as d1, max(q.created_at)::date as d2
      from public.ledger_review_queue q
      left join ops_acct.evidence_inbox e on e.ref_id = q.ref_id
     where q.status = 'PENDING' and e.ref_id is null
  ) x;

/* ── Why the verdict is printed and not raised ────────────────────────────
 *
 * A failing exit code would make this a gate, and it is not one yet: the gap
 * is expected to be non-zero for as long as the mirror is behind. It becomes a
 * gate on the day somebody decides the cutover is ready, and then the line
 * above is the sentence that has to read BERSIH.
 *
 * Read the verdict, not the exit code — the same rule the other files here
 * carry, and for the same reason.
 */
