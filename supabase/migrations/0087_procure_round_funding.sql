-- 0087_procure_round_funding.sql — the three figures `v_round_summary` never
-- carried, because nothing before this needed to ask "can we afford this
-- round" from the database rather than from the screen holding both numbers.
--
-- `RoundSummary` (the shared contract, `src/services/procurement/contracts.ts`)
-- has always declared `paying_balance`, `to_transfer` and
-- `remaining_after_payment`. The demo's `roundSummary()` computes them from
-- state already in memory; the real view never grew them, which is why
-- `procurement.getRound` / `listRounds` / `approveRound` / `closeRound` /
-- `syncRound` / `transferRound` are still on `PENDING_PARITY` — not because
-- the seams are wrong, but because the row they read is short four fields
-- (`lines` is the fourth, and belongs in the client the same way
-- `v_pr_line` already does for every other line-bearing view).
--
-- Appended at the end, not restated alongside `transfer_shortfall`: a view
-- can add columns but not reorder or retype the ones already there, and
-- `RoundSummary` is read as a named object everywhere, never positionally.
create or replace view ops_procure.v_round_summary as
  select r.id as round_id, r.round_no, r.status, r.opened_at,
         case when r.status = 'OPEN'
              then coalesce((select sum(cov.remaining)
                               from ops_procure.payment_round_lines rl
                               join ops_procure.v_line_coverage cov on cov.line_id = rl.line_id
                              where rl.round_id = r.id), 0)
              else coalesce((select sum(rl.requested_amount)
                               from ops_procure.payment_round_lines rl
                              where rl.round_id = r.id), 0)
         end as requested_total,
         coalesce(tr.transferred_total, 0) as transferred_total,
         coalesce(lc.line_count, 0)        as line_count,
         greatest(
           case when r.status = 'OPEN'
                then coalesce((select sum(cov.remaining)
                                 from ops_procure.payment_round_lines rl
                                 join ops_procure.v_line_coverage cov on cov.line_id = rl.line_id
                                where rl.round_id = r.id), 0)
                else coalesce((select sum(rl.requested_amount)
                                 from ops_procure.payment_round_lines rl
                                where rl.round_id = r.id), 0)
           end - coalesce(tr.transferred_total, 0), 0) as transfer_shortfall,
         -- Cash across the accounts that actually pay people — the same
         -- question `ops_acct.v_cash_position` answers, asked here because a
         -- round screen needs it beside the round, not as a second fetch that
         -- could read a different instant.
         coalesce(pb.paying_balance, 0) as paying_balance,
         -- Never negative, and a shortfall never blocks approval — the
         -- balance is information, not a gate (matches the demo exactly).
         greatest(
           (case when r.status = 'OPEN'
                 then coalesce((select sum(cov.remaining)
                                  from ops_procure.payment_round_lines rl
                                  join ops_procure.v_line_coverage cov on cov.line_id = rl.line_id
                                 where rl.round_id = r.id), 0)
                 else coalesce((select sum(rl.requested_amount)
                                  from ops_procure.payment_round_lines rl
                                 where rl.round_id = r.id), 0)
            end) - coalesce(pb.paying_balance, 0), 0) as to_transfer,
         coalesce(pb.paying_balance, 0) -
         (case when r.status = 'OPEN'
               then coalesce((select sum(cov.remaining)
                                from ops_procure.payment_round_lines rl
                                join ops_procure.v_line_coverage cov on cov.line_id = rl.line_id
                               where rl.round_id = r.id), 0)
               else coalesce((select sum(rl.requested_amount)
                                from ops_procure.payment_round_lines rl
                               where rl.round_id = r.id), 0)
          end) as remaining_after_payment
    from ops_procure.payment_rounds r
    left join (
      select round_id, sum(amount) as transferred_total
        from ops_procure.round_transfers group by round_id
    ) tr on tr.round_id = r.id
    left join (
      select round_id, count(*) as line_count
        from ops_procure.payment_round_lines group by round_id
    ) lc on lc.round_id = r.id
    left join (
      select sum(balance) as paying_balance
        from ops_acct.v_account_balance where is_paying
    ) pb on true;

alter view ops_procure.v_round_summary set (security_invoker = on);
