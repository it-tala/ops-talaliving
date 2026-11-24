-- 0296_procure_sheet_sync.sql — the PR recap sheet, read into the PR module once a day (D454).
--
-- ── Why ─────────────────────────────────────────────────────────────────
--
-- The office still types every request into the `<MONTH> PR RECAP` tab of the
-- `2026 PURCHASE-PAYMENT TRACKER` workbook, although the PR module exists. Until
-- 2026-11-25 somebody copied those rows into Supabase by hand and matched each
-- one to the ledger row that paid it, so that the ledger drawer could say *this
-- transaction paid pr-…-L03*. This does that copy every day, and keeps the sheet
-- working as the office's view: the `LINE ID` and `TRX ID` columns are written
-- back by the route (`/api/procurement/sheet-sync`), from what this seam answers.
--
-- ── What the owner asked to be recorded (2026-11-25) ────────────────────
--
--   * **when it was typed** — the sheet's own DATE (`requested_on`) and the day
--     the sync first read the row (`first_seen_on`);
--   * **when it was approved** — the day the sync first saw `EJO APPROVAL`
--     ticked (`approved_seen_on`), which is also the GOODS approval's date;
--   * **when it was paid** — the date of the ledger transaction allocated to the
--     line, and the day `PAID AMOUNT` was first filled (`paid_seen_on`).
--
-- Day precision, not the hour: the sync runs once a day, and the owner chose a
-- date over an Apps Script that stamps every edit.
--
-- ── What it does not do ─────────────────────────────────────────────────
--
-- * **It never creates a ledger transaction.** A row matches the ledger only
--   when `PAID AMOUNT` is filled, and only to a transaction that already exists.
-- * **It never guesses.** A paid row is allocated only when exactly one OUT
--   transaction fits — the paid amount to the rupiah, or that amount plus a bank
--   fee folded into it (F294) — and shares a word with the row. Anything else is
--   answered as `unmatched` / `ambiguous` and left for a person.
-- * **It never edits a line.** A row whose amount or description changed after
--   its line exists is reported as `differs`, not written over.
-- * **It never writes a LINE ID it did not resolve.** A LINE ID on the sheet that
--   the database does not know is reported as `unknown_line`, and nothing is made.

/* ── settings: which workbook, and who the job writes as ─────────────────── */

