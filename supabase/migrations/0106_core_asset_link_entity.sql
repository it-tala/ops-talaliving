-- 0106_core_asset_link_entity.sql — documents can be attached to an asset.
--
-- The asset register (`0107`) keeps a photo of the thing, its purchase nota
-- and its warranty card on the same road as every other document (ADR-010),
-- so an asset is a record a file can be linked to.
--
-- Alone in its file: Postgres will not let a new enum value be used in the
-- transaction that added it.
alter type ops_core.link_entity_t add value if not exists 'asset';
