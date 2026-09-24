#!/usr/bin/env node
/** Build the user SOP for a module — HTML, then PDF — from John Lau's own
 *  process knowledge.
 *
 *  ## One source, two readers
 *
 *  The SOP a person prints and the answers John Lau's model gives are read
 *  from the **same rows**: `ops_asst.processes`, `process_steps`,
 *  `process_faq` (0136). Writing the SOP by hand beside them would be two
 *  statements of how the PO screen works, and the first time somebody fixed
 *  one the other would be wrong with nobody noticing. So a step is changed by
 *  a migration, and both the PDF and the model follow.
 *
 *  The *Temuan* section is the FAQ rows marked *(sementara)* — the steps the
 *  simulation found broken — so the document says honestly where the system
 *  does not yet do what the step says, for exactly as long as it does not.
 *
 *    supabase/local/rebuild.sh
 *    PGHOST=/tmp PGPORT=5433 node scripts/sop/build-sop.mjs procurement
 *
 *  Needs a database with the ladder applied (like the other check scripts)
 *  and a Chromium for the PDF (`CHROME`, or the pre-installed Playwright
 *  browser). Writes `docs/sop/<module>/sop.html` and `sop.pdf`.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname, resolve } from "node:path";

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "../..");
const MODULE = process.argv[2] ?? "procurement";
const DIR = join(ROOT, "docs/sop", MODULE);

function q(sql) {
  return execFileSync("psql", ["-tAc", sql], {
    encoding: "utf8",
    env: { ...process.env, PGDATABASE: process.env.PGDATABASE ?? "postgres", PGUSER: process.env.PGUSER ?? "postgres" },
  });
}
const json = (sql) => JSON.parse(q(`select coalesce(json_agg(x), '[]') from (${sql}) x`).trim());

/* The processes whose SOP folder is this module's — procurement's walk runs
   on into the ledger, and the ledger steps belong in the same document. */
const processes = json(`select * from ops_asst.processes where sop_ref like '${MODULE}/%' order by seq`);
const keys = processes.map((p) => `'${p.key}'`).join(",") || "''";
const steps = json(`select * from ops_asst.process_steps where process_key in (${keys}) order by process_key, seq`);
const faq = json(`select * from ops_asst.process_faq where process_key in (${keys}) order by id`);

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const quoteButtons = (s) => esc(s).replace(/&quot;|"([^"]+)"/g, (m, t) => (t ? `<b class="btn">${t}</b>` : m));
const img = (file) => {
  if (!file) return "";
  const name = file.split("/").pop();
  return existsSync(join(DIR, name)) ? `<figure><img src="${name}" alt=""></figure>` : "";
};

const today = new Date().toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });

/* The live walk, when one has been recorded (`scripts/e2e/walk-procurement.mjs`).
 * Its screenshots are the real screens against the real database, so they are
 * preferred over the demo's: a step whose button the walk pressed shows the
 * walk's picture of pressing it. */
const WALK = join(DIR, "walk.json");
const walk = existsSync(WALK) ? JSON.parse(readFileSync(WALK, "utf8")) : null;
function walkShot(processKey, action) {
  if (!walk) return null;
  const a = action.toLowerCase();
  const hit = walk.steps.find((w) => w.ok && w.shot && w.process === processKey && w.button
    && a.includes(w.button.toLowerCase().split(" rp")[0].replace("…", "").trim()));
  return hit?.shot ?? null;
}
const walkedIn = (key) => walk ? walk.steps.filter((w) => w.process === key && w.ok).length : 0;
const temuan = faq.filter((f) => f.question.includes("(sementara)"));

/* What differs between modules' documents: the cover and the paragraphs
   before the first process. Everything after that comes from the rows. */
