-- 0302_acct_ledger_sheet_auto_sync.sql — the GL OPS sheet keeps itself up to date (D460).
--
-- ── Why ─────────────────────────────────────────────────────────────────
--
-- 0297 (D455) mirrored the ops ledger into the `GL OPS 2026` tab, written only
-- when somebody pressed *Perbarui sheet*. The sheet was therefore as old as the
-- last press. The owner chose the automatic sync next (2026-11-25).
--
-- ── How ─────────────────────────────────────────────────────────────────
--
-- The same road as the PR sheet (0296): `pg_cron` cannot sign a Google token,
-- so `ops_acct.kick_ledger_sheet_sync()` asks the app to. One POST to
-- `/api/accounting/ledger-sheet` with `x-ops-sync-key`, URL and key read from
-- Vault (`ops_app_url`, `ops_sheet_sync_key`, the same two secrets as the PR
-- job). Missing secrets make it a no-op, so this schedules safely before IT
-- has set them.
--
-- Every 15 minutes from 06:00 to 22:59 WIB. Most of those calls find nothing
-- new: `ledger_sheet_rows()` now answers the md5 of the rows it would write
-- beside the md5 of the last good write, and the route leaves the tab alone
-- when they match and that write is under a day old. A void, an edited
-- amount, a newly linked document or a new row changes the md5, so the
-- sheet is at most 15 minutes behind the ledger. A run that writes nothing is
-- not recorded.
--
-- A person's button still writes every time, because someone may have typed
-- into the tab by hand.
--
-- ── Who ─────────────────────────────────────────────────────────────────
--
-- The job reads as `service_role`, like `sync_pr_sheet`. It only reads rows
-- and records how the write went, so it is not attributed to a person:
-- `ledger_sheet_runs.trigger = 'cron'`, `run_by` empty.

alter table ops_acct.ledger_sheet_runs add column content_hash text;

-- ── the rows ──────────────────────────────────────────────────────────────
-- 0301's body. The guard admits the service key, and the answer carries `hash`,
-- `last_hash` and `last_ok_at`.

create or replace function ops_acct.ledger_sheet_rows()
returns jsonb language plpgsql security definer
set search_path = ops_acct, ops_core, pg_temp as $$
declare
  v    ops_acct.ledger_sheet_settings;
  v_rows jsonb;
  v_last ops_acct.ledger_sheet_runs;
