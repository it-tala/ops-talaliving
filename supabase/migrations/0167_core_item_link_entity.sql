-- 0167_core_item_link_entity.sql — a catalogue item can carry its own photos.
--
-- On its own, like 0106 (`asset`) and 0155 (`log_cost`): Postgres will not let
-- a transaction use an enum value it added, and 0168 uses this one straight
-- away (the photo cap trigger and `register_item` both link to 'item').
--
-- Keyed by the item's public code (`I-00123`), the same way every other link
-- names its parent (ADR-004).

alter type ops_core.link_entity_t add value if not exists 'item';
