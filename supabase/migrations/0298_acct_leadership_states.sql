-- 0298_acct_leadership_states.sql — BCA USD 081 and BCA 064 are read from
-- the bank's own screen, not summed from what we happened to see (D456).
--
-- Owner, 2026-11-25: *kita tidak pernah tahu dari mana uang masuk dan berapa,
-- kapan, sehingga mencatat balance hanya akan rancu … alurnya 081 begini:
-- saldo USD awal berapa, dikonversi ke IDR berapa, sisa USD berapa, sisa IDR
-- berapa … jika sebelumnya transaksi terakhir sisa USD 4000 tapi sekarang jadi
-- USD 6000 maka itu bisa diabaikan, dan dicatat sebagai state baru.* And for
-- 064: *mungkin ada transaksi yang tidak tercatat seperti biaya bulanan bank.*
-- *Patokannya adalah dokumen yang diupload di google chat oleh evin.*
--
-- ── What went wrong with a running balance ───────────────────────────────
--
-- A running balance is the opening balance plus every row. It is right only
-- when every movement is a row. On the two leadership accounts most are not:
-- client money arrives in 064 and dollars arrive in 081 with no document
-- anybody here sees, and the bank takes its monthly fee without one. D444
-- closed the hole with GAP rows — Rp 938,6 jt IN on 064, USD 12.595,14 IN on
-- 081 — which made the totals agree with the bank once and wrong again at the
-- next unseen movement. The ledger then printed a balance that looked
-- checked and was not.
--
-- What Evin sends is the bank's own reading: an *Account Portfolio Summary*
-- screenshot with both balances, at the moment of a transfer or conversion.
-- That is the truth this records.
--
-- ── 1. A state: the balance the bank showed, with its screenshot ─────────
--
-- `account_states` holds one reading per row: account, day, the balance in
-- the account's own currency, the evidence, and *where in that day* it was
-- read — right after a named ledger row (`after_trx_no`, what a conversion
-- writes) or at the end of the day (null, what a screenshot alone gives).
-- Append-only: a wrong reading is voided with a reason, never edited.
--
-- ── 2. An account's balance mode ─────────────────────────────────────────
--
--   running     opening + every row, as before (every other account)
--   anchored    the latest state + the rows after it, and each row's balance
--               counted from the state before it (BCA 064 — owner: yes, show
--               it). Rows before the first state show none
--   state_only  the account's balance as `anchored`, but rows print no
--               balance at all (BCA USD 081 — owner: no balance on rows)
--
-- So a movement nobody recorded does not poison every row after it: the next
-- screenshot re-anchors, and the difference between what the rows predicted
-- and what the bank showed is printed as **tidak tercatat** on the state
-- (`v_account_state.unrecorded`) — shown, never booked.
--
-- ── 3. A conversion: one act, the four figures the owner named ───────────
--
-- `record_conversion` writes the transfer (081 OUT in dollars, 064 IN in
-- rupiah, through `post_transfer`/`book_evidence_to_transfer`, 0285), keeps
-- *USD awal · dikonversi · kurs · IDR diterima* in `fx_conversions`, and
-- writes the state *after* it: USD awal − dikonversi on 081, and the 064
-- balance when the screenshot shows it. A USD awal that does not follow from
-- the previous USD sisa (4.000 then 6.000) is not refused and books nothing:
-- it is the new state, and `v_fx_conversion.foreign_jump` shows the
-- difference.
--
-- The evidence (Q4, answered from the screenshots): 081 holds dollars only,
-- and a conversion lands in 064 whole and at once — on 22/10 064 went from
-- 10.995.568 to 47.051.568, exactly USD 2.000 @ 18.028, while 081 fell to
-- USD 295,14.
--
-- Money that *is* documented still goes in as a row: a transfer 064 → 271, a
-- transfer to EJO, a bank fee with its proof, a dollar withdrawal into 081
-- (owner, Q3: *catat sebagai IN*). Rows are what the liquidation and
-- cashflow reports follow; states are what the balance is read from.

-- ── the mode ──────────────────────────────────────────────────────────────

alter table ops_acct.accounts
  add column if not exists balance_mode text not null default 'running'
    check (balance_mode in ('running', 'anchored', 'state_only'));
comment on column ops_acct.accounts.balance_mode is
  'running: opening + every row. anchored: the latest account_states reading + the rows after it, rows show '
  'their balance from the reading before them. state_only: as anchored, but rows show no balance (D456).';

update ops_acct.accounts set balance_mode = 'state_only' where code = 'BCA USD 081';
update ops_acct.accounts set balance_mode = 'anchored'   where code = 'BCA 064';

-- ── the reading ───────────────────────────────────────────────────────────

