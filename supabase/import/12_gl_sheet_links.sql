-- 12_gl_sheet_links.sql — the documents the 2026 ledger sheet already pointed at.
--
-- The owner's `2026 TALAHOME LEDGERS` sheet — *data asli sebelum migrasi ke
-- Supabase*, 3.433 rows, exported as CSV on 2026-10-14 — carries six link
-- columns per row: INVOICE/NOTA LINK, FAKTUR, PROOF PAYMENT, ITEM PHOTO,
-- PURCHASE REQUISITION, PAYMENT REQUEST. 3.814 Google Drive links in all.
-- `03_ledger.sql` brought the rows across from `public.transactions`, and
-- `05_evidence.sql` brought the 237 documents of `public.transaction_docs`.
-- Nothing brought these links, because the legacy tables never held them —
-- the accountant pasted them into the sheet, and the sheet was not a source
-- the ladder read. That is the whole reason 1.616 Jan–Jun rows read as *tanpa
-- dokumen* in the 14 Oct kajian (§11.1): an import gap, not missing evidence
-- (F273). After this step, 137 rows of 2026 have no document, and nearly all
-- of them are transfers between our own accounts, cash withdrawals, opening
-- balances and bank fees — rows the sheet never had a document for either.
--
-- ── What `data/gl_sheet_links_2026.csv` is ──────────────────────────────
--
-- One row per (sheet line, link column, ops transaction):
--
--   line       row number in the exported sheet (header = 1)
--   col        N nota · F faktur · P proof of payment · I item photo
--              R purchase requisition · Q payment request
--   kind       `ops_core.doc_kind_t`: N→nota, F→invoice, P→transfer_proof,
--              I→goods_photo, R/Q→other (the column name goes in `note`)
--   trx_no     the ops transaction; empty on the 10 refused rows
--   file_id    the Drive file id, the only identity the sheet gives a file
--   url        filled only when the sheet's form is not the plain
--              `/view?usp=drive_link` one (`?usp=sharing`, bare `/view`, and
--              four Google Sheets links filed as nota)
--   note       what goes on the link (column name; and for paired rows the
--              sheet row it came from, with its description and amount)
--   pair_note  why a sheet row and an ops row were paired by hand
--
-- 4.071 link rows over 2.808 distinct files, 3.293 sheet lines, 3.272
-- transactions; 10 refused rows.
--
-- ── How a sheet line found its transaction ─────────────────────────────
--
-- `03_ledger.sql` kept no sheet row number, so the match is on the money:
--
--   1. exact — md5(date | account | direction | amount | UPPER(description
--      with spaces collapsed)), with a sequence number for repeats on the
--      same key: 2.619 lines (Jan–Jun 100%).
--   2. key only — the same hash without the description, same sequencing:
--      647 lines. Descriptions were retyped or trimmed at import; the money
--      was not.
--   3. by hand — 157 lines where the two books hold the same payment at a
--      different granularity. The sheet books one row, ops three (THINNER,
--      KAIN JAHIT & GRAZE 1.242.000 → 10_004/005/006); the sheet books two
--      withdrawals, ops one (21.000.000 + 500.000 → 13_088); the sheet books
--      the admin fee as its own 2.500 row while ops, since late September,
--      books it inside the amount (every FEE pair in `pair_note`); two rows
--      one rupiah apart (JAWUL SUAR 18.999.911 vs 18.999.910, BINDER KSA
--      1.386.770 vs .771); inbox-captured rows dated two or three days later
--      in ops than in the sheet. Each pairing is written into `pair_note`
--      and repeated into `legacy_map.note`, so *why does this file sit on
--      that transaction* stays answerable. A paired file is linked to every
--      transaction of its group.
--   4. refused — 10 rows: two 2.500 admin fees with no credible counterpart
--      (lines 2662, 3020) and eight October rows that are not in ops at all
--      (PESANGON THOHA / HENDI / NUR AISAH in cash, REMBUS BENSIN AVANZA,
--      the JENIUS top-up and the CREDIT CARD MANDIRI rows, lines 3426–3429
--      and 3436–3439). They are in the map as `refused`, not dropped.
--
-- The reverse direction was checked too. Ops rows absent from the sheet are
-- the three opening balances, the same payments at the other granularity,
-- the fee-inside-the-amount rows, and the JAGO / JENIUS / MANDIRI CC
-- subscription rows that only ever existed in ops.
--
-- ── What it writes ──────────────────────────────────────────────────────
--
--   ops_core.attachments        one per distinct file id, **found or created
--                               by the id inside the url** (`/d/<id>/`),
--                               because the sheet, the chat path and the web
--                               path spell the same file four ways
--                               (`?usp=drive_link`, `?usp=sharing`, `/view`,
--                               `?usp=drivesdk`). `filename` is the file id,
--                               plus an extension when `public.blobs` knows
--                               the file — it knows **none** of these: the
--                               sheet's files were uploaded by hand to Drive,
--                               never captured by john-lau, so sha256, mime
--                               and bytes stay null. source = `import`,
--                               uploaded_by = shared@talaliving.com.
--   ops_core.attachment_links   one per csv row whose transaction exists. A
--                               file already filed on that transaction under
--                               any kind is pointed at, not filed again
--                               (95 such, mostly chat captures of the same
--                               proof); `links_live_idx` refuses the rest of
--                               the repeats.
--   ops_core.legacy_map         `sheet.gl_2026.link` / `<line>:<col>:<trx_no>`
--                               per link row (imported, or refused when the
--                               transaction is missing), `sheet.gl_2026.row` /
--                               `<line>:<col>` per refused row; one run_id.
--
-- Idempotent: a second run stages the same rows and writes nothing, because
-- every write resolves against the url, the live link and the map first.
--
-- ── How it was actually applied ─────────────────────────────────────────
--
-- The session that did this had no database credentials for psql, so the
-- same body ran as sixteen `insert into _gl values (…)` chunks through the
-- Supabase MCP on 2026-10-14, then the map was reconciled against this csv by md5 over
-- 200-line buckets of `<line>:<col>:<trx_no>=<file_id>`. One bucket differed:
-- a file id mistyped by hand at line 1368 (`…PHBUMLx…` typed as `…PHMLx…`),
-- repaired in place. A hand-typed load is reconciled against its source before it is
-- called done (F274). See `RUNLOG.md`.
--
-- Run from the repository root, so the \copy path resolves:
--
--   psql … -v ON_ERROR_STOP=1 -f supabase/import/12_gl_sheet_links.sql

