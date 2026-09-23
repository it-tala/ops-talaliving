-- 04_lines.sql — what the money was spent on, itemised.
--
-- 1.194 rows in `public.item_purchases`, each naming one transaction and one
-- item. They become `ops_acct.transaction_lines`.
--
-- ── Why this is worth importing at all ──────────────────────────────────
--
-- `03_ledger.sql` carried the money: 3.221 transactions, reconciled to the
-- rupiah. Every one of them says *Rp 250.000 to UD SUMBER REJEKI* and none of
-- them says what was bought.
--
-- D86 is that a purchase is itemised — not for tidiness, but because it is what
-- makes a catalogue learn a real last-paid price. Without these lines
-- `ops_procure.items.last_price` is whatever `02_items.sql` copied across and
-- can never be recomputed; with them, *what did we last pay for plywood, and to
-- whom* is a question the new system can answer from its own rows.
--
-- ── What it does not do ─────────────────────────────────────────────────
--
-- **It does not touch `items.last_price`.** That is derived state, and A3 says
-- the new system computes it rather than storing somebody else's arithmetic. A
-- line that disagrees with the price the catalogue carries is the new system
-- finding a row the old one got wrong, and writing the legacy value over it
-- would destroy exactly the signal the design exists to produce.
--
-- **It does not reconcile the line total against the transaction.** 1.182 of
-- 1.188 sum exactly; three sum over and three sum under. Those six are not
-- errors this import may correct — they are what the old system recorded, and a
-- line adjusted to make an arithmetic check pass is a fact replaced by a
-- preference. They are counted at the bottom so somebody can look.
--
-- ── Five rows have no transaction to belong to ──────────────────────────
--
-- Their `trx_id` names one of the fourteen `03_ledger.sql` refused for having
-- `idr_amount = 0`. A line on a transaction that does not exist is not a line,
-- so they are refused with the reason naming the transaction — which makes the
-- two refusal lists join up rather than each looking like an unexplained gap.
--
-- ── Units ───────────────────────────────────────────────────────────────
--
-- Resolved through `_units.sql`, shared with `02_items.sql`. Eleven lines use a
-- unit nobody here can read — `fil`, `gendel`, `ltrset`, `rem`, `slop`, `slp` —
-- and arrive with none, their text kept in the map. `rem` looks like `rim` and
-- is a single row; close enough to guess is the reason not to.
--
-- 832 of the 1.194 have no unit at all, which is not a problem to solve:
-- `transaction_lines.uom` is nullable because a line of *service, Rp 500.000*
-- has no unit and never did.

\set ON_ERROR_STOP on
\timing off

begin;

create temp table _run on commit drop as
  select gen_random_uuid() as run_id;

\ir _units.sql

/* ── staging ─────────────────────────────────────────────────────────────
 *
 * **`line_no` continues from whatever the transaction already has.** Starting
 * at 1 would be right today — nothing else writes lines against an imported
 * transaction yet — and wrong the first time somebody itemises one by hand
 * before this is re-run, which is exactly the kind of assumption that holds
 * until the day it costs a unique-violation mid-import.
 */
