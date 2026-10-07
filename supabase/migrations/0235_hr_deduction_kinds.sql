-- 0235 — BPJS as adjustment kinds, for the monthly default deductions (D389).
--
-- On its own because a new enum value cannot be used in the migration that
-- adds it (F161). These are the fixed monthly amounts HRD sets — not the
-- enrolment-based contributions of 0051, which stay what they are.
alter type ops_hr.adjustment_kind_t add value if not exists 'bpjs_tk';
alter type ops_hr.adjustment_kind_t add value if not exists 'bpjs_kes';