begin
  -- The scheduled job calls with the service key (0302); everyone else must
  -- keep the ledger.
  if current_setting('role', true) is distinct from 'service_role'
     and not ops_core.has_authority('post_ledger') then
    return ops_core.refused('accounting', 'ledger_sheet', null, 'rows', 'forbidden',
      'Memperbarui sheet ledger butuh wewenang post_ledger.');
  end if;
  select * into v from ops_acct.ledger_sheet_settings where id;
  if not found then
    return ops_core.refused('accounting', 'ledger_sheet', null, 'rows', 'not_configured',
      'Sheet ledger belum disiapkan: IT mengisi ops_acct.ledger_sheet_settings.');
  end if;

  with live as (
    select x.id, x.account_id, x.trx_date, x.trx_no,
           case when x.direction = 'IN' then x.amount_idr else -x.amount_idr end as signed
      from ops_acct.transactions x
     where x.status <> 'VOID'
  ),
  -- The same running balance as `v_transaction` (0301), without its RLS filter.
  rb as (
    select l.id, l.signed,
           a.opening_balance + sum(l.signed) over (
             partition by l.account_id order by l.trx_date, l.signed < 0, l.trx_no
             rows between unbounded preceding and current row) as balance_after
      from live l join ops_acct.accounts a on a.id = l.account_id
  ),
  docs as (
    select k.entity_no as trx_no, k.attachment_id,
           k.kind::text as kind,
           coalesce(a.web_view_link, a.url,
                    'https://drive.google.com/file/d/' || coalesce(a.drive_file_id, a.storage_path) || '/view') as href,
           k.linked_at
      from ops_core.attachment_links k
      join ops_core.attachments a on a.id = k.attachment_id
     where k.entity = 'transaction' and k.unlinked_at is null
  ),
  trx as (
    select t.id, t.trx_no, t.trx_date, t.description, t.remark, t.type_code, t.direction::text as direction,
           t.amount_idr, t.status::text as status, acc.code as account_code, acc.currency, acc.balance_mode::text as balance_mode,
           p.code as project_code, vd.name as vendor_name, pu.full_name as posted_by_name,
           coalesce(t.category_override, ty.category, 'overhead')::text as category,
           case acc.balance_mode
             when 'running'  then case when t.trx_date >= ops_acct.ledger_balance_from() then rb.balance_after end
             when 'anchored' then an.balance_after
           end as balance_after,
           case acc.balance_mode
             when 'running'  then case when t.trx_date >= ops_acct.ledger_balance_from() then rb.balance_after - rb.signed end
             when 'anchored' then an.balance_after - rb.signed
           end as balance_before,
           (select coalesce(jsonb_agg(jsonb_build_object('kind', d.kind, 'href', d.href, 'att', d.attachment_id)
                                      order by d.linked_at), '[]')
              from docs d where d.trx_no = t.trx_no) as docs,
           (select coalesce(array_agg(distinct a.pr_line_no) filter (where a.pr_line_no is not null), '{}')
              from ops_acct.payment_allocations a where a.trx_id = t.id and a.superseded_by is null) as pr_line_nos,
           (select coalesce(array_agg(distinct a.po_no) filter (where a.po_no is not null), '{}')
              from ops_acct.payment_allocations a where a.trx_id = t.id and a.superseded_by is null) as po_nos
      from ops_acct.transactions t
      join ops_acct.accounts acc on acc.id = t.account_id
      left join ops_acct.transaction_types ty on ty.code = t.type_code
      left join ops_procure.projects p on p.id = t.project_id
      left join ops_procure.vendors vd on vd.id = t.vendor_id
      left join ops_core.users pu on pu.id = t.posted_by
      left join rb on rb.id = t.id
      -- An anchored account: the reading before the row + the rows between.
      left join lateral (
        select st.balance + coalesce((
                 select sum(case when x.direction = 'IN' then x.amount_idr else -x.amount_idr end)
                   from ops_acct.transactions x
                  where x.account_id = t.account_id and x.status <> 'VOID'
                    and ops_acct.row_after_state(x.trx_date, x.trx_no, st.as_of, st.after_trx_no)
                    and not ops_acct.row_after_state(x.trx_date, x.trx_no, t.trx_date, t.trx_no)), 0) as balance_after
          from ops_acct.state_before_row(t.account_id, t.trx_date, t.trx_no) st
         where st.id is not null
      ) an on acc.balance_mode = 'anchored'
     where t.status <> 'VOID'
       and t.trx_date >= make_date(v.year, 1, 1)
       and t.trx_date <  make_date(v.year + 1, 1, 1)
  ),
  sheet_rows as (
    select t.*, ln.line_pos, ln.line_count, ln.line_desc, ln.line_kind, ln.line_amount, ln.line_att, ln.cum
      from trx t
      left join lateral (
        select row_number() over (order by l.line_no) as line_pos, count(*) over () as line_count, l.description as line_desc, l.kind as line_kind,
               l.amount as line_amount, l.attachment_id as line_att,
               sum(l.amount) over (order by l.line_no rows between unbounded preceding and current row) as cum
          from ops_acct.transaction_lines l where l.trx_id = t.id
      ) ln on true
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'trx_no',      r.trx_no,
           'line',        case when r.line_count > 1 then chr(96 + least(r.line_pos, 26)::int) end,
           'trx_date',    r.trx_date,
           -- What the money was for, as the ledger says it; a split transaction's
           -- line adds its own item after it (the item alone, e.g. "Pertalite",
           -- does not say who or what it was for).
           'description', case when r.line_count > 1 and r.line_desc is not null
                                 and r.line_desc is distinct from r.description
                               then r.description || ' — ' || r.line_desc
                               else r.description end,
           'trx_description', r.description,
           'remark',      r.remark,
           'type',        case when r.line_kind = 'fee' then 'BANK CHARGES' else r.type_code end,
           'project',     r.project_code,
           'account',     r.account_code,
           'currency',    r.currency,
           'direction',   r.direction,
           'amount',      coalesce(r.line_amount, r.amount_idr),
           -- The account's balance after this row: the line's share of the
           -- transaction, and the transaction's own balance on its last line.
           'balance',     case
                            when r.balance_after is null then null
                            when r.line_pos is null or r.line_pos = r.line_count then r.balance_after
                            else r.balance_before
                                 + case when r.direction = 'IN' then r.cum else -r.cum end
                          end,
           'vendor',      r.vendor_name,
           'docs',        case when r.line_att is null then r.docs
                               else (select coalesce(jsonb_agg(e), '[]') from jsonb_array_elements(r.docs) e
                                      where e->>'att' is distinct from r.line_att::text
                                        and not exists (select 1 from jsonb_array_elements(r.docs) f
                                                         where f->>'att' = r.line_att::text and f->>'kind' = e->>'kind'))
                                    || coalesce((select jsonb_agg(f) from jsonb_array_elements(r.docs) f
                                                  where f->>'att' = r.line_att::text), '[]')
                          end,
           'pr_line_nos', to_jsonb(r.pr_line_nos),
           'po_nos',      to_jsonb(r.po_nos),
           'status',      r.status,
           'category',    r.category,
           'posted_by',   r.posted_by_name
         ) order by r.trx_date, (r.balance_mode = 'running' and r.direction = 'OUT'), r.trx_no, r.line_pos), '[]')
    into v_rows
    from sheet_rows r;

  select * into v_last from ops_acct.ledger_sheet_runs
   where outcome = 'ok' and tab = v.tab order by run_at desc limit 1;

  return ops_core.ok('accounting', 'ledger_sheet', v.tab, 'rows', jsonb_build_object(
    'spreadsheet_id', v.spreadsheet_id,
    'tab',            v.tab,
    'year',           v.year,
    'enabled',        v.enabled,
    'balance_from',   ops_acct.ledger_balance_from(),
    -- What the tab would hold, and what the last good write held: the job
    -- leaves the tab alone when they are the same (0302).
    'hash',           md5(v_rows::text),
    'last_hash',      v_last.content_hash,
    'last_ok_at',     v_last.run_at,
    'rows',           v_rows));
