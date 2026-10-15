-- 0277 — two kinds of paper the ledger meets and could not name (L8, kajian
-- §6.6, D433 Q94).
--
-- A **faktur pajak** is the tax invoice a PKP vendor issues beside its nota;
-- a **TTB** (tanda terima barang) is the receipt the vendor's courier has
-- signed for what was handed over. Both were being filed as *Others*. The
-- values alone here: an enum value cannot be used in the migration that adds
-- it (F161), so the labels, drives and paths follow in 0278.
alter type ops_core.doc_kind_t add value if not exists 'faktur_pajak';
alter type ops_core.doc_kind_t add value if not exists 'ttb';