const TEXT = {
  procurement: {
    title: "Procurement sampai buku besar",
    lede: "Cara memakai sistem, langkah demi langkah, dari menambah supplier sampai mencocokkan rekening koran.",
    intro: [
      `<p><b>Siapa mengerjakan apa.</b> Staf procurement membuat PR, PO dan mencatat barang datang. Pimpinan (pemegang <code>approve_goods</code>) menyetujui barang dan mengonfirmasi PO. Keuangan (pemegang <code>post_ledger</code>) mencatat pembayaran ke buku besar, memverifikasi bukti, dan mencocokkan rekening koran. Tombol yang bukan bagian Anda tetap terlihat, tapi sistem akan menolak dengan alasan yang jelas.</p>`,
      `<p><b>Satuan kerjanya adalah baris.</b> Satu PR bisa berisi banyak baris, dan tiap baris disetujui, dibayar dan diterima sendiri-sendiri. Status baris dihitung sistem, tidak pernah diketik.</p>`,
    ],
    ask: `Tanyakan "bagaimana cara membuat PO?" atau "saya sudah submit PR, terus apa?".`,
    drafts: `<p><b>Minta John Lau menyiapkan pekerjaan.</b> Ketik "siapkan PR untuk lem kayu 5 kaleng" atau "buat PO untuk KSA binder 5 liter". John Lau menyiapkan <b>draft</b> — untuk PO, diisi dari baris PR yang sudah disetujui — dan tidak ada yang tersimpan sampai Anda memeriksa isinya dan menekan <b class="btn">Ya, tulis</b>. PO dari staf langsung diminta konfirmasinya ke pimpinan, sama seperti dari layar.</p>`,
    figures: ["11-john-lau-po.jpg", "10-john-lau.jpg"],
  },
  hr: {
    title: "HR sampai gajian dibayar",
    lede: "Cara memakai sistem HR, langkah demi langkah: karyawan baru, berkas 201, kontrak, absensi dari mesin, cuti, run gaji, persetujuan pimpinan, sampai gaji dibayar dan tercatat di buku besar.",
    intro: [
      `<p><b>Siapa mengerjakan apa.</b> Staf HRD (akses <code>hrd</code> dan <code>payroll</code>) mencatat karyawan, berkas, kontrak, absensi, cuti, dan menyiapkan run gaji. Pimpinan (pemegang <code>approve_funds</code>) menyetujui run gaji — yang menyiapkan tidak bisa menyetujui. Keuangan (pemegang <code>post_ledger</code>) membayar run yang sudah disetujui dan mencatatnya ke buku besar. Aturan gaji dan pola jadwal dipegang IT.</p>`,
      `<p><b>Gaji dihitung dari hari.</b> Tidak ada tombol hitung: setiap kali halaman run dibuka, gaji dihitung ulang dari absensi, tanda hari, cuti dan lembur yang disetujui. Karena itu run tidak bisa disetujui selama masih ada hari yang "belum dibaca".</p>`,
    ],
    ask: `Tanyakan "kenapa run gaji tidak bisa disetujui?" atau "bagaimana cara mencatat karyawan sakit?".`,
    drafts: `<p><b>Minta John Lau menyiapkan pengajuan cuti.</b> Ketik "ajukan cuti untuk Wulan 2 sampai 3 Oktober, acara keluarga". John Lau menyiapkan <b>draft</b> pengajuan, dan tidak ada yang tersimpan sampai Anda memeriksanya dan menekan <b class="btn">Ya, tulis</b>. Gaji, absensi dan berkas 201 seseorang <b>tidak</b> dibacakan John Lau — angkanya dibaca di layar HRD oleh yang berhak.</p>`,
    figures: ["11-john-lau-cuti.jpg"],
  },
  produksi: {
    title: "Produksi sampai serah terima",
    lede: "Cara memakai sistem produksi, langkah demi langkah: klien dan proyek, produk dan BOM, quotation, Job Order, bahan dari BOM, progres dan vendor, peti, surat jalan, pemasangan, sampai BAST ditandatangani.",
    intro: [
      `<p><b>Siapa mengerjakan apa.</b> Sales/PM (akses <code>project</code>) mencatat klien, proyek, quotation dan serah terima. PPIC/mandor (akses <code>production</code>, dan <code>procurement</code> untuk PR) membuat produk dan BOM, Job Order, mencatat progres dan vendor. Tim pengiriman (akses <code>delivery</code>) mengemas peti, membuat surat jalan, mencatat sampai dan pemasangan. BAST hanya dicatat oleh yang memegang wewenang serah terima proyek.</p>`,
      `<p><b>Status proyek bergerak sendiri.</b> INQUIRY → QUOTATION_SENT (quotation dikirim) → DEAL (disetujui) → IN_PRODUCTION (Job Order pertama) → SHIPPED (surat jalan pertama) → DONE (BAST). Surat jalan hanya boleh berisi yang sudah selesai dibuat, jadi Job Order dibuat dari baris order dan semua tahapnya dicatat.</p>`,
    ],
    ask: `Tanyakan "SPK mana yang terlambat?", "sudah sampai mana pengiriman ke klien?" atau "kenapa surat jalan saya ditolak?".`,
    drafts: `<p><b>Angka dibaca dari layarnya.</b> John Lau menjawab Job Order yang lewat tanggal dan progres pengiriman per proyek langsung dari data yang sama dengan layar Produksi dan Serah terima, sesuai akses Anda.</p>`,
    figures: [],
  },
};
const T = TEXT[MODULE] ?? TEXT.procurement;

