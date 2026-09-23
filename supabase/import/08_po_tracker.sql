-- 08_po_tracker.sql — purchase orders from the field sheet, tied to the ledger.
--
-- Source: the `PO TRACKER` Google Sheet (shared drive, owner
-- shared@talaliving.com), read on 2026-09-23. It is where procurement actually
-- writes its orders: one tab per vendor, each tab a PO document — header,
-- lines, and a *TOTAL PAID TO DATE* block naming every transfer with its date
-- and proof. Nothing in the database had any of it: `ops_procure.purchase_orders`
-- was empty, and the old app's `public.purchase_orders` carries 15 orders that
-- somebody re-typed from the sheet on 2026-08-03, with lines that disagree with
-- the sheet in five places.
--
-- ── What it writes ────────────────────────────────────────────────────────
--
--   46 orders from 25 vendor tabs, their lines, the DP/balance terms where the
--   tab states a DP percentage, and the `payment_allocations` that tie each
--   order to the ledger rows that paid it. Plus one order the old app has and
--   the sheet does not (`po-26-08-12_01`, KSA, paid on 2026-08-18).
--
--   Where a transfer was already allocated to a **request line** by the PR
--   RECAP import, the order goes onto that same allocation rather than beside
--   it, so transfer, request and order all name each other and the money is
--   counted once (step 5). Request lines that answer exactly one order line
--   get `pr_lines.po_line_id`.
--
--   Two vendors the ledger paid and the vendor master did not know — PT URECEL
--   INDONESIA and PT. INOCYCLE TECHNOLOGY — are created from the PO document,
--   which carries their name, phone and bank account. That is a vendor with a
--   paper trail, not one invented from a typo.
--
--   Eight ledger rows that paid one of these orders and named no vendor get
--   the order's vendor, each with an `audit_log` row (same shape as
--   `07_corrections.sql`).
--
-- ── How each link was found ───────────────────────────────────────────────
--
-- Every allocation below was matched by hand, payment by payment: the tab's
-- amount and date against `ops_acct.transactions`, then the description and
-- account read to confirm. Where the two disagree the **ledger wins on money**
-- — it is reconciled to the bank to the rupiah (README) and the sheet is not —
-- and the disagreement is written down in RUNLOG.md rather than smoothed over.
-- The cases that needed judgement:
--
--   trx-26-08-26_017  Rp 13.810.000  one transfer, three orders: HADI PO2's
--                                    balance 12.680.000 + PO3 850.000 + the
--                                    280.000 PO1 was short by (41 pcs, not 40).
--   trx-26-08-26_066  Rp 16.891.100  CN GLASS balance on both orders:
--                                    16.387.100 + the KACA BS order's 504.000.
--   trx-26-07-29_038  Rp 4.260.000   EFENDI: PO 07172026's balance 2.100.000
--                                    + PO 07202026's 2.160.000.
--   trx-26-04-17_004  Rp 48.207.160  "REIMBURSMENT EJO FOR WOOD & DP COMPUTER":
--                                    38.207.151 is CV AMIN's balance (the tab's
--                                    own figure); the other 10.000.009 is the
--                                    computer and stays unallocated.
--   trx-26-09-17_003  Rp 22.742.000  ALUMUNIUM MANDIRI; the order is
--                                    22.610.000. The request asked for all of
--                                    it; 132.000 stays on the request alone
--                                    rather than being claimed by an order that
--                                    does not say it.
--   trx-26-09-03_027  Rp 1.365.000   RUBIATI payments 2 and 3 of the tab
--                                    (525.000 + 840.000) in one transfer.
--
-- A transaction never funds more than it moved — the rule `allocate_payment()`
-- enforces. Checked twice: before anything is written (what this file claims
-- per transfer) and after step 5 (everything live on the transfer, both
-- imports together). Either failure refuses the whole file.
--
-- ── What an imported order says, and does not ─────────────────────────────
--
-- **`issued_at`, `issued_by`, `approved_at`, `approved_by` are null.** The
-- orders were sent and paid; who approved them, and when, was never written
-- anywhere, and `issued_was_approved` means an issue date forces an approver.
-- Naming one would be the record telling its first lie. `status` says ISSUED
-- or CLOSED; the timestamps say *not recorded here*. CLOSED means the tracker
-- calls it COMPLETED (or the tab shows nothing owed) **and** the ledger shows
-- it paid within `money_tolerance()`; everything else is ISSUED.
--
-- **The project is in `note`.** `purchase_orders` has no project column.
--
-- **No receipts.** The tabs record deliveries (TTB, dated quantities), but a
-- receipt needs somebody who received it and, to count, somebody who
-- confirmed it (0012). That is a decision about people, not data — held back
-- and listed in RUNLOG.md.
--
-- `po_no` carries the old app's number where the order is the same order
-- (14 of them), for the same reason `trx_no` does: it is the number people
-- already quote. The rest get the next number for **their order date**, after
-- the counters for those days are raised past every legacy number.
--
-- Idempotent: every row it writes is gated on `ops_core.legacy_map`. A second
-- run writes nothing. Run it like the others (README.md), after 07.

begin;

create temp table _run on commit drop as
  select 'e8d4c1a7-3b52-4f0e-9a61-5c2f7d08b913'::uuid as id;
create temp table _author on commit drop as
  select id from ops_core.users where email = 'shared@talaliving.com';

-- ── 1. what the sheet says ────────────────────────────────────────────────

create temp table _po (
  src text, key text primary key, tab text, order_no text, order_date date,
  vendor_ref text, legacy_po text, status ops_procure.po_status_t, dp numeric,
  project text, expected date, sheet_total numeric) on commit drop;
