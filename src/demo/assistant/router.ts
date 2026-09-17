/** Turning a sentence into a tool name.
 *
 *  **This is the part that is not real yet, and the screen says so.** In Phase
 *  2 a language model reads the prompt and picks from `TOOLS`; here a keyword
 *  matcher does it. The swap changes this file and nothing else, which is the
 *  whole reason the catalogue, the permission checks and the confirmation step
 *  live somewhere else (D221).
 *
 *  What matters is that the matcher is **allowed to fail**. A router that
 *  always finds something is a router that answers the wrong question
 *  confidently, and every hour of this project has been spent refusing that.
 *  No match means *saya tidak mengerti*, with the list of what it can do.
 */

export interface Match {
  tool: string;
  /** What it thinks was asked, echoed back so a wrong reading is visible
   *  before anybody acts on it. */
  understood_as: string;
  args: Record<string, string>;
}

interface Rule {
  tool: string;
  /** All of these must appear for the rule to fire. */
  all?: string[];
  /** At least one of these. */
  any: string[];
  /** None of these, for rules that would otherwise overlap. */
  not?: string[];
  understood: string;
}

/* Order matters: the first rule that fires wins, so the blocked ones are
   listed first. Somebody asking for a salary must be told it is refused, not
   quietly matched to something adjacent that happens to be allowed. */
const RULES: Rule[] = [
  { tool: "hr.employee_files", any: ["ktp", "berkas 201", "kartu keluarga", "npwp", "bpjs", "nomor identitas", "berkas karyawan", "employee file", "id card", "id number", "family card"], understood: "membaca berkas kepegawaian" },
  { tool: "hr.payroll", any: ["gaji", "slip gaji", "payroll", "upah", "thr", "lembur dibayar", "salary", "payslip", "wage", "take home"], understood: "membaca data gaji" },
  /* `terlambat` belongs to two worlds — a person arriving late and a work
     order past its date — and the blocked rules run first, so an unguarded
     keyword here turns *SPK apa yang terlambat* into an accusation that
     somebody was reading staff records (F64). A false refusal is the most
     expensive mistake this router can make, so the **blocked rules carry the
     guards**, not the open ones. */
  { tool: "hr.attendance",
    any: ["absensi", "kehadiran", "jam masuk", "terlambat", "telat", "attendance", "clock in", "late"],
    not: ["spk", "produksi", "order", "proyek", "kirim", "pengiriman", "bayar", "po ", "vendor", "work order", "production", "delivery", "project"],
    understood: "membaca data kehadiran" },
  { tool: "it.audit", any: ["audit", "log aktivitas", "activity log", "siapa membuka", "siapa mengubah", "who opened", "who changed", "hak akses", "peran", "pengguna sistem", "permission", "role", "system user"], understood: "membaca modul IT" },
  { tool: "it.settings_write", any: ["ubah pengaturan", "ganti pengaturan", "setel ulang", "ubah zona waktu", "ubah toleransi", "change setting", "change the setting", "set timezone", "change tolerance"], understood: "mengubah pengaturan" },

  /* Guidance before reading: "cara bikin PO" is a how, not a how-many. */
  { tool: "guide.create_po", all: [], any: ["cara", "bagaimana", "gimana", "sop", "langkah"], not: [], understood: "menjelaskan cara membuat purchase order" },

  /* Writing. Checked before the read rules so "buatkan PO" is not read as
     "berapa PO". */
  { tool: "procurement.draft_po", any: ["buatkan po", "buat po", "bikin po", "po baru", "order ke vendor", "create a po", "create po", "new po", "raise a po", "order from vendor"], understood: "menyiapkan purchase order baru" },
  { tool: "procurement.draft_pr_line", any: ["minta beli", "permintaan pembelian", "request beli", "ajukan pembelian", "pr baru", "purchase request", "request to buy", "new request line"], understood: "menyiapkan baris permintaan pembelian" },

  /* Reading. */
  { tool: "procurement.pending_approvals", any: ["menunggu persetujuan", "belum disetujui", "perlu approve", "antrian approval", "rapat", "belum di-approve", "waiting for approval", "pending approval", "not approved", "approval queue"], understood: "melihat baris yang menunggu persetujuan" },
  { tool: "procurement.vendor_debt", any: ["hutang", "utang", "belum dibayar", "tagihan vendor", "sisa bayar", "owe", "outstanding", "unpaid", "vendor debt"], understood: "melihat kewajiban ke vendor" },
  { tool: "accounting.balances", any: ["saldo", "kas", "rekening", "uang kita", "duit", "balance", "account balance", "cash we have", "how much money"], understood: "melihat saldo rekening" },
  { tool: "inventory.low_stock", any: ["menipis", "stok minimum", "hampir habis", "stok kurang", "restock", "di bawah minimum", "below minimum", "running low", "low stock", "need reorder"], understood: "melihat barang di bawah minimum" },
  { tool: "production.late_orders",
    all: ["spk"], any: ["telat", "terlambat", "molor", "lewat", "late", "overdue", "past due"],
    understood: "melihat SPK yang lewat tanggal" },
  { tool: "production.late_orders",
    all: ["produksi"], any: ["telat", "terlambat", "molor", "lewat", "late", "overdue"],
    understood: "melihat SPK yang lewat tanggal" },
  { tool: "production.late_orders",
    all: ["work order"], any: ["late", "overdue", "past due", "behind"],
    understood: "melihat SPK yang lewat tanggal" },
  { tool: "delivery.fulfilment", any: ["sudah dikirim", "sampai mana", "progres proyek", "terpasang", "serah terima", "how far", "delivered", "installed", "handover", "project progress"], understood: "melihat sejauh mana pesanan klien sampai" },
];

