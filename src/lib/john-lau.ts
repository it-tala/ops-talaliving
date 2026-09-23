/** John Lau's prose: the guidance he gives, and the shape of a draft.
 *
 *  ## Why this is in `src/lib` and not in `src/demo`
 *
 *  It was in `src/demo/assistant/guides.ts`, which was right while only the
 *  demo could answer. Both implementations answer now, and the same guide has
 *  to come back from either — a screen that cannot tell which service it got is
 *  the whole of ADR-009, and it stops being true the moment the demo knows a
 *  step the real one does not.
 *
 *  It is prose and not data, deliberately, and that is the difference between
 *  this file and the catalogue. `ops_asst.tools` is in the database because it
 *  is a **security boundary** and a reader must not be able to edit it. A guide
 *  is neither: it explains a screen, it touches nothing, and it belongs beside
 *  `src/lib/messages.ts`, which is where the shell's two languages already
 *  live.
 *
 *  ## How the steps are written
 *
 *  **The rule and then the click**, not the click alone. A step that says
 *  *press Issue* teaches somebody to press Issue; a step that says *until it is
 *  issued nothing is owed, so a draft is the safe place to stop* teaches them
 *  when not to (D222).
 */
import type { AssistantDraft, GuideStep } from "@/services/assistant/contracts";
import type { PrLineView, UomCode, Vendor } from "@/services/procurement/contracts";
import { invalid, isOk, ok, type Result } from "@/services/_shared/envelope";
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

/* ────────────────────────────────────────────────────────────────────────
 * The shape of a draft
 * ──────────────────────────────────────────────────────────────────────── */

/** What a person is asked to say yes to, before anything is written.
 *
 *  Shared by both implementations for the same reason the guides are: D220
 *  says the confirmation is of **the exact payload, not a summary of it**, and
 *  two copies of "what the payload looks like" is how the demo ends up asking
 *  for three fields and the real one writing four.
 *
 *  The id, the idempotency key and the timestamp are not here — they belong to
 *  whoever is actually opening the draft, and inventing them in a pure
 *  function would mean two callers minting keys the database never saw.
 */
export function draftShape(
  tool: string,
  args: Record<string, string>,
  lang: Lang,
): Pick<AssistantDraft, "headline" | "fields" | "warnings"> {
  const id = lang === "id";
  /* A blank that says it is blank. The alternative — quietly defaulting a
     quantity to 1, a vendor to the last one used — is composing, and composing
     is the one thing John Lau does not do (D217). It also reads as a fact on a
     confirmation screen, which is the worst place for a guess to be. */
  const blank = id ? "— belum diisi —" : "— not filled in —";
  const qty = args.qty ? `${args.qty} ${args.uom ?? ""}`.trim() : blank;

  if (tool === "procurement.draft_po") {
    const fromLine = !!args.pr_line_no;
    const candidates = args.candidates ? args.candidates.split(";").filter(Boolean) : [];
    const asked = args.item ?? args.name ?? "";
    return {
      headline: id ? "Purchase order baru" : "New purchase order",
      fields: [
        { key: "pr_line_no", label: id ? "Dari baris PR" : "From request line", value: args.pr_line_no ?? blank },
        { key: "vendor", label: "Vendor", value: args.vendor ?? blank },
        { key: "item", label: id ? "Barang" : "Item", value: args.item ?? args.name ?? blank },
        { key: "qty", label: id ? "Jumlah" : "Quantity", value: qty },
        { key: "unit_price", label: id ? "Harga satuan" : "Unit price", value: args.unit_price ?? blank },
        { key: "dp_percent", label: id ? "DP (%)" : "Deposit (%)", value: args.dp_percent ?? "0" },
        { key: "ask_leadership", label: id ? "Minta konfirmasi pimpinan" : "Ask leadership to confirm", value: "ya" },
      ],
      warnings: [
        ...(fromLine ? [id
          ? `Diisi dari ${args.pr_line_no}, baris yang sudah disetujui: vendor, jumlah dan harga adalah yang disetujui, bukan tebakan.`
          : `Filled from ${args.pr_line_no}, an approved line: the vendor, quantity and price are what was approved, not a guess.`] : []),
        ...(candidates.length ? [id
          ? `Ada ${candidates.length} baris disetujui yang cocok dengan "${asked}": ${candidates.join(", ")}. Isi "Dari baris PR" dengan salah satunya.`
          : `${candidates.length} approved lines match "${asked}": ${candidates.join(", ")}. Put one of them in "From request line".`] : []),
        ...(!fromLine && !candidates.length ? [id
          ? `Belum ada baris PR yang disetujui untuk "${asked}". PO biasanya dibuat dari baris yang sudah disetujui — minta saya "siapkan PR untuk ${asked}" dulu, atau lengkapi vendor dan harga sendiri kalau ini kontrak tanpa PR.`
          : `No approved request line matches "${asked}". An order is normally built from an approved line — ask me to "draft a PR for ${asked}" first, or fill in the vendor and price yourself if this is a contract with no request.`] : []),
        id
          ? "PO dibuat sebagai draft. Pimpinan harus mengonfirmasinya sebelum bisa dikirim ke vendor — kalau Anda bukan pimpinan, permintaan konfirmasi langsung dikirim ke pimpinan."
          : "The PO is created as a draft. Leadership must confirm it before it can go to the vendor — if you are not leadership, the request for confirmation goes to them straight away.",
      ],
    };
  }

  return {
    headline: id ? "Baris permintaan pembelian baru" : "New purchase request line",
    fields: [
      { key: "item", label: id ? "Barang" : "Item", value: args.name ?? blank },
      { key: "qty", label: id ? "Jumlah" : "Quantity", value: qty },
      { key: "purpose", label: id ? "Keperluan" : "Purpose", value: args.purpose ?? blank },
    ],
    warnings: id ? [
      "Baris ini masuk sebagai permintaan, bukan sebagai persetujuan. Yang menyetujui tetap orang, di papan rapat.",
    ] : [
      "This goes in as a request, not as an approval. Approving it stays a person's act, on the meeting board.",
    ],
  };
}