insert into _po values
  ('sheet.po_tracker', 'MARTONO/19082026-01', 'MARTONO', '19082026-01', '2026-08-19', 'V-0293', null, 'ISSUED', 30, 'STANDARD', null, 19039500),
  ('sheet.po_tracker', 'DUL ROTAN/06102026', 'DUL ROTAN', '06102026', '2026-06-10', 'V-0013', 'po-26-08-03_05', 'ISSUED', 30, 'STANDARD', null, 54900000),
  ('sheet.po_tracker', 'DUL ROTAN/06302026', 'DUL ROTAN', '06302026', '2026-06-30', 'V-0013', 'po-26-08-03_06', 'ISSUED', 30, 'BABY ISLAND', null, 103175000),
  ('sheet.po_tracker', 'RUBIATI/29082026-01', 'RUBIATI', '29082026-01', '2026-08-29', 'V-0272', null, 'CLOSED', null, 'STANDARD', null, 1575000),
  ('sheet.po_tracker', 'RUBIATI/31082026-02', 'RUBIATI', '31082026-02', '2026-08-31', 'V-0272', null, 'CLOSED', null, 'STANDARD', null, 1890000),
  ('sheet.po_tracker', 'CHYNTIA BOX/05262026', 'CHYNTIA BOX', '05262026', '2026-05-26', 'V-0104', null, 'CLOSED', null, 'STANDARD', null, 6818500),
  ('sheet.po_tracker', 'CHYNTIA BOX/05302026', 'CHYNTIA BOX', '05302026', '2026-05-30', 'V-0104', null, 'CLOSED', 50, 'STANDARD', null, 10250172.9),
  ('sheet.po_tracker', 'CHYNTIA BOX/06012026', 'CHYNTIA BOX', '06012026', '2026-06-01', 'V-0104', null, 'CLOSED', 50, 'STANDARD', null, 36436700),
  ('sheet.po_tracker', 'CHYNTIA BOX/07282026', 'CHYNTIA BOX', '07282026', '2026-07-28', 'V-0104', 'po-26-08-03_12', 'CLOSED', null, 'STANDARD', null, 238000),
  ('sheet.po_tracker', 'CHYNTIA BOX/08132026', 'CHYNTIA BOX', '08132026', '2026-08-13', 'V-0104', null, 'ISSUED', null, 'STANDARD', null, 725900),
  ('sheet.po_tracker', 'CHYNTIA BOX/14092026', 'CHYNTIA BOX', '14092026', '2026-09-14', 'V-0104', null, 'CLOSED', null, 'STANDARD', null, 1218000),
  ('sheet.po_tracker', 'WILLY CNC/08092026-01', 'WILLY CNC', '08092026-01', '2026-09-08', 'V-0093', null, 'CLOSED', null, 'BABY ISLAND', null, 625000),
  ('sheet.po_tracker', 'WILLY CNC/08092026-02', 'WILLY CNC', '08092026-02', '2026-09-08', 'V-0093', null, 'CLOSED', null, 'STANDARD', null, 4000000),
  ('sheet.po_tracker', 'WILLY CNC/14092026-01', 'WILLY CNC', '14092026-01', '2026-09-14', 'V-0093', null, 'CLOSED', null, 'BABY ISLAND', null, 400000),
  ('sheet.po_tracker', 'WILLI CNC/05132026', 'WILLI CNC', '05132026', '2026-05-13', 'V-0093', null, 'CLOSED', null, 'STANDARD', null, 3650000),
  ('sheet.po_tracker', 'MANDIRI/10092026-01', 'MANDIRI', '10092026-01', '2026-09-10', 'V-0264', null, 'CLOSED', null, 'BABY ISLAND', null, 22610000),
  ('sheet.po_tracker', 'NURYANTO/15092026-01', 'NURYANTO', '15092026-01', '2026-09-15', 'V-0296', null, 'ISSUED', null, 'BABY ISLAND', null, 12900000),
  ('sheet.po_tracker', 'JAWUL SWAR/07012026', 'JAWUL SWAR', '07012026', '2026-07-01', 'V-0258', 'po-26-08-03_04', 'ISSUED', null, 'STANDARD', '2026-07-31', 42000000),
  ('sheet.po_tracker', 'JAWUL SWAR/11082026-01', 'JAWUL SWAR', '11082026-01', '2026-08-11', 'V-0258', 'po-26-08-13_01', 'ISSUED', 40, 'STANDARD', '2026-08-20', 61200000),
  ('sheet.po_tracker', 'PAPAN KAYU/12092026-01', 'PAPAN KAYU', '12092026-01', '2026-09-12', 'V-0292', null, 'CLOSED', null, 'BABY ISLAND', null, 1369000),
  ('sheet.po_tracker', 'URECEL/180826-01', 'URECEL', '180826-01', '2026-08-18', 'NEW:URECEL', null, 'CLOSED', null, 'STANDARD', null, 23845642.7),
  ('sheet.po_tracker', 'URECEL/280826-02', 'URECEL', '280826-02', '2026-08-28', 'NEW:URECEL', null, 'ISSUED', null, 'STANDARD', null, 2298375.2),
  ('sheet.po_tracker', 'ALBERTO/180826-01', 'ALBERTO', '180826-01', '2026-08-18', 'V-0123', null, 'CLOSED', null, 'STANDARD', null, 2040000),
  ('sheet.po_tracker', 'ZENCHEN/180826-01', 'ZENCHEN', '180826-01', '2026-08-18', 'V-0121', null, 'CLOSED', null, 'STANDARD', null, 5020000),
  ('sheet.po_tracker', 'ZENCHEN/310826-01', 'ZENCHEN', '310826-01', '2026-08-31', 'V-0121', null, 'CLOSED', null, 'STANDARD', null, 2360000),
  ('sheet.po_tracker', 'INOCYCLE/19082026-01', 'INOCYCLE', '19082026-01', '2026-08-19', 'NEW:INOCYCLE', null, 'CLOSED', null, 'STANDARD', null, 5217500),
  ('sheet.po_tracker', 'HADI GLASS/06302026', 'HADI GLASS', '06302026', '2026-06-30', 'V-0015', 'po-26-08-03_11', 'CLOSED', 50, 'STANDARD', null, 30605000),
  ('sheet.po_tracker', 'HADI GLASS/07252026', 'HADI GLASS', '07252026', '2026-07-25', 'V-0015', 'po-26-08-03_01', 'CLOSED', null, 'STANDARD', null, 25430000),
  ('sheet.po_tracker', 'HADI GLASS/08192026', 'HADI GLASS', '08192026', '2026-08-19', 'V-0015', null, 'CLOSED', null, 'STANDARD', null, 850000),
  ('sheet.po_tracker', 'KUSAIRI/05262026', 'KUSAIRI', '05262026', '2026-05-26', 'V-0026', null, 'CLOSED', null, 'STANDARD', null, 3000000),
  ('sheet.po_tracker', 'KUSAIRI/06152026', 'KUSAIRI', '06152026', '2026-06-15', 'V-0026', null, 'CLOSED', null, 'STANDARD', null, 6000000),
  ('sheet.po_tracker', 'KUSAIRI/06302026', 'KUSAIRI', '06302026', '2026-06-30', 'V-0026', null, 'CLOSED', null, 'STANDARD', null, 540000),
  ('sheet.po_tracker', 'KUSAIRI/07292026', 'KUSAIRI', '07292026', '2026-07-29', 'V-0026', 'po-26-08-03_09', 'CLOSED', null, 'STANDARD', null, 4950000),
  ('sheet.po_tracker', 'KUSAIRI/08132026', 'KUSAIRI', '08132026', '2026-08-13', 'V-0026', null, 'CLOSED', null, 'STANDARD', null, 2550000),
  ('sheet.po_tracker', 'VIRO/07272026', 'VIRO', '07272026', '2026-07-27', 'V-0179', 'po-26-07-30_01', 'CLOSED', 50, 'BABY ISLAND', '2026-08-18', 60828000),
  ('sheet.po_tracker', 'CN GLASS/05202026', 'CN GLASS', '05202026', '2026-05-20', 'V-0080', 'po-26-08-03_02', 'CLOSED', null, 'STANDARD', null, 113449200),
  ('sheet.po_tracker', 'CN GLASS/05082026', 'CN GLASS', '05082026', '2026-05-08', 'V-0080', null, 'CLOSED', null, 'STANDARD', null, 504000),
  ('sheet.po_tracker', 'PUTRA TAN/07092026', 'PUTRA TAN', '07092026', '2026-07-09', 'V-0078', 'po-26-08-03_07', 'CLOSED', 50, 'STANDARD', null, 1800000),
  ('sheet.po_tracker', 'PUTRA TAN/06302026', 'PUTRA TAN', '06302026', '2026-06-30', 'V-0078', 'po-26-08-03_08', 'CLOSED', 50, 'BABY ISLAND', null, 26130000),
  ('sheet.po_tracker', 'KEMIRAN/03132026', 'KEMIRAN', '03132026', '2026-03-13', 'V-0023', 'po-26-08-03_03', 'CLOSED', 50, 'STANDARD', null, 62000000),
  ('sheet.po_tracker', 'SUMARTO/07302026', 'SUMARTO', '07302026', '2026-07-30', 'V-0117', 'po-26-08-03_10', 'CLOSED', null, 'FAIRMONT', null, 6270000),
  ('sheet.po_tracker', 'AMPLAS-FRANS/07172026', 'AMPLAS-FRANS', '07172026', '2026-07-17', 'V-0108', null, 'CLOSED', null, 'STANDARD', '2026-07-21', 9210000),
  ('sheet.po_tracker', 'AMPLAS-FRANS/07202026', 'AMPLAS-FRANS', '07202026', '2026-07-20', 'V-0108', null, 'CLOSED', null, 'STANDARD', null, 2160000),
  ('sheet.po_tracker', 'CV VEENER/04212026', 'CV VEENER', '04212026', '2026-04-21', 'V-0241', null, 'CLOSED', null, 'WAREHOUSE', null, 3885000),
  ('sheet.po_tracker', 'CV AMIN/04072026', 'CV AMIN', '04072026', '2026-04-07', 'V-0194', null, 'CLOSED', null, 'STD DOOR', null, 75725820),
  ('sheet.po_tracker', 'KSA/18092026-01', 'KSA', '18092026-01', '2026-09-18', 'V-0156', null, 'ISSUED', null, 'STANDARD', null, 3269860.1),
  ('public.purchase_orders', 'po-26-08-12_01', null, 'po-26-08-12_01', '2026-08-12', 'V-0156', 'po-26-08-12_01', 'ISSUED', null, 'STANDARD', null, 6726639);

create temp table _pl (
  key text, line_no int, code text, descr text, qty numeric, uom text, price numeric,
  primary key (key, line_no)) on commit drop;