/** Which guide a "cara …" question is about. */
const GUIDES: { tool: string; any: string[]; understood: string }[] = [
  { tool: "guide.create_po", any: ["po", "purchase order", "order"], understood: "menjelaskan cara membuat purchase order" },
  { tool: "guide.receive_goods", any: ["barang datang", "terima barang", "penerimaan", "surat jalan", "goods arriv", "receive goods", "receiving", "delivery note"], understood: "menjelaskan cara mencatat barang datang" },
  { tool: "guide.pay_line", any: ["bayar", "pembayaran", "melunasi", "pay a line", "pay the line", "payment"], understood: "menjelaskan cara membayar baris permintaan" },
];

const HOW = ["cara", "bagaimana", "gimana", "sop", "langkah", "caranya", "how do i", "how to", "how can i", "steps"];

/** Lowercase, strip punctuation, and drop the possessive `-nya`.
 *
 *  Without this, *stoknya menipis* does not match the rule written as *stok
 *  menipis* — and the failure was found by the demo's own suggestion chip not
 *  working (F64). A matcher this literal is exactly what a language model
 *  replaces; until then it should at least survive the way people write.
 */
function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[?!.,;:]/g, " ")
    .replace(/\b(\w{3,})nya\b/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

export function route(prompt: string): Match | null {
  const p = normalise(prompt);

  /* A how-question first, because "cara bikin PO" contains "buat po" and would
     otherwise be read as an instruction to build one (F64). */
  if (HOW.some((h) => p.includes(h))) {
    for (const g of GUIDES) {
      if (g.any.some((k) => p.includes(k))) {
        return { tool: g.tool, understood_as: g.understood, args: {} };
      }
    }
  }

  for (const r of RULES) {
    if (r.tool.startsWith("guide.")) continue;
    if (r.not?.some((k) => p.includes(k))) continue;
    if (r.all?.length && !r.all.every((k) => p.includes(k))) continue;
    if (!r.any.some((k) => p.includes(k))) continue;
    return { tool: r.tool, understood_as: r.understood, args: extractArgs(p) };
  }
  return null;
}

/** The crumbs a keyword matcher can honestly pull out: a quantity, a vendor
 *  name in quotes, a project code. Everything else is left to the draft form,
 *  where a person fills it in and sees what they filled. */
function extractArgs(p: string): Record<string, string> {
  const args: Record<string, string> = {};
  const qty = /(\d+)\s*(lembar|pcs|batang|unit|set|box|dus|kg|m3|daun)\b/.exec(p);
  if (qty) { args.qty = qty[1]; args.uom = qty[2]; }
  const quoted = /["']([^"']{3,})["']/.exec(p);
  if (quoted) args.name = quoted[1];
  const project = /\b(25\d{3})\b/.exec(p);
  if (project) args.project_code = project[1];
  const vendor = /(?:ke|dari|vendor)\s+([a-z][a-z .]{3,30})/.exec(p);
  if (vendor && !args.name) args.name = vendor[1].trim();
  return args;
}
