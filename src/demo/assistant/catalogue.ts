/** Everything John Lau can be asked to do — and everything it cannot.
 *
 *  The blocked entries are **in this list on purpose** rather than absent from
 *  it. A capability that is missing produces *saya tidak mengerti*, which
 *  teaches the person to rephrase until something works. A capability that is
 *  present and refused produces *tidak bisa lewat prompt, dan ini alasannya* —
 *  which ends the conversation honestly and points at the screen where a human
 *  may look, with the look recorded (D218).
 *
 *  This file is the security boundary. Not a system prompt, not an instruction
 *  to a model: a list the executor reads. In Phase 2 a model chooses **from**
 *  this catalogue and still cannot reach past it, because the refusal is in the
 *  dispatcher rather than in the model's good intentions.
 */
import type { AssistantTool } from "@/services/assistant/contracts";
import type { Message, Lang } from "@/lib/i18n";

/** The catalogue holds **both languages**; the dispatcher resolves one before
 *  the tool leaves the service (D224). Resolving at the edge rather than in the
 *  screen means a Phase-2 HTTP client gets a finished sentence, and the
 *  language of a refusal is decided in the same place the refusal is. */
export interface ToolDef extends Omit<AssistantTool, "label" | "blocked_reason"> {
  label: Message;
  blocked_reason: Message | null;
}

export function resolveTool(t: ToolDef, lang: Lang): AssistantTool {
  return {
    ...t,
    label: t.label[lang],
    blocked_reason: t.blocked_reason ? t.blocked_reason[lang] : null,
  };
}

