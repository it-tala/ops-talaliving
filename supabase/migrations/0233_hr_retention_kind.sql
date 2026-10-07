-- 0233 — retensi, as its own kind of adjustment (D388).
--
-- On its own because a new enum value cannot be used in the migration that
-- adds it (F161). `retention` is money held back from a payslip; the owner
-- wants its balance kept per person and seen by HRD only. `retention_release`
-- is that money given back — an addition, against the balance.
alter type ops_hr.adjustment_kind_t add value if not exists 'retention';
alter type ops_hr.adjustment_kind_t add value if not exists 'retention_release';