insert into _pl values
  ('MARTONO/19082026-01', 1, 'SG-28', 'JASA JOK SG-28 DAYBED', 5, 'pcs', 1950000),
  ('MARTONO/19082026-01', 2, 'SG-29', 'JASA JOK SG-29 LOUNGER', 10, 'pcs', 350000),
  ('MARTONO/19082026-01', 3, 'SG-30', 'JASA JOK SG-30 OUTDOOR SOFA', 4, 'pcs', 450000),
  ('MARTONO/19082026-01', 4, 'SG-31', 'JASA JOK SG-31 ARMCHAIR', 10, 'pcs', 330000),
  ('MARTONO/19082026-01', 5, 'TAMBAHAN', 'KEPLA YKK (ZIPPER HEAD)', 1, 'pack', 175000),
  ('MARTONO/19082026-01', 6, 'TAMBAHAN', 'TALIKUR - MITRA UTAMA', 1, 'pack', 32000),
  ('MARTONO/19082026-01', 7, 'TAMBAHAN', 'RESLETING PUTIH YKK - MITRA', 1, 'pack', 235000),
  ('MARTONO/19082026-01', 8, 'TAMBAHAN', 'KAIN TRICOTE TULLE - BANG AMIR', 15, 'meter', 16500),
  ('DUL ROTAN/06102026', 1, 'SG-27', 'JASA ANYAM STOOL', 122, 'pcs', 450000),
  ('DUL ROTAN/06302026', 1, 'SG-28', 'FRAME ALUMINIUM DAYBED', 5, 'pcs', 5000000),
  ('DUL ROTAN/06302026', 2, 'SG-28', 'JASA ANYAM DAYBED', 5, 'pcs', 3700000),
  ('DUL ROTAN/06302026', 3, 'SG-30', 'FRAME ALUMINIUM SOFA', 4, 'pcs', 3000000),
  ('DUL ROTAN/06302026', 4, 'SG-30', 'JASA ANYAM SOFA', 4, 'pcs', 1800000),
  ('DUL ROTAN/06302026', 5, 'AA-31', 'FRAME ALUMUNIUM UMBRELA', 10, 'pcs', 2500000),
  ('DUL ROTAN/06302026', 6, 'AA-31', 'JASA ANYAM UMBRELLA', 10, 'pcs', 400000),
  ('DUL ROTAN/06302026', 7, 'TB-24', 'JASA ANYAM ROUND WOOD', 25, 'pcs', 400000),
  ('DUL ROTAN/06302026', 8, null, 'PAKU TEMBAK SST F15', 5, 'pcs', 145000),
  ('DUL ROTAN/06302026', 9, null, 'STAPLES SST 413J', 5, 'pcs', 150000),
  ('RUBIATI/29082026-01', 1, null, 'BORONG PACKING DUDUKAN KURSI', 90, 'pcs', 17500),
  ('RUBIATI/31082026-02', 1, null, 'BORONG PACKING DUDUKAN KURSI', 30, 'pcs', 17500),
  ('RUBIATI/31082026-02', 2, null, 'BORONG PACKING FRAME KURSI', 78, 'pcs', 17500),
  ('CHYNTIA BOX/05262026', 1, 'OV-506', '119,5 CM X 44 CM X 31 CM (A1)', 109, 'pcs', 48900),
  ('CHYNTIA BOX/05262026', 2, 'BV-506.1', '89,5 CM X 37,5 CM X 25 CM (A1)', 29, 'pcs', 32000),
  ('CHYNTIA BOX/05262026', 3, 'BV-506', '119,5 CM X 36,5 CM X 38,5 CM (A1)', 12, 'pcs', 46700),
  ('CHYNTIA BOX/05302026', 1, 'OV-601', '208,5 CM X 85,5 CM X 5 CM (TOP BOTTOM)', 92, 'pcs', 75315),
  ('CHYNTIA BOX/05302026', 2, 'BV-601', '213 CM X 85,5 CM X 5 CM (TOP BOTTOM)', 30, 'pcs', 76847),
  ('CHYNTIA BOX/05302026', 3, 'PPN', 'PPN 11%', 1, 'lot', 1015782.9),
  ('CHYNTIA BOX/06012026', 1, 'AA-02', '83 CM X 83 CM X 6,5 CM TOP BOTTOM', 121, 'pcs', 37800),
  ('CHYNTIA BOX/06012026', 2, 'AA-03B', '143 CM X 143 CM X 6,5 CM TOP BOTTOM', 122, 'pcs', 96700),
  ('CHYNTIA BOX/06012026', 3, 'AA-07A', '191 CM X 81 CM X 6,5 CM TOP BOTTOM', 121, 'pcs', 77000),
  ('CHYNTIA BOX/06012026', 4, 'AA-29', '83 CM X 58 CM X 6 CM TOP BOTTOM', 91, 'pcs', 27700),
  ('CHYNTIA BOX/06012026', 5, 'AA-04B', '191 CM X 80 CM X 10 CM TOP BOTTOM', 91, 'pcs', 84400),
  ('CHYNTIA BOX/06012026', 6, 'LT-02', '28 CM X 28 CM X 22 CM (A1)', 46, 'pcs', 11900),
  ('CHYNTIA BOX/07282026', 1, 'LT-02', '28CMX28CMX22CM (A1)', 20, 'pcs', 11900),
  ('CHYNTIA BOX/08132026', 1, 'LT-02', '28CMX28CMX22CM (A1)', 61, 'pcs', 11900),
  ('CHYNTIA BOX/14092026', 1, 'SG-28', '203X73X40 (A1)', 10, 'pcs', 121800),
  ('WILLY CNC/08092026-01', 1, 'SG-29', 'LOUNGER FITTING', 25, 'pcs', 25000),
  ('WILLY CNC/08092026-02', 1, 'TB-24', 'STOLL BABY ISLAND', 25, 'pcs', 160000),
  ('WILLY CNC/14092026-01', 1, 'TB-25/TB-26', 'CUTTING KAYU GEAR', 10, 'pcs', 40000),
  ('WILLI CNC/05132026', 1, 'AA-29', 'JASA CNC FRAME MIROR AA-29', 50, 'pcs', 70000),
  ('WILLI CNC/05132026', 2, 'TB-24', 'JASA POTONG PLYWOOD STOOL TB-24', 1, 'lot', 150000),
  ('MANDIRI/10092026-01', 1, 'SQ-01', 'ALUMUNIUM EXSTRUSION 60X30X2M', 30, 'pcs', 516000),
  ('MANDIRI/10092026-01', 2, 'SQ-01', 'ALUMUNIUM EXSTRUSION 60X60X2M', 10, 'pcs', 713000),
  ('NURYANTO/15092026-01', 1, 'SQ-01', 'SHADE RECTANGULAR (KANOPI) 5M X 5M X 3M', 6, 'pcs', 2150000),
  ('JAWUL SWAR/07012026', 1, 'SG-27', 'STOOL (KERING)', 53, 'pcs', 450000),
  ('JAWUL SWAR/07012026', 2, 'TB-03', 'WOOD STOOL (KERING)', 36, 'pcs', 450000),
  ('JAWUL SWAR/07012026', 3, 'SG-27', 'JASA OVEN', 17, 'pcs', 50000),
  ('JAWUL SWAR/07012026', 4, 'TB-03', 'JASA OVEN', 22, 'pcs', 50000),
  ('JAWUL SWAR/11082026-01', 1, 'SG-01A', 'LOUNGE CHAIR - JASA JOK', 120, 'pcs', 510000),
  ('PAPAN KAYU/12092026-01', 1, 'TB-25/TB-26', 'PAPAN KAYU 260 X 24', 1, 'lembar', 325000),
  ('PAPAN KAYU/12092026-01', 2, 'TB-25/TB-26', 'PAPAN KAYU 250 X 24', 1, 'lembar', 299000),
  ('PAPAN KAYU/12092026-01', 3, 'TB-25/TB-26', 'PAPAN KAYU 210 X 22', 1, 'lembar', 250000),
  ('PAPAN KAYU/12092026-01', 4, 'TB-25/TB-26', 'PAPAN KAYU 260 X 24', 1, 'lembar', 285000),
  ('PAPAN KAYU/12092026-01', 5, 'TB-25/TB-26', 'PAPAN KAYU 210 X 18', 1, 'lembar', 210000),
  ('URECEL/180826-01', 1, 'C27', 'QDF SHEET 235cm x 125cm x 6cm (FIRM) - 15 PCS', 2.64375, 'm3', 4890160),
  ('URECEL/180826-01', 2, 'C26', 'QDF SHEET 235cm x 125cm x 4cm (MEDIUM) - 19 PCS', 2.2325, 'm3', 4890160),
  ('URECEL/280826-02', 1, 'C26', 'QDF SHEET 235cm x 125cm x 5cm (FIRM) - 2 PCS', 0.29375, 'm3', 4890160),
  ('URECEL/280826-02', 2, 'C28', 'QDF SHEET 235cm x 125cm x 3cm (SOFT) - 2 PCS', 0.17625, 'm3', 4890160),
  ('ALBERTO/180826-01', 1, null, 'MATA BOR DOWEL TCT M8 (M8x16x110 LH)', 2, 'pcs', 510000),
  ('ALBERTO/180826-01', 2, null, 'MATA BOR DOWEL TCT M8 (M8x16x110 RH)', 2, 'pcs', 510000),
  ('ZENCHEN/180826-01', 1, 'ZP42003', 'SEALER PU', 40, 'kg', 59000),
  ('ZENCHEN/180826-01', 2, 'ZN62002', 'SEALER NC CLEAR', 25, 'kg', 52000),
  ('ZENCHEN/180826-01', 3, 'ZPH8004', 'PU FAST DRYING - PRIMER HARDENER', 20, 'kg', 68000),
  ('ZENCHEN/310826-01', 1, 'ZN42009', 'SEALER NC CLEAR PRIMER - ZN42009', 40, 'kg', 59000),
  ('INOCYCLE/19082026-01', 1, 'HLA', 'DACRON LEMBARAN HI-FIL (HLA)', 70, 'meter', 44000),
  ('INOCYCLE/19082026-01', 2, 'RECOMAX (H300)', 'DACRON AWUL RECOMAX (H300)', 75, 'kg', 28500),
  ('HADI GLASS/06302026', 1, 'AA-04B', '1780mm x 660mm x 5mm (PERSEGI PANJANG) SANBLAST KACA BIASA', 45, 'pcs', 425000),
  ('HADI GLASS/06302026', 2, 'AA-04A', '1000MM X 660MM X 5MM (PERSEGI PANJANG SANBLAST)', 41, 'pcs', 280000),
  ('HADI GLASS/07252026', 1, 'AA-04B', '1780mm x 660mm x 5mm (PERSEGI PANJANG) SANBLAST KACA BIASA', 46, 'pcs', 425000),
  ('HADI GLASS/07252026', 2, 'AA-04A', '1000MM X 660MM X 5MM (PERSEGI PANJANG SANBLAST)', 21, 'pcs', 280000),
  ('HADI GLASS/08192026', 1, 'AA-04B', '1780mm x 660mm x 5mm (PERSEGI PANJANG) SANBLAST KACA BIASA', 2, 'pcs', 425000),
  ('KUSAIRI/05262026', 1, 'AA-04A', 'PROFIL CORNER', 20, 'pcs', 75000),
  ('KUSAIRI/05262026', 2, 'LT-02', 'COVER LAMPU LT-02', 20, 'pcs', 75000),
  ('KUSAIRI/06152026', 1, 'LT-02', 'COVER LAMPU LT-02', 80, 'pcs', 75000),
  ('KUSAIRI/06302026', 1, 'LT-02', 'BUBUT SAMBUNGAN LT-02', 18, 'pcs', 30000),
  ('KUSAIRI/07292026', 1, 'AA-04A', 'SUDUT FRAME MIRROR', 33, 'pcs', 75000),
  ('KUSAIRI/07292026', 2, 'AA-04B', 'SUDUT FRAME MIRROR', 33, 'pcs', 75000),
  ('KUSAIRI/08132026', 1, 'LT-02', 'SUDUT FRAME MIRROR', 10, 'pcs', 75000),
  ('KUSAIRI/08132026', 2, 'AA-04B', 'SUDUT FRAME MIRROR', 24, 'pcs', 75000),
  ('VIRO/07272026', 1, 'AA-21', 'VIRO TATCH BALI PANEL NON FIRE RETARDANT 7FT', 10, 'pcs', 5480000),
  ('VIRO/07272026', 2, 'PPN', 'PPN 11%', 1, 'lot', 6028000),
  ('CN GLASS/05202026', 1, 'AA-02', '755mm x 755mm x 5mm (BULAT)', 121, 'pcs', 153200),
  ('CN GLASS/05202026', 2, 'AA-03A', '1358mm x 1358mm x 5mm (BULAT)', 122, 'pcs', 501150),
  ('CN GLASS/05202026', 3, 'AA-07A', '1620mm x 515mm x 5mm (PERSEGI PANJANG)', 121, 'pcs', 222700),
  ('CN GLASS/05202026', 4, 'AA-29', '660mm x 410mm x 5mm (PERSEGI PANJANG)', 91, 'pcs', 75000),
  ('CN GLASS/05082026', 1, 'KACA BS', 'KACA BS 70CM X 120 CM', 3, 'pcs', 168000),
  ('PUTRA TAN/07092026', 1, 'SG-29', 'MARAGOGY GARDENIA', 10, 'meter', 180000),
  ('PUTRA TAN/06302026', 1, 'SG-31', 'TR-05', 12, 'meter', 120000),
  ('PUTRA TAN/06302026', 2, 'SG-31', 'TR-07', 12, 'meter', 120000),
  ('PUTRA TAN/06302026', 3, 'SG-28/SG-29/SG-30', 'MARAGOGI PARCHMENT', 155, 'meter', 150000),
  ('KEMIRAN/03132026', 1, 'SG-27', 'STOOL', 69, 'pcs', 400000),
  ('KEMIRAN/03132026', 2, 'TB-03', 'WOOD STOOL', 86, 'pcs', 400000),
  ('SUMARTO/07302026', 1, null, 'SOFA FAIRMONT', 2, 'pcs', 3135000),
  ('AMPLAS-FRANS/07172026', 1, 'TB-03', 'GRINDA & AMPLAS BORONG 400 X 400 X 450 MM', 30, 'pcs', 70000),
  ('AMPLAS-FRANS/07172026', 2, 'AA-04B', 'GRINDA & AMPLAS BORONG 1990 X 750 X 70 MM', 33, 'pcs', 70000),
  ('AMPLAS-FRANS/07172026', 3, 'AA-04A', 'GRINDA & AMPLAS BORONG 1150 X 750 X 70 MM', 16, 'pcs', 50000),
  ('AMPLAS-FRANS/07172026', 4, 'AA-29', 'GRINDA & AMPLAS BORONG 800 X 550 X 25 MM', 50, 'pcs', 80000),
  ('AMPLAS-FRANS/07202026', 1, 'AA-04B', 'GRINDA & AMPLAS BORONG 1990 X 750 X 70 MM', 27, 'pcs', 80000),
  ('CV VEENER/04212026', 1, null, 'ASAH PISAU POTONG VEENER PANJANG 320 CM, LEBAR 8,5CM, TEBAL 1CM', 1, 'pcs', 3500000),
  ('CV VEENER/04212026', 2, 'PPN', 'PPN 11%', 1, 'lot', 385000),
  ('CV AMIN/04072026', 1, null, 'KUSEN PANJANG 5CM X 17CM X 220CM (MERANTI PUTIH) - 184 PCS', 3.4408, 'm3', 8500000),
  ('CV AMIN/04072026', 2, null, 'KUSEN PANJANG 5CM X 18CM X 220CM (MERANTI PUTIH) - 60 PCS', 1.188, 'm3', 8500000),
  ('CV AMIN/04072026', 3, null, 'KUSEN PENDEK 5CM X 17CM X 100CM (MERANTI PUTIH) - 92 PCS', 0.782, 'm3', 8500000),
  ('CV AMIN/04072026', 4, null, 'KUSEN PENDEK 5CM X 18CM X 100CM (MERANTI PUTIH) - 30 PCS', 0.27, 'm3', 8500000),
  ('CV AMIN/04072026', 5, null, 'RAM PINTU PANJANG 3,5CM X 6CM X 220CM (MERANTI PUTIH) - 122 PCS', 0.56364, 'm3', 8500000),
  ('CV AMIN/04072026', 6, null, 'RAM PINTU PANJANG 3,5CM X 6CM X 220CM (MERANTI MERAH) - 244 PCS', 1.12728, 'm3', 8500000),
  ('CV AMIN/04072026', 7, null, 'RAM PINTU PENDEK 3,5CM X 6CM X 100CM (MERANTI MERAH) - 732 PCS', 1.5372, 'm3', 8500000),
  ('KSA/18092026-01', 1, 'AZ2120/00', 'AZ2120 (TOP COAT SHEEN 20)', 3, 'ltr', 394135),
  ('KSA/18092026-01', 2, 'EL87003-C', 'BLOKING EL87003-C', 2, 'ltr', 350342),
  ('KSA/18092026-01', 3, 'AM0623/NN', 'BINDER AM0623/NN', 5, 'ltr', 277354.22),
  ('po-26-08-12_01', 1, null, 'BLOCKING', 7, 'ltr', 280274),
  ('po-26-08-12_01', 2, null, 'BINDER AM 623 - KSA', 7, 'ltr', 221883),
  ('po-26-08-12_01', 3, null, 'SEALER AM0473 (DEMPUL)', 5, 'ltr', 327000),
  ('po-26-08-12_01', 4, null, 'TOP COAT AZ2120', 5, 'ltr', 315308);

