-- 0247_core_dwg_kind.sql — the drafters' source file, as a kind of its own
-- (Studio Desain S1, D399, kajian F247).
--
-- A working drawing reaches the workshop as a PDF; the drafter keeps drawing
-- in the DWG. Both are kept per item, in the item's own folder, and each is a
-- box of its own on the item's checklist — so the DWG needs a kind the PDF is
-- not (`gambar_kerja`).
--
-- An enum value alone, in a file of its own: a value added by `alter type …
-- add value` cannot be used in the same transaction (F161). Its label, drive
-- and folder are `0248`.

alter type ops_core.doc_kind_t add value if not exists 'dwg';