create table if not exists ops_acct.account_states (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references ops_acct.accounts(id),
  as_of         date not null,
  -- Read right after this ledger row (same account, same day). Null: at the
  -- end of `as_of`, so every row of that day is already in it.
  after_trx_no  text,
  -- In the account's own currency: dollars on 081, rupiah on 064.
  balance       numeric not null,
  attachment_id uuid references ops_core.attachments(id),
  -- The source's own key, so a retry is recognised: `inbox:<ref_id>` for a
  -- screenshot from the inbox, `conversion:<transfer_id>:from|to` for the
  -- state a conversion writes.
  source_ref    text unique,
  note          text,
  recorded_by   uuid not null references ops_core.users(id),
  recorded_at   timestamptz not null default now(),
  void_reason   text,
  voided_by     uuid references ops_core.users(id),
  voided_at     timestamptz,
  constraint account_state_void_whole check ((void_reason is null) = (voided_at is null)
                                             and (voided_at is null) = (voided_by is null))
);
create index if not exists account_states_live_idx
  on ops_acct.account_states (account_id, as_of desc) where voided_at is null;
comment on table ops_acct.account_states is
  'The balance a bank screen showed, with the screenshot (D456). Anchors the balance of an account whose '
  'balance_mode is not running. Append-only: void with a reason, record again.';

create table if not exists ops_acct.fx_conversions (
  transfer_id      uuid primary key,
  trx_date         date not null,
  from_account_id  uuid not null references ops_acct.accounts(id),
  to_account_id    uuid not null references ops_acct.accounts(id),
  foreign_currency text not null,
  foreign_before   numeric not null check (foreign_before >= 0),
  foreign_amount   numeric not null check (foreign_amount > 0),
  fx_rate          numeric check (fx_rate is null or fx_rate > 0),
  idr_amount       numeric not null check (idr_amount > 0),
  idr_after        numeric,
  out_trx_no       text not null,
  in_trx_no        text not null,
  recorded_by      uuid not null references ops_core.users(id),
  recorded_at      timestamptz not null default now(),
  constraint fx_before_covers check (foreign_before >= foreign_amount)
);
comment on table ops_acct.fx_conversions is
  'One currency conversion between our own accounts as the bank advice states it: foreign balance before, '
  'amount converted, rate, rupiah received, rupiah balance after (D456). The money is the transfer_id pair.';

alter table ops_acct.account_states enable row level security;
alter table ops_acct.fx_conversions enable row level security;

drop policy if exists account_states_read on ops_acct.account_states;
create policy account_states_read on ops_acct.account_states for select to authenticated
  using (ops_core.has_permission('accounting.read')
         and exists (select 1 from ops_acct.accounts a
                      where a.id = account_id and ops_acct.account_rows_readable(a.custody)));
drop policy if exists fx_conversions_read on ops_acct.fx_conversions;
create policy fx_conversions_read on ops_acct.fx_conversions for select to authenticated
  using (ops_core.has_permission('accounting.read')
         and exists (select 1 from ops_acct.accounts a
                      where a.id = from_account_id and ops_acct.account_rows_readable(a.custody)));

grant select on ops_acct.account_states, ops_acct.fx_conversions to authenticated;

-- ── where a row sits against a reading ────────────────────────────────────
-- A row is *after* a reading when it is on a later day, or on the same day
-- after the row the reading names. An end-of-day reading (no row named)
-- already has the whole day in it.

create or replace function ops_acct.row_after_state(
  p_trx_date date, p_trx_no text, p_as_of date, p_after_trx_no text)
returns boolean
language sql immutable set search_path = pg_temp as $$
  select p_trx_date > p_as_of
      or (p_trx_date = p_as_of and p_after_trx_no is not null and p_trx_no > p_after_trx_no)
$$;
comment on function ops_acct.row_after_state(date, text, date, text) is
  'True when a ledger row (date, trx_no) moves money after an account_states reading (as_of, after_trx_no) (D456).';
grant execute on function ops_acct.row_after_state(date, text, date, text) to authenticated;

-- The reading a row is counted from: the latest one that is not after it.
create or replace function ops_acct.state_before_row(
  p_account_id uuid, p_trx_date date, p_trx_no text)
returns ops_acct.account_states
language sql stable set search_path = ops_acct, pg_temp as $$
  select s.* from ops_acct.account_states s
   where s.account_id = p_account_id and s.voided_at is null
     and not ops_acct.row_after_state(s.as_of, coalesce(s.after_trx_no, ''), p_trx_date, p_trx_no)
     and not (s.as_of = p_trx_date and s.after_trx_no is null)
   order by s.as_of desc, (s.after_trx_no is null) desc, s.after_trx_no desc, s.recorded_at desc
   limit 1
$$;
comment on function ops_acct.state_before_row(uuid, date, text) is
  'The live account_states reading at or before a ledger row (an end-of-day reading counts from the next day).';
grant execute on function ops_acct.state_before_row(uuid, date, text) to authenticated;

-- The latest reading on an account, for its balance today.
create or replace function ops_acct.latest_state(p_account_id uuid)
returns ops_acct.account_states
language sql stable set search_path = ops_acct, pg_temp as $$
  select s.* from ops_acct.account_states s
   where s.account_id = p_account_id and s.voided_at is null
   order by s.as_of desc, (s.after_trx_no is null) desc, s.after_trx_no desc, s.recorded_at desc
   limit 1
$$;
grant execute on function ops_acct.latest_state(uuid) to authenticated;

-- ── the balance ───────────────────────────────────────────────────────────
-- Same columns as 0020 in the same order; the two at the end are new.