create temp table _pay (key text, trx_no text, amount numeric,
  primary key (key, trx_no)) on commit drop;
insert into _pay values
  ('MARTONO/19082026-01', 'trx-26-08-26_089', 5505000),
  ('MARTONO/19082026-01', 'trx-26-09-17_094', 7000000),
  ('DUL ROTAN/06102026', 'trx-26-07-13_024', 16200000),
  ('DUL ROTAN/06102026', 'trx-26-08-11_101', 12600000),
  ('DUL ROTAN/06102026', 'trx-26-08-31_038', 15000000),
  ('DUL ROTAN/06102026', 'trx-26-09-17_075', 10830000),
  ('DUL ROTAN/06302026', 'trx-26-07-13_026', 30510000),
  ('DUL ROTAN/06302026', 'trx-26-09-17_096', 35000000),
  ('RUBIATI/29082026-01', 'trx-26-09-01_006', 1575000),
  ('RUBIATI/31082026-02', 'trx-26-09-03_027', 1365000),
  ('RUBIATI/31082026-02', 'trx-26-09-17_125', 525000),
  ('CHYNTIA BOX/05262026', 'trx-26-06-10_002', 3500000),
  ('CHYNTIA BOX/05262026', 'trx-26-06-12_007', 3318500),
  ('CHYNTIA BOX/05302026', 'trx-26-07-14_094', 5125086),
  ('CHYNTIA BOX/05302026', 'trx-26-07-27_060', 5125086),
  ('CHYNTIA BOX/06012026', 'trx-26-06-18_003', 18000000),
  ('CHYNTIA BOX/06012026', 'trx-26-06-29_004', 18436700),
  ('CHYNTIA BOX/07282026', 'trx-26-08-04_026', 238000),
  ('CHYNTIA BOX/08132026', 'trx-26-08-19_032', 724768),
  ('CHYNTIA BOX/14092026', 'trx-26-09-17_103', 1218000),
  ('WILLY CNC/08092026-01', 'trx-26-09-10_012', 625000),
  ('WILLY CNC/08092026-02', 'trx-26-09-17_033', 4000000),
  ('WILLY CNC/14092026-01', 'trx-26-09-17_092', 400000),
  ('WILLI CNC/05132026', 'trx-26-07-14_070', 3500000),
  ('WILLI CNC/05132026', 'trx-26-07-14_071', 150000),
  ('MANDIRI/10092026-01', 'trx-26-09-17_003', 22610000),
  ('NURYANTO/15092026-01', 'trx-26-09-17_124', 5340000),
  ('JAWUL SWAR/07012026', 'trx-26-07-13_003', 22075000),
  ('JAWUL SWAR/07012026', 'trx-26-08-11_103', 925089),
  ('JAWUL SWAR/07012026', 'trx-26-09-10_010', 18999911),
  ('JAWUL SWAR/11082026-01', 'trx-26-08-18_002', 24480000),
  ('JAWUL SWAR/11082026-01', 'trx-26-08-31_006', 18360000),
  ('JAWUL SWAR/11082026-01', 'trx-26-09-01_004', 18360000),
  ('PAPAN KAYU/12092026-01', 'trx-26-09-17_079', 1369000),
  ('URECEL/180826-01', 'trx-26-08-26_015', 23845643),
  ('ALBERTO/180826-01', 'trx-26-08-26_016', 2040000),
  ('ZENCHEN/180826-01', 'trx-26-08-31_014', 2360000),
  ('ZENCHEN/180826-01', 'trx-26-08-31_016', 1300000),
  ('ZENCHEN/180826-01', 'trx-26-08-31_015', 1360000),
  ('ZENCHEN/310826-01', 'trx-26-09-01_049', 2360000),
  ('INOCYCLE/19082026-01', 'trx-26-08-26_091', 5217500),
  ('HADI GLASS/06302026', 'trx-26-07-13_005', 9562500),
  ('HADI GLASS/06302026', 'trx-26-07-27_062', 15847500),
  ('HADI GLASS/06302026', 'trx-26-08-04_022', 4915000),
  ('HADI GLASS/06302026', 'trx-26-08-26_017', 280000),
  ('HADI GLASS/07252026', 'trx-26-08-11_073', 12750000),
  ('HADI GLASS/07252026', 'trx-26-08-26_017', 12680000),
  ('HADI GLASS/08192026', 'trx-26-08-26_017', 850000),
  ('KUSAIRI/05262026', 'trx-26-07-13_006', 3000000),
  ('KUSAIRI/06152026', 'trx-26-07-14_122', 6000000),
  ('KUSAIRI/06302026', 'trx-26-07-27_023', 540000),
  ('KUSAIRI/07292026', 'trx-26-08-04_019', 4950000),
  ('KUSAIRI/08132026', 'trx-26-08-19_013', 2550000),
  ('VIRO/07272026', 'trx-26-07-30_033', 30414000),
  ('VIRO/07272026', 'trx-26-08-19_042', 30414000),
  ('CN GLASS/05202026', 'trx-26-06-17_005', 76062100),
  ('CN GLASS/05202026', 'trx-26-08-04_023', 5000000),
  ('CN GLASS/05202026', 'trx-26-08-11_072', 8000000),
  ('CN GLASS/05202026', 'trx-26-08-19_031', 8000000),
  ('CN GLASS/05202026', 'trx-26-08-26_066', 16387100),
  ('CN GLASS/05082026', 'trx-26-08-26_066', 504000),
  ('PUTRA TAN/07092026', 'trx-26-07-14_102', 900000),
  ('PUTRA TAN/07092026', 'trx-26-08-04_029', 900000),
  ('PUTRA TAN/06302026', 'trx-26-07-28_039', 13065000),
  ('PUTRA TAN/06302026', 'trx-26-08-04_028', 13065000),
  ('KEMIRAN/03132026', 'trx-26-03-30_004', 48000000),
  ('KEMIRAN/03132026', 'trx-26-07-10_002', 6000000),
  ('KEMIRAN/03132026', 'trx-26-08-04_021', 4000000),
  ('KEMIRAN/03132026', 'trx-26-08-11_071', 4000000),
  ('SUMARTO/07302026', 'trx-26-08-04_024', 6270000),
  ('AMPLAS-FRANS/07172026', 'trx-26-07-21_039', 2100000),
  ('AMPLAS-FRANS/07172026', 'trx-26-07-28_010', 5010000),
  ('AMPLAS-FRANS/07172026', 'trx-26-07-29_038', 2100000),
  ('AMPLAS-FRANS/07202026', 'trx-26-07-29_038', 2160000),
  ('CV VEENER/04212026', 'trx-26-04-22_006', 3885000),
  ('CV AMIN/04072026', 'trx-26-04-08_014', 37518669),
  ('CV AMIN/04072026', 'trx-26-04-17_004', 38207151),
  ('KSA/18092026-01', 'trx-26-09-22_037', 1386771),
  ('po-26-08-12_01', 'trx-26-08-19_038', 2452393),
  ('po-26-08-12_01', 'trx-26-08-19_039', 2861125),
  ('po-26-08-12_01', 'trx-26-08-19_040', 1970674),
  ('po-26-08-12_01', 'trx-26-08-19_041', 1386771);

