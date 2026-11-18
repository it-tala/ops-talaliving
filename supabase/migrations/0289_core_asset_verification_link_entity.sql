-- 0289_core_asset_verification_link_entity.sql — a verification can carry files.
--
-- The asset verification flow (0290, D437) photographs the machine at every
-- check, and those photos are the proof of *that* check, not of the asset in
-- general: a recheck next month has its own. So they are filed against the
-- verification (`VRF-000001`), beside the asset's own record photo
-- (`entity = asset`).
--
-- On its own because a new enum value cannot be used in the migration that
-- adds it (F161): 0290 names it in a `drive_paths` row and in its seams.

alter type ops_core.link_entity_t add value if not exists 'asset_verification';