begin;

create temp table _gl (
  line int, col text, kind text, trx_no text, file_id text,
  url text, note text, pair_note text);

\copy _gl from 'supabase/import/data/gl_sheet_links_2026.csv' with (format csv, header true)


insert into ops_core.attachments (url, filename, sha256, mime, bytes, source, uploaded_by, uploaded_at)
select distinct on (g.file_id)
       coalesce(nullif(g.url,''), 'https://drive.google.com/file/d/'||g.file_id||'/view?usp=drive_link'),
       g.file_id || case b.mime_type when 'application/pdf' then '.pdf' when 'image/jpeg' then '.jpg'
                                    when 'image/png' then '.png' when 'image/webp' then '.webp' else '' end,
       b.sha256, b.mime_type, b.size_bytes, 'import', '235e49cd-3395-4ebf-8f48-0a36cf5a33f0'::uuid, now()
  from _gl g
  left join public.blobs b on b.drive_file_id = g.file_id
 where g.trx_no <> ''
   and not exists (select 1 from ops_core.attachments a where strpos(coalesce(a.url,''), '/d/'||g.file_id||'/') > 0)
 order by g.file_id, b.created_at;

with ins as (
  insert into ops_core.attachment_links (attachment_id, entity, entity_no, kind, note, linked_by, linked_at)
  select a.id, 'transaction'::ops_core.link_entity_t, g.trx_no, g.kind::ops_core.doc_kind_t,
         nullif(g.note,''), '235e49cd-3395-4ebf-8f48-0a36cf5a33f0'::uuid, now()
    from _gl g
    join lateral (select a.id from ops_core.attachments a
                   where strpos(coalesce(a.url,''), '/d/'||g.file_id||'/') > 0
                   order by a.uploaded_at limit 1) a on true
   where g.trx_no <> ''
     and exists (select 1 from ops_acct.transactions t where t.trx_no = g.trx_no)
     and not exists (select 1 from ops_core.attachment_links k
                      where k.attachment_id = a.id and k.entity = 'transaction'
                        and k.entity_no = g.trx_no and k.unlinked_at is null)
  on conflict do nothing
  returning id, attachment_id, entity_no, kind)
insert into ops_core.legacy_map (source_table, source_id, target_table, target_id, outcome, note, run_id)
select 'sheet.gl_2026.link', g.line||':'||g.col||':'||g.trx_no, 'ops_core.attachment_links',
       coalesce(i.id, k.id),
       case when coalesce(i.id, k.id) is not null then 'imported' else 'refused' end,
       nullif(concat_ws('; ',
         'file '||g.file_id,
         case when i.id is null and k.id is not null
              then 'this file was already filed on this transaction — pointed at the existing link, not duplicated' end,
         case when t.trx_no is null then 'transaction not in ops' end,
         nullif(g.pair_note,'')), ''),
       '6f1c2a3e-9b7d-4c15-8e2a-20261014a001'::uuid
  from _gl g
  left join lateral (select a.id from ops_core.attachments a
                      where strpos(coalesce(a.url,''), '/d/'||g.file_id||'/') > 0
                      order by a.uploaded_at limit 1) a on true
  left join ins i on i.attachment_id = a.id and i.entity_no = g.trx_no and i.kind = g.kind::ops_core.doc_kind_t
  left join lateral (select k.id from ops_core.attachment_links k
                      where k.attachment_id = a.id and k.entity = 'transaction'
                        and k.entity_no = g.trx_no and k.unlinked_at is null
                      order by k.linked_at limit 1) k on true
  left join ops_acct.transactions t on t.trx_no = g.trx_no
 where g.trx_no <> ''
on conflict (source_table, source_id) do nothing;

insert into ops_core.legacy_map (source_table, source_id, target_table, target_id, outcome, note, run_id)
select 'sheet.gl_2026.row', g.line||':'||g.col, 'ops_core.attachment_links', null, 'refused',
       g.pair_note, '6f1c2a3e-9b7d-4c15-8e2a-20261014a001'::uuid
  from _gl g
 where g.trx_no = ''
on conflict (source_table, source_id) do nothing;

select (select count(*) from _gl where trx_no <> '')                         as staged_links,
       (select count(*) from _gl where trx_no = '')                          as staged_refused,
       (select count(*) from ops_core.legacy_map
         where run_id = '6f1c2a3e-9b7d-4c15-8e2a-20261014a001'
           and outcome = 'imported')                                         as imported,
       (select count(*) from ops_core.legacy_map
         where run_id = '6f1c2a3e-9b7d-4c15-8e2a-20261014a001'
           and outcome = 'refused')                                          as refused,
       (select count(*) from ops_core.legacy_map
         where run_id = '6f1c2a3e-9b7d-4c15-8e2a-20261014a001'
           and note like '%already filed%')                                  as pointed_at_existing,
       (select count(*) from ops_core.attachments where source = 'import')   as import_files;

commit;