create temp table _nv (ref text primary key, name text, phone text, pic text,
  address text, bank text) on commit drop;
insert into _nv values
  ('NEW:URECEL', 'PT URECEL INDONESIA', '+62 823-2234-5967', 'ZUMALA', null, 'BCA 7610471778 a/n URECEL INDONESIA'),
  ('NEW:INOCYCLE', 'PT. INOCYCLE TECHNOLOGY', '085786524975', null, 'Jl. RA Rukmini RT 19 RW 03, Desa Bawu, Kec. Batealit, Jepara', 'BCA 7960381381 a/n PT. INOCYCLE TECHNOLOGY');

create temp table _gap (key text primary key, amount numeric, note text) on commit drop;
insert into _gap values
  ('NURYANTO/15092026-01', 7560000, 'Tab says PAYMENT 1 Rp 12.900.000, no date and no proof. The ledger has one Nuryanto transfer, trx-26-09-17_124 Rp 5.340.000 (POWDER CUTTING KANOPI, 2026-09-15), allocated here. Rp 7.560.000 is not in the ledger.');

create temp table _tab (tab text primary key, note text) on commit drop;
insert into _tab values
  ('PURCHASE ORDER TRACK', 'Hidden summary tab; superseded by PURCHASE ORDER TRACK AGS and the vendor tabs. Used as a cross-check only.'),
  ('PURCHASE ORDER TRACK AGS', 'Summary of the vendor tabs. Cross-check only; every order it lists is imported from its vendor tab.'),
  ('27 AUG TO COMPLETE', 'Budget-to-complete worksheet, not an order.'),
  ('Copy of PO URECEL', 'FAIRMONT order FR-06232025 dated 2025-06-23, before the ledger begins (2026-01-01). Nothing in the ledger to link it to.'),
  ('VALIDATION', 'Drop-down list of statuses.');