create table ops_procure.sheet_sync_settings (
  id              boolean primary key default true check (id),
  spreadsheet_id  text not null,
  -- The person every row the daily job creates is attributed to. The job has no
  -- session; it must not write as "nobody".
  actor_id        uuid not null references auth.users (id),
  -- Whose tick the `EJO APPROVAL` column is (D19: approve_goods is the CEO's).
  approver_email  ops_core.citext not null,
  enabled         boolean not null default true,
  updated_at      timestamptz not null default now()
);

alter table ops_procure.sheet_sync_settings enable row level security;
create policy sheet_sync_settings_read on ops_procure.sheet_sync_settings
  for select to authenticated using (ops_core.has_permission('procurement.read'));
grant select on ops_procure.sheet_sync_settings to authenticated;

/* ── one row per sheet row the sync has read ──────────────────────────────
 *
 *  The fingerprint (request date + description + amount) is what makes a second
 *  run harmless when the LINE ID write-back failed: a row with no LINE ID that
 *  matches a fingerprint is the line already made, not a new one. A row copied
 *  into next month's tab keeps its date, so it is the same line too.
 */
create table ops_procure.sheet_pr_rows (
  id                uuid primary key default gen_random_uuid(),
  fingerprint       text not null unique,
  line_id           uuid not null references ops_procure.pr_lines (id),
  tab               text not null,
  row_no            int  not null,
  requested_on      date,
  first_seen_on     date not null,
  approved_seen_on  date,
  paid_amount       numeric,
  paid_seen_on      date,
  last_seen_at      timestamptz not null default now(),
  last_row          jsonb not null
);
create index sheet_pr_rows_line on ops_procure.sheet_pr_rows (line_id);

alter table ops_procure.sheet_pr_rows enable row level security;
create policy sheet_pr_rows_read on ops_procure.sheet_pr_rows
  for select to authenticated using (ops_core.has_permission('procurement.read'));
grant select on ops_procure.sheet_pr_rows to authenticated;

/* ── every run, kept ─────────────────────────────────────────────────────── */

create table ops_procure.sheet_sync_runs (
  id          uuid primary key default gen_random_uuid(),
  run_at      timestamptz not null default now(),
  trigger     text not null check (trigger in ('cron', 'manual')),
  run_by      uuid references auth.users (id),
  tab         text not null,
  rows_read   int not null,
  summary     jsonb not null
);

alter table ops_procure.sheet_sync_runs enable row level security;
create policy sheet_sync_runs_read on ops_procure.sheet_sync_runs
  for select to authenticated using (ops_core.has_permission('procurement.read'));
grant select on ops_procure.sheet_sync_runs to authenticated;

/* ── which workbook, for the route ────────────────────────────────────────
 *
 *  The daily job's client is `service_role`, and that role gets functions,
 *  never tables (0038). So the route asks here rather than reading the table.
 */
create or replace function ops_procure.sheet_sync_target()
returns jsonb language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
declare v ops_procure.sheet_sync_settings;
begin
  if current_setting('role', true) <> 'service_role'
     and not ops_core.has_permission('procurement.read') then
    return ops_core.refused('procurement', 'sheet_sync', null, 'target', 'forbidden',
      'Reading the PR sheet settings needs procurement access.');
  end if;
  select * into v from ops_procure.sheet_sync_settings where id;
  if not found then
    return ops_core.refused('procurement', 'sheet_sync', null, 'target', 'not_configured',
      'The PR sheet sync has no settings row yet. IT sets ops_procure.sheet_sync_settings once.');
  end if;
  return ops_core.ok('procurement', 'sheet_sync', v.spreadsheet_id, 'target',
                     jsonb_build_object('spreadsheet_id', v.spreadsheet_id, 'enabled', v.enabled));
end $$;

revoke execute on function ops_procure.sheet_sync_target() from public;
grant  execute on function ops_procure.sheet_sync_target() to authenticated, service_role;

/* ── the words two descriptions share ─────────────────────────────────────
 *
 *  `PAYMENT INDIHOME LANGON` and `INDIHOME TALAHOME` share INDIHOME; that is the
 *  whole test. Words of four letters or more, minus the ones every ledger row
 *  carries.
 */
create or replace function ops_procure.sheet_words(p text)
returns text[] language sql immutable set search_path = pg_catalog, pg_temp as $$
  select coalesce(array_agg(distinct w), '{}')
    from unnest(regexp_split_to_array(
           upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]+', ' ', 'g')), ' ')) w
   where length(w) >= 4
     and w !~ '^[0-9]+$'
     and w not in ('PAYMENT', 'PEYMENT', 'PAYMEN', 'ADMIN', 'TRANSFER', 'BAYAR', 'PEMBAYARAN',
                   'TAGIHAN', 'WEEK', 'MONTH', 'DEADLINE', 'DEALINE', 'BALANCE', 'WITH', 'FROM')
$$;

/* ── the seam ─────────────────────────────────────────────────────────────
 *
 *  p_rows: [{row_no, line_id, date (YYYY-MM-DD), description, keterangan, vendor,
 *            qty, unit, price, amount, approved, paid_amount}]
 *  — already parsed by the route from the sheet's formatted text.
 *
 *  Called two ways:
 *    * by the daily job, as `service_role` (the route verified the job's key);
 *      writes as `sheet_sync_settings.actor_id`;
 *    * by a person's "Sinkron sheet" button, as themselves; needs
 *      `procurement.update`, writes as them.
 */
create or replace function ops_procure.sync_pr_sheet(
  p_tab text, p_rows jsonb, p_trigger text default 'manual'
) returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_acct, ops_core, pg_temp as $$
declare
  v_system   boolean := current_setting('role', true) = 'service_role';
  v_set      ops_procure.sheet_sync_settings;
  v_actor    uuid;
  v_appr_id  uuid;
  v_today    date := ops_core.office_day();
  v_fees     numeric[] := array[1000, 2500, 3000, 5000, 6500, 7000];
  r          jsonb;
  v_row_no   int;
  v_desc     text;
  v_req      date;
  v_amount   numeric;
  v_qty      numeric;
  v_price    numeric;
  v_paid     numeric;
  v_fp       text;
  v_line     ops_procure.pr_lines;
  v_doc_no   text;
  v_doc_id   uuid;
  v_docs     jsonb := '{}';
  v_status   text;
  v_words    text[];
  v_trx      uuid;
  v_n        int;
  v_uom      text;
  v_out      jsonb := '[]';
  v_counts   jsonb;
  c_read int := 0; c_created int := 0; c_approved int := 0; c_matched int := 0;
  c_unmatched int := 0; c_skipped int := 0; c_unknown int := 0; c_differs int := 0;
  p record; q record;
begin
  select * into v_set from ops_procure.sheet_sync_settings where id;
  if not found then
    return ops_core.refused('procurement', 'sheet_sync', p_tab, 'sync', 'not_configured',
      'The PR sheet sync has no settings row yet. IT sets ops_procure.sheet_sync_settings once.');
  end if;

  if v_system then
    if not v_set.enabled then
      return ops_core.noop('procurement', 'sheet_sync', p_tab, 'sync', 'disabled');
    end if;
    v_actor := v_set.actor_id;
  else
    if not ops_core.has_permission('procurement.update') then
      return ops_core.refused('procurement', 'sheet_sync', p_tab, 'sync', 'forbidden',
        'Syncing the PR sheet needs procurement write access. Ask the procurement admin.');
    end if;
    v_actor := auth.uid();
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    return ops_core.invalid('procurement', 'sheet_sync', p_tab, 'sync', 'rows_required',
      'p_rows must be an array of sheet rows.');
  end if;

  select id into v_appr_id from auth.users where email = v_set.approver_email::text;

  create temp table if not exists _sheet_pending (
    row_no int, line_id uuid, line_no_full text, requested_on date, paid numeric, words text[]
  ) on commit drop;
  truncate _sheet_pending;

  for r in select * from jsonb_array_elements(p_rows) loop
    v_row_no := nullif(r->>'row_no', '')::int;
    v_desc   := btrim(regexp_replace(coalesce(r->>'description', ''), '\s+', ' ', 'g'));
    v_amount := nullif(r->>'amount', '')::numeric;
    v_req    := nullif(r->>'date', '')::date;
    v_qty    := nullif(r->>'qty', '')::numeric;
    v_price  := nullif(r->>'price', '')::numeric;
    v_paid   := nullif(r->>'paid_amount', '')::numeric;

    if v_desc = '' or v_amount is null or v_amount <= 0 or v_req is null then
      c_skipped := c_skipped + 1;
      v_out := v_out || jsonb_build_object('row_no', v_row_no, 'status', 'skipped');
      continue;
    end if;
    c_read := c_read + 1;
    v_status := 'seen';
    v_fp := md5(v_req::text || '|' || upper(v_desc) || '|' || v_amount::text);

    /* 1 ── which line this row is */
    v_line := null;
    if coalesce(r->>'line_id', '') <> '' then
      select * into v_line from ops_procure.pr_lines where line_no_full = btrim(r->>'line_id');
      if v_line.id is null then
        c_unknown := c_unknown + 1;
        v_out := v_out || jsonb_build_object('row_no', v_row_no, 'status', 'unknown_line',
                                             'line_no_full', btrim(r->>'line_id'));
        continue;
      end if;
    else
      select l.* into v_line from ops_procure.sheet_pr_rows s
        join ops_procure.pr_lines l on l.id = s.line_id where s.fingerprint = v_fp;
    end if;

    /* 2 ── a new line: one document per request date per run */
    if v_line.id is null then
      v_doc_id := (v_docs->>v_req::text)::uuid;
      if v_doc_id is null then
        loop
          v_doc_no := ops_core.next_doc_number('pr', (v_req + time '12:00') at time zone 'Asia/Jakarta');
          exit when not exists (select 1 from ops_procure.pr_documents where doc_no = v_doc_no);
        end loop;
        insert into ops_procure.pr_documents (doc_no, doc_type, status, requested_by, created_at, submitted_at)
        values (v_doc_no, 'PR', 'SUBMITTED', v_actor, now(), now())
        returning id into v_doc_id;
        v_docs := v_docs || jsonb_build_object(v_req::text, v_doc_id);
      end if;
      select doc_no into v_doc_no from ops_procure.pr_documents where id = v_doc_id;
      select coalesce(max(line_no), 0) + 1 into v_n from ops_procure.pr_lines where doc_id = v_doc_id;

      select code into v_uom from ops_procure.uom where code = lower(btrim(coalesce(r->>'unit', '')));

      insert into ops_procure.pr_lines (doc_id, doc_no, line_no, description, qty, uom, unit_price,
                                        item_total, purpose)
      values (v_doc_id, v_doc_no, v_n, v_desc,
              case when v_qty > 0 then v_qty end, v_uom,
              case when v_price >= 0 then v_price end, v_amount,
              nullif(concat_ws('; ',
                nullif(btrim(r->>'keterangan'), ''),
                nullif(btrim(r->>'vendor'), ''),
                case when v_uom is null and coalesce(btrim(r->>'unit'), '') <> ''
                     then 'sheet unit ' || btrim(r->>'unit') end,
                'from ' || p_tab || ' row ' || v_row_no), ''))
      returning * into v_line;
      c_created := c_created + 1;
      v_status := 'created';
    elsif v_line.item_total <> v_amount or upper(btrim(v_line.description)) <> upper(v_desc) then
      c_differs := c_differs + 1;
      v_status := 'differs';
    end if;

    /* 3 ── the trace of this row */
    insert into ops_procure.sheet_pr_rows (fingerprint, line_id, tab, row_no, requested_on,
                                           first_seen_on, last_row)
    values (v_fp, v_line.id, p_tab, coalesce(v_row_no, 0), v_req, v_today, r)
    on conflict (fingerprint) do update
      set tab = excluded.tab, row_no = excluded.row_no, last_seen_at = now(), last_row = excluded.last_row;

    /* 4 ── approved: the day the tick was first seen */
    if coalesce((r->>'approved')::boolean, false) then
      update ops_procure.sheet_pr_rows set approved_seen_on = coalesce(approved_seen_on, v_today)
       where fingerprint = v_fp;
      if v_appr_id is not null
         and not exists (select 1 from ops_procure.pr_approvals a
                          where a.line_id = v_line.id and a.step = 'GOODS') then
        insert into ops_procure.pr_approvals (line_id, step, approved, approved_qty, approved_amount,
                                              recorded_by, recorded_by_email, recorded_at, channel)
        values (v_line.id, 'GOODS', true, v_line.qty, v_amount, v_appr_id, v_set.approver_email, now(), 'sheet');
        c_approved := c_approved + 1;
      end if;
    end if;

    /* 5 ── paid: match the ledger only when PAID AMOUNT is filled */
    if v_paid > 0 then
      update ops_procure.sheet_pr_rows
         set paid_amount = v_paid, paid_seen_on = coalesce(paid_seen_on, v_today)
       where fingerprint = v_fp;

      if not exists (select 1 from ops_acct.payment_allocations x
                      where x.pr_line_no = v_line.line_no_full and x.superseded_by is null) then
        v_words := ops_procure.sheet_words(concat_ws(' ', v_desc, r->>'keterangan', r->>'vendor'));
        select count(*), min(t.id::text)::uuid into v_n, v_trx
          from ops_acct.transactions t
          left join ops_procure.vendors v on v.id = t.vendor_id
          cross join lateral (select coalesce(sum(x.amount), 0) as used
                                from ops_acct.payment_allocations x
                               where x.trx_id = t.id and x.superseded_by is null) a
         where t.direction = 'OUT' and t.void_at is null and t.transfer_id is null
           and t.trx_date between v_req - 3 and v_today
           and (t.amount_idr - a.used = v_paid
                or (a.used = 0 and t.amount_idr - v_paid = any (v_fees)))
           and ops_procure.sheet_words(concat_ws(' ', t.description, v.name)) && v_words;

        if v_n = 1 then
          insert into ops_acct.payment_allocations (trx_id, pr_line_no, amount, method, allocated_by)
          select t.id, v_line.line_no_full, least(v_paid, t.amount_idr),
                 (case when ac.code = 'PETTY CASH' then 'cash' else 'transfer' end)::ops_acct.alloc_method_t,
                 v_actor
            from ops_acct.transactions t join ops_acct.accounts ac on ac.id = t.account_id
           where t.id = v_trx;
          c_matched := c_matched + 1;
        else
          insert into _sheet_pending values (v_row_no, v_line.id, v_line.line_no_full, v_req, v_paid, v_words);
        end if;
      end if;
    end if;

    v_out := v_out || jsonb_build_object('row_no', v_row_no, 'status', v_status,
                                         'line_no_full', v_line.line_no_full);
  end loop;

  /* 6 ── one transfer paying two rows of the same day (payroll + the Grand Max) */
  for p in select a.row_no ra, b.row_no rb, a.line_no_full la, b.line_no_full lb,
                  a.paid pa, b.paid pb, a.requested_on req, a.words || b.words words
             from _sheet_pending a join _sheet_pending b
               on b.requested_on = a.requested_on and b.row_no > a.row_no
  loop
    continue when exists (select 1 from ops_acct.payment_allocations x
                           where x.pr_line_no in (p.la, p.lb) and x.superseded_by is null);
    select count(*), min(t.id::text)::uuid into v_n, v_trx
      from ops_acct.transactions t
      left join ops_procure.vendors v on v.id = t.vendor_id
      cross join lateral (select coalesce(sum(x.amount), 0) as used
                            from ops_acct.payment_allocations x
                           where x.trx_id = t.id and x.superseded_by is null) a
     where t.direction = 'OUT' and t.void_at is null and t.transfer_id is null
       and t.trx_date between p.req - 3 and v_today
       and a.used = 0
       and (t.amount_idr = p.pa + p.pb or t.amount_idr - (p.pa + p.pb) = any (v_fees))
       and ops_procure.sheet_words(concat_ws(' ', t.description, v.name)) && p.words;
    if v_n = 1 then
      insert into ops_acct.payment_allocations (trx_id, pr_line_no, amount, method, allocated_by)
      select t.id, q2.ln, q2.amt,
             (case when ac.code = 'PETTY CASH' then 'cash' else 'transfer' end)::ops_acct.alloc_method_t, v_actor
        from ops_acct.transactions t join ops_acct.accounts ac on ac.id = t.account_id
        cross join (values (p.la, p.pa), (p.lb, p.pb)) q2(ln, amt)
       where t.id = v_trx;
      c_matched := c_matched + 2;
    end if;
  end loop;

  /* 7 ── what the sheet should show: every live allocation, whoever made it */
  select coalesce(jsonb_agg(o || jsonb_build_object(
           'trx_nos', (select string_agg(t.trx_no, ', ' order by t.trx_no)
                         from ops_acct.payment_allocations x
                         join ops_acct.transactions t on t.id = x.trx_id
                        where x.pr_line_no = o->>'line_no_full' and x.superseded_by is null),
           'paid_status', case
             when o->>'line_no_full' is null then null
             when exists (select 1 from ops_acct.payment_allocations x
                           where x.pr_line_no = o->>'line_no_full' and x.superseded_by is null) then 'allocated'
             when exists (select 1 from _sheet_pending s where s.line_no_full = o->>'line_no_full') then 'unmatched'
           end)), '[]')
    into v_out from jsonb_array_elements(v_out) o;

  select count(*) into c_unmatched from _sheet_pending s
   where not exists (select 1 from ops_acct.payment_allocations x
                      where x.pr_line_no = s.line_no_full and x.superseded_by is null);

  v_counts := jsonb_build_object('read', c_read, 'created', c_created, 'approved', c_approved,
    'matched', c_matched, 'unmatched', c_unmatched, 'skipped', c_skipped,
    'unknown_line', c_unknown, 'differs', c_differs);

  insert into ops_procure.sheet_sync_runs (trigger, run_by, tab, rows_read, summary)
  values (case when p_trigger = 'cron' then 'cron' else 'manual' end, v_actor, p_tab, c_read, v_counts);

  return ops_core.ok('procurement', 'sheet_sync', p_tab, 'sync',
                     jsonb_build_object('counts', v_counts, 'rows', v_out));
end $$;

revoke execute on function ops_procure.sync_pr_sheet(text, jsonb, text) from public;
grant  execute on function ops_procure.sync_pr_sheet(text, jsonb, text) to authenticated, service_role;

/* ── a line's three dates, as the owner asked for them ───────────────────── */

create or replace view ops_procure.v_line_timeline with (security_invoker = on) as
select l.line_no_full,
       l.description,
       l.item_total,
       min(s.requested_on)                                      as requested_on,
       coalesce(min(s.first_seen_on), (d.created_at at time zone 'Asia/Jakarta')::date) as recorded_on,
       coalesce(min(s.approved_seen_on),
                (select min(a.recorded_at at time zone 'Asia/Jakarta')::date
                   from ops_procure.pr_approvals a
                  where a.line_id = l.id and a.step = 'GOODS' and a.approved)) as approved_on,
       (select min(t.trx_date) from ops_acct.payment_allocations x
          join ops_acct.transactions t on t.id = x.trx_id
         where x.pr_line_no = l.line_no_full and x.superseded_by is null) as paid_on,
       (select string_agg(t.trx_no, ', ' order by t.trx_no) from ops_acct.payment_allocations x
          join ops_acct.transactions t on t.id = x.trx_id
         where x.pr_line_no = l.line_no_full and x.superseded_by is null) as trx_nos,
       min(s.paid_seen_on)                                      as paid_marked_on,
       bool_or(s.id is not null)                                as from_sheet
  from ops_procure.pr_lines l
  join ops_procure.pr_documents d on d.id = l.doc_id
  left join ops_procure.sheet_pr_rows s on s.line_id = l.id
 group by l.id, l.line_no_full, l.description, l.item_total, d.created_at;

grant select on ops_procure.v_line_timeline to authenticated;

/* ── the daily kick ───────────────────────────────────────────────────────
 *
 *  `pg_cron` cannot sign a Google token, so it asks the app to: one POST to
 *  `/api/procurement/sheet-sync` with the job's key, both read from Vault
 *  (`ops_app_url`, `ops_sheet_sync_key`). No secret is in this file or in
 *  `cron.job`. Missing secrets make it a no-op, so the project schedules it
 *  before IT has set them without anything failing.
 *
 *  20:00 WIB = 13:00 UTC: after the day's transfers are booked.
 */
create or replace function ops_procure.kick_sheet_sync()
returns void language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  v_url text;
  v_key text;
begin
  -- The job runs as postgres with no session; a person may kick it too, but
  -- only one who could have pressed the button.
  if auth.uid() is not null and not ops_core.has_permission('procurement.update') then
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
    using rtrim(v_url, '/') || '/api/procurement/sheet-sync', v_key;
end $$;

revoke execute on function ops_procure.kick_sheet_sync() from public;
grant  execute on function ops_procure.kick_sheet_sync() to authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('ops-pr-sheet-sync', '0 13 * * *', 'select ops_procure.kick_sheet_sync()');
  end if;
end $$;

analyze ops_procure.sheet_sync_settings;
analyze ops_procure.sheet_pr_rows;
analyze ops_procure.sheet_sync_runs;
