-- 0221_core_design_link_entities.sql — the records a design is filed against,
-- and the proof a client approved it (P4, D378, D379, kajian F224).
--
-- `0222` gives a project its design: collections, rooms and the items in them,
-- the order the drafters work in (D379). A render, a client's drawing or a
-- moodboard belongs to one of those, so a file can be filed against a
-- **design item** or a whole **collection**. And a client's approval is a fact
-- recorded with its evidence — a WhatsApp screenshot, a signed print — which is
-- a kind of document of its own (D378: never required, always recordable).
--
-- Enum values alone, in a file of their own (F161).

alter type ops_core.link_entity_t add value if not exists 'design_collection';
alter type ops_core.link_entity_t add value if not exists 'design_item';

alter type ops_core.doc_kind_t add value if not exists 'persetujuan_klien';