export const TOOLS: ToolDef[] = [
  /* ── Reading ──────────────────────────────────────────────────────── */
  {
    name: "procurement.pending_approvals", module: "procurement", level: "read",
    effect: "read", reach: "open",
    label: { en: "Request lines waiting for approval", id: "Baris permintaan yang menunggu persetujuan" },
    blocked_reason: null, instead_at: "/procurement/meeting",
  },
  {
    name: "procurement.vendor_debt", module: "procurement", level: "read",
    effect: "read", reach: "open",
    label: { en: "What we still owe a vendor", id: "Berapa yang masih kita hutang ke sebuah vendor" },
    blocked_reason: null, instead_at: "/procurement/tracker",
  },
  {
    name: "accounting.balances", module: "accounting", level: "read",
    effect: "read", reach: "open",
    label: { en: "Balance of each account", id: "Saldo tiap rekening" },
    blocked_reason: null, instead_at: "/accounting/ledger",
  },
  {
    name: "inventory.low_stock", module: "inventory", level: "read",
    effect: "read", reach: "open",
    label: { en: "Items already below their minimum", id: "Barang yang sudah di bawah stok minimum" },
    blocked_reason: null, instead_at: "/inventory/material",
  },
  {
    name: "production.late_orders", module: "production", level: "read",
    effect: "read", reach: "open",
    label: { en: "Work orders past their promised date", id: "SPK yang lewat tanggal janji" },
    blocked_reason: null, instead_at: "/produksi/jadwal",
  },
  {
    name: "delivery.fulfilment", module: "project", level: "read",
    effect: "read", reach: "open",
    label: { en: "How much of a client order has arrived and been fitted", id: "Sudah berapa banyak pesanan klien yang sampai dan terpasang" },
    blocked_reason: null, instead_at: "/proyek/serah-terima",
  },

  /* ── Guidance ─────────────────────────────────────────────────────── */
  {
    name: "guide.create_po", module: null, level: "read",
    effect: "guide", reach: "open",
    label: { en: "How to create a purchase order", id: "Cara membuat purchase order" },
    blocked_reason: null, instead_at: "/procurement/po",
  },
  {
    name: "guide.receive_goods", module: null, level: "read",
    effect: "guide", reach: "open",
    label: { en: "How to record goods arriving", id: "Cara mencatat barang datang" },
    blocked_reason: null, instead_at: "/procurement/penerimaan",
  },
  {
    name: "guide.pay_line", module: null, level: "read",
    effect: "guide", reach: "open",
    label: { en: "How to pay a request line", id: "Cara membayar sebuah baris permintaan" },
    blocked_reason: null, instead_at: "/procurement/tracker",
  },

  /* ── Writing, and only ever as a draft ────────────────────────────── */
  {
    name: "procurement.draft_pr_line", module: "procurement", level: "write",
    effect: "write", reach: "open",
    label: { en: "Draft a new purchase request line", id: "Menyiapkan baris permintaan pembelian baru" },
    blocked_reason: null, instead_at: "/procurement/pr/new",
  },
  {
    name: "procurement.draft_po", module: "procurement", level: "write",
    effect: "write", reach: "open",
    label: { en: "Draft a new purchase order", id: "Menyiapkan purchase order baru" },
    blocked_reason: null, instead_at: "/procurement/po",
  },

  /* ── Never, at any grant ──────────────────────────────────────────── */
  {
    name: "hr.employee_files", module: "hrd", level: "read",
    effect: "read", reach: "blocked",
    label: { en: "Employee files — ID card, family card, contract, tax and insurance numbers", id: "Berkas 201 — KTP, kartu keluarga, kontrak, NPWP, BPJS" },
    blocked_reason: {
      en: "Employee files cannot be read through the prompt, at any level of access. Identity numbers are opened one at a time by a person, with an eye button, and every opening is recorded in the audit trail under that person's name (D196). A conversation cannot carry that trail: it can copy, forward, and answer ten numbers at once.",
      id: "Berkas 201 tidak bisa dibaca lewat prompt, pada tingkat akses mana pun. Nomor identitas dibuka satu per satu oleh orang, dengan tombol mata, dan setiap pembukaan tercatat atas nama orang itu di audit (D196). Percakapan tidak bisa memberikan jejak itu: ia bisa menyalin, meneruskan, dan menjawab sepuluh nomor sekaligus.",
    },
    instead_at: "/hrd/berkas-201",
  },
  {
    name: "hr.payroll", module: "payroll", level: "read",
    effect: "read", reach: "blocked",
    label: { en: "Salaries, payslips, pay adjustments", id: "Gaji, slip gaji, penyesuaian upah" },
    blocked_reason: {
      en: "Individual pay is not read through the prompt. Confirmed by the owner after it was proposed as a default: one person's salary is the same class of exposure as their ID number, and it is far easier to ask for everybody's at once.",
      id: "Gaji per orang tidak dibaca lewat prompt. Dikonfirmasi pemilik setelah diusulkan sebagai default: nominal gaji satu orang adalah paparan sejenis dengan nomor KTP, dan jauh lebih mudah dimintakan sekaligus untuk semua orang.",
    },
    instead_at: "/hrd/payroll",
  },
  {
    name: "hr.attendance", module: "hrd", level: "read",
    effect: "read", reach: "blocked",
    label: { en: "Attendance and lateness per person", id: "Absensi dan keterlambatan per orang" },
    blocked_reason: {
      en: "Attendance per person is not read through the prompt, for the same reason as pay: easy to ask for wholesale, and what comes out is a record about people rather than about the company. Confirmed by the owner.",
      id: "Kehadiran per orang tidak dibaca lewat prompt, alasan yang sama dengan gaji: mudah diminta sekaligus, dan yang keluar adalah catatan tentang orang, bukan tentang perusahaan. Dikonfirmasi pemilik.",
    },
    instead_at: "/hrd/absensi",
  },
  {
    name: "it.audit", module: "it", level: "read",
    effect: "read", reach: "blocked",
    label: { en: "Audit log, activity log, users, roles", id: "Audit log, log aktivitas, pengguna, peran" },
    blocked_reason: {
      en: "The IT module cannot be read through the prompt at all (owner). The audit trail is a record of what people did; reading it through a conversation turns it into a way to watch a colleague with one sentence. Only IT and leadership may open it, on its own screen (D190).",
      id: "Modul IT tidak bisa dibaca lewat prompt sama sekali (pemilik). Jejak audit adalah catatan tentang apa yang dilakukan orang; membacanya lewat percakapan menjadikannya alat untuk mengawasi rekan kerja dengan satu kalimat. Yang boleh membukanya hanya IT dan pimpinan, di layarnya sendiri (D190).",
    },
    instead_at: "/it/audit",
  },
  {
    name: "it.settings_write", module: "settings", level: "write",
    effect: "write", reach: "blocked",
    label: { en: "Change system settings", id: "Mengubah pengaturan sistem" },
    blocked_reason: {
      en: "Settings are not changed through the prompt. Five of the twelve rewrite figures that already exist (D214), and the difference between the safe ones and the rest is exactly what a sentence loses — on the screen that difference is the first thing you read.",
      id: "Pengaturan tidak diubah lewat prompt. Lima dari dua belas pengaturan mengubah angka yang sudah ada (D214), dan perbedaan antara yang aman dan yang tidak justru hilang dalam kalimat percakapan — di layarnya perbedaan itu yang pertama terbaca.",
    },
    instead_at: "/pengaturan",
  },
];

export function findTool(name: string): ToolDef | undefined {
  return TOOLS.find((t) => t.name === name);
}