-- ── 2. refuse the whole file rather than half of it ───────────────────────

do $$
declare r record;
begin
  if (select count(*) from _author) <> 1 then
    raise exception 'shared@talaliving.com is not in ops_core.users';
  end if;

  for r in select distinct p.vendor_ref from _po p
            where p.vendor_ref not like 'NEW:%'
              and not exists (select 1 from ops_procure.vendors v where v.code = p.vendor_ref) loop
    raise exception 'vendor % does not exist', r.vendor_ref;
  end loop;

  for r in select distinct l.uom from _pl l
            where not exists (select 1 from ops_procure.uom u where u.code = l.uom) loop
    raise exception 'unit % does not exist', r.uom;
  end loop;

  -- The sheet's own total, against the lines as this file will store them.
  for r in select p.key, p.sheet_total, sum(round(l.qty * l.price)) as contract
             from _po p join _pl l using (key) group by 1, 2
           having abs(sum(round(l.qty * l.price)) - p.sheet_total) >= 1 loop
    raise exception '% lines total % but the sheet says %', r.key, r.contract, r.sheet_total;
  end loop;

  for r in select y.trx_no from _pay y
            where not exists (select 1 from ops_acct.transactions t
                               where t.trx_no = y.trx_no and t.direction = 'OUT'
                                 and t.status <> 'VOID') loop
    raise exception '% is not a live outgoing transaction', r.trx_no;
  end loop;

  -- What this file claims for one transfer can never exceed the transfer.
  -- (Whether it fits beside what is already allocated is checked after step
  -- 5, when the PR allocations it merges with have been accounted for.)
  for r in
    select t.trx_no, t.amount_idr, sum(y.amount) as claimed
      from _pay y join ops_acct.transactions t on t.trx_no = y.trx_no
     group by t.trx_no, t.amount_idr
    having sum(y.amount) > t.amount_idr
  loop
    raise exception '% moved % and the sheet claims %', r.trx_no, r.amount_idr, r.claimed;
  end loop;
end $$;

-- ── 3. the two vendors the master did not have ────────────────────────────

create temp table _vmap (ref text primary key, vendor_id uuid) on commit drop;

insert into _vmap
select v.code, v.id from ops_procure.vendors v
 where v.code in (select vendor_ref from _po);

do $$
declare r record; v_id uuid; v_code text; n int;
begin
  for r in select * from _nv order by ref loop
    select m.target_id into v_id from ops_core.legacy_map m
     where m.source_table = 'sheet.po_tracker.vendor' and m.source_id = r.ref;
    if v_id is null then
      -- Somebody may have added it by hand since; an exact name is the same vendor.
      select v.id into v_id from ops_procure.vendors v
       where upper(btrim(v.name)) = upper(btrim(r.name)) and v.merged_into is null;
      if v_id is null then
        select count(*) + 1 into n from ops_procure.vendors;
        v_code := 'V-' || lpad(n::text, 4, '0');
        while exists (select 1 from ops_procure.vendors v where v.code = v_code) loop
          n := n + 1;
          v_code := 'V-' || lpad(n::text, 4, '0');
        end loop;
        insert into ops_procure.vendors
          (code, name, phone, pic_name, address, bank_account, is_curated, created_by)
        values (v_code, r.name, r.phone, r.pic, r.address, r.bank, false,
                (select id from _author))
        returning id into v_id;
      end if;
      insert into ops_core.legacy_map
        (source_table, source_id, target_table, target_id, outcome, note, run_id)
      values ('sheet.po_tracker.vendor', r.ref, 'ops_procure.vendors', v_id, 'imported',
              'From the PO document header in PO TRACKER (name, phone, bank). '
              || 'The ledger had paid this vendor with no vendor on the row.',
              (select id from _run));
    end if;
    insert into _vmap values (r.ref, v_id);
  end loop;
end $$;

-- ── 4. orders, lines, terms ───────────────────────────────────────────────

-- Every legacy number is taken before anything is minted, so a new order dated
-- 2026-08-03 cannot be handed po-26-08-03_01, which the old app already means.
insert into ops_core.doc_numbers (prefix, day, seq)
select 'po', to_date(substr(po_id, 4, 8), 'YY-MM-DD'), max(substr(po_id, 13)::int)
  from public.purchase_orders
 where po_id ~ '^po-\d{2}-\d{2}-\d{2}_\d+$'
 group by 2
on conflict (prefix, day) do update
  set seq = greatest(ops_core.doc_numbers.seq, excluded.seq);

create temp table _done (key text primary key, po_id uuid, po_no text) on commit drop;

insert into _done
select m.source_id, m.target_id, po.po_no
  from ops_core.legacy_map m
  join ops_procure.purchase_orders po on po.id = m.target_id
 where (m.source_table, m.source_id) in (select src, key from _po);

do $$
declare r record; v_no text; v_id uuid;
begin
  for r in select p.* from _po p
            where not exists (select 1 from _done d where d.key = p.key)
            order by p.order_date, p.key loop
    v_no := coalesce(r.legacy_po,
      ops_core.next_doc_number('po', (r.order_date + time '12:00') at time zone 'Asia/Jakarta'));
    if exists (select 1 from ops_procure.purchase_orders where po_no = v_no) then
      raise exception '% already exists and is not mapped to %', v_no, r.key;
    end if;

    insert into ops_procure.purchase_orders
      (po_no, vendor_id, status, created_by, created_at, note, expected_delivery)
    values (v_no, (select vendor_id from _vmap where ref = r.vendor_ref), r.status,
            (select id from _author),
            (r.order_date + time '12:00') at time zone 'Asia/Jakarta',
            case when r.src = 'sheet.po_tracker'
                 then 'PO TRACKER › ' || r.tab || ' › Order No ' || r.order_no
                 else 'Aplikasi lama › ' || r.order_no || ' (tidak ada di PO TRACKER)' end
              || ' · proyek ' || r.project
              || '. Diimpor 2026-09-23; persetujuan & penerbitan terjadi di luar sistem,'
              || ' jadi tanggal dan namanya kosong.',
            r.expected)
    returning id into v_id;

    insert into ops_procure.po_lines
      (po_id, line_no, description, qty, uom, unit_price, line_total, created_at)
    select v_id, l.line_no,
           case when l.code is null then l.descr else l.code || ' — ' || l.descr end,
           l.qty, l.uom, l.price, round(l.qty * l.price),
           (r.order_date + time '12:00') at time zone 'Asia/Jakarta'
      from _pl l where l.key = r.key;

    -- The terms the tab states, in create_po()'s shape: two or none.
    if r.dp is not null then
      insert into ops_procure.po_schedule (po_id, term_no, kind, basis, basis_value, due_rule) values
        (v_id, v_no || '-M01', 'DP',    'percent', r.dp,       'on_issue'),
        (v_id, v_no || '-M02', 'FINAL', 'percent', 100 - r.dp, 'on_delivery');
    end if;

    insert into ops_core.legacy_map
      (source_table, source_id, target_table, target_id, outcome, note, run_id)
    values (r.src, r.key, 'ops_procure.purchase_orders', v_id, 'imported',
            case when r.src = 'sheet.po_tracker'
                 then 'Tab ' || r.tab || ', order ' || r.order_no || ', dated ' || r.order_date
                      || ', project ' || r.project || '.'
                      || coalesce(' Same order as ' || r.legacy_po || ' in the old app, whose number it keeps.', '')
                 else 'In the old app and not on the sheet. Lines as the old app has them.' end,
            (select id from _run));

    -- The old app's copy of the same order points here too, so "did we take
    -- po-26-08-03_05" has an answer.
    if r.legacy_po is not null and r.src = 'sheet.po_tracker' then
      insert into ops_core.legacy_map
        (source_table, source_id, target_table, target_id, outcome, note, run_id)
      values ('public.purchase_orders', r.legacy_po, 'ops_procure.purchase_orders', v_id,
              'imported',
              'Merged with PO TRACKER › ' || r.key || '. The sheet is the source for lines and'
              || ' payments; the old app''s copy was re-typed from it on 2026-08-03.',
              (select id from _run))
      on conflict (source_table, source_id) do nothing;
    end if;

    insert into _done values (r.key, v_id, v_no);
  end loop;
