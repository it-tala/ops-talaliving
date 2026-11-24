-- 0297_acct_ledger_sheet.sql — the ops ledger, mirrored into the accounting workbook (D455).
--
-- ── Why ─────────────────────────────────────────────────────────────────
--
-- Accounting reads the ledger in the `GENERAL LEDGER PLUS 064 2026` tab of the
-- `2026 TALAHOME LEDGERS` workbook. The owner asked (2026-11-25) for the ops
-- ledger to appear there in the same shape, in its own tab `GL OPS 2026`, so the
-- team keeps the view it knows while the records live in ops:
--
--   * one-way, ops → sheet (D9): the tab is written whole on every sync and is
--     never read back; the manual tab is left exactly as it is;
--   * the same columns A–I as the manual tab, the balances grouped J–O (PETTY
--     CASH, BNI 325, BCA 271, BCA 064, JENIUS, JENIUS CARDS — no JAGO, no SCRAP
--     SALES), then supplier and the document links;
--   * leadership accounts included — the owner decided the workbook's own
--     sharing is the boundary for this tab, not `approve_funds` (D391);
--   * 2026 only; another year may get another ledger shape;
--   * synced by a button for now ("Perbarui sheet" on the ledger screen). The
--     automatic sync on every new row is a later step.
--
-- ── What this file holds ────────────────────────────────────────────────
--
--   * `ledger_sheet_settings` — which workbook, which tab, which year;
--   * `ledger_sheet_runs`     — every sync, kept;
--   * `ledger_sheet_rows()`   — the rows, already in sheet order, one per
--                               transaction line (one per transaction without
--                               lines), with the account's balance after it;
--   * `record_ledger_sheet_run()` — the route says how the write went.
--
-- The route (`/api/accounting/ledger-sheet`) only lays the rows into cells and
-- carries the other accounts' balances down, as the manual tab's SUMIFS do.
--
-- ── Why security definer reads past `account_rows_readable` ─────────────
--
-- The tab is one picture for everyone the workbook is shared with. If the rows
-- followed the caller's RLS, a sync pressed by someone without `approve_funds`
-- would silently drop BCA 064 from the sheet and the next sync would put it
-- back. So the function reads every account, and who may press is decided
-- here: `post_ledger`, the people who keep the ledger.

/* ── settings ────────────────────────────────────────────────────────────── */

create table ops_acct.ledger_sheet_settings (
  id              boolean primary key default true check (id),
  spreadsheet_id  text not null,
  tab             text not null,
  year            int  not null check (year between 2024 and 2100),
  enabled         boolean not null default true,
  updated_at      timestamptz not null default now()
);

alter table ops_acct.ledger_sheet_settings enable row level security;
create policy ledger_sheet_settings_read on ops_acct.ledger_sheet_settings
  for select to authenticated using (ops_core.has_authority('post_ledger'));
grant select on ops_acct.ledger_sheet_settings to authenticated;

-- The workbook the owner named on 2026-11-25. It must be shared with the
-- service account (GOOGLE_SERVICE_ACCOUNT_EMAIL) as an editor.
insert into ops_acct.ledger_sheet_settings (spreadsheet_id, tab, year)
values ('1XWHWoGHaxHSXc3EQxciQYxxxpPICfxjhW8AnBeweKMI', 'GL OPS 2026', 2026);

/* ── every run ───────────────────────────────────────────────────────────── */

create table ops_acct.ledger_sheet_runs (
  id        uuid primary key default gen_random_uuid(),
  run_at    timestamptz not null default now(),
  trigger   text not null check (trigger in ('cron', 'manual')),
  run_by    uuid references auth.users (id),
  tab       text not null,
  row_count int  not null,
  outcome   text not null check (outcome in ('ok', 'failed')),
  message   text
);

alter table ops_acct.ledger_sheet_runs enable row level security;
create policy ledger_sheet_runs_read on ops_acct.ledger_sheet_runs
  for select to authenticated using (ops_core.has_authority('post_ledger'));
grant select on ops_acct.ledger_sheet_runs to authenticated;

/* ── the rows ────────────────────────────────────────────────────────────── */

create or replace function ops_acct.ledger_sheet_rows()
returns jsonb language plpgsql security definer
set search_path = ops_acct, ops_core, pg_temp as $$
declare
  v    ops_acct.ledger_sheet_settings;
  v_rows jsonb;
begin
  if not ops_core.has_authority('post_ledger') then
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
  -- The same running balance as `v_transaction` (0282), without its RLS filter.
  rb as (
    select l.id, l.signed,
           a.opening_balance + sum(l.signed) over (
             partition by l.account_id order by l.trx_date, l.trx_no
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
           t.amount_idr, t.status::text as status, acc.code as account_code, acc.currency,
           p.code as project_code, vd.name as vendor_name, pu.full_name as posted_by_name,
           coalesce(t.category_override, ty.category, 'overhead')::text as category,
           case when t.trx_date >= ops_acct.ledger_balance_from() then rb.balance_after end as balance_after,
           case when t.trx_date >= ops_acct.ledger_balance_from() then rb.balance_after - rb.signed end as balance_before,
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
           'description', coalesce(r.line_desc, r.description),
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
         ) order by r.trx_date, r.trx_no, r.line_pos), '[]')
    into v_rows
    from sheet_rows r;

  return ops_core.ok('accounting', 'ledger_sheet', v.tab, 'rows', jsonb_build_object(
    'spreadsheet_id', v.spreadsheet_id,
    'tab',            v.tab,
    'year',           v.year,
    'enabled',        v.enabled,
    'balance_from',   ops_acct.ledger_balance_from(),
    'rows',           v_rows));
end $$;

revoke execute on function ops_acct.ledger_sheet_rows() from public;
grant  execute on function ops_acct.ledger_sheet_rows() to authenticated;

/* ── how the write went ──────────────────────────────────────────────────── */

create or replace function ops_acct.record_ledger_sheet_run(p_rows int, p_outcome text, p_message text default null)
returns jsonb language plpgsql security definer
set search_path = ops_acct, ops_core, pg_temp as $$
declare
  v ops_acct.ledger_sheet_settings;
  v_id uuid;
begin
  if not ops_core.has_authority('post_ledger') then
    return ops_core.refused('accounting', 'ledger_sheet', null, 'record_run', 'forbidden',
      'Mencatat sinkron sheet ledger butuh wewenang post_ledger.');
  end if;
  if p_outcome not in ('ok', 'failed') then
    return ops_core.invalid('accounting', 'ledger_sheet', null, 'record_run', 'bad_outcome',
      'outcome harus ok atau failed.');
  end if;
  select * into v from ops_acct.ledger_sheet_settings where id;
  insert into ops_acct.ledger_sheet_runs (trigger, run_by, tab, row_count, outcome, message)
  values ('manual', auth.uid(), coalesce(v.tab, '?'), greatest(coalesce(p_rows, 0), 0), p_outcome, left(p_message, 2000))
  returning id into v_id;
  return ops_core.ok('accounting', 'ledger_sheet', v_id::text, 'record_run', jsonb_build_object('id', v_id));
end $$;

revoke execute on function ops_acct.record_ledger_sheet_run(int, text, text) from public;
grant  execute on function ops_acct.record_ledger_sheet_run(int, text, text) to authenticated;

analyze ops_acct.ledger_sheet_settings;
analyze ops_acct.ledger_sheet_runs;
