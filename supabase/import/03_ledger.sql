-- 03_ledger.sql — the money.
--
-- 3.235 transactions, 2026-01-01 to 2026-09-16, against a legacy system that is
-- still running and still receiving Google Chat events while this runs.
--
-- ── Why this one is different from 01 and 02 ─────────────────────────────
--
-- Reference data can be imported in halves. A vendor that did not come across
-- is a vendor somebody notices is missing.
--
-- A ledger cannot. **Every opening balance in `ops_acct.accounts` is 0 as of
-- 2026-01-01 and the legacy data begins 2026-01-01**, so a balance in the new
-- system is exactly the sum of what this file imported. A row left out does not
-- show up as a gap — it shows up as a balance that is simply wrong, on a screen
-- that looks the same as it would if it were right.
--
-- That is why `0042` had to add five transaction types before this could run,
-- and why the reconciliation at the bottom is not a summary but the point: it
-- compares the new system's net movement per account against the legacy
-- system's, and any difference is a row this file did not carry.
--
-- ── Idempotent, like the others ──────────────────────────────────────────
--
-- Gated on `ops_core.legacy_map`. Run it twice and the second run imports
-- nothing and changes nothing. `source_ref` is `legacy:<trx_id>` and is unique,
-- so even a map that was lost would refuse the duplicate rather than book the
-- money twice.
--
-- ── `trx_no` is carried across, deliberately ─────────────────────────────
--
-- The legacy id is `trx-26-09-17_135` and `ops_acct.transactions.trx_no` is
-- documented as `trx-26-09-11_014`. The same format, by inheritance — the new
-- numbering was written from the old. So the number people already quote to
-- each other keeps working, and a screenshot from August still finds its row.
--
-- `source_ref` is the same value with a `legacy:` prefix rather than the bare
-- id: it is the idempotency claim, and it should say at a glance that this row
-- came from the old system rather than from somebody pressing a button.
--
-- ── Who posted these ─────────────────────────────────────────────────────
--
-- **706 of them have a real author and it is recovered**, by joining
-- `event_id` to `raw_events.sender` to `chat_users.email` — six people, all of
-- whom already exist in `ops_core.users`. That is a fact the old system
-- recorded, and it is carried rather than flattened.
--
-- The other 2.529 have no author anywhere: 2.339 never had an event, and 190
-- came from a sender who is not a known chat user. `posted_by` is `not null`,
-- so they need a name.
--
-- Owner, 2026-09-21: **`shared@talaliving.com`**. Put to them with the cost
-- attached — it is an account people sign in to, so the audit trail will read
-- as though that account posted two and a half thousand transactions — and
-- chosen anyway. Recorded here so the next person reading a ledger row does not
-- have to guess whether a person did that.
--
-- Every such row is marked in `ops_core.legacy_map`, so *which ones had a real
-- author* stays answerable.
--
-- ── What it refuses, and why that is safe here ───────────────────────────
--
-- Fourteen rows have `idr_amount = 0`, three of them described `void`.
-- `amount_idr` is `check (> 0)` — a transaction of nothing is not a
-- transaction. They are refused, and refusing them costs the reconciliation
-- nothing, because zero is what they are worth.
--
-- One row has no account and no direction. It is refused: an entry that does
-- not say which account it moved, or which way, is not a ledger entry.
--
-- ── What it never invents ────────────────────────────────────────────────
--
-- `vendor` and `project` are text in the old schema and foreign keys here.
-- They resolve by name or they stay null, with the original text kept in the
-- map. 276 of 281 distinct vendor names resolve; 655 of 666 project rows do.
-- The eleven that do not include `CHAIR PHILIPPINES`, which the project table
-- spells `CHAIR PHILIPHINES` — two systems disagreeing about a name, which is
-- exactly the kind of thing that must surface as a refusal rather than be
-- matched away by a fuzzy comparison.

\set ON_ERROR_STOP on
\timing off

begin;

create temp table _run on commit drop as
  select gen_random_uuid() as run_id;

/* ── the identity every row without an author is posted as ───────────────
 *
 * Resolved once, here, and the whole file fails if it is missing. The
 * alternative — a `coalesce` onto whichever user happens to sort first — is
 * how a ledger ends up attributing two and a half thousand transactions to
 * somebody by accident.
 */
