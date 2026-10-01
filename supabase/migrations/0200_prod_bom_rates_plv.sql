-- 0200 — rate PLV masuk daftar rate BOM, dasarnya disebut di nama (D355).
--
-- IT, after the PLV BOM kajian (F205): *import data rate yang belum lengkap
-- dari PLV ke supabase OPS.*
--
-- The owner's PLV BOM rate card (29 Sep 2026, read from the RATES tab of the
-- stack tests of 30 Sep, `rates_version 2026-09-29`) prices timber **as a
-- finished component**: one rate per species per tier, per m³ of component,
-- with the log price, the kiln and sawmill, the yield and the carpentry
-- labour already inside. The 84 rates entered on 29 Sep price timber **as
-- bought** — per m³ of log, of square or of *siap potong* — and the yield is
-- still to be applied. Same unit, different basis, so:
--
--   1. 26 rates are ADDED, never replacing a figure: 11 timber tiers, the
--      fasteners-per-m³ rule, four finishing rates per m² exposed (materials,
--      abrasives, sanding labour, finishing labour), three packing rates, and
--      raw plywood 3–24 mm per sheet. Each name says its basis; each note
--      says the formula and the card's own status (CONFIRM, judgement).
--   2. The seven bought-timber rates get one sentence in their note saying
--      which yield still has to be applied. They are found by name, not by
--      code: on a fresh ladder the codes below RT-0008 belong to this file.
--   3. The card's rule thresholds, allocation percentages, tier factors and
--      derivation inputs become `bom_norms` rows in category `PLV`, so the
--      AI, Tahap 1 (auto tier, derived lines) and Tahap 2 (re-deriving the
--      card) read them from the database and not from a sheet. Names avoid
--      the words `wasteFromNorm` keys on (waste, yield, rendemen, susut) or
--      carry a unit other than %, so none is mistaken for a line's waste.
--   4. Four existing norms that the card contradicts (overhead 17 % against
--      13 %, finishing material 96.300 against 51.640/m², finishing labour
--      12.500 against 88.755/m², processing 700.000 against 598.978/m³) get
--      a remark naming the PLV figure. Their `source_kind` is not touched:
--      which one rules is the owner's (Q-D355a).
--
-- Idempotent: a rate is skipped when an active rate of the same name exists,
-- a norm is upserted on (category, norm), a remark is appended once.
-- No function, no view, no policy changes.