create or replace view ops_acct.v_account_balance as
  select a.id as account_id, a.code, a.name, a.custody, a.currency,
         a.is_paying, a.opening_balance, a.opened_on, a.is_active,
         coalesce(m.total_in, 0)  as total_in,
         coalesce(m.total_out, 0) as total_out,
         case
           when a.balance_mode <> 'running' and ls.id is not null then
             ls.balance + coalesce((
               select sum(case when x.direction = 'IN' then x.amount_idr else -x.amount_idr end)
                 from ops_acct.transactions x
                where x.account_id = a.id and x.status <> 'VOID'
                  and ops_acct.row_after_state(x.trx_date, x.trx_no, ls.as_of, ls.after_trx_no)), 0)
           else a.opening_balance + coalesce(m.total_in, 0) - coalesce(m.total_out, 0)
         end as balance,
         (a.custody = 'leadership' and not ops_core.has_authority('approve_funds'))
           as balance_locked,
         a.balance_mode,
         ls.as_of as balance_anchored_on
    from ops_acct.accounts a
    left join (
      select account_id,
             sum(amount_idr) filter (where direction = 'IN')  as total_in,
             sum(amount_idr) filter (where direction = 'OUT') as total_out
        from ops_acct.transactions where status <> 'VOID'
       group by account_id
    ) m on m.account_id = a.id
    left join lateral (select * from ops_acct.latest_state(a.id)) ls
      on a.balance_mode <> 'running' and ls.id is not null;
alter view ops_acct.v_account_balance set (security_invoker = on);
grant select on ops_acct.v_account_balance to authenticated;

-- ── each row's balance ────────────────────────────────────────────────────
-- 0282's body; only the balance columns change. A running account keeps the
-- window from 0268; an anchored one counts from the reading before the row;
-- a state_only one prints none.