create temp table _fallback_actor on commit drop as
  select id from ops_core.users where email = 'shared@talaliving.com';

do $$
begin
  if not exists (select 1 from _fallback_actor) then
    raise exception
      'shared@talaliving.com is not in ops_core.users, and 2.529 transactions have no author '
      'of their own. Importing them under a different account would put a false name on real '
      'money. Create the account first, or change the fallback in this file deliberately.';
  end if;
end $$;

/* ── staging: every legacy row, resolved, with its refusal reason ────────
 *
 * Built once so the insert, the map and the reconciliation all read the same
 * decisions. Three separate `left join`s over 3.235 rows would be three
 * chances for them to disagree about which rows were imported.
 */
create temp table _staged on commit drop as
select t.trx_id,
       t.trx_date,
       a.id                                   as account_id,
       t.account                              as account_text,
       t.in_out,
       t.idr_amount,
       coalesce(nullif(btrim(t.type_of_transaction), ''), 'OTHERS') as type_code,
       t.type_of_transaction                  as type_text,
       v.id                                   as vendor_id,
       t.vendor                               as vendor_text,
       p.id                                   as project_id,
       t.project                              as project_text,
       t.description,
       t.remark,
       coalesce(nullif(btrim(t.status), ''), 'POSTED') as status,
       t.status                               as status_text,
       t.created_at,
       /* The real author, where the old system happened to record one. */
       u.id                                   as sender_id,
       cu.email                               as sender_email,
       /* Refused, and why — one reason, the first that applies, so the
          reconciliation reads as a list of distinct problems rather than a
          row appearing under four headings. */
       case
         when t.idr_amount is null or t.idr_amount <= 0
           then 'amount is ' || coalesce(t.idr_amount::text, 'null')
                || ' — a transaction of nothing is not a transaction'
         when t.in_out is null or t.in_out not in ('IN','OUT')
           then 'no direction — an entry that does not say which way the money went '
                'is not a ledger entry'
         when a.id is null
           then 'account ' || coalesce(quote_literal(t.account), '(none)')
                || ' is not an account in ops_acct.accounts'
         when not exists (select 1 from ops_acct.transaction_types ty
                           where ty.code = coalesce(nullif(btrim(t.type_of_transaction),''),'OTHERS'))
           then 'transaction type ' || quote_literal(btrim(t.type_of_transaction))
                || ' has no code in ops_acct.transaction_types'
       end                                    as refused_because
  from public.transactions t
  left join ops_acct.accounts   a  on a.code = btrim(t.account)
  left join ops_procure.vendors v  on upper(v.name) = upper(btrim(t.vendor))
                                  and coalesce(btrim(t.vendor), '') <> ''
  /* **By name, not by code.** `transactions.project` holds `BABY ISLAND`, not
     `25007` — measured, not assumed. */
  left join ops_procure.projects p on upper(p.name) = upper(btrim(t.project))
                                  and coalesce(btrim(t.project), '') <> ''
  left join public.raw_events   e  on e.event_id = t.event_id
  left join public.chat_users   cu on cu.user_id = e.sender
  left join ops_core.users      u  on u.email = cu.email
 where not exists (
   select 1 from ops_core.legacy_map m
    where m.source_table = 'public.transactions' and m.source_id = t.trx_id);

create index on _staged (trx_id);

/* ── the transactions ────────────────────────────────────────────────────
 *
 * `posted_at` carries the legacy `created_at` rather than defaulting to now().
 * A ledger whose rows all claim to have been posted on the afternoon of the
 * import is a ledger that cannot answer *what did we know in March*.
 */
insert into ops_acct.transactions
  (trx_no, trx_date, account_id, direction, amount_idr, type_code,
   vendor_id, project_id, description, remark, status, source_ref,
   posted_by, posted_at)
select s.trx_id,
       s.trx_date,
       s.account_id,
       s.in_out::ops_acct.direction_t,
       s.idr_amount,
       s.type_code,
       s.vendor_id,
       s.project_id,
       s.description,
       s.remark,
       s.status::ops_acct.trx_status_t,
       'legacy:' || s.trx_id,
       coalesce(s.sender_id, (select id from _fallback_actor)),
       s.created_at
  from _staged s
 where s.refused_because is null
 on conflict (source_ref) do nothing;

