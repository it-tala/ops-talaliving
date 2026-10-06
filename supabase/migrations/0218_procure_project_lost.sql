-- 0218_procure_project_lost.sql — a sale that did not happen is not a
-- cancelled order (P2, D377, kajian F224).
--
-- Until now a project had one way to end badly, `CANCELLED`, used both for an
-- inquiry that never became an order and for an order called off after the
-- deal. Those are different questions — *why do we lose sales?* and *why do
-- orders fall through?* — and a pipeline that mixes them answers neither.
--
--   LOST       did not happen: closed before the deal, from INQUIRY or
--              QUOTATION_SENT
--   CANCELLED  called off after the deal (unchanged)
--
-- The value alone, in a file of its own: a new enum value cannot be used in
-- the migration that adds it (F161). The rule that uses it is `0219`.

alter type ops_procure.project_status_t add value if not exists 'LOST' before 'CANCELLED';