-- ── 1. the 26 rates ───────────────────────────────────────────────────────
with plv(ord, name, rate_group, uom, unit_rate, note) as (values
  (1,  'Jati tier A — per m³ komponen (rendemen 3,5, processing dan upah tukang di dalam)', 'kayu', 'm3', 47714405.66::numeric,
       'PLV rate card 29 Sep 2026 (rates_version 2026-09-29): (log jati 10,9 jt tersirat + processing 598.978) × rendemen 3,5 + upah tukang 7.467.983, per m³ komponen jadi. Rendemen A judgement (OPEN_ITEMS 4); harga log status CONFIRM. Dasar: m³ komponen — jangan dikalikan rendemen lagi, jangan tambah baris upah tukang.'),
  (2,  'Jati tier A-curved — per m³ komponen (rendemen 4,6, processing dan upah tukang di dalam)', 'kayu', 'm3', 60363281.46,
       'PLV rate card 29 Sep 2026: (10,9 jt + 598.978) × 4,6 + 7.467.983 per m³ komponen. Lengkung / bubut / papan lebar. Rendemen dari mindi STMV. Dasar: m³ komponen.'),
  (3,  'Jati tier B — per m³ komponen (rendemen 2,5, processing dan upah tukang di dalam)', 'kayu', 'm3', 36215427.66,
       'PLV rate card 29 Sep 2026: (10,9 jt + 598.978) × 2,5 + 7.467.983 per m³ komponen. Terekspos < 1000 mm, atau penampang ≤ 40 × 40 sampai 1500 mm (aturan 30 Sep). Rendemen B judgement. Dasar: m³ komponen.'),
  (4,  'Jati tier C — per m³ komponen (rendemen 2,0, processing dan upah tukang di dalam)', 'kayu', 'm3', 30465938.66,
       'PLV rate card 29 Sep 2026: (10,9 jt + 598.978) × 2,0 + 7.467.983 per m³ komponen. Tidak terekspos. Rendemen dari jati STMV. Dasar: m³ komponen.'),
  (5,  'Jati tier D — per m³ komponen (rendemen 1,5, processing dan upah tukang di dalam)', 'kayu', 'm3', 24716449.66,
       'PLV rate card 29 Sep 2026: (10,9 jt + 598.978) × 1,5 + 7.467.983 per m³ komponen. Komponen sangat kecil (< 0,0005 m³ dan < 300 mm). Rendemen D judgement. Dasar: m³ komponen.'),
  (6,  'Mindi tier A — per m³ komponen (rendemen 3,5, processing dan upah tukang di dalam)', 'kayu', 'm3', 20414405.66,
       'PLV rate card 29 Sep 2026: (log mindi 3,1 jt tersirat + processing 598.978) × 3,5 + 7.467.983 per m³ komponen. Harga log status CONFIRM. Dasar: m³ komponen — jangan dikalikan rendemen lagi, jangan tambah baris upah tukang.'),
  (7,  'Mindi tier A-curved — per m³ komponen (rendemen 4,6, processing dan upah tukang di dalam)', 'kayu', 'm3', 24483281.46,
       'PLV rate card 29 Sep 2026: (3,1 jt + 598.978) × 4,6 + 7.467.983 per m³ komponen. Dasar: m³ komponen.'),
  (8,  'Mindi tier B — per m³ komponen (rendemen 2,5, processing dan upah tukang di dalam)', 'kayu', 'm3', 16715427.66,
       'PLV rate card 29 Sep 2026: (3,1 jt + 598.978) × 2,5 + 7.467.983 per m³ komponen. Dasar: m³ komponen.'),
  (9,  'Mindi tier C — per m³ komponen (rendemen 2,0, processing dan upah tukang di dalam)', 'kayu', 'm3', 14865938.66,
       'PLV rate card 29 Sep 2026: (3,1 jt + 598.978) × 2,0 + 7.467.983 per m³ komponen. Dasar: m³ komponen.'),
  (10, 'Mindi tier D — per m³ komponen (rendemen 1,5, processing dan upah tukang di dalam)', 'kayu', 'm3', 13016449.66,
       'PLV rate card 29 Sep 2026: (3,1 jt + 598.978) × 1,5 + 7.467.983 per m³ komponen. Dasar: m³ komponen.'),
  (11, 'Meranti semua tier — per m³ komponen (rendemen 1,5 dan upah tukang di dalam, tanpa processing)', 'kayu', 'm3', 20217982.66,
       'PLV rate card 29 Sep 2026: meranti kering gergajian 8,5 jt (harga BOM STMV, status CONFIRM) × 1,5 + 7.467.983 per m³ komponen. Dasar: m³ komponen.'),
  (12, 'Sekrup, paku, dowel, lem — per m³ kayu solid komponen (PLV)', 'material', 'm3', 1750614.251,
       'PLV rule T3: ledger STMV 57 jt ÷ 32,56 m³ komponen kayu solid. Baris turunan: Σ m³ kayu solid × rate; bukan per pcs. Status CONFIRM (OPEN_ITEMS 7).'),
  (13, 'Bahan finishing Zhanchen + thinner — per m² terekspos (PLV)', 'finishing', 'm2', 38844.56417,
       'PLV rule F2: (Zhanchen all-in 52.888.326 + thinner 31.249.000) ÷ 2.166 m² terekspos STMV. m² = muka terbesar tiap komponen terekspos (satu muka; seluruh muka = OPEN_ITEMS 2). Bertabrakan dengan norma Total finishing material NC all-in 96.300/m² (156,5 jt ÷ 1.624 m²).'),
  (14, 'Bahan amplas — per m² terekspos (PLV)', 'finishing', 'm2', 12794.55217,
       'PLV rule F2: abrasives 27.713.000 ÷ 2.166 m². Bersama bahan finishing = 51.640/m² bahan.'),
  (15, 'Upah amplas — per m² terekspos (PLV)', 'labour', 'm2', 39477.20413,
       'PLV rule F2: payroll sanding Mar–Sep 131.550.191 × 65 % (35 % dibuang: bleach re-sanding, packing) ÷ 2.166 m². Baris labour per m² terekspos, bukan per jam.'),
  (16, 'Upah finishing — per m² terekspos (PLV)', 'labour', 'm2', 88754.97276,
       'PLV rule F2: payroll finishing, PU, gerinda, helper 192.243.271 ÷ 2.166 m². Empat rate finishing PLV berjumlah 179.871/m² (kartu 29 Sep). Bertabrakan dengan norma Finishing throughput (12.500/m², industri).'),
  (17, 'Karton + consumables packing — per m² karton 6 sisi (PLV)', 'packing', 'm2', 42000,
       'PLV rule K2: karton = ukuran barang + 40 mm per sisi (CARTON_ADD); m² 6 sisi × rate. Di bawah 0,15 m² pakai karton grup A.'),
  (18, 'Upah packing — per m³ karton (PLV)', 'packing', 'm3', 100000,
       'PLV rule K2: 6 orang × 8 hari per kontainer. Status CONFIRM.'),
  (19, 'Karton grup A, di bawah 0,15 m² (PLV)', 'packing', 'pcs', 24000,
       'PLV rule K2: harga satu karton kecil, dipakai bila m² karton < CARTON_MIN_M2.'),
  (20, 'Plywood raw 3 mm, lembar 2440 × 1220 — Mojo Indah Sep 2026 (PLV)', 'material', 'lembar', 77500,
       'PLV rate card PANEL_SHEETS, kolom raw board: daftar harga Mojo Indah Sep 2026. Baris panel: lembar dari nesting (SHEET 2440 × 1220, kerf 5 mm) atau SHEETS manual.'),
  (21, 'Plywood raw 6 mm, lembar 2440 × 1220 — Mojo Indah Sep 2026 (PLV)', 'material', 'lembar', 115000,
       'PLV rate card PANEL_SHEETS: daftar harga Mojo Indah Sep 2026.'),
  (22, 'Plywood raw 9 mm, lembar 2440 × 1220 — Mojo Indah Sep 2026 (PLV)', 'material', 'lembar', 172500,
       'PLV rate card PANEL_SHEETS: daftar harga Mojo Indah Sep 2026.'),
  (23, 'Plywood raw 12 mm, lembar 2440 × 1220 — Mojo Indah Sep 2026 (PLV)', 'material', 'lembar', 215000,
       'PLV rate card PANEL_SHEETS: daftar harga Mojo Indah Sep 2026.'),
  (24, 'Plywood raw 15 mm, lembar 2440 × 1220 — Mojo Indah Sep 2026 (PLV)', 'material', 'lembar', 260000,
       'PLV rate card PANEL_SHEETS: daftar harga Mojo Indah Sep 2026.'),
  (25, 'Plywood raw 18 mm, lembar 2440 × 1220 — Mojo Indah Sep 2026 (PLV)', 'material', 'lembar', 295000,
       'PLV rate card PANEL_SHEETS: daftar harga Mojo Indah Sep 2026. Riwayat nota OPS: palm UTY 250.000, semi meranti 227.000.'),
  (26, 'Plywood raw 24 mm, lembar 2440 × 1220 — Mojo Indah Sep 2026 (PLV)', 'material', 'lembar', 375000,
       'PLV rate card PANEL_SHEETS: ekstrapolasi, status CONFIRM.')
)
insert into ops_prod.bom_rates (code, name, rate_group, uom, unit_rate, item_code, note, active)
select 'RT-' || lpad((b.n + row_number() over (order by p.ord))::text, 4, '0'),
       p.name, p.rate_group, p.uom, p.unit_rate, null, p.note, true
