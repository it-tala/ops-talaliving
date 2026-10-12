-- 0258_core_container_doc_kinds.sql — document kinds for a container's papers
-- (O5, kajian F255 §5.6).
--
-- A container leaves with two papers that are not a surat jalan: the
-- **packing list** (what is in it, carton by carton, from the factory or our
-- own packing) and the **bill of lading** (the shipping line's receipt, and the
-- title to the goods). They are filed with the container they describe, in
-- the PROJECT MANAGER drive beside the surat jalan keluar.
--
-- Their own migration because a value added by `alter type … add value`
-- cannot be used in the same transaction (F161). Labels, drive and folder are
-- `0259`.

alter type ops_core.doc_kind_t add value if not exists 'packing_list';
alter type ops_core.doc_kind_t add value if not exists 'bill_of_lading';
