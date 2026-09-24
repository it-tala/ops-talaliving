-- 0141 — John Lau drafts a leave request (stage 4, HR; D301).
--
-- The same road as `procurement.draft_po` (D300): a sentence — *ajukan cuti
-- untuk Wulan 2 sampai 3 Oktober, acara keluarga* — becomes a **draft** of
-- exactly what `ops_hr.request_leave` would be given, the person checks every
-- field, and only their "Ya, tulis" writes it, as them, through the seam the
-- /hrd/cuti screen uses. The request lands PENDING; deciding it stays a
-- person's act on the screen.
--
-- It needs `hrd` write, the same as the screen's "Ajukan" — the gate
-- (`ops_asst.may_run`) reads the catalogue's module and level, so a person
-- who cannot file leave on the screen cannot file it through the prompt.
--
-- What does not change: pay, attendance and the 201 file stay **blocked** as
-- reads (D218). Filing a request names a person and some dates the asker
-- already knows; it reads nothing back about anyone.

insert into ops_asst.tools
  (name, module, level, effect, reach, label_en, label_id, blocked_reason_en, blocked_reason_id, instead_at, sort_order, note)
values
  ('hr.draft_leave', 'hrd', 'write', 'write', 'open',
   'Draft a leave, permit or sick-day request',
   'Menyiapkan pengajuan cuti, izin atau sakit',
   null, null, '/hrd/cuti', 32,
   'Drafts the arguments of ops_hr.request_leave; the person confirms; decide_leave stays on the screen. (0141, D301)');

-- A writing rule, so before the reads — and after the blocked ones, whose
-- words it does not share: *ajukan cuti* is filing, not reading attendance.
insert into ops_asst.rules (seq, tool, stage, all_words, any_words, not_words, understood_en, understood_id, note) values
 (62,'hr.draft_leave','main','{}',
     '{"ajukan cuti","ajukan izin","ajukan sakit","minta cuti","pengajuan cuti","catat cuti","request leave","leave request","file leave","book leave"}',
     '{}','drafting a leave request','menyiapkan pengajuan cuti', null);