from plv p
cross join (select coalesce(max(substring(code from 4)::int), 0) as n from ops_prod.bom_rates) b
where not exists (select 1 from ops_prod.bom_rates x
                   where lower(btrim(x.name)) = lower(btrim(p.name)) and x.active);

-- ── 2. the bought-timber rates say which yield is still owed ──────────────
update ops_prod.bom_rates
   set note = concat_ws(' ', note,
         'Dasar: per m³ balok / siap potong yang dibeli, bukan per m³ komponen — rendemen balok→komponen (80 %, × 1,25) dan upah tukang masih harus ditambahkan (D355).'),
       updated_at = now()
 where active and coalesce(note, '') not like '%Dasar:%'
   and (name like 'Kayu jati kelas A%' or name like 'Kayu jati kelas B%' or name like 'Kayu mindi siap potong%');

update ops_prod.bom_rates
   set note = concat_ws(' ', note,
         'Dasar: per m³ log yang dibeli, bukan per m³ komponen — rendemen log→komponen (tier 1,5–4,6, atau 55 % × 80 %), processing dan upah tukang masih harus ditambahkan (D355).'),
       updated_at = now()
 where active and coalesce(note, '') not like '%Dasar:%'
   and (name like 'Kayu jati glondong%' or name like 'Kayu mindi log%');