end $$;

-- The old app's lines and terms: read, and deliberately not carried — the
-- sheet's are. Except the one order that exists only there.
insert into ops_core.legacy_map
  (source_table, source_id, target_table, target_id, outcome, note, run_id)
select 'public.po_lines', l.po_line_id, 'ops_procure.po_lines',
       case when l.po_id = 'po-26-08-12_01' then pl.id end,
       case when l.po_id = 'po-26-08-12_01' then 'imported' else 'skipped' end,
       case when l.po_id = 'po-26-08-12_01' then null
            else 'Lines for ' || l.po_id || ' are taken from PO TRACKER, the field source.' end,
       (select id from _run)
  from public.po_lines l
  left join ops_procure.purchase_orders po on po.po_no = l.po_id
  left join ops_procure.po_lines pl
         on pl.po_id = po.id and pl.line_no = substr(l.po_line_id, length(l.po_id) + 3)::int
 where l.po_id in (select legacy_po from _po where legacy_po is not null)
on conflict (source_table, source_id) do nothing;

insert into ops_core.legacy_map
  (source_table, source_id, target_table, target_id, outcome, note, run_id)
select 'public.po_schedule', s.milestone_id, 'ops_procure.po_schedule', null, 'skipped',
       'Terms are taken from what PO TRACKER states; most of the old app''s are'
       || ' "100% on delivery" placeholders the sheet contradicts.',
       (select id from _run)
  from public.po_schedule s
 where s.po_id in (select legacy_po from _po where legacy_po is not null)
on conflict (source_table, source_id) do nothing;

-- ── 5. the links: which transfer paid which order ─────────────────────────