/** Words that ask for an order rather than name what is ordered. */
const ASKING = ["buat", "buatkan", "bikin", "bikinkan", "tolong", "po", "purchase", "order", "untuk", "pesan",
  "pesankan", "siapkan", "baru", "ke", "dari", "vendor", "supplier", "saya", "kita", "mau", "create", "a", "for", "new", "raise"];

/** The approved request lines a sentence like *buat PO untuk KSA binder* could
 *  mean (D300).
 *
 *  A purchase order is built from an approved line (D297), so before John Lau
 *  drafts one he looks for the line — by the words of the item, in lines that
 *  are approved, have a quantity and are not removed. One match fills the
 *  draft from what was approved: its vendor, quantity and price, none of them
 *  guessed. Several are listed for the person to choose. None says so, and
 *  points at drafting the request first.
 *
 *  Pure, so the demo and the live client resolve a sentence identically; each
 *  passes the lines its own `listOpenLines` returned.
 */
export function resolvePoDraft(
  args: Record<string, string>,
  lines: PrLineView[],
  sentence = "",
): Record<string, string> {
  /* The item, as the person wrote it: from the arguments when a reader found
     one, otherwise their own sentence with the asking words taken out. The
     keyword router knows *buat PO* is a purchase order and not what for, and
     *buat PO untuk KSA binder 5 liter* is the sentence the owner used. */
  const own = sentence.toLowerCase().split(/\s+/).filter((w) => w && !ASKING.includes(w.replace(/[^a-z]/g, ""))).join(" ").trim();
  const item = args.item ?? args.name ?? own;
  if (!item) return args;
  if (!args.item && !args.name) args = { ...args, item };
  const asked = item.toLowerCase();
  const words = asked.split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !/^\d+$/.test(w)
    && !["liter", "ltr", "pcs", "lembar", "unit", "yang"].includes(w));
  if (!words.length) return args;
  const orderable = lines.filter((l) => (l.status === "APPROVED" || l.status === "PAID")
    && l.qty != null && l.qty > 0 && !l.removed_at);
  const scored = orderable
    .map((l) => ({ l, hits: words.filter((w) => `${l.description} ${l.item_name ?? ""}`.toLowerCase().includes(w)).length }))
    .filter((x) => x.hits > 0);
  const best = Math.max(0, ...scored.map((x) => x.hits));
  const top = scored.filter((x) => x.hits === best).map((x) => x.l);
  if (top.length === 1) {
    const l = top[0];
    const q = l.approval?.approved_qty ?? l.qty ?? 1;
    const amount = l.approval?.approved_amount ?? l.item_total;
    const price = q > 0 ? Math.round(amount / q) : l.unit_price ?? 0;
    /* Only what the line knows. A line approved without a price leaves the
       price blank for the person — never a zero, and never what the sentence
       or a model suggested (D217). */
    const { unit_price: _suggested, vendor: _v, vendor_id: _vi, ...rest } = args;
    void _suggested; void _v; void _vi;
    return {
      ...rest,
      pr_line_no: l.line_no_full,
      item: l.description,
      ...(l.vendor_name ? { vendor: l.vendor_name, vendor_id: l.vendor_id ?? "" } : {}),
      qty: String(q),
      uom: l.uom ?? args.uom ?? "",
      ...(price > 0 ? { unit_price: String(price) } : {}),
    };
  }
  if (top.length > 1) return { ...args, candidates: top.slice(0, 5).map((l) => l.line_no_full).join(";") };
  return args;
}

