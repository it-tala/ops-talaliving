/** The shell's words, in both languages.
 *
 *  Typed as `Message`, so a half-added entry does not compile (D224). Business
 *  vocabulary is **absent from this file on purpose** — `PKWT`, `SP NORTH`,
 *  `kubikasi`, account codes and status strings are names, not words, and a
 *  name that changes with the language setting is a name two systems will
 *  disagree about.
 */
import type { Message } from "./i18n";

const m = (en: string, id: string): Message => ({ en, id });

export const MESSAGES = {
  nav: {
    dashboard: m("Dashboard", "Dasbor"),
    overview: m("Overview", "Ringkasan"),

    hr: m("HR", "SDM"),
    employees: m("Employees", "Karyawan"),
    attendance: m("Attendance", "Absensi"),
    overtime: m("Overtime", "Lembur"),
    employeeFiles: m("Employee Files", "Berkas 201"),
    leave: m("Leave & Permits", "Cuti & izin"),
    payroll: m("Payroll", "Penggajian"),
    payrollWeek: m("Weekly payroll", "Gajian mingguan"),
    payRules: m("Pay rules", "Aturan penggajian"),
    contributions: m("Statutory contributions", "Iuran wajib"),
    performance: m("Performance & tasks", "Kinerja & tugas"),

    procurement: m("Procurement", "Pengadaan"),
    requests: m("Purchase requests", "Permintaan pembelian"),
    meeting: m("Approval meeting", "Rapat persetujuan"),
    purchaseOrders: m("Purchase orders", "Purchase order"),
    receiving: m("Receiving", "Penerimaan barang"),
    tracker: m("Vendor tracker", "Tracker vendor"),
    suppliers: m("Suppliers", "Pemasok"),
    catalog: m("Item catalogue", "Katalog barang"),
    rounds: m("Payment rounds", "Ronde pembayaran"),
    documents: m("Documents", "Dokumen"),

    inventory: m("Inventory", "Persediaan"),
    timber: m("Timber", "Kayu"),
    materials: m("Materials & hardware", "Bahan & perangkat keras"),
    adjustments: m("Stock adjustments", "Penyesuaian stok"),

    accounting: m("Accounting", "Akuntansi"),
    ledger: m("Ledger", "Buku besar"),
    verification: m("Purchase verification", "Verifikasi pembelian"),
    calendar: m("Cash calendar", "Kalender kas"),
    monthlyBills: m("Monthly bills", "Tagihan bulanan"),
    liquidation: m("Liquidation", "Pertanggungjawaban dana"),
    statements: m("Bank statements", "Rekening koran"),

    marketing: m("Marketing", "Pemasaran"),
    pipeline: m("Package — pipeline", "Package — pipeline"),
    reps: m("Representatives & commission", "Representative & komisi"),

    projects: m("Projects", "Proyek"),
    orders: m("Client orders", "Pesanan klien"),
    costVsPlan: m("Cost vs projection", "Biaya vs proyeksi"),
    delivery: m("Delivery", "Pengiriman"),
    boxes: m("Packing boxes & labels", "Peti & label"),
    installation: m("Installation", "Instalasi"),
    handover: m("Handover", "Serah terima"),

    production: m("Production", "Produksi"),
    design: m("Design", "Desain"),
    workAttribution: m("Who did the work", "Penautan nama"),
    bom: m("Products & BOM", "Produk & BOM"),
    schedule: m("Planning & schedule", "Perencanaan & jadwal"),

    johnLau: m("John Lau", "John Lau"),
    johnLauScope: m("What you may ask", "Apa yang boleh ditanyakan"),

    it: m("IT", "IT"),
    audit: m("Audit log", "Log audit"),
    activity: m("Activity log", "Log aktivitas"),
    users: m("Users & access", "Pengguna & akses"),
    roles: m("Roles & permissions", "Peran & izin"),

    settings: m("Settings", "Pengaturan"),
    general: m("General", "Umum"),
    demo: m("Demo", "Demo"),
  },

  common: {
    save: m("Save", "Simpan"),
    cancel: m("Cancel", "Batal"),
    close: m("Close", "Tutup"),
    open: m("Open", "Buka"),
    send: m("Send", "Kirim"),
    readOnly: m("View only", "Lihat saja"),
    notReal: m("DEMO · DATA IS NOT REAL", "DEMO · DATA INI TIDAK NYATA"),
    reset: m("Reset", "Reset"),
    access: m("Access", "Akses"),
  },

  johnLau: {
    launcher: m("John Lau", "John Lau"),
    placeholder: m("Ask, or ask for something to be drafted…", "Tanya, atau minta dibuatkan sesuatu…"),
    ariaPrompt: m("Question for John Lau", "Pertanyaan untuk John Lau"),
    opening: m(
      "I run named commands in this system and show you what they return. I do not invent figures: every number I quote carries the name of the computation behind it and the screen where you can check it yourself.",
      "Saya menjalankan perintah bernama di sistem ini dan menunjukkan apa yang dikembalikannya. Saya tidak mengarang angka: setiap angka yang saya sebut punya nama perhitungannya dan layar tempat Anda bisa mengeceknya sendiri.",
    ),
    openingClosed: m(
      "Some things cannot reach me at all — employee files and the IT module. Try the last suggestion below to see how I refuse.",
      "Ada yang tidak bisa lewat saya sama sekali — berkas 201 dan modul IT. Coba tanyakan yang terakhir di bawah untuk melihat bagaimana saya menolak.",
    ),
    refusedClosed: m(
      "Closed to the prompt — no permission opens it",
      "Tertutup lewat prompt — tidak ada izin yang membukanya",
    ),
    refusedPermission: m("Your access is not enough", "Akses Anda belum cukup"),
    openScreen: m("open the screen", "buka layarnya"),
    openHere: m("open", "buka"),
    writeIt: m("Yes, write it", "Ya, tulis"),
    savedAs: m("Saved", "Tersimpan"),
    abandoned: m("Cancelled. Nothing was written.", "Dibatalkan. Tidak ada yang ditulis."),
  },
} as const;

export const EXAMPLES: Record<"en" | "id", string[]> = {
  en: [
    "How do I create a PO?",
    "What are the account balances?",
    "Which items are below minimum?",
    "How much do we owe our vendors?",
    "What is Karjo's salary?",
  ],
  id: [
    "Bagaimana cara membuat PO?",
    "Saldo rekening berapa?",
    "Barang apa yang stoknya menipis?",
    "Berapa hutang kita ke vendor?",
    "Berapa gaji Karjo?",
  ],
};