/* ── the map, which is the deliverable ───────────────────────────────────
 *
 * Every legacy row lands here, imported or refused, with what could not be
 * carried. The refusals are a list somebody works through; the notes on the
 * imported ones are what makes *which rows have a borrowed author* and *which
 * lost their project* answerable a month from now, when the question comes up
 * and nobody remembers.
 */
insert into ops_core.legacy_map
  (source_table, source_id, target_table, target_id, outcome, note, run_id)
select 'public.transactions',
       s.trx_id,
       'ops_acct.transactions',
       t.id,
       case when s.refused_because is null then 'imported' else 'refused' end,
       coalesce(s.refused_because, nullif(concat_ws('; ',
         case when s.sender_id is null
              then 'no author in the legacy row — posted as shared@talaliving.com (owner, 2026-09-21)'
              else 'author recovered from the chat event: ' || s.sender_email end,
         case when coalesce(btrim(s.vendor_text), '') <> '' and s.vendor_id is null
              then 'vendor ' || quote_literal(btrim(s.vendor_text))
                   || ' not resolved — left null rather than created' end,
         case when coalesce(btrim(s.project_text), '') <> '' and s.project_id is null
              then 'project ' || quote_literal(btrim(s.project_text))
                   || ' not resolved by name — left null' end,
         case when coalesce(btrim(s.type_text), '') = ''
              then 'no transaction type in the legacy row — filed as OTHERS, '
                   'which is indistinguishable on screen from one somebody chose' end,
         case when coalesce(btrim(s.status_text), '') = ''
              then 'no status in the legacy row — posted' end
       ), '')),
       (select run_id from _run)
  from _staged s
  left join ops_acct.transactions t on t.source_ref = 'legacy:' || s.trx_id
 on conflict (source_table, source_id) do nothing;

\echo ''
\echo '── what came across ────────────────────────────────────────────────'
select count(*)                                                as transactions,
       count(*) filter (where posted_by <> (select id from _fallback_actor)) as real_author,
       count(*) filter (where posted_by =  (select id from _fallback_actor)) as posted_as_shared,
       count(*) filter (where vendor_id  is null)               as no_vendor,
       count(*) filter (where project_id is null)               as no_project
  from ops_acct.transactions;

\echo ''
\echo '── refused, and why ────────────────────────────────────────────────'
select regexp_replace(note, '[0-9]+', 'N', 'g') as reason, count(*)
  from ops_core.legacy_map
 where source_table = 'public.transactions' and outcome = 'refused'
 group by 1 order by 2 desc;

/* ── the reconciliation, which is the whole reason to run this ───────────
 *
 * Net movement per account, ours against theirs. Openings are 0 on both sides
 * as of 2026-01-01, so these must agree to the rupiah — and a difference is
 * not a rounding question, it is a row this file did not carry.
 *
 * Read this, not the exit code.
 */
\echo ''
\echo '── reconciliation: net movement per account ────────────────────────'
with ours as (
  select a.code,
         sum(case when t.direction = 'IN' then t.amount_idr else -t.amount_idr end) as net
    from ops_acct.transactions t
    join ops_acct.accounts a on a.id = t.account_id
   where t.status <> 'VOID'
   group by a.code),
theirs as (
  select btrim(account) as code,
         sum(case when in_out = 'IN' then idr_amount else -idr_amount end) as net
    from public.transactions
   where account is not null and idr_amount > 0 and in_out in ('IN','OUT')
   group by 1)
select coalesce(o.code, x.code)                      as account,
       round(coalesce(o.net, 0))                     as ours,
       round(coalesce(x.net, 0))                     as legacy,
       round(coalesce(o.net, 0) - coalesce(x.net, 0)) as difference,
       case when round(coalesce(o.net,0)) = round(coalesce(x.net,0))
            then 'agrees' else '*** DIFFERS ***' end as verdict
  from ours o full join theirs x on x.code = o.code
 order by 1;

commit;
