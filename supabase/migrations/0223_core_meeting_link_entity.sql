-- 0223_core_meeting_link_entity.sql — a meeting's files are filed against the
-- meeting (P3, kajian F224 §4.2, G12).
--
-- The whiteboard photo, the signed minutes, the client's sketch handed over
-- across the table, the WhatsApp screenshot from a site visit: each belongs to
-- the contact it came from, so `0224` lets a file be filed against an entry of
-- the client log (`ops_procure.client_activities`). Its number is the entry's
-- id: a contact has no public code, and nobody types one.
--
-- An enum value alone, in a file of its own (F161).

alter type ops_core.link_entity_t add value if not exists 'client_activity';
