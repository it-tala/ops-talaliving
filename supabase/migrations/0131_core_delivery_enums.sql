-- 0131_core_delivery_enums.sql — the words the last leg needs, before it is
-- built.
--
-- Alone in its file for the reason 0100 and 0108 are: Postgres will not let a
-- new enum value be used in the transaction that added it, and 0132 uses every
-- one of these straight away.
--
--   **delivery** is a module of its own (owner, 2026-09-23). The people who
--   pack crates, drive them and fit them on site are not the people who change
--   a client's order or its status, and a single `project` grant would have
--   handed the second to the first.
--
--   Three document kinds, all filed in the PROJECT MANAGER drive: the signed
--   **BAST**, **our own** surat jalan going out (the existing `surat_jalan` is
--   the vendor's, coming in, and it lives in PROCUREMENT), and a **photo from
--   the site** — a snag, a crate, a wall.
--
--   Four things a file can be attached to: a delivery, a crate, a snag and a
--   handover.

alter type ops_core.module_t      add value if not exists 'delivery';

alter type ops_core.doc_kind_t    add value if not exists 'bast';
alter type ops_core.doc_kind_t    add value if not exists 'surat_jalan_keluar';
alter type ops_core.doc_kind_t    add value if not exists 'foto_lokasi';

alter type ops_core.link_entity_t add value if not exists 'delivery';
alter type ops_core.link_entity_t add value if not exists 'packing_box';
alter type ops_core.link_entity_t add value if not exists 'snag';
alter type ops_core.link_entity_t add value if not exists 'handover';
