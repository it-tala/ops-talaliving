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
  /** The last leg (0131). **Our own** surat jalan going out, signed at the
   *  site — not the vendor's coming in, which is "Delivery Note". The BAST is
   *  the client's signature on the finished job (D211); a site photo is a
   *  crate, a wall, a snag. All three are filed in PROJECT MANAGER. */
  "Surat Jalan Keluar",
  "BAST",
  "Foto Lokasi",
  /** A photo taken at a clock-in away from the warehouse (D332). A face and a
   *  place, so it is filed in the HRD drive, not with `Foto` in PROCUREMENT. */
  "Foto Presensi",
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
  "Surat Jalan Keluar",
  "BAST",
  "Foto Lokasi",
  "Foto Presensi",
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
  | "asset"
  /** A catalogue item, by its code — the 1–4 photos that show the floor what
   *  it is. Four is a cap the database holds; the last one cannot come off
   *  (`0168`). */
  | "item"
  /** A leave request, by its number — the surat dokter a sick request carries
   *  from the phone it was photographed on (`0187`, D331). */
  | "leave_request"
  /** One phone tap, by its `tap_no` — the off-site photo (D332, `0188`). */
  | "attendance_scan";

/** Which kinds make sense where. The full list is thirty kinds across HR,
 *  production and money, and a ledger row offered "Ijazah" or "KTP" is a
 *  picker that makes the right choice harder to find and the wrong one easy.
 *  An entity not listed here is offered every kind. This is what the picker
 *  offers, not a rule the database enforces — a file already filed under
 *  another kind still shows and still counts. */
export const DOC_KINDS_FOR: Partial<Record<LinkEntity, readonly DocKind[]>> = {
  /* Money that moved: what proves it, what it bought, and the papers that
     travel with a purchase. */
  transaction: [
    "Receipt / Invoice / Nota", "Payment Proof", "Receiving Item", "Invoice",
    "Receiving Report", "Delivery Note", "Purchase Order", "Rekening Koran",
    "Others",
  ],
  /* A request line: where the price came from, then the same purchase papers
     as the ledger row that pays it. */
  pr_line: [
    "Reference Link", "Receipt / Invoice / Nota", "Payment Proof",
    "Receiving Item", "Invoice", "Receiving Report", "Delivery Note",
    "Purchase Order", "Foto", "Others",
  ],
  /* A thing the company owns: what it looks like, what it cost, what covers it. */
  asset: [
    "Foto", "Receipt / Invoice / Nota", "Invoice", "Sertifikat",
    "Delivery Note", "Others",
  ],
  /* A catalogue item: what it looks like. Its purchases are ledger lines,
     reached through the item rather than filed on it. */
  item: ["Foto", "Others"],
  leave_request: ["Surat Dokter", "Others"],
};

/** The photos an item carries (`0168`): at least one, at most four. */
export const ITEM_PHOTO_MIN = 1;
export const ITEM_PHOTO_MAX = 4;

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
  /** The Google Drive link of an uploaded file — what people open. Null for a
   *  link and for files filed before 0175. */
  web_view_link?: string | null;
  /** Where the file sits, in words: `PROCUREMENT / OPS / INVENTORY/ITEMS`.
   *  Decided by the database from the kind, never by the screen (0175). */
  filed_in?: string | null;
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
  /** Set by `upload` only: these exact bytes were already filed (from Google
   *  Chat, or earlier in the same drive), so that file was returned and
   *  nothing new went to Drive (D359, F209). */
  reused?: boolean;
}

/* ── IT → Google Drive (F173, D320) ───────────────────────────────────── */

/** The state of one shared drive, as far as filing goes.
 *
 *  - `ready`: the app's `ops-talaliving` folder exists and uploads can see it.
 *  - `not_set_up`: the drive is reachable, and the folder is not made yet.
 *    *Create ops-talaliving* makes it, and so does the first upload.
 *  - `not_member_or_wrong_id`: Google cannot find the recorded folder or drive
 *    for the app's account, so the account is not a member of that shared
 *    drive, or the id is wrong.
 *  - `read_only_member`: in the drive as Viewer or Commenter, cannot file.
 *  - `app_folder_missing`: a folder was recorded, but uploads can no longer
 *    open it (moved, binned or deleted). *Create ops-talaliving* makes another.
 *  - `not_configured`: nothing records which shared drive this is.
 *  - `check_failed`: the check itself could not run (see `note`).
 */
export type DriveVerdict =
  | "ready" | "not_set_up" | "not_member_or_wrong_id" | "read_only_member"
  | "app_folder_missing" | "not_configured" | "check_failed";

export interface DriveCheck {
  slug: string;
  label: string;
  /** The folder a person made in the drive; says which drive it is. */
  recorded_folder_id: string | null;
  drive_id: string | null;
  /** The app's `ops-talaliving` folder, once made. */
  folder_id: string | null;
  /** The shared drive as a member sees it (read-only look). */
  drive: {
    ok: boolean; status: number; message: string | null;
    name: string | null; can_add: boolean | null;
  } | null;
  /** The app's folder as uploads see it (`drive.file`). */
  app_folder: { ok: boolean; status: number; message: string | null; name: string | null; trashed: boolean } | null;
  verdict: DriveVerdict;
  note: string | null;
}

/** One drive's result from *Create ops-talaliving*. */
export interface DriveSetUp {
  slug: string;
  label: string;
  ok: boolean;
  drive_id: string | null;
  drive_name: string | null;
  folder_id: string | null;
  /** True when made just now; false when the app's folder was already there. */
  created: boolean;
  code: string | null;
  message: string | null;
}

export interface DriveCheckReport {
  service_account: string;
  /** The permission uploads use. */
  upload_scope: string;
  /** The folder the app files into, in every drive. */
  app_folder: string;
  drives: DriveCheck[];
}
