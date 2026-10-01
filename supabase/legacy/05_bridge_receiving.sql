-- 05_bridge_receiving.sql — the RECEIVING REPORT space, into
-- `ops_procure.receiving_inbox`, every five minutes (D358).
--
-- It names `public.*`, so it cannot be a migration (`check_schema_isolation.sh`)
-- and lives here, like `03_bridge_review_queue.sql`.
--
-- ── Why a scheduled bridge and not the worker ────────────────────────────
--
-- `03`'s lesson, measured twice: the worker was repointed at
-- `file_evidence()`, merged, **and never deployed**, and 35 documents sat
-- where nobody could see them. Everything this needs is already in the
-- database the worker writes to:
--
--   public.raw_events             the message (space, sender, text, time)
--   public.blobs                  each photo, already in Drive
--   public.receiving_extractions  Gemini's reading (ITEM PHOTO / RECEIVING SHEET)
--   public.chat_users             who the sender is, by email
--
-- So the bridge reads those and calls the one verb, `ops_procure.file_receiving()`,
-- from `pg_cron`. No deploy in GCP, nothing written to the worker's tables, no
-- trigger on them that could fail its insert. When the worker one day calls
-- the seam itself, this keeps working: the seam is idempotent on the event id
-- and merges a second filing while the row is open.
--
-- ── What it carries ──────────────────────────────────────────────────────
--
-- Only messages **with a photo** in the space. A text-only reply ("Baik mas")
-- is conversation, not an arrival. A message whose photo lands after the first
-- run, or whose reading lands after it, is picked up by the next run — the
-- `need` clause below is "not in the inbox yet, or open with fewer files or no
-- reading than the worker now holds".
--
-- The file name is the attachment's own (`contentName`) by position, else the
-- Drive id. The reading is passed as Gemini wrote it plus its confidence; the
-- screen reads `doc_kind`, `vendor`, `po_number`, `delivery_note_no` and
-- `lines[].item / received_qty / condition`, which are already the worker's
-- own key names (no translation needed, unlike `03`).
--
-- Run once by hand to install (and backfill everything since the space began),
-- then cron runs it:
--
--   psql "$PROD" -f supabase/legacy/05_bridge_receiving.sql
--
-- To stop it: `select cron.unschedule('ops-receiving-bridge');`
\set ON_ERROR_STOP on

begin;

create or replace function public.ops_bridge_receiving(
  p_space text default 'spaces/AAQAiO_aiOA')
returns table (outcome text, code text, n int)
language plpgsql
set search_path = public, pg_temp as $$
begin
  return query
  with need as (
    select r.event_id, r.sender, r.message_text, r.received_at, r.payload
      from public.raw_events r
      left join ops_procure.receiving_inbox i on i.ref_id = r.event_id::text
     where r.space_id = p_space
       and exists (select 1 from public.blobs b where b.event_id = r.event_id and b.drive_link is not null)
       and (i.id is null
            or (i.status = 'PENDING'
                and ((select count(*) from ops_procure.receiving_inbox_files f where f.inbox_id = i.id)
                       < (select count(*) from public.blobs b where b.event_id = r.event_id and b.drive_link is not null)
                     or (i.extracted = '{}'::jsonb
                         and exists (select 1 from public.receiving_extractions x where x.event_id = r.event_id)))))
     order by r.received_at
     limit 200
  ), filed as (
    select ops_procure.file_receiving(
             n.event_id::text,
             (select jsonb_agg(jsonb_build_object(
                       'url',        b.drive_link,
                       'filename',   coalesce(
                                       n.payload -> 'message' -> 'attachment' -> (b.ord - 1)::int ->> 'contentName',
                                       b.drive_file_id || case b.mime_type
                                         when 'image/jpeg' then '.jpg' when 'image/png' then '.png'
                                         when 'image/webp' then '.webp' when 'application/pdf' then '.pdf'
                                         else '' end),
                       'source_ref', b.blob_id::text,
                       'mime',       b.mime_type,
                       'bytes',      b.size_bytes,
                       'sha256',     b.sha256) order by b.ord)
                from (select bb.*, row_number() over (order by bb.created_at, bb.blob_id) as ord
                        from public.blobs bb
                       where bb.event_id = n.event_id and bb.drive_link is not null) b),
             n.message_text,
             coalesce((select c.email from public.chat_users c where c.user_id = n.sender),
                      n.payload -> 'message' -> 'sender' ->> 'displayName'),
             n.received_at,
             coalesce((select x.output || jsonb_build_object('confidence', x.confidence)
                         from public.receiving_extractions x
                        where x.event_id = n.event_id
                        order by x.created_at desc limit 1), '{}'::jsonb)
           ) as res
      from need n
  )
  select f.res ->> 'outcome', coalesce(f.res -> 'error' ->> 'code', ''), count(*)::int
    from filed f group by 1, 2;
end $$;

-- `public` is exposed through PostgREST. This is for cron and for a person at
-- psql, never for a browser.
revoke all on function public.ops_bridge_receiving(text) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.ops_bridge_receiving(text) from anon, authenticated';
  end if;
end $$;

commit;

-- The backlog since 2026-09-09, now.
\echo '── first run ───────────────────────────────────────────────────────'
select * from public.ops_bridge_receiving();

-- Then every five minutes. `cron.schedule` with a name replaces the job.
select cron.schedule('ops-receiving-bridge', '*/5 * * * *',
                     $$select public.ops_bridge_receiving()$$);

\echo '── the inbox now ───────────────────────────────────────────────────'
select status, count(*) as rows,
       (select count(*) from ops_procure.receiving_inbox_files) as files
  from ops_procure.receiving_inbox group by status order by 1;