const toc = processes.map((p, i) => `<li><span>${i + 1}.</span> ${esc(p.title)}</li>`).join("");

const body = processes.map((p, i) => {
  const ss = steps.filter((s) => s.process_key === p.key);
  const qs = faq.filter((f) => f.process_key === p.key && !f.question.includes("(sementara)"));
  const next = processes.find((x) => x.follows === p.key);
  return `
  <section class="proc">
    <header>
      <div class="num">${i + 1}</div>
      <div>
        <h2>${esc(p.title)}</h2>
        <p class="meta">Layar: <code>${esc(p.route)}</code>${p.permission ? ` · Butuh: <code>${esc(p.permission)}</code>` : ""}${walkedIn(p.key) ? ` · <span class="proof">diuji lewat layar live: ${walkedIn(p.key)} langkah</span>` : ""}</p>
      </div>
    </header>
    <p class="purpose">${esc(p.purpose)}</p>
    <ol class="steps">
      ${ss.map((s) => `
      <li>
        <div class="act">${quoteButtons(s.action)}</div>
        ${s.rule ? `<div class="rule"><b>Kenapa:</b> ${esc(s.rule)}</div>` : ""}
        ${s.status_before || s.status_after ? `<div class="status">${esc(s.status_before ?? "—")} <span>→</span> ${esc(s.status_after ?? "—")}</div>` : ""}
        ${img(walkShot(p.key, s.action) ?? s.screenshot)}
      </li>`).join("")}
    </ol>
    ${qs.length ? `<div class="faq"><h3>Tanya-jawab</h3>${qs.map((f) => `<p><b>${esc(f.question)}</b><br>${esc(f.answer)}</p>`).join("")}</div>` : ""}
    ${next ? `<p class="next">Berikutnya: <b>${esc(next.title)}</b></p>` : ""}
  </section>`;
}).join("");