create or replace view ops_acct.v_transaction as
 SELECT t.id,
    t.trx_no,
    t.trx_date,
    t.account_id,
    acc.code AS account_code,
    t.direction,
    t.amount_idr,
    t.type_code,
    t.vendor_id,
    v.name AS vendor_name,
    t.project_id,
    p.code AS project_code,
    t.description,
    t.remark,
    t.status,
    t.source_ref,
    t.posted_by,
    pu.full_name AS posted_by_name,
    t.posted_at,
    t.void_reason,
    t.void_at,
    COALESCE(al.allocated_total, 0::numeric) AS allocated_total,
    t.amount_idr - COALESCE(al.allocated_total, 0::numeric) AS unallocated,
    COALESCE(ev.evidence_count, 0::bigint) AS evidence_count,
    COALESCE(ev.has_payment_proof, false) AS has_payment_proof,
    COALESCE(ev.has_receipt_doc, false) AS has_receipt_doc,
    COALESCE(ln.pr_line_nos, '{}'::text[]) AS pr_line_nos,
    COALESCE(ln.po_nos, '{}'::text[]) AS po_nos,
    t.direction = 'OUT'::ops_acct.direction_t AND COALESCE(ty.is_purchase, true) AS expects_allocation,
    CASE acc.balance_mode
      WHEN 'running'  THEN rb.balance_after - rb.signed_amount
      WHEN 'anchored' THEN an.balance_after - an.signed_amount
    END AS balance_before,
    CASE acc.balance_mode
      WHEN 'running'  THEN rb.balance_after
      WHEN 'anchored' THEN an.balance_after
    END AS balance_after,
    COALESCE(t.category_override, ty.category, 'overhead'::ops_acct.category_t) AS category,
    t.category_override,
    p.name AS project_name,
    t.transfer_id
   FROM ops_acct.transactions t
     JOIN ops_acct.accounts acc ON acc.id = t.account_id
     LEFT JOIN ops_acct.transaction_types ty ON ty.code = t.type_code
     LEFT JOIN ops_procure.vendors v ON v.id = t.vendor_id
     LEFT JOIN ops_procure.projects p ON p.id = t.project_id
     LEFT JOIN ops_core.users pu ON pu.id = t.posted_by
     LEFT JOIN ops_acct.v_allocated al ON al.trx_id = t.id
     LEFT JOIN LATERAL ( SELECT count(*) AS evidence_count,
            bool_or(k.kind = 'transfer_proof'::ops_core.doc_kind_t) AS has_payment_proof,
            bool_or(k.kind = ANY (ARRAY['nota'::ops_core.doc_kind_t, 'rekening_koran'::ops_core.doc_kind_t])) AS has_receipt_doc
           FROM ops_core.attachment_links k
          WHERE k.entity = 'transaction'::ops_core.link_entity_t AND k.entity_no = t.trx_no AND k.unlinked_at IS NULL) ev ON true
     LEFT JOIN LATERAL ( SELECT array_agg(DISTINCT a.pr_line_no) FILTER (WHERE a.pr_line_no IS NOT NULL) AS pr_line_nos,
            array_agg(DISTINCT a.po_no) FILTER (WHERE a.po_no IS NOT NULL) AS po_nos
           FROM ops_acct.payment_allocations a
          WHERE a.trx_id = t.id AND a.superseded_by IS NULL) ln ON true
     LEFT JOIN ( SELECT r.id,
            r.signed_amount,
            ra.opening_balance + sum(r.signed_amount) OVER (
              PARTITION BY r.account_id ORDER BY r.trx_date, r.trx_no
              ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS balance_after
           FROM ( SELECT x.id, x.account_id, x.trx_date, x.trx_no,
                    CASE WHEN x.direction = 'IN'::ops_acct.direction_t THEN x.amount_idr ELSE - x.amount_idr END AS signed_amount
                   FROM ops_acct.transactions x
                  WHERE x.status <> 'VOID'::ops_acct.trx_status_t) r
             JOIN ops_acct.accounts ra ON ra.id = r.account_id) rb
       ON rb.id = t.id AND t.trx_date >= ops_acct.ledger_balance_from()
     LEFT JOIN LATERAL (
       SELECT CASE WHEN t.direction = 'IN'::ops_acct.direction_t THEN t.amount_idr ELSE - t.amount_idr END AS signed_amount,
              st.balance + COALESCE((
                SELECT sum(CASE WHEN x.direction = 'IN'::ops_acct.direction_t THEN x.amount_idr ELSE - x.amount_idr END)
                  FROM ops_acct.transactions x
                 WHERE x.account_id = t.account_id AND x.status <> 'VOID'::ops_acct.trx_status_t
                   AND ops_acct.row_after_state(x.trx_date, x.trx_no, st.as_of, st.after_trx_no)
                   AND NOT ops_acct.row_after_state(x.trx_date, x.trx_no, t.trx_date, t.trx_no)), 0::numeric) AS balance_after
         FROM ops_acct.state_before_row(t.account_id, t.trx_date, t.trx_no) st
        WHERE st.id IS NOT NULL) an
       ON acc.balance_mode = 'anchored' AND t.status <> 'VOID'::ops_acct.trx_status_t
  WHERE ops_acct.account_rows_readable(acc.custody);
alter view ops_acct.v_transaction set (security_invoker = on);
grant select on ops_acct.v_transaction to authenticated;

-- ── the readings, with what the rows did not explain ──────────────────────

create or replace view ops_acct.v_account_state as
  select s.id, s.account_id, a.code as account_code, a.currency, s.as_of, s.after_trx_no,
         s.balance, s.attachment_id, att.url as attachment_url, att.filename as attachment_filename,
         s.source_ref, s.note, s.recorded_by, u.full_name as recorded_by_name, s.recorded_at,
         s.void_reason, s.voided_at,
         prev.id as previous_id, prev.balance as previous_balance, prev.as_of as previous_as_of,
         -- What the rows between the two readings moved…
         case when prev.id is not null then coalesce((
           select sum(case when x.direction = 'IN' then x.amount_idr else -x.amount_idr end)
             from ops_acct.transactions x
            where x.account_id = s.account_id and x.status <> 'VOID'
              and ops_acct.row_after_state(x.trx_date, x.trx_no, prev.as_of, prev.after_trx_no)
              and not ops_acct.row_after_state(x.trx_date, x.trx_no, s.as_of, s.after_trx_no)), 0)
         end as recorded_movement,
         -- …and what the bank moved that nobody recorded. Shown, never booked.
         case when prev.id is not null then s.balance - prev.balance - coalesce((
           select sum(case when x.direction = 'IN' then x.amount_idr else -x.amount_idr end)
             from ops_acct.transactions x
            where x.account_id = s.account_id and x.status <> 'VOID'
              and ops_acct.row_after_state(x.trx_date, x.trx_no, prev.as_of, prev.after_trx_no)
              and not ops_acct.row_after_state(x.trx_date, x.trx_no, s.as_of, s.after_trx_no)), 0)
         end as unrecorded
    from ops_acct.account_states s
    join ops_acct.accounts a on a.id = s.account_id
    left join ops_core.attachments att on att.id = s.attachment_id
    left join ops_core.users u on u.id = s.recorded_by
    left join lateral (
      select p.* from ops_acct.account_states p
       where p.account_id = s.account_id and p.voided_at is null and p.id <> s.id
         and (p.as_of < s.as_of
              or (p.as_of = s.as_of and s.after_trx_no is null and p.after_trx_no is not null)
              or (p.as_of = s.as_of and p.after_trx_no is not null and s.after_trx_no is not null
                  and p.after_trx_no < s.after_trx_no))
       order by p.as_of desc, (p.after_trx_no is null) desc, p.after_trx_no desc, p.recorded_at desc
       limit 1) prev on s.voided_at is null
   where ops_acct.account_rows_readable(a.custody);
alter view ops_acct.v_account_state set (security_invoker = on);
grant select on ops_acct.v_account_state to authenticated;
comment on view ops_acct.v_account_state is
  'Each bank reading with the one before it: recorded_movement is what the ledger rows moved in between, '
  'unrecorded = balance − previous − recorded_movement, what the bank moved that nobody recorded (D456).';

create or replace view ops_acct.v_fx_conversion as
  select c.transfer_id, c.trx_date, fa.code as from_account_code, ta.code as to_account_code,
         c.foreign_currency, c.foreign_before, c.foreign_amount,
         c.foreign_before - c.foreign_amount as foreign_after,
         c.fx_rate, round(c.idr_amount / c.foreign_amount, 2) as effective_rate,
         c.idr_amount, c.idr_after, c.out_trx_no, c.in_trx_no,
         -- The previous conversion's dollars left, and how far this one's
         -- starting balance is from it: a new state, never a booked row.
         lag(c.foreign_before - c.foreign_amount) over w as previous_foreign_after,
         c.foreign_before - lag(c.foreign_before - c.foreign_amount) over w as foreign_jump,
         c.recorded_by, u.full_name as recorded_by_name, c.recorded_at,
         coalesce((select jsonb_agg(jsonb_build_object(
                     'attachment_id', k.attachment_id, 'kind', k.kind,
                     'url', att.url, 'filename', att.filename) order by k.linked_at)
                     from ops_core.attachment_links k
                     join ops_core.attachments att on att.id = k.attachment_id
                    where k.entity = 'transaction' and k.entity_no = c.out_trx_no
                      and k.unlinked_at is null), '[]'::jsonb) as documents
    from ops_acct.fx_conversions c
    join ops_acct.accounts fa on fa.id = c.from_account_id
    join ops_acct.accounts ta on ta.id = c.to_account_id
    left join ops_core.users u on u.id = c.recorded_by
    join ops_acct.transactions o on o.trx_no = c.out_trx_no and o.status <> 'VOID'
   where ops_acct.account_rows_readable(fa.custody)
  window w as (partition by c.from_account_id order by c.trx_date, c.out_trx_no);
alter view ops_acct.v_fx_conversion set (security_invoker = on);
grant select on ops_acct.v_fx_conversion to authenticated;
comment on view ops_acct.v_fx_conversion is
  'The conversion log the owner reads for BCA USD 081: USD awal, dikonversi, kurs, IDR diterima, USD sisa, '
  'IDR sisa, and foreign_jump when USD awal does not follow from the previous USD sisa (D456).';

-- ── seam: record a reading ────────────────────────────────────────────────

create or replace function ops_acct.record_account_state(
  p_account_code  text,
  p_as_of         date,
  p_balance       numeric,
  p_inbox_ref     text    default null,
  p_attachment_id uuid    default null,
  p_after_trx_no  text    default null,
  p_note          text    default null,
  p_key           text    default null)
returns jsonb
language plpgsql security definer set search_path = ops_acct, ops_core, pg_temp as $$
declare
  acc ops_acct.accounts; inbox ops_acct.evidence_inbox; att uuid; src text;
  existing ops_acct.account_states; new_id uuid; replayed jsonb; res jsonb;
begin
  replayed := ops_core.idem_replay('accounting','record_account_state:' || coalesce(p_account_code,''), p_key);
  if replayed is not null then return replayed; end if;

  if not ops_core.has_authority('post_ledger') then
    return ops_core.refused('accounting','account_state', p_account_code,'record',
      'authority_required','Recording a bank balance belongs to Accounting.',
      jsonb_build_object('required','post_ledger'));
  end if;
  select * into acc from ops_acct.accounts where code = btrim(coalesce(p_account_code,''));
  if not found then
    return ops_core.not_found('accounting','account_state', p_account_code,'record','No such account.');
  end if;
  if acc.custody = 'leadership' and not ops_core.has_authority('approve_funds') then
    return ops_core.refused('accounting','account_state', acc.code,'record',
      'leadership_account','Leadership accounts are recorded only by someone who approves funds.',
      jsonb_build_object('required','approve_funds'));
  end if;
  if acc.balance_mode = 'running' then
    return ops_core.invalid('accounting','account_state', acc.code,'record',
      'running_account', format('%s is counted from its rows; a bank reading does not set it.', acc.code),
      jsonb_build_object('field','account_code','balance_mode', acc.balance_mode));
  end if;
  if p_as_of is null then
    return ops_core.invalid('accounting','account_state', acc.code,'record',
      'date_required','Which day did the bank show this balance?', jsonb_build_object('field','as_of'));
  end if;
  if p_balance is null or p_balance < 0 then
    return ops_core.invalid('accounting','account_state', acc.code,'record',
      'balance_required','Type the balance as the bank shows it (zero or more).',
      jsonb_build_object('field','balance'));
  end if;

  if nullif(btrim(coalesce(p_inbox_ref,'')), '') is not null then
    select * into inbox from ops_acct.evidence_inbox where ref_id = btrim(p_inbox_ref) for update;
    if not found then
      return ops_core.not_found('accounting','account_state', acc.code,'record','No such inbox row.');
    end if;
    att := inbox.attachment_id;
    src := 'inbox:' || inbox.ref_id;
  else
    att := p_attachment_id;
  end if;
  if att is null then
    return ops_core.invalid('accounting','account_state', acc.code,'record',
      'evidence_required','A balance needs the screenshot it was read from (D85).',
      jsonb_build_object('field','attachment_id'));
  end if;
  if not exists (select 1 from ops_core.attachments where id = att) then
    return ops_core.not_found('accounting','account_state', acc.code,'record','No such attachment.');
  end if;

  if nullif(btrim(coalesce(p_after_trx_no,'')), '') is not null
     and not exists (select 1 from ops_acct.transactions x
                      where x.trx_no = btrim(p_after_trx_no) and x.account_id = acc.id
                        and x.trx_date = p_as_of and x.status <> 'VOID') then
    return ops_core.invalid('accounting','account_state', acc.code,'record',
      'after_trx_not_here', format('%s is not a live row of %s on %s.', btrim(p_after_trx_no), acc.code, p_as_of),
      jsonb_build_object('field','after_trx_no'));
  end if;

  -- The same screenshot read again for the same account: already recorded.
  if src is not null then
    select * into existing from ops_acct.account_states
     where source_ref = src || ':' || acc.code and voided_at is null;
    if found then
      return ops_core.ok('accounting','account_state', acc.code,'record',
        jsonb_build_object('id', existing.id, 'already_recorded', true, 'balance', existing.balance),
        null, null);
    end if;
  end if;

  insert into ops_acct.account_states
    (account_id, as_of, after_trx_no, balance, attachment_id, source_ref, note, recorded_by)
  values
    (acc.id, p_as_of, nullif(btrim(coalesce(p_after_trx_no,'')), ''), p_balance, att,
     case when src is not null then src || ':' || acc.code end,
     nullif(btrim(coalesce(p_note,'')), ''), auth.uid())
  returning id into new_id;

  -- A screenshot that only shows balances is filed, not booked: NOTED, with
  -- what was read from it. One that is still to be booked as a transfer
  -- keeps its status.
  if inbox.ref_id is not null and inbox.status = 'PENDING' then
    update ops_acct.evidence_inbox
       set status = 'NOTED', resolved_by = auth.uid(), resolved_at = now(),
           resolve_note = format('Saldo %s per %s dicatat: %s', acc.code, p_as_of, p_balance)
     where ref_id = inbox.ref_id;
  end if;

  perform ops_core.emit('accounting','accounting.account_state.recorded', acc.code,
    jsonb_build_object('id', new_id, 'account', acc.code, 'as_of', p_as_of, 'balance', p_balance));

  res := ops_core.ok('accounting','account_state', acc.code,'record',
    jsonb_build_object('id', new_id, 'account_code', acc.code, 'as_of', p_as_of, 'balance', p_balance),
    null, jsonb_build_object('id', new_id, 'balance', p_balance, 'as_of', p_as_of));
  return ops_core.idem_remember('accounting','record_account_state:' || acc.code, p_key, res);
end $$;
revoke execute on function ops_acct.record_account_state(text, date, numeric, text, uuid, text, text, text) from public;
grant  execute on function ops_acct.record_account_state(text, date, numeric, text, uuid, text, text, text) to authenticated;
comment on function ops_acct.record_account_state(text, date, numeric, text, uuid, text, text, text) is
  'Record the balance a bank screen showed for an anchored/state_only account, with its screenshot (an inbox '
  'row, filed NOTED, or an attachment). post_ledger; approve_funds for leadership accounts (D456).';

create or replace function ops_acct.void_account_state(
  p_id uuid, p_reason text, p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_acct, ops_core, pg_temp as $$
declare s ops_acct.account_states; acc ops_acct.accounts; replayed jsonb; res jsonb;
begin
  replayed := ops_core.idem_replay('accounting','void_account_state:' || coalesce(p_id::text,''), p_key);
  if replayed is not null then return replayed; end if;
  select * into s from ops_acct.account_states where id = p_id for update;
  if not found then
    return ops_core.not_found('accounting','account_state', p_id::text,'void','No such reading.');
  end if;
  select * into acc from ops_acct.accounts where id = s.account_id;
  if not ops_core.has_authority('post_ledger')
     or (acc.custody = 'leadership' and not ops_core.has_authority('approve_funds')) then
    return ops_core.refused('accounting','account_state', acc.code,'void',
      'authority_required','Only whoever may record this balance may void it.');
  end if;
  if coalesce(btrim(p_reason),'') = '' then
    return ops_core.invalid('accounting','account_state', acc.code,'void',
      'reason_required','Say why the reading was wrong.', jsonb_build_object('field','reason'));
  end if;
  if s.voided_at is not null then
    return ops_core.conflict('accounting','account_state', acc.code,'void',
      'already_void','This reading is already void.');
  end if;
  update ops_acct.account_states
     set void_reason = btrim(p_reason), voided_by = auth.uid(), voided_at = now()
   where id = p_id;
  res := ops_core.ok('accounting','account_state', acc.code,'void',
    jsonb_build_object('id', p_id), to_jsonb(s), jsonb_build_object('void_reason', btrim(p_reason)));
  return ops_core.idem_remember('accounting','void_account_state:' || p_id::text, p_key, res);
end $$;
revoke execute on function ops_acct.void_account_state(uuid, text, text) from public;
grant  execute on function ops_acct.void_account_state(uuid, text, text) to authenticated;

-- ── seam: record a conversion ─────────────────────────────────────────────

create or replace function ops_acct.record_conversion(
  p_trx_date          date,
  p_foreign_before    numeric,
  p_foreign_amount    numeric,
  p_idr_amount        numeric,
  p_rate              numeric default null,
  p_idr_after         numeric default null,
  p_inbox_ref         text    default null,
  p_also_inbox_refs   text[]  default null,
  p_documents         jsonb   default null,
  p_description       text    default null,
  p_from_account_code text    default 'BCA USD 081',
  p_to_account_code   text    default 'BCA 064',
  p_key               text    default null)
returns jsonb
language plpgsql security definer set search_path = ops_acct, ops_core, pg_temp as $$
declare
  fa ops_acct.accounts; ta ops_acct.accounts; posted jsonb; tid uuid; out_no text; in_no text;
  descr text; replayed jsonb; res jsonb; extra uuid; also text[];
begin
  replayed := ops_core.idem_replay('accounting','record_conversion:' || coalesce(p_inbox_ref, p_trx_date::text, ''), p_key);
  if replayed is not null then return replayed; end if;

  if not ops_core.has_authority('post_ledger') then
    return ops_core.refused('accounting','conversion', null,'record',
      'authority_required','Recording a conversion belongs to Accounting.',
      jsonb_build_object('required','post_ledger'));
  end if;
  select * into fa from ops_acct.accounts where code = btrim(coalesce(p_from_account_code,''));
  select * into ta from ops_acct.accounts where code = btrim(coalesce(p_to_account_code,''));
  if fa.id is null or ta.id is null then
    return ops_core.not_found('accounting','conversion', null,'record','One of the two accounts does not exist.');
  end if;
  if (fa.custody = 'leadership' or ta.custody = 'leadership') and not ops_core.has_authority('approve_funds') then
    return ops_core.refused('accounting','conversion', fa.code,'record',
      'leadership_account','Leadership accounts are recorded only by someone who approves funds.',
      jsonb_build_object('required','approve_funds'));
  end if;
  if fa.currency = 'IDR' or ta.currency <> 'IDR' then
    return ops_core.invalid('accounting','conversion', fa.code,'record',
      'not_a_conversion', format('A conversion goes from a foreign account into a rupiah one; %s (%s) → %s (%s) is not.',
                                 fa.code, fa.currency, ta.code, ta.currency),
      jsonb_build_object('field','from_account_code'));
  end if;
  if p_trx_date is null then
    return ops_core.invalid('accounting','conversion', fa.code,'record',
      'date_required','Which day did the bank convert?', jsonb_build_object('field','trx_date'));
  end if;
  if coalesce(p_foreign_amount, 0) <= 0 then
    return ops_core.invalid('accounting','conversion', fa.code,'record',
      'amount_required', format('How many %s were converted?', fa.currency), jsonb_build_object('field','foreign_amount'));
  end if;
  if coalesce(p_idr_amount, 0) <= 0 then
    return ops_core.invalid('accounting','conversion', fa.code,'record',
      'idr_required','How many rupiah arrived?', jsonb_build_object('field','idr_amount'));
  end if;
  if p_foreign_before is null or p_foreign_before < p_foreign_amount then
    return ops_core.invalid('accounting','conversion', fa.code,'record',
      'before_short', format('%s awal (%s) must cover the %s converted.', fa.currency,
                             coalesce(p_foreign_before::text, '—'), p_foreign_amount),
      jsonb_build_object('field','foreign_before'));
  end if;
  -- The bank advice gives all three; they must agree to the rupiah.
  if p_rate is not null and abs(round(p_foreign_amount * p_rate) - p_idr_amount) > 1 then
    return ops_core.invalid('accounting','conversion', fa.code,'record',
      'rate_mismatch', format('%s × %s = %s, not %s.', p_foreign_amount, p_rate,
                              round(p_foreign_amount * p_rate), p_idr_amount),
      jsonb_build_object('field','rate'));
  end if;
  if p_idr_after is not null and p_idr_after < 0 then
    return ops_core.invalid('accounting','conversion', ta.code,'record',
      'idr_after_negative','The rupiah balance after cannot be negative.', jsonb_build_object('field','idr_after'));
  end if;

  descr := coalesce(nullif(btrim(coalesce(p_description,'')), ''),
    format('Konversi %s %s @ %s — %s → %s', fa.currency,
           trim_scale(p_foreign_amount)::text,
           trim_scale(coalesce(p_rate, round(p_idr_amount / p_foreign_amount, 2)))::text,
           fa.code, ta.code));

  if nullif(btrim(coalesce(p_inbox_ref,'')), '') is not null then
    posted := ops_acct.book_evidence_to_transfer(
      p_ref_id            => btrim(p_inbox_ref),
      p_from_account_code => fa.code,
      p_to_account_code   => ta.code,
      p_amount            => p_idr_amount,
      p_trx_date          => p_trx_date,
      p_fee               => null,
      p_description       => descr,
      p_billed_currency   => fa.currency,
      p_billed_amount     => p_foreign_amount,
      p_also_ref_ids      => p_also_inbox_refs,
      p_key               => null);
  else
    if p_documents is null or jsonb_array_length(p_documents) = 0 then
      return ops_core.invalid('accounting','conversion', fa.code,'record',
        'evidence_required','A conversion needs its bank advice: an inbox document or an attachment (D85).',
        jsonb_build_object('field','documents'));
    end if;
    posted := ops_acct.post_transfer(
      p_from_account_code => fa.code,
      p_to_account_code   => ta.code,
      p_amount            => p_idr_amount,
      p_documents         => p_documents,
      p_trx_date          => p_trx_date,
      p_description       => descr,
      p_fee               => null,
      p_billed_currency   => fa.currency,
      p_billed_amount     => p_foreign_amount,
      p_key               => null);
  end if;
  if not ops_core.said_ok(posted) then
    return posted;
  end if;
  tid    := (posted -> 'data' ->> 'transfer_id')::uuid;
  out_no := posted -> 'data' ->> 'out_trx_no';
  in_no  := posted -> 'data' ->> 'in_trx_no';

  -- Every file of the message on both legs, not only the first: the
  -- screenshot of the balances belongs with the money it explains.
  also := coalesce(p_also_inbox_refs, '{}');
  for extra in
    select i.attachment_id from ops_acct.evidence_inbox i where i.ref_id = any(also)
  loop
    insert into ops_core.attachment_links (attachment_id, entity, entity_no, kind, linked_by)
    select extra, 'transaction', leg, 'transfer_proof', auth.uid()
      from unnest(array[out_no, in_no]) leg
     where not exists (select 1 from ops_core.attachment_links k
                        where k.attachment_id = extra and k.entity = 'transaction'
                          and k.entity_no = leg and k.unlinked_at is null);
  end loop;

  insert into ops_acct.fx_conversions
    (transfer_id, trx_date, from_account_id, to_account_id, foreign_currency, foreign_before,
     foreign_amount, fx_rate, idr_amount, idr_after, out_trx_no, in_trx_no, recorded_by)
  values
    (tid, p_trx_date, fa.id, ta.id, fa.currency, p_foreign_before, p_foreign_amount, p_rate,
     p_idr_amount, p_idr_after, out_no, in_no, auth.uid());

  -- The state after it, on each side the advice shows.
  if fa.balance_mode <> 'running' then
    insert into ops_acct.account_states
      (account_id, as_of, after_trx_no, balance, attachment_id, source_ref, note, recorded_by)
    select fa.id, p_trx_date, out_no, p_foreign_before - p_foreign_amount,
           (select k.attachment_id from ops_core.attachment_links k
             where k.entity = 'transaction' and k.entity_no = out_no and k.unlinked_at is null
             order by k.linked_at limit 1),
           'conversion:' || tid || ':from',
           format('%s awal %s − %s dikonversi', fa.currency, p_foreign_before, p_foreign_amount), auth.uid();
  end if;
  if p_idr_after is not null and ta.balance_mode <> 'running' then
    insert into ops_acct.account_states
      (account_id, as_of, after_trx_no, balance, attachment_id, source_ref, note, recorded_by)
    select ta.id, p_trx_date, in_no, p_idr_after,
           (select k.attachment_id from ops_core.attachment_links k
             where k.entity = 'transaction' and k.entity_no = in_no and k.unlinked_at is null
             order by k.linked_at limit 1),
           'conversion:' || tid || ':to', 'Saldo sesudah konversi', auth.uid();
  end if;

  perform ops_core.emit('accounting','accounting.conversion.recorded', out_no,
    jsonb_build_object('transfer_id', tid, 'foreign_amount', p_foreign_amount,
                       'idr_amount', p_idr_amount, 'foreign_after', p_foreign_before - p_foreign_amount));

  res := ops_core.ok('accounting','conversion', out_no,'record',
    jsonb_build_object('transfer_id', tid, 'out_trx_no', out_no, 'in_trx_no', in_no,
                       'foreign_after', p_foreign_before - p_foreign_amount, 'idr_after', p_idr_after),
    null, null);
  return ops_core.idem_remember('accounting','record_conversion:' || coalesce(p_inbox_ref, p_trx_date::text, ''), p_key, res);
end $$;
revoke execute on function ops_acct.record_conversion(date, numeric, numeric, numeric, numeric, numeric, text, text[], jsonb, text, text, text, text) from public;
grant  execute on function ops_acct.record_conversion(date, numeric, numeric, numeric, numeric, numeric, text, text[], jsonb, text, text, text, text) to authenticated;
comment on function ops_acct.record_conversion(date, numeric, numeric, numeric, numeric, numeric, text, text[], jsonb, text, text, text, text) is
  'A currency conversion as the bank advice states it (USD awal, dikonversi, kurs, IDR diterima, IDR sisa): '
  'the transfer pair (book_evidence_to_transfer from the inbox, or post_transfer with attachments), the '
  'fx_conversions row, and the state after it on each anchored side. post_ledger + approve_funds (D456).';

-- ── the ledger mirror follows the bank readings (D455 → D456) ──────────────
-- 0297's body; only the balance changes. BCA 064 (`anchored`) prints the
-- balance counted from the reading before the row, as `v_transaction` does,
-- and nothing before its first reading; BCA USD 081 (`state_only`) prints none.

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

analyze ops_acct.account_states;
analyze ops_acct.fx_conversions;
