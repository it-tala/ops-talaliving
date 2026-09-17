/** The SOP, as steps somebody can follow while the screen is open beside them.
 *
 *  Written as **the rule and then the click**, not the click alone. A step that
 *  says *press Issue* teaches somebody to press Issue; a step that says *until
 *  it is issued nothing is owed, so a draft is the safe place to stop* teaches
 *  them when not to (D222).
 */
import type { GuideStep } from "@/services/assistant/contracts";
import type { Message, Lang } from "@/lib/i18n";

interface StepDef { text: Message; href: string | null; rule: Message | null }
interface GuideDef { title: Message; route: string; steps: StepDef[] }

export function resolveGuide(g: GuideDef, lang: Lang): { title: string; route: string; steps: GuideStep[] } {
  return {
    title: g.title[lang],
    route: g.route,
    steps: g.steps.map((s) => ({ text: s.text[lang], href: s.href, rule: s.rule ? s.rule[lang] : null })),
  };
}

export const GUIDES: Record<string, GuideDef> = {
  "guide.create_po": {
    title: { en: "Creating a purchase order", id: "Membuat purchase order" },
    route: "/procurement/po",
    steps: [
      {
        text: { en: "Make sure the line is approved first. A PO is built from a request line that already has goods approval.", id: "Pastikan barisnya sudah disetujui dulu. PO dibuat dari baris permintaan yang sudah punya persetujuan barang." },
        href: "/procurement/meeting",
        rule: { en: "Approving the goods and approving the money are two different things, and the first has to exist before we order from a vendor.", id: "Persetujuan barang dan persetujuan uang itu dua hal berbeda, dan yang pertama harus ada sebelum kita memesan ke vendor." },
      },
      {
        text: { en: "Open Purchase Orders, press Add new PO, choose the vendor.", id: "Buka Purchase Orders, tekan Add new PO, pilih vendornya." },
        href: "/procurement/po",
        rule: null,
      },
      {
        text: { en: "Fill the lines: item, quantity, unit price. The line total is quantity × price, except a service line, where the amount is typed directly.", id: "Isi barisnya: barang, jumlah, dan harga satuan. Nilai barisnya dihitung dari jumlah × harga, kecuali baris jasa yang nominalnya diketik langsung." },
        href: null,
        rule: { en: "A service line has no quantity, so recomputing its amount from quantity × price gives zero.", id: "Baris jasa tidak punya jumlah, jadi kalau nominalnya dihitung ulang dari jumlah × harga hasilnya nol." },
      },
      {
        text: { en: "If there is a deposit, put it in the deposit field. If not, leave it empty.", id: "Kalau ada uang muka, isi di kolom deposit. Kalau tidak, kosongkan." },
        href: null,
        rule: null,
      },
      {
        text: { en: "Press Issue to send it, or tick draft if it is not going out yet.", id: "Tekan Issue untuk mengirimkannya, atau centang draft kalau belum mau dikirim." },
        href: null,
        rule: { en: "Before it is issued we owe nothing; after it, the deposit is already an obligation. A draft is the safe place to stop.", id: "Sebelum di-issue tidak ada yang kita hutangi; sesudahnya depositnya sudah jadi kewajiban. Draft adalah tempat berhenti yang aman." },
      },
      {
        text: { en: "An issued PO is printed from its own page, not from a screenshot.", id: "PO yang sudah issued dicetak dari halaman PO-nya sendiri, bukan dari screenshot." },
        href: null,
        rule: { en: "What prints is the document, with no menu and no sidebar.", id: "Yang dicetak adalah dokumennya, tanpa menu dan tanpa sidebar." },
      },
    ],
  },

  "guide.receive_goods": {
    title: { en: "Recording goods arriving", id: "Mencatat barang datang" },
    route: "/procurement/penerimaan",
    steps: [
      {
        text: { en: "Anybody who sees the goods arrive may report it, including outside working hours. Photograph them first.", id: "Siapa pun yang melihat barangnya datang boleh melaporkannya, termasuk di luar jam kerja. Foto barangnya dulu." },
        href: "/procurement/penerimaan",
        rule: { en: "Goods often arrive at night. Reporting and confirming are deliberately separate so the person who saw them need not be the person with authority.", id: "Barang sering datang malam. Laporan dan konfirmasi sengaja dipisah supaya yang melihat tidak harus orang yang berwenang." },
      },
      {
        text: { en: "Procurement confirms with the signed delivery note, the quantity, the condition, and who checked them.", id: "Procurement mengonfirmasi dengan tanda terima yang ditandatangani, jumlah, kondisi, dan siapa yang memeriksa." },
        href: null,
        rule: { en: "The photo answers what arrived; the delivery note answers that we acknowledged it. Three weeks later the argument is settled by whichever one exists.", id: "Foto menjawab apa yang datang; tanda terima menjawab bahwa kita mengakuinya. Tiga minggu lagi yang menyelesaikan perdebatan adalah salah satunya yang ada." },
      },
      {
        text: { en: "Confirmed goods enter stock on their own.", id: "Barang yang dikonfirmasi masuk ke stok dengan sendirinya." },
        href: "/inventory/material",
        rule: { en: "Only a confirmed receipt counts as value received.", id: "Hanya penerimaan yang dikonfirmasi yang dihitung sebagai nilai diterima." },
      },
    ],
  },

  "guide.pay_line": {
    title: { en: "Paying a request line", id: "Membayar sebuah baris permintaan" },
    route: "/procurement/tracker",
    steps: [
      {
        text: { en: "Open the vendor tracker and see which lines may be billed.", id: "Buka tracker vendornya dan lihat baris mana yang sudah boleh ditagih." },
        href: "/procurement/tracker",
        rule: { en: "Contracted is not the same as billable — what decides it is whether the goods have been received.", id: "Yang sudah dikontrakkan belum tentu sudah boleh ditagih — yang menentukan adalah barangnya sudah diterima." },
      },
      {
        text: { en: "Pay from the line itself, not by creating a separate transaction.", id: "Bayar dari barisnya, bukan dengan membuat transaksi terpisah." },
        href: null,
        rule: { en: "Paying a line is one act: the transaction, its allocation to that line, and the document are written together. Split them and one of them goes missing.", id: "Membayar satu baris itu satu tindakan: transaksinya, alokasinya ke baris itu, dan dokumennya ditulis bersama-sama. Kalau dipisah, salah satunya akan hilang." },
      },
      {
        text: { en: "Attach the transfer proof.", id: "Lampirkan bukti transfernya." },
        href: null,
        rule: { en: "One transfer proof may cover several purchases, and one purchase may be paid twice — cash and transfer. Both are normal and both are visible on the verification screen.", id: "Satu bukti transfer boleh menutup beberapa pembelian, dan satu pembelian boleh dibayar dua kali — tunai dan transfer. Keduanya normal dan keduanya terlihat di layar verifikasi." },
      },
    ],
  },
};
