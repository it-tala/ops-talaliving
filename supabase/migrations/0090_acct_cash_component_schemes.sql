-- 0090_acct_cash_component_schemes.sql — the column `CashComponent` has
-- always declared and `cash_components` never grew.
--
-- D259: a cash line that pays a statutory scheme can cover more than one at
-- once — one BPJS Ketenagakerjaan invoice is JHT, JP, JKK and JKM together —
-- so `scheme_codes` is a list, not a single value. It is what lets accounting
-- hold the roll of names against the money: the expected figure comes from
-- HR's enrolment register (`ops_hr.contribution_rates`, whose own `scheme`
-- column is `ops_hr.contribution_scheme_t`), the paid figure from this line's
-- actuals, and the two cannot disagree about what a "scheme" is because there
-- is one enum, not two spellings of the same six names.
--
-- `text[]`, not `ops_hr.contribution_scheme_t[]`: cross-service references
-- are public codes here, never a join or a shared type (ADR-004) — an
-- accounting table naming an HR-owned type is the same coupling ADR-004
-- refuses, one level down. The check constraint holds the same six codes
-- without the schemas needing to agree on where the type lives.
alter table ops_acct.cash_components
  add column scheme_codes text[] not null default '{}';

alter table ops_acct.cash_components
  add constraint cash_components_scheme_codes_valid check (
    scheme_codes <@ array['BPJS_KESEHATAN','JHT','JP','JKK','JKM','PPH21']
  );