end $$;

revoke execute on function ops_acct.ledger_sheet_rows() from public;
grant  execute on function ops_acct.ledger_sheet_rows() to authenticated, service_role;

-- ── how the write went ────────────────────────────────────────────────────
-- 0297's, plus the md5 that was written and who wrote it (the job or a person).

drop function ops_acct.record_ledger_sheet_run(int, text, text);

create or replace function ops_acct.record_ledger_sheet_run(
  p_rows int, p_outcome text, p_message text default null, p_hash text default null)
returns jsonb language plpgsql security definer
set search_path = ops_acct, ops_core, pg_temp as $$
declare
  v ops_acct.ledger_sheet_settings;
  v_id uuid;
  v_job boolean := current_setting('role', true) is not distinct from 'service_role';
begin
  if not v_job and not ops_core.has_authority('post_ledger') then
    return ops_core.refused('accounting', 'ledger_sheet', null, 'record_run', 'forbidden',
      'Mencatat sinkron sheet ledger butuh wewenang post_ledger.');
  end if;
  if p_outcome not in ('ok', 'failed') then
    return ops_core.invalid('accounting', 'ledger_sheet', null, 'record_run', 'bad_outcome',
      'outcome harus ok atau failed.');
  end if;
  select * into v from ops_acct.ledger_sheet_settings where id;
  -- clock_timestamp(): two runs in one transaction still have an order, so
  -- "the last good write" is never a tie.
  insert into ops_acct.ledger_sheet_runs (run_at, trigger, run_by, tab, row_count, outcome, message, content_hash)
  values (clock_timestamp(), case when v_job then 'cron' else 'manual' end,
          case when v_job then null else auth.uid() end,
          coalesce(v.tab, '?'), greatest(coalesce(p_rows, 0), 0), p_outcome, left(p_message, 2000),
          case when p_outcome = 'ok' then left(p_hash, 64) end)
  returning id into v_id;
  return ops_core.ok('accounting', 'ledger_sheet', v_id::text, 'record_run', jsonb_build_object('id', v_id));
end $$;

revoke execute on function ops_acct.record_ledger_sheet_run(int, text, text, text) from public;
grant  execute on function ops_acct.record_ledger_sheet_run(int, text, text, text) to authenticated, service_role;

-- ── the kick ──────────────────────────────────────────────────────────────

create or replace function ops_acct.kick_ledger_sheet_sync()
returns void language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  v_url text;
  v_key text;
begin
  -- The job runs as postgres with no session; a person may kick it too, but
  -- only one who could have pressed the button.
  if auth.uid() is not null and not ops_core.has_authority('post_ledger') then
    return;
  end if;
  if not exists (select 1 from ops_acct.ledger_sheet_settings where id and enabled) then
    return;
  end if;
  if to_regclass('vault.decrypted_secrets') is null or to_regnamespace('net') is null then
    return;
  end if;
  execute $q$select max(decrypted_secret) filter (where name = 'ops_app_url'),
                    max(decrypted_secret) filter (where name = 'ops_sheet_sync_key')
               from vault.decrypted_secrets$q$ into v_url, v_key;
  if v_url is null or v_key is null then
    return;
  end if;
  execute $q$select net.http_post(url := $1, body := '{"trigger":"cron"}'::jsonb,
                                  headers := jsonb_build_object('content-type', 'application/json',
                                                                'x-ops-sync-key', $2),
                                  timeout_milliseconds := 120000)$q$
    using rtrim(v_url, '/') || '/api/accounting/ledger-sheet', v_key;
end $$;

revoke execute on function ops_acct.kick_ledger_sheet_sync() from public;
grant  execute on function ops_acct.kick_ledger_sheet_sync() to authenticated;

-- 06:00–22:59 WIB = 23:00–15:59 UTC.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('ops-ledger-sheet-sync', '*/15 0-15,23 * * *',
                          'select ops_acct.kick_ledger_sheet_sync()');
  end if;
end $$;

analyze ops_acct.ledger_sheet_runs;