create temp table _staged on commit drop as
select ip.purchase_id,
       ip.trx_id,
       t.id                                        as trx_uuid,
       m.target_id                                 as item_id,
       /* What was written on the line, not what the catalogue calls it now.
          `item_raw` is the text somebody typed; the item's name is where it was
          eventually filed, and those are two different facts. */
       coalesce(nullif(btrim(ip.item_raw), ''), i.name, '(tanpa keterangan)') as description,
       ip.qty,
       lower(btrim(coalesce(ip.unit, '')))         as raw_unit,
       coalesce(
         (select u.code from ops_procure.uom u
           where u.code = lower(btrim(coalesce(ip.unit, '')))),
         (select um.uom from _unit_map um
           where um.legacy = lower(btrim(coalesce(ip.unit, ''))))
       )                                           as uom_code,
       ip.price,
       ip.idr_amount,
       coalesce((select max(l.line_no) from ops_acct.transaction_lines l
                  where l.trx_id = t.id), 0)
         + row_number() over (partition by ip.trx_id
                              order by ip.created_at, ip.purchase_id) as line_no,
       case
         when t.id is null
           then 'transaction ' || ip.trx_id || ' was not imported — see its own row in this map'
         when ip.idr_amount is null or ip.idr_amount < 0
           then 'line amount is ' || coalesce(ip.idr_amount::text, 'null')
         when ip.qty is not null and ip.qty <= 0
           then 'quantity is ' || ip.qty::text || ' — a line of none of something is not a line'
       end                                         as refused_because
  from public.item_purchases ip
  left join ops_acct.transactions t on t.trx_no = ip.trx_id
  /* The item, through the map `02_items.sql` wrote. Never by name: two items
     can share one and the map is the record of which row became which. */
  left join ops_core.legacy_map m on m.source_table = 'public.items'
                                 and m.source_id = ip.item_id::text
                                 and m.outcome = 'imported'
  left join ops_procure.items i on i.id = m.target_id
 where not exists (
   select 1 from ops_core.legacy_map lm
    where lm.source_table = 'public.item_purchases'
      and lm.source_id = ip.purchase_id::text);

create index on _staged (purchase_id);

insert into ops_acct.transaction_lines
  (trx_id, line_no, item_id, description, qty, uom, unit_price, amount)
select s.trx_uuid, s.line_no, s.item_id, s.description, s.qty, s.uom_code,
       s.price, s.idr_amount
  from _staged s
 where s.refused_because is null
 on conflict (trx_id, line_no) do nothing;

insert into ops_core.legacy_map
  (source_table, source_id, target_table, target_id, outcome, note, run_id)
select 'public.item_purchases',
       s.purchase_id::text,
       'ops_acct.transaction_lines',
       l.id,
       case when s.refused_because is null then 'imported' else 'refused' end,
       coalesce(s.refused_because, nullif(concat_ws('; ',
         case when s.item_id is null
              then 'item ' || quote_literal(coalesce(nullif(btrim(s.description),''),'?'))
                   || ' did not resolve through the items map — line kept, item left null' end,
         case when s.raw_unit <> '' and s.uom_code is null
              then 'unit ' || quote_literal(s.raw_unit)
                   || ' is not one this system knows — line kept with no unit, text here' end
       ), '')),
       (select run_id from _run)
  from _staged s
  left join ops_acct.transaction_lines l
         on l.trx_id = s.trx_uuid and l.line_no = s.line_no
 on conflict (source_table, source_id) do nothing;

\echo ''
\echo '── what came across ────────────────────────────────────────────────'
select count(*)                                         as lines,
       count(*) filter (where item_id is null)          as no_item,
       count(*) filter (where uom is null)              as no_unit,
       count(*) filter (where qty is null)              as no_quantity,
       count(distinct trx_id)                           as transactions_itemised
  from ops_acct.transaction_lines;

\echo ''
\echo '── refused, and why ────────────────────────────────────────────────'
select regexp_replace(note, 'trx-[0-9-]+_[0-9]+', 'trx-…', 'g') as reason, count(*)
  from ops_core.legacy_map
 where source_table = 'public.item_purchases' and outcome = 'refused'
 group by 1 order by 2 desc;

/* ── the six that do not add up ──────────────────────────────────────────
 *
 * Not an error to fix here. A transaction whose lines do not sum to its amount
 * is either a line somebody forgot or an amount somebody mistyped, and both are
 * questions for a person with the documents in front of them. Reported so the
 * question gets asked, rather than smoothed over so it never is.
 */
\echo ''
\echo '── lines that do not sum to their transaction ──────────────────────'
select t.trx_no,
       round(t.amount_idr)      as transaction,
       round(sum(l.amount))     as lines_total,
       round(sum(l.amount) - t.amount_idr) as difference
  from ops_acct.transactions t
  join ops_acct.transaction_lines l on l.trx_id = t.id
 group by t.trx_no, t.amount_idr
having sum(l.amount) <> t.amount_idr
 order by abs(sum(l.amount) - t.amount_idr) desc;

commit;