-- ── 3. the card's rules and inputs, as norms ──────────────────────────────
insert into ops_prod.bom_norms (category, norm, value, unit, basis, remarks, source_kind, effective_on) values
  ('PLV', 'TIER_A_MIN_LEN',      1000,   'mm',  'Rule T1 (PLV rate card 29 Sep 2026)',
     'Komponen terekspos lurus dengan sisi terpanjang ≥ ini → tier A (kecuali aturan 40 × 40).', 'decision', '2026-09-29'),
  ('PLV', 'TIER_D_MAX_VOL',      0.0005, 'm3',  'Rule T1',
     'Volume < ini dan sisi terpanjang < TIER_D_MAX_LEN → tier D.', 'decision', '2026-09-29'),
  ('PLV', 'TIER_D_MAX_LEN',      300,    'mm',  'Rule T1',
     'Bersama TIER_D_MAX_VOL menentukan tier D.', 'decision', '2026-09-29'),
  ('PLV', 'NARROW_MAX_SECTION',  40,     'mm',  'Rule T1 revisi 30 Sep 2026',
     'Penampang (median dari L, W, T) ≤ ini dan panjang ≤ NARROW_MAX_LEN → tier B walau ≥ 1000 mm.', 'decision', '2026-09-30'),
  ('PLV', 'NARROW_MAX_LEN',      1500,   'mm',  'Rule T1 revisi 30 Sep 2026',
     'Batas panjang aturan 40 × 40.', 'decision', '2026-09-30'),
  ('PLV', 'SHEET_L',             2440,   'mm',  'Rule P3',
     'Panjang lembar plywood untuk nesting.', 'decision', '2026-09-29'),
  ('PLV', 'SHEET_W',             1220,   'mm',  'Rule P3',
     'Lebar lembar plywood untuk nesting.', 'decision', '2026-09-29'),
  ('PLV', 'SHEET_KERF',          5,      'mm',  'Rule P3',
     'Lebar potong gergaji, ditambahkan ke tiap sisi potongan saat menghitung potongan per lembar.', 'decision', '2026-09-29'),
  ('PLV', 'OFFCUT_REUSE_MIN',    25,     '%',   'Rule P3 (kode PLV: WASTE_REUSE_MIN)',
     'Bila sisa pada lembar terakhir melebihi ini, sisanya dihitung dapat dipakai ulang (lembar pecahan dibayar sebagian). Bukan susut baris.', 'decision', '2026-09-29'),
  ('PLV', 'OFFCUT_HANDLING',     5,      '%',   'Rule P3',
     'Faktor handling pada lembar pecahan yang sisanya dipakai ulang. Bukan susut baris.', 'decision', '2026-09-29'),
  ('PLV', 'CARTON_ADD',          40,     'mm',  'Rule K2',
     'Tambahan per sisi dari ukuran barang (atau kotak flatpack) ke ukuran karton.', 'decision', '2026-09-29'),
  ('PLV', 'CARTON_MIN_M2',       0.15,   'm2',  'Rule K2',
     'Karton di bawah ini memakai harga karton grup A (rate), bukan m² × rate karton.', 'decision', '2026-09-29'),
  ('PLV', 'KD_PACK_FACTOR',      0,      '%',   'Rule K2',
     'Consumables tambahan untuk flatpack 2+ kotak; 0 = mati.', 'decision', '2026-09-29'),
  ('PLV', 'USD_IDR',             16000,  'IDR/USD', 'REVISI BOM 21 MEI 26',
     'Kurs tersirat BOM lama (unit IDR ÷ unit USD). Hanya pembanding; quotation OPS dalam IDR (D164).', 'decision', '2026-09-29'),
  ('PLV', 'MISC_PCT',            5,      '%',   'Rule A1, keputusan 29 Sep',
     'Misc × direct cost. Sama dengan Factor | Kontingensi / miskalkulasi 5 %. Sampai Tahap 1: miscalc_percent 18,64 % = 1,05 × 1,1299 − 1 mewakili misc + overhead.', 'decision', '2026-09-29'),
  ('PLV', 'OH_PCT',              12.99286985, '%', 'Rule A2 (OPEN_ITEMS 8)',
     'Overhead × (direct + misc) = (payroll overhead 213.627.079 + utilitas 144.633.030 − upgrade PLN 49.700.000) ÷ direct STMV 2.374.841.837. Bertabrakan dengan Overhead pabrik 17 % (410 jt ÷ 2,37 M; pembilang berbeda). Owner memilih (Q-D355a).', 'empirical', '2026-09-29'),
  ('PLV', 'LOG_PER_COMPONENT_A', 3.5,    'x',   'Rule T2 — faktor m³ log per m³ komponen, tier A (kode PLV: yield_A)',
     'Judgement (OPEN_ITEMS 4). Sudah di dalam rate tier; dipakai lagi hanya untuk mengubah m³ komponen → m³ beli saat PR.', 'decision', '2026-09-29'),
  ('PLV', 'LOG_PER_COMPONENT_A_CURVED', 4.6, 'x', 'Rule T2 — tier A-curved / papan lebar (kode PLV: yield_AC)',
     'Dari mindi STMV. Sudah di dalam rate tier.', 'empirical', '2026-09-29'),
  ('PLV', 'LOG_PER_COMPONENT_B', 2.5,    'x',   'Rule T2 — tier B (kode PLV: yield_B)',
     'Judgement (OPEN_ITEMS 4). Sudah di dalam rate tier.', 'decision', '2026-09-29'),
  ('PLV', 'LOG_PER_COMPONENT_C', 2.0,    'x',   'Rule T2 — tier C (kode PLV: yield_C)',
     'Dari jati STMV. Sudah di dalam rate tier.', 'empirical', '2026-09-29'),
  ('PLV', 'LOG_PER_COMPONENT_D', 1.5,    'x',   'Rule T2 — tier D (kode PLV: yield_D)',
     'Judgement (OPEN_ITEMS 4). Sudah di dalam rate tier.', 'decision', '2026-09-29'),
  ('PLV', 'SAWN_PER_COMPONENT_MERANTI', 1.5, 'x', 'Rule T2 — meranti gergajian → komponen (kode PLV: yield_MER)',
     'Asumsi. Sudah di dalam rate meranti.', 'decision', '2026-09-29'),
  ('PLV', 'LOG_TEAK_IMPLIED',    10900000, 'IDR/m3', 'Rate card INPUTS: ledger 152,3 jt ÷ 14 m³',
     'Status CONFIRM — ganti dengan harga nota. Pembanding OPS: RT-0004 jati glondong 4,5 jt (nota 2025). Masukan rate tier jati.', 'empirical', '2026-09-29'),
  ('PLV', 'LOG_MINDI_IMPLIED',   3100000,  'IDR/m3', 'Rate card INPUTS: ledger 126,1 jt ÷ 41 m³',
     'Status CONFIRM. Pembanding OPS: RT-0005 3,0 jt, RT-0006 2,7 jt. Masukan rate tier mindi.', 'empirical', '2026-09-29'),
  ('PLV', 'MERANTI_SAWN',        8500000,  'IDR/m3', 'Rate card INPUTS: harga BOM STMV',
     'Status CONFIRM. Masukan rate meranti.', 'decision', '2026-09-29'),
  ('PLV', 'PROCESSING_PER_M3_LOG', 598978, 'IDR/m3', 'Rate card INPUTS: kiln + sawmill + angkut + staf sawmill ÷ 75,82 m³ log jati dan mindi (ledger)',
     'Masukan rate tier. Bertabrakan dengan Wood | Kiln drying + sawmill + handling add-on 700.000 dan RT-0009 + RT-0010 + RT-0011 = 765.000 (tarif vendor).', 'empirical', '2026-09-29'),
  ('PLV', 'CARPENTRY_LABOUR_PER_M3', 7467982.657, 'IDR/m3', 'Rate card TIER_CALC (kode PLV: LAB_CARP): payroll tukang 270.175.017 × (1 − 10 % pemotongan panel) ÷ 32,56 m³ komponen STMV',
     'Sudah di dalam setiap rate tier — jangan ditambahkan sebagai baris labour pada produk yang memakai rate tier. Pembanding: RT-0071 tukang kayu 20.300/jam.', 'empirical', '2026-09-29')
