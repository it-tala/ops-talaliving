-- 0232_core_bot_reads.sql — the two things John Lau's capture bot reads here.
--
-- Owner, 2026-10-07. Overnight the bot's own copies of vendors, projects, items
-- and its ledger were archived out of `public` (into `zz_archive_jl_public`).
-- Two of its running steps read them:
--
--   * the extractor builds its prompt from the catalogue — vendor names to match
--     a misspelt nota against, the projects a nota may name, item names and
--     units. Every extraction failed on the 404 until the bot learnt to read
--     without it, which costs the canonical vendor name on every reading;
--   * the daily ops card prints each account's balance, and had nothing to sum.
--
-- The bot holds the service-role key, which by design has no SELECT on any
-- `ops_*` table. It reaches this database only through definer functions
-- granted to it by name (`file_evidence`, `approval_card`, the outbox verbs).
-- These are two more, read-only, and they hand back this application's own
-- figures rather than a copy the bot keeps.
--
-- ── 1. the catalogue ──────────────────────────────────────────────────────
--
-- Curated only (owner, same day: *pakai yang is_curated saja*). On the day this
-- was written that is 48 vendors of 262 live and 806 items of 840. An uncurated
-- name in the prompt is a name the model will confidently "correct" a nota
-- towards. Merged and archived rows never appear: the survivor carries the name.
--
-- ── 2. balances ───────────────────────────────────────────────────────────
--
-- Read from `v_account_balance`, the view the ledger screen reads, so the card
-- and the screen cannot disagree — including on opening balances, which the
-- bot's old sum over its own transactions never counted. The card is posted
-- into a channel, so it gets what a viewer without `approve_funds` gets (D87):
-- a leadership account is listed and its figure is not.

create or replace function ops_procure.extraction_reference()
returns jsonb
language sql stable security definer set search_path = ops_procure, pg_temp as $$
  select jsonb_build_object(
    'vendors', coalesce((
      select jsonb_agg(jsonb_build_object(
               'name', v.name,
               'aka',  to_jsonb(coalesce(v.aka, '{}'::text[])))
             order by v.name)
        from ops_procure.vendors v
       where v.is_curated and v.archived_at is null and v.merged_into is null
    ), '[]'::jsonb),
    'projects', coalesce((
      select jsonb_agg(p.name order by p.name)
        from ops_procure.projects p
       where p.is_active
    ), '[]'::jsonb),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'name',     i.name,
               'category', i.category_code,
               'unit',     i.base_uom)
             order by i.name)
        from ops_procure.items i
       where i.is_curated and i.archived_at is null and i.merged_into is null
    ), '[]'::jsonb));
$$;

revoke execute on function ops_procure.extraction_reference() from public, authenticated;
grant execute on function ops_procure.extraction_reference() to service_role;

comment on function ops_procure.extraction_reference() is
  'The curated vendor, active project and curated item names John Lau''s extractor '
  'builds its prompt from. Read-only; the worker calls this, the browser cannot. (0232)';

create or replace function ops_acct.bot_balances()
returns jsonb
language sql stable security definer set search_path = ops_acct, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'code',         b.code,
           'currency',     b.currency,
           'locked',       b.custody = 'leadership',
           'balance',      case when b.custody = 'leadership' then null else b.balance end,
           'transactions', (select count(*) from ops_acct.transactions t
                             where t.account_id = b.account_id and t.status <> 'VOID'))
         order by b.code), '[]'::jsonb)
    from ops_acct.v_account_balance b
   where b.is_active;
$$;

revoke execute on function ops_acct.bot_balances() from public, authenticated;
grant execute on function ops_acct.bot_balances() to service_role;

comment on function ops_acct.bot_balances() is
  'Every active account with its balance from v_account_balance, for the daily ops card '
  'John Lau posts into a channel. Leadership accounts are listed with their figure '
  'withheld (D87). Read-only; the worker calls this, the browser cannot. (0232)';
