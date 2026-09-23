/** Documents contracts — `core.attachments` and `core.attachment_links`.
 *
 *  This is the main road (ADR-010): somebody opens the PR line or the ledger
 *  row and attaches the file there, so the link is declared rather than
 *  inferred. Many-to-many from the start, and every link records WHO declared
 *  it — that column is the answer to the tracing problem.
 */

/** The four document types, exactly as the running system spells them. */
export const DOC_KINDS = [
  "Receipt / Invoice / Nota",
  "Payment Proof",
  "Receiving Item",
  "Delivery Note",
  "Purchase Order",
  /** The supplier's bill, when it is a separate paper from the nota. */
  "Invoice",
  /** Our own signed sheet of what arrived and in what state — not the
   *  supplier's delivery note, which says what was sent (owner, 2026-09-23). */
  "Receiving Report",
  /** A shop page, a marketplace listing, a quotation somebody sent a link to.
   *  What a request is usually built from before any nota exists (D125). */
  "Reference Link",
  /** The bank's own statement. For the two leadership accounts it is not a
   *  check on rows somebody typed — it is the **only** way their rows exist at
   *  all, so it stands as evidence in its own right (D180). */
  "Rekening Koran",
  /** HR evidence. A day off sick is paid **only** with the doctor's letter
   *  behind it, and overtime reaches leadership only with the surat lembur
   *  attached (D144, D145) — so both are document kinds like any other, on the
   *  same road, countable in the same strip. */
  "Surat Dokter",
  "Surat Lembur",
  /** A staff session's own report — usually a screenshot of the work (D146). */
  "Laporan Lembur",
  /** Production master data. **Gambar kerja** is what the workshop builds from
   *  — dimensions, joints, the section through the leg. **Gambar jadi** is what
   *  the client was shown and what QC checks against. They are different
   *  documents answering different questions, and a product missing either is
   *  a product somebody will have to ask about (D150). */
  "Gambar Kerja",
  "Gambar Jadi",
  /** Berkas 201 — the personnel file. Each of these is a document like any
   *  other, on the same road, so a person's file is a strip of evidence rather
   *  than a folder on somebody's laptop (D177). */
  "KTP",
  "Kartu Keluarga",
  "Ijazah",
  "CV",
  "Kontrak Kerja",
  "NPWP",
  "BPJS",
  "Foto",
  "Sertifikat",
  "Surat Peringatan",
  "Others",
] as const;
export type DocKind = (typeof DOC_KINDS)[number];

/** The kinds that can stand as *the* evidence for money moving.
 *
 *  A ledger row needs at least one of these (D85): the nota, the transfer
 *  proof, or the photo of what arrived. Everything else — a delivery note, the
 *  PO, a quotation — is supporting: worth filing, but it does not by itself
 *  say that this money moved for this reason. A row with no primary document
 *  is a number somebody typed.
 */
export const PRIMARY_DOC_KINDS: DocKind[] = [
  "Receipt / Invoice / Nota",
  "Payment Proof",
  "Receiving Item",
  /* A bank statement evidences the movement better than a transfer proof does:
     it is the bank's own record rather than a screenshot of one (D180). */
  "Rekening Koran",
];

export const SUPPORTING_DOC_KINDS: DocKind[] = [
  "Delivery Note",
  "Purchase Order",
  "Invoice",
  "Receiving Report",
  "Reference Link",
  "Surat Dokter",
  "Surat Lembur",
  /** A staff session's own report — usually a screenshot of the work (D146). */
  "Laporan Lembur",
  /** Production master data. **Gambar kerja** is what the workshop builds from
   *  — dimensions, joints, the section through the leg. **Gambar jadi** is what
   *  the client was shown and what QC checks against. They are different
   *  documents answering different questions, and a product missing either is
   *  a product somebody will have to ask about (D150). */
  "Gambar Kerja",
  "Gambar Jadi",
  "Others",
];

/** What a request must carry before anybody is asked to decide on it.
 *
 *  A request with nothing behind it asks somebody to approve a number. The
 *  owner's rule: *setiap pengajuan untuk pembayaran harus dilengkapi dengan
 *  dokumen pendukung* — a link to the shop page, an invoice, a bill. Any of
 *  these will do, because at request time the nota usually does not exist yet
 *  and the link is what the price came from (D125).
 */
export const REQUEST_SUPPORT_KINDS: DocKind[] = [
  "Reference Link",
  "Receipt / Invoice / Nota",
  "Purchase Order",
  "Others",
];

/** What a ledger row needs before it can be marked COMPLETED — at least one
 *  of these (owner, 2026-09-23; enforced by `complete_transaction`, `0103`). */
export const COMPLETION_DOC_KINDS: DocKind[] = [
  "Receipt / Invoice / Nota",
  "Payment Proof",
];

/** `Others` never touches the ledger — it branches to notes before anything
 *  else is looked at (owner, 2026-08-27). */
export const LEDGER_DOC_KINDS: DocKind[] = [
  "Receipt / Invoice / Nota",
  "Payment Proof",
  "Receiving Item",
];

export type LinkEntity =
  | "transaction" | "pr_line" | "po" | "receipt"
  | "day_mark" | "overtime"
  /** A product's drawings — master data, not evidence of an event (D150). */
  | "product"
  /** Somebody's own file: KTP, ijazah, the contract they signed (D177). */
  | "employee"
  /** A photo of the thing, its purchase nota, its warranty card (`0106`). */
  | "asset";

/** A piece of evidence — a **file or a link**, never both.
 *
 *  A marketplace listing is not a file, and photographing the screen to make
 *  it one loses the thing that made it useful: the address somebody else can
 *  open to see the price. So a link is first-class evidence, on the same road
 *  as everything else (D125) — it reaches a record through the same
 *  `attachment_link`, appears in the same strip, and counts the same way.
 */
export interface Attachment {
  id: string;
  /** Empty for a link. */
  storage_path: string;
  /** The address, for a link. Null for a file. */
  url: string | null;
  filename: string;
  sha256: string;
  mime: string;
  bytes: number;
  uploaded_by: string;
  uploaded_at: string;
  source: "web" | "chat" | "api" | "import";
  /** Advisory only — identical bytes seen before. Never blocks (A6). */
  duplicate_suspect: boolean;
}

export interface AttachmentLink {
  id: string;
  attachment_id: string;
  entity: LinkEntity;
  entity_no: string;
  kind: DocKind;
  /** Who declared this link, and when. The whole point. */
  linked_by: string;
  linked_at: string;
}

export interface AttachmentView extends Attachment {
  links: AttachmentLink[];
  /** More than one link means one document covering several parents — the
   *  normal case here, not the parked-file problem it is today. */
  covers_count: number;
}