on conflict (category, norm) do update
  set value = excluded.value, unit = excluded.unit, basis = excluded.basis,
      remarks = excluded.remarks, source_kind = excluded.source_kind, effective_on = excluded.effective_on;

-- ── 4. the norms the card contradicts say so ──────────────────────────────
update ops_prod.bom_norms
   set remarks = concat_ws(' ', remarks, 'Bertabrakan dengan PLV | OH_PCT 13,0 % × (direct + misc): pembilang berbeda (payroll tak langsung masuk, mesin/kendaraan/logistik/gedung keluar). Belum diputuskan owner (Q-D355a).')
 where category in ('Factor', 'Overhead') and norm in ('Overhead pabrik', 'Factory overhead on direct cost')
   and coalesce(remarks, '') not like '%PLV%';

update ops_prod.bom_norms
   set remarks = concat_ws(' ', remarks, 'Bertabrakan dengan rate PLV bahan finishing + amplas 51.640/m² (111,9 jt ÷ 2.166 m²; tanpa WA-250 dan dempul, penyebut berbeda). Belum diputuskan owner (Q-D355a).')
 where category = 'Finishing' and norm = 'Total finishing material (NC natural, all-in)'
   and coalesce(remarks, '') not like '%PLV%';

update ops_prod.bom_norms
   set remarks = concat_ws(' ', remarks, 'Bertabrakan dengan rate PLV upah finishing 88.755 + upah amplas 39.477 per m² (payroll aktual ÷ 2.166 m²). Belum diputuskan owner (Q-D355a).')
 where category = 'Labour' and norm = 'Finishing throughput'
   and coalesce(remarks, '') not like '%PLV%';

update ops_prod.bom_norms
   set remarks = concat_ws(' ', remarks, 'PLV: 598.978 per m³ log (ledger ÷ 75,82 m³), lihat PLV | PROCESSING_PER_M3_LOG.')
 where category = 'Wood' and norm = 'Kiln drying + sawmill + handling add-on'
   and coalesce(remarks, '') not like '%PLV%';

analyze ops_prod.bom_rates;
analyze ops_prod.bom_norms;
