-- 0213_core_project_file_kinds.sql — the kinds of file a sale and a design are
-- made of, and the records they are filed against (P1, kajian F221).
--
-- The owner (2026-10-06): *mulai dari mengirim proposal, penawaran, meeting
-- dengan client sampai closing atau tidak jadi, semuanya ingin kita track …
-- daftar desain item, drawings, render, dan sebagainya dari kita sendiri maupun
-- gambar desain dari klien.* Until now the only design kinds were `gambar_kerja`
-- and `gambar_jadi`, both filed on a product, which does not exist until there
-- is an order. A brief, a survey, a client's drawing, a render, a proposal
-- deck, a meeting's notes and the signed contract had no kind at all.
--
-- Enum values only, in a file of their own: a value added by `alter type …
-- add value` cannot be used in the same transaction (F161). Labels, drives,
-- folders and the seams that use them are `0214`.
--
-- `client_activity` (a meeting's notes as a file on the meeting itself) waits
-- for P3, which gives a contact a number of its own; an attachment link names
-- its record by its public code, never a uuid (ADR-004).

-- ── what the file is ──────────────────────────────────────────────────────
alter type ops_core.doc_kind_t add value if not exists 'brief';            -- the client's brief, in writing
alter type ops_core.doc_kind_t add value if not exists 'foto_survei';      -- site survey photos and measurements
alter type ops_core.doc_kind_t add value if not exists 'gambar_klien';     -- a drawing the client or their architect brings
alter type ops_core.doc_kind_t add value if not exists 'referensi_klien';  -- inspiration, a catalogue page, a photo of something they like
alter type ops_core.doc_kind_t add value if not exists 'moodboard';        -- concept, material board
alter type ops_core.doc_kind_t add value if not exists 'layout';           -- floor plan / layout
alter type ops_core.doc_kind_t add value if not exists 'render';           -- 3D render; not `gambar_jadi`, which is the finished piece (D150)
alter type ops_core.doc_kind_t add value if not exists 'proposal';         -- the deck or PDF sent to the client
alter type ops_core.doc_kind_t add value if not exists 'notulen';          -- meeting notes
alter type ops_core.doc_kind_t add value if not exists 'kontrak';          -- the signed contract, SPK or client PO

-- ── what it is filed against ──────────────────────────────────────────────
alter type ops_core.link_entity_t add value if not exists 'client';
alter type ops_core.link_entity_t add value if not exists 'quotation';