const html = `<!doctype html>
<html lang="id"><head><meta charset="utf-8">
<title>SOP ${esc(MODULE)} — Tala Living</title>
<style>
  @page { size: A4; margin: 16mm 14mm 18mm; }
  :root { --brand: #2f6b52; --ink: #1e293b; --muted: #64748b; --line: #e2e8f0; --warn: #b45309; }
  * { box-sizing: border-box; }
  body { font-family: "Segoe UI", system-ui, -apple-system, sans-serif; color: var(--ink); font-size: 10.5pt; line-height: 1.5; margin: 0; background: #fff; }
  .cover { height: 250mm; display: flex; flex-direction: column; justify-content: center; page-break-after: always; }
  .cover .kicker { color: var(--brand); font-weight: 700; letter-spacing: .12em; font-size: 10pt; text-transform: uppercase; }
  .cover h1 { font-size: 30pt; margin: 6mm 0 3mm; line-height: 1.15; }
  .cover p { color: var(--muted); max-width: 140mm; }
  .cover ol { list-style: none; padding: 0; margin-top: 10mm; columns: 2; }
  .cover ol li { padding: 1.5mm 0; border-bottom: 1px solid var(--line); break-inside: avoid; }
  .cover ol span { color: var(--brand); font-weight: 700; display: inline-block; width: 7mm; }
  .intro { page-break-after: always; }
  h2 { margin: 0; font-size: 16pt; }
  h3 { font-size: 11pt; margin: 0 0 2mm; }
  .proc { page-break-before: always; }
  .proc header { display: flex; gap: 4mm; align-items: center; border-bottom: 2px solid var(--brand); padding-bottom: 3mm; margin-bottom: 3mm; }
  .num { background: var(--brand); color: #fff; width: 11mm; height: 11mm; border-radius: 50%; display: grid; place-items: center; font-weight: 700; font-size: 13pt; flex: none; }
  .meta { margin: 1mm 0 0; color: var(--muted); font-size: 9pt; }
  code { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 8.8pt; background: #f1f5f9; padding: 0 1.2mm; border-radius: 1mm; }
  .purpose { background: #f0f7f3; border-left: 3px solid var(--brand); padding: 2.5mm 3.5mm; margin: 0 0 4mm; }
  .steps { padding-left: 6mm; margin: 0; }
  .steps > li { margin: 0 0 4mm; padding-left: 1mm; }
  .steps > li::marker { color: var(--brand); font-weight: 700; }
  .act { font-weight: 600; }
  .btn { background: #e8f1ec; color: var(--brand); border: 1px solid #b9d5c6; border-radius: 1.2mm; padding: 0 1.4mm; font-weight: 700; white-space: nowrap; }
  .rule { color: #334155; font-size: 9.5pt; margin-top: 1mm; }
  .status { display: inline-block; margin-top: 1.2mm; font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 8.5pt; background: #f8fafc; border: 1px solid var(--line); border-radius: 1mm; padding: .4mm 2mm; }
  .status span { color: var(--brand); font-weight: 700; }
  figure { margin: 2.5mm 0 0; break-inside: avoid; }
  figure img { width: 100%; border: 1px solid var(--line); border-radius: 1.5mm; }
  .faq { margin-top: 4mm; border-top: 1px solid var(--line); padding-top: 3mm; font-size: 9.5pt; break-inside: avoid; }
  .faq p { margin: 0 0 2mm; }
  .next { color: var(--muted); font-size: 9.5pt; border-top: 1px dashed var(--line); padding-top: 2mm; }
  .temuan { page-break-before: always; }
  .temuan li { margin-bottom: 3mm; }
  .temuan li b { color: var(--warn); }
  .note { color: var(--muted); font-size: 9pt; }
  .proof { color: var(--brand); font-weight: 600; }
</style></head>
<body>
  <div class="cover">
    <div class="kicker">SOP · OPS TALALIVING</div>
    <h1>${esc(T.title)}</h1>
    <p>${esc(T.lede)} Setiap langkah di dokumen ini sudah dijalankan dalam simulasi terhadap database yang sama dengan sistem live.</p>
    <p class="note">Versi ${esc(today)} · dibuat otomatis dari tabel pengetahuan John Lau (<code>ops_asst.processes</code>).${walk
      ? ` Gambar diambil dari uji jalan lewat layar live (${walk.steps.filter((w) => w.ok).length} langkah, ${esc(walk.at.slice(0, 10))}) dengan data uji; yang tidak ada di uji jalan diambil dari mode demo.`
      : " Gambar diambil dari mode demo, jadi angkanya contoh."}</p>
    <ol>${toc}</ol>
  </div>

  <section class="intro">
    <h2>Sebelum mulai</h2>
    ${T.intro.join("\n    ")}
    <p><b>Tanya John Lau kapan saja.</b> Tombol <b class="btn">John Lau</b> ada di pojok kanan bawah setiap halaman. ${esc(T.ask)} Panduannya tetap terbuka saat Anda pindah halaman, dan langkah yang sesuai dengan halaman yang sedang dibuka ditandai <b class="btn">you are here</b>. Percakapan tersimpan, jadi tidak hilang walaupun halaman di-refresh.</p>
    ${T.drafts}
    ${T.figures.filter((f) => existsSync(join(DIR, f))).map((f) => `<figure><img src="${f}" alt=""></figure>`).join("\n    ")}
  </section>

  ${body}

  ${temuan.length ? `<section class="temuan">
    <h2>Temuan simulasi — yang belum berjalan sesuai SOP</h2>
    <p>Simulasi menemukan langkah-langkah berikut yang belum berjalan seperti yang ditulis di atas. Sudah dilaporkan ke IT; sampai diperbaiki, ikuti catatan di bawah.</p>
    <ol>${temuan.map((f) => `<li><b>${esc(f.question.replace(" (sementara)", ""))}</b><br>${esc(f.answer)}</li>`).join("")}</ol>
  </section>` : ""}
</body></html>`;

writeFileSync(join(DIR, "sop.html"), html);
console.log(`sop.html      ${processes.length} proses, ${steps.length} langkah, ${temuan.length} temuan`);

const chrome = process.env.CHROME ?? [
  "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  "/usr/bin/chromium", "/usr/bin/google-chrome",
].find((p) => existsSync(p));
if (!chrome) {
  console.log("sop.pdf       skipped — set CHROME to a Chromium to print it");
  process.exit(0);
}
execFileSync(chrome, [
  "--headless", "--no-sandbox", "--disable-gpu", "--no-pdf-header-footer",
  `--print-to-pdf=${join(DIR, "sop.pdf")}`, `file://${join(DIR, "sop.html")}`,
], { stdio: "ignore" });
console.log(`sop.pdf       ${(readFileSync(join(DIR, "sop.pdf")).length / 1024 / 1024).toFixed(1)} MB`);