/** What confirming a PO draft needs from a procurement client — the demo's or
 *  the live one, which answer the same shapes (ADR-009). */
export interface PoDraftApi {
  listVendors(opts: { q?: string; curated?: boolean }): Promise<Result<Vendor[]>>;
  createPo(input: {
    vendor_id: string;
    lines: { description: string; qty: number; uom: UomCode; unit_price: number; pr_line_no?: string | null }[];
    dp_percent?: number | null;
  }): Promise<Result<{ po_no: string; self_confirmed: boolean }>>;
  requestPoApproval(input: { po_no: string }): Promise<Result<unknown>>;
}

/** "Ya, tulis" on a PO draft (D300): the order is written through `createPo`,
 *  the same seam the screen uses, from the fields as the person left them.
 *
 *  Leadership's rule holds on this road too (D299): an author who holds
 *  `approve_goods` has the order confirmed on creation; anybody else's goes to
 *  leadership straight away unless they said not to. **Once the order exists
 *  this never answers an error** — the draft would stay open, and a second
 *  "Ya, tulis" is a second order to a vendor. A request for confirmation that
 *  fails is said in the reference instead.
 */
export async function confirmPoDraft(
  api: PoDraftApi,
  fields: Record<string, string>,
  drafted: Record<string, string>,
  lang: Lang,
): Promise<Result<string>> {
  const id = lang === "id";
  const SERVICE = "procurement" as const;
  const num = (s: string | undefined) => Number(String(s ?? "").replace(/[^0-9.,]/g, "").replace(/[.,](?=\d{3}\b)/g, "").replace(",", ".")) || 0;

  /* The vendor as drafted from the line, unless the person changed the name. */
  const vendorName = (fields.vendor ?? "").trim();
  let vendorId = vendorName && vendorName === (drafted.vendor ?? "") ? drafted.vendor_id ?? "" : "";
  if (!vendorId) {
    if (!vendorName || vendorName.startsWith("—")) {
      return invalid(SERVICE, "vendor_required", id ? "Isi vendornya dulu — sebuah PO dipesan ke seseorang." : "Fill in the vendor first — an order is placed with somebody.", { field: "vendor" });
    }
    const found = await api.listVendors({ q: vendorName });
    if (!isOk(found)) return found;
    const exact = found.data.filter((v) => v.name.toLowerCase() === vendorName.toLowerCase());
    const pick = exact.length === 1 ? exact[0] : found.data.length === 1 ? found.data[0] : null;
    if (!pick) {
      return invalid(SERVICE, "vendor_not_found", id
        ? `Tidak menemukan satu supplier bernama "${vendorName}". Tulis namanya persis seperti di Master data → Suppliers.`
        : `Could not find one supplier called "${vendorName}". Write the name exactly as in Master data → Suppliers.`, { field: "vendor" });
    }
    vendorId = pick.id;
  }

  const [q, u] = (fields.qty ?? "").trim().split(/\s+/);
  const created = await api.createPo({
    vendor_id: vendorId,
    lines: [{
      description: (fields.item ?? "").trim(),
      qty: num(q),
      uom: (u || drafted.uom || "pcs") as UomCode,
      unit_price: num(fields.unit_price),
      pr_line_no: (fields.pr_line_no ?? "").trim().startsWith("—") ? null : (fields.pr_line_no ?? "").trim() || null,
    }],
    dp_percent: num(fields.dp_percent) || null,
  });
  if (!isOk(created)) return created;
  const po = created.data;

  if (po.self_confirmed) {
    return ok(SERVICE, id ? `${po.po_no} · dikonfirmasi (Anda pemegang wewenang) · tinggal di-issue` : `${po.po_no} · confirmed (you hold the authority) · ready to issue`);
  }
  if (!/^(ya|yes|y)$/i.test((fields.ask_leadership ?? "ya").trim())) {
    return ok(SERVICE, id ? `${po.po_no} · draft, belum diminta konfirmasi` : `${po.po_no} · draft, confirmation not asked yet`);
  }
  const asked = await api.requestPoApproval({ po_no: po.po_no });
  return ok(SERVICE, isOk(asked)
    ? (id ? `${po.po_no} · menunggu konfirmasi pimpinan` : `${po.po_no} · waiting for leadership to confirm`)
    : (id ? `${po.po_no} · draft dibuat, tetapi permintaan konfirmasi gagal: ${asked.error.message}` : `${po.po_no} · drafted, but asking for confirmation failed: ${asked.error.message}`));
}

