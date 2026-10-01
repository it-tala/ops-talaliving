import type { Attachment } from "@/services/documents/contracts";
import type { DemoReceivingInbox } from "../state";

/** The RECEIVING REPORT space (0203, D358): what the bridge files from Google
 *  Chat. Three messages — a purchase already paid, an order's delivery with
 *  its tanda terima, and a chat reply that is not an arrival. */
export const RECEIVING_ATTACHMENTS: Attachment[] = [
  { id: "att_rr_01", storage_path: "", url: "https://drive.google.com/file/d/demo-rr-01/view", filename: "WhatsApp Image 2026-09-30 at 10.12.01.jpeg", sha256: "", mime: "image/jpeg", bytes: 261_519, uploaded_by: "usr_made", uploaded_at: "2026-09-30T10:12:30+07:00", source: "chat", duplicate_suspect: false },
  { id: "att_rr_02", storage_path: "", url: "https://drive.google.com/file/d/demo-rr-02/view", filename: "WhatsApp Image 2026-09-30 at 10.12.02.jpeg", sha256: "", mime: "image/jpeg", bytes: 179_101, uploaded_by: "usr_made", uploaded_at: "2026-09-30T10:12:31+07:00", source: "chat", duplicate_suspect: false },
  { id: "att_rr_03", storage_path: "", url: "https://drive.google.com/file/d/demo-rr-03/view", filename: "1001277930.jpeg", sha256: "", mime: "image/jpeg", bytes: 306_710, uploaded_by: "usr_made", uploaded_at: "2026-09-30T15:17:55+07:00", source: "chat", duplicate_suspect: false },
  { id: "att_rr_04", storage_path: "", url: "https://drive.google.com/file/d/demo-rr-04/view", filename: "1001277926.jpeg", sha256: "", mime: "image/jpeg", bytes: 171_426, uploaded_by: "usr_made", uploaded_at: "2026-09-30T15:17:59+07:00", source: "chat", duplicate_suspect: false },
  { id: "att_rr_05", storage_path: "", url: "https://drive.google.com/file/d/demo-rr-05/view", filename: "Image_20260930_1457.jpeg", sha256: "", mime: "image/jpeg", bytes: 360_413, uploaded_by: "usr_made", uploaded_at: "2026-10-01T08:57:57+07:00", source: "chat", duplicate_suspect: false },
];

const open = {
  status: "PENDING" as const, matched_to: null, trx_no: null, po_no: null,
  receipt_nos: [], move_nos: [], asset_nos: [], resolved_by: null, resolved_at: null, resolve_note: null,
};

export const RECEIVING_INBOX: DemoReceivingInbox[] = [
  {
    rr_no: "rr-26-09-30_01", ref_id: "demo-ev-0001", message: "Sanding sealer 20 ltr + thinner",
    sender_name: "Made", reported_by: "usr_made", reported_at: "2026-09-30T10:12:20+07:00",
    extracted: {
      doc_kind: "RECEIVING SHEET", vendor: "PT PROPAN RAYA ICC", confidence: 95,
      lines: [
        { item: "SANDING SEALER PROPAN", received_qty: 20, condition: "GOOD", remark: "LTR" },
        { item: "THINNER ND SUPER", received_qty: 10, condition: "GOOD", remark: "LTR" },
      ],
    },
    file_ids: ["att_rr_01", "att_rr_02"], ...open,
  },
  {
    rr_no: "rr-26-09-30_02", ref_id: "demo-ev-0002", message: "Veneer jati 0.6mm 150 lbr, surat jalan terlampir",
    sender_name: "Made", reported_by: "usr_made", reported_at: "2026-09-30T15:17:46+07:00",
    extracted: {
      doc_kind: "RECEIVING SHEET", vendor: "PT INDO VENEER UTAMA", po_number: "po-26-08-14_01",
      delivery_note_no: "SJ-0931", confidence: 95,
      lines: [{ item: "VENEER JATI 0.6MM", received_qty: 150, expected_qty: 400, condition: "GOOD", remark: "LBR" }],
    },
    file_ids: ["att_rr_03", "att_rr_04"], ...open,
  },
  {
    rr_no: "rr-26-10-01_01", ref_id: "demo-ev-0003", message: "Baik mas, nanti difoto ulang",
    sender_name: "Cintya Arta", reported_by: null, reported_at: "2026-10-01T08:57:51+07:00",
    extracted: { doc_kind: "ITEM PHOTO", lines: [] },
    file_ids: ["att_rr_05"], ...open,
  },
];