--
-- **Many of these transfers are already allocated — to a request line.** The
-- PR RECAP import ran the same afternoon and applied them to the `pr-…` lines
-- that asked for the money ("BALANCE PAYMENT HADI GLASS"). The request and
-- the order are two questions about the same transfer — *who decided to pay*
-- and *what it paid for* — and the table was built to answer both on one row:
-- `payment_allocations` carries `pr_line_no` **and** `po_no` (D106, D107).
-- Allocating the transfer a second time, to the order alone, would count the
-- money twice.
--
-- So, per transfer, the request allocations and the orders it paid are paired
-- in order — request lines by number, orders as this file lists them — and
-- each pairing becomes one row carrying both numbers. What does not pair
-- stays what it was: a request share with no order (Mandiri's 132.000), or an
-- order share with no request (Rp 8.000 of Jawul's balance the recap left
-- out). The old request rows are **superseded, not changed** (A2): the new row
-- that took over names them in `superseded_by`, and an `audit_log` row per
-- transfer carries the before and the after.
--
-- A transfer with no request allocation is simply allocated to its orders.

create temp table _alloc (key text, trx_no text, alloc_id uuid, pr_line_no text) on commit drop;
create temp table _swap (trx_no text, old_id uuid, old_pr text, old_amount numeric, new_id uuid) on commit drop;
create temp table _t (seq int, key text, po_no text, remaining numeric) on commit drop;

do $$
declare
  tx record; pa record; tg record;
  rem numeric; amt numeric; nid uuid; first_new uuid; n_old int;
begin
  for tx in
    select distinct t.id, t.trx_no, t.amount_idr
      from _pay y join ops_acct.transactions t on t.trx_no = y.trx_no
     where not exists (select 1 from ops_core.legacy_map m
                        where m.source_table = 'import.po_allocation.trx'
                          and m.source_id = t.trx_no)
     order by t.trx_no
  loop
    truncate _t;
    insert into _t
    select row_number() over (order by y.key), y.key, d.po_no, y.amount
      from _pay y join _done d using (key)
     where y.trx_no = tx.trx_no;

    n_old := 0;
    for pa in
      select a.id, a.pr_line_no, a.amount, a.method
        from ops_acct.payment_allocations a
       where a.trx_id = tx.id and a.superseded_by is null
         and a.pr_line_no is not null and a.po_no is null
       order by a.pr_line_no, a.allocated_at, a.id
    loop
      n_old := n_old + 1;
      rem := pa.amount; first_new := null;
      while rem > 0 loop
        select * into tg from _t where remaining > 0 order by seq limit 1;
        if not found then
          -- The request asked for more than the orders absorb: the rest stays
          -- on the request alone.
          insert into ops_acct.payment_allocations
            (trx_id, pr_line_no, po_no, amount, method, allocated_by)
          values (tx.id, pa.pr_line_no, null, rem, pa.method, (select id from _author))
          returning id into nid;
          insert into _alloc values (null, tx.trx_no, nid, pa.pr_line_no);
          first_new := coalesce(first_new, nid);
          rem := 0;
        else
          amt := least(rem, tg.remaining);
          insert into ops_acct.payment_allocations
            (trx_id, pr_line_no, po_no, amount, method, allocated_by)
          values (tx.id, pa.pr_line_no, tg.po_no, amt, pa.method, (select id from _author))
          returning id into nid;
          insert into _alloc values (tg.key, tx.trx_no, nid, pa.pr_line_no);
          update _t set remaining = remaining - amt where seq = tg.seq;
          first_new := coalesce(first_new, nid);
          rem := rem - amt;
        end if;
      end loop;
      update ops_acct.payment_allocations set superseded_by = first_new where id = pa.id;
      insert into _swap values (tx.trx_no, pa.id, pa.pr_line_no, pa.amount, first_new);
    end loop;

    -- What the orders still need from this transfer, with no request behind it.
    -- Beside a request allocation, a remainder under money_tolerance() is the
    -- recap rounding a line (2.452.392 for 2.452.393), not a second payment;
    -- a one-rupiah allocation would only be noise on the order.
    for tg in select * from _t
               where remaining > 0
                 and (n_old = 0 or remaining >= ops_core.money_tolerance())
               order by seq loop
      insert into ops_acct.payment_allocations (trx_id, po_no, amount, method, allocated_by)
      values (tx.id, tg.po_no, tg.remaining, 'transfer', (select id from _author))
      returning id into nid;
      insert into _alloc values (tg.key, tx.trx_no, nid, null);
    end loop;

    insert into ops_core.legacy_map
      (source_table, source_id, target_table, target_id, outcome, note, run_id)
    values ('import.po_allocation.trx', tx.trx_no, 'ops_acct.transactions', tx.id, 'imported',
            case when n_old = 0 then 'Allocated to its orders; no request allocation existed.'
                 else n_old || ' request allocation(s) superseded by rows carrying the order too.' end,
            (select id from _run));
  end loop;

  -- Never more than the row moved, now that both imports are on it.
  for tx in
    select t.trx_no, t.amount_idr, sum(a.amount) as live
      from ops_acct.transactions t
      join ops_acct.payment_allocations a on a.trx_id = t.id and a.superseded_by is null
     where t.trx_no in (select trx_no from _pay)
     group by t.trx_no, t.amount_idr
    having sum(a.amount) > t.amount_idr
  loop
    raise exception '% moved % and would carry % of allocations', tx.trx_no, tx.amount_idr, tx.live;
  end loop;
end $$;

insert into ops_core.legacy_map
  (source_table, source_id, target_table, target_id, outcome, note, run_id)
select 'import.po_allocation',
       coalesce(a.key, 'request only') || ' <- ' || a.trx_no || coalesce(' via ' || a.pr_line_no, ''),
       'ops_acct.payment_allocations', a.alloc_id, 'imported',
       case when a.key is null then 'The part of the request that no order on PO TRACKER absorbs.' end,
       (select id from _run)
  from _alloc a;

insert into ops_core.audit_log
  (service, entity, entity_no, action, outcome, reason, before, after, detail)
select 'accounting', 'transaction', s.trx_no, 'link_po', 'ok',
       'The transfer was allocated to a request line only. The order it paid, per PO TRACKER,'
       || ' is now on the same allocation, so the request and the order point at each other'
       || ' and the money is counted once.',
       jsonb_agg(distinct jsonb_build_object('id', s.old_id, 'pr_line_no', s.old_pr, 'amount', s.old_amount)),
       (select jsonb_agg(jsonb_build_object('id', a.alloc_id, 'pr_line_no', a.pr_line_no,
                                            'po_no', pa.po_no, 'amount', pa.amount))
          from _alloc a join ops_acct.payment_allocations pa on pa.id = a.alloc_id
         where a.trx_no = s.trx_no),
       jsonb_build_object('by', 'supabase/import/08_po_tracker.sql')
  from _swap s
 group by s.trx_no;

-- The request line and the order line, where one answers the other.
--
-- `pr_lines.po_line_id` is the column 0008 left for exactly this. Set only when
-- it is unambiguous: the order has one line; or exactly one line of it has the
-- same description once punctuation is gone; or exactly one has the same
-- total within money_tolerance(). A balance request against a four-line order
-- answers the order, not a line — it stays linked through the allocation.
create temp table _prlink on commit drop as
with pairs as (
  select distinct pl.id as pr_line_id, pl.line_no_full, pl.description, pl.item_total, po.id as po_id, po.po_no
    from _alloc a
    join ops_acct.payment_allocations x on x.id = a.alloc_id
    join ops_procure.pr_lines pl on pl.line_no_full = x.pr_line_no
    join ops_procure.purchase_orders po on po.po_no = x.po_no
   where pl.po_line_id is null
), cand as (
  select p.*, l.id as po_line_id, l.line_no,
         count(*) over (partition by p.pr_line_id, p.po_id) as n_lines,
         regexp_replace(upper(case when position(' — ' in l.description) > 0
                                   then split_part(l.description, ' — ', 2) else l.description end),
                        '[^A-Z0-9]', '', 'g') = regexp_replace(upper(p.description), '[^A-Z0-9]', '', 'g')
           as same_text,
         abs(l.line_total - coalesce(p.item_total, -1e12)) <= ops_core.money_tolerance() as same_total
    from pairs p
    join ops_procure.po_lines l on l.po_id = p.po_id and l.superseded_by is null
), pick as (
  select distinct on (pr_line_id) pr_line_id, line_no_full, po_no, po_line_id, line_no,
         case when n_lines = 1 then 'the order has one line'
              when same_text then 'same description'
              else 'same total' end as why
    from (
      select c.*,
             count(*) filter (where same_text)  over (partition by pr_line_id, po_id) as n_text,
             count(*) filter (where same_total) over (partition by pr_line_id, po_id) as n_total
        from cand c
    ) c
   where n_lines = 1
      or (same_text and n_text = 1)
      or (n_text = 0 and same_total and n_total = 1)
   order by pr_line_id, (n_lines = 1) desc, same_text desc
)
select * from pick
 where pr_line_id not in (  -- a request line paying two orders answers neither line
   select pr_line_id from pairs group by pr_line_id having count(distinct po_id) > 1);

update ops_procure.pr_lines pl
   set po_line_id = k.po_line_id
  from _prlink k
 where pl.id = k.pr_line_id and pl.po_line_id is null;

insert into ops_core.audit_log
  (service, entity, entity_no, action, outcome, reason, before, after, detail)
select 'procurement', 'pr_line', k.line_no_full, 'link_po_line', 'ok',
       'Paid by the same transfer as ' || k.po_no || ' line ' || k.line_no || ' (' || k.why || ').',
       jsonb_build_object('po_line_id', null),
       jsonb_build_object('po_no', k.po_no, 'line_no', k.line_no, 'po_line_id', k.po_line_id),
       jsonb_build_object('by', 'supabase/import/08_po_tracker.sql')
  from _prlink k;

-- What the sheet claims was paid and the ledger does not carry.
insert into ops_core.legacy_map
  (source_table, source_id, target_table, target_id, outcome, note, run_id)
select 'sheet.po_tracker.payment', g.key || ' / unmatched', 'ops_acct.payment_allocations',
       null, 'refused', g.note, (select id from _run)
  from _gap g
on conflict (source_table, source_id) do nothing;

insert into ops_core.legacy_map
  (source_table, source_id, target_table, target_id, outcome, note, run_id)
select 'sheet.po_tracker.tab', t.tab, 'ops_procure.purchase_orders', null, 'skipped',
       t.note, (select id from _run)
  from _tab t
on conflict (source_table, source_id) do nothing;

-- ── 6. the vendor a paying row forgot to name ─────────────────────────────
--
-- Idempotent by shape: only rows whose vendor is still null, and only when
-- every order the row pays belongs to the same vendor.

create temp table _fix_vendor on commit drop as
select t.id, t.trx_no, min(po.vendor_id::text)::uuid as vendor_id
  from ops_acct.payment_allocations a
  join ops_acct.transactions t on t.id = a.trx_id
  join ops_procure.purchase_orders po on po.po_no = a.po_no
  join ops_core.legacy_map m
    on m.target_id = a.id and m.source_table = 'import.po_allocation'
 where a.superseded_by is null and t.vendor_id is null
 group by t.id, t.trx_no
having count(distinct po.vendor_id) = 1;

update ops_acct.transactions t
   set vendor_id = f.vendor_id
  from _fix_vendor f
 where t.id = f.id and t.vendor_id is null;

insert into ops_core.audit_log
  (service, entity, entity_no, action, outcome, reason, before, after, detail)
select 'accounting', 'transaction', f.trx_no, 'attribute_vendor', 'ok',
       'The row named no vendor. It pays ' || string_agg(distinct a.po_no, ', ')
       || ', which is an order with ' || v.name || ', matched by amount, date and'
       || ' description against PO TRACKER.',
       jsonb_build_object('vendor', null),
       jsonb_build_object('vendor_code', v.code, 'vendor_name', v.name),
       jsonb_build_object('by', 'supabase/import/08_po_tracker.sql')
  from _fix_vendor f
  join ops_procure.vendors v on v.id = f.vendor_id
  join ops_acct.payment_allocations a on a.trx_id = f.id and a.superseded_by is null
 group by f.trx_no, v.name, v.code;

-- ── 7. what it did ────────────────────────────────────────────────────────

select d.po_no, p.key, v.name as vendor, s.status, s.contract_value, s.paid_to_date,
       s.contract_value - s.paid_to_date as balance, s.payment_state,
       (select count(*) from _alloc a where a.key = p.key) as linked_this_run,
       (select string_agg(distinct x.pr_line_no, ', ')
          from ops_acct.payment_allocations x
         where x.po_no = d.po_no and x.superseded_by is null) as via_requests
  from _po p
  join _done d using (key)
  join ops_procure.v_po_status s on s.po_id = d.po_id
  join ops_procure.vendors v on v.id = s.vendor_id
union all
select '— total', count(*)::text || ' orders, ' || (select count(*) from _alloc) || ' allocations written, '
       || (select count(*) from _swap) || ' request allocations superseded, '
       || (select count(*) from _prlink) || ' request lines tied to an order line, '
       || (select count(*) from _fix_vendor) || ' vendors attributed',
       null, null, sum(s.contract_value), sum(s.paid_to_date),
       sum(s.contract_value - s.paid_to_date), null, null, null
  from _done d join ops_procure.v_po_status s on s.po_id = d.po_id
 order by 1;

commit;
