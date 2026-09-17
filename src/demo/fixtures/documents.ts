import type { Attachment, AttachmentLink } from "@/services/documents/contracts";
import { trxIdByNo } from "./ledger";

/* Evidence, and where it hangs.
 *
 * The one to look at is att_04: a single supplier invoice covering three
 * ledger rows. Today that file would be one of the 674 sitting parked because
 * it "cannot be honestly named after one of them". Here it is three links,
 * each recording who declared it — which is the whole point of attaching from
 * the record instead of matching to it afterwards (ADR-010).
 */
export const ATTACHMENTS: Attachment[] = [
  { id: "att_01", storage_path: "demo/2026-08/nota-amplas-sejahtera.jpg", url: null, filename: "nota-amplas-sejahtera.jpg", sha256: "9f2a1c77b0e4", mime: "image/jpeg", bytes: 842_113, uploaded_by: "usr_putri", uploaded_at: "2026-08-20T16:05:00+08:00", source: "web", duplicate_suspect: false },
  { id: "att_02", storage_path: "demo/2026-08/bukti-transfer-amplas.jpg", url: null, filename: "bukti-transfer-amplas.jpg", sha256: "3b71ee90aa12", mime: "image/jpeg", bytes: 415_882, uploaded_by: "usr_putri", uploaded_at: "2026-08-20T16:08:00+08:00", source: "web", duplicate_suspect: false },
  { id: "att_03", storage_path: "demo/2026-08/foto-terima-amplas.jpg", url: null, filename: "foto-terima-amplas.jpg", sha256: "cc4410ab7731", mime: "image/jpeg", bytes: 1_204_776, uploaded_by: "usr_made", uploaded_at: "2026-08-25T13:35:00+08:00", source: "chat", duplicate_suspect: false },
  { id: "att_04", storage_path: "demo/2026-08/invoice-makmur-sentosa-gabungan.pdf", url: null, filename: "invoice-makmur-sentosa-gabungan.pdf", sha256: "77de0192bb45", mime: "application/pdf", bytes: 288_401, uploaded_by: "usr_anggun", uploaded_at: "2026-08-31T10:00:00+08:00", source: "web", duplicate_suspect: false },
  /* The last leg's paper: surat jalan, the photo of the load, snag photos, and
     the signed BAST (D209). */
  { id: "att_60", storage_path: "demo/2026-08/surat-jalan-krm-260820.jpg", url: null, filename: "surat-jalan-krm-260820.jpg", sha256: "aa10bb20cc30", mime: "image/jpeg", bytes: 388_204, uploaded_by: "usr_made", uploaded_at: "2026-08-20T14:35:00+08:00", source: "web", duplicate_suspect: false },
  { id: "att_61", storage_path: "demo/2026-08/bongkar-lemari-seminyak.jpg", url: null, filename: "bongkar-lemari-seminyak.jpg", sha256: "bb11cc21dd31", mime: "image/jpeg", bytes: 612_880, uploaded_by: "usr_made", uploaded_at: "2026-08-20T14:36:00+08:00", source: "chat", duplicate_suspect: false },
  { id: "att_62", storage_path: "demo/2026-09/surat-jalan-krm-260902.jpg", url: null, filename: "surat-jalan-krm-260902.jpg", sha256: "cc12dd22ee32", mime: "image/jpeg", bytes: 401_110, uploaded_by: "usr_made", uploaded_at: "2026-09-02T11:15:00+08:00", source: "web", duplicate_suspect: false },
  { id: "att_63", storage_path: "demo/2026-09/surat-jalan-krm-260908.jpg", url: null, filename: "surat-jalan-krm-260908.jpg", sha256: "dd13ee23ff33", mime: "image/jpeg", bytes: 377_002, uploaded_by: "usr_made", uploaded_at: "2026-09-08T08:10:00+08:00", source: "web", duplicate_suspect: false },
  { id: "att_64", storage_path: "demo/2026-06/surat-jalan-krm-260611.jpg", url: null, filename: "surat-jalan-krm-260611.jpg", sha256: "ee14ff24aa34", mime: "image/jpeg", bytes: 359_440, uploaded_by: "usr_made", uploaded_at: "2026-06-11T13:05:00+08:00", source: "web", duplicate_suspect: false },
  { id: "att_65", storage_path: "demo/2026-06/bongkar-lemari-arsip.jpg", url: null, filename: "bongkar-lemari-arsip.jpg", sha256: "ff15aa25bb35", mime: "image/jpeg", bytes: 548_120, uploaded_by: "usr_made", uploaded_at: "2026-06-11T13:06:00+08:00", source: "chat", duplicate_suspect: false },
  { id: "att_66", storage_path: "demo/2026-08/temuan-pintu-lemari.jpg", url: null, filename: "temuan-pintu-lemari.jpg", sha256: "aa16bb26cc36", mime: "image/jpeg", bytes: 466_900, uploaded_by: "usr_made", uploaded_at: "2026-08-22T16:20:00+08:00", source: "chat", duplicate_suspect: false },
  { id: "att_67", storage_path: "demo/2026-09/temuan-warna-pintu.jpg", url: null, filename: "temuan-warna-pintu.jpg", sha256: "bb17cc27dd37", mime: "image/jpeg", bytes: 502_330, uploaded_by: "usr_made", uploaded_at: "2026-09-04T16:40:00+08:00", source: "chat", duplicate_suspect: false },
  { id: "att_68", storage_path: "demo/2026-06/bast-office-fitout.pdf", url: null, filename: "bast-office-fitout.pdf", sha256: "cc18dd28ee38", mime: "application/pdf", bytes: 214_880, uploaded_by: "usr_made", uploaded_at: "2026-06-18T15:05:00+08:00", source: "web", duplicate_suspect: false },
  { id: "att_43", storage_path: "demo/2026-08/nota-plywood-sentosa.jpg", url: null, filename: "nota-plywood-sentosa.jpg", sha256: "5f20aa71c9b4", mime: "image/jpeg", bytes: 466_210, uploaded_by: "usr_anggun", uploaded_at: "2026-08-28T15:44:00+08:00", source: "web", duplicate_suspect: false },
  { id: "att_05", storage_path: "demo/2026-08/bukti-transfer-plywood.jpg", url: null, filename: "bukti-transfer-plywood.jpg", sha256: "1a09fe33cd80", mime: "image/jpeg", bytes: 392_004, uploaded_by: "usr_anggun", uploaded_at: "2026-08-29T16:25:00+08:00", source: "web", duplicate_suspect: false },
  { id: "att_06", storage_path: "demo/2026-08/kwitansi-potong-rumput.jpg", url: null, filename: "kwitansi-potong-rumput.jpg", sha256: "5502ab11ff73", mime: "image/jpeg", bytes: 221_559, uploaded_by: "usr_anggun", uploaded_at: "2026-08-29T16:30:00+08:00", source: "web", duplicate_suspect: false },
  { id: "att_07", storage_path: "demo/2026-08/bukti-dp-indoveneer.jpg", url: null, filename: "bukti-dp-indoveneer.jpg", sha256: "8811cc02de44", mime: "image/jpeg", bytes: 508_220, uploaded_by: "usr_putri", uploaded_at: "2026-08-21T16:15:00+08:00", source: "web", duplicate_suspect: false },
  { id: "att_08", storage_path: "demo/2026-09/foto-terima-hpl.jpg", url: null, filename: "foto-terima-hpl.jpg", sha256: "aa19bb7700cd", mime: "image/jpeg", bytes: 1_882_330, uploaded_by: "usr_made", uploaded_at: "2026-09-02T09:45:00+08:00", source: "chat", duplicate_suspect: false },
  { id: "att_09", storage_path: "demo/2026-09/foto-terima-veneer-tahap1.jpg", url: null, filename: "foto-terima-veneer-tahap1.jpg", sha256: "0d3311fa9b62", mime: "image/jpeg", bytes: 1_650_119, uploaded_by: "usr_made", uploaded_at: "2026-09-06T11:20:00+08:00", source: "chat", duplicate_suspect: false },
  { id: "att_10", storage_path: "demo/2026-09/nota-makmur-090926.jpg", url: null, filename: "nota-makmur-090926.jpg", sha256: "6612ffab0091", mime: "image/jpeg", bytes: 733_902, uploaded_by: "usr_made", uploaded_at: "2026-09-09T17:22:00+08:00", source: "chat", duplicate_suspect: false },
  { id: "att_11", storage_path: "demo/2026-09/nota-sinar-abadi.jpg", url: null, filename: "nota-sinar-abadi.jpg", sha256: "b0027fc31184", mime: "image/jpeg", bytes: 611_447, uploaded_by: "usr_andi", uploaded_at: "2026-09-10T08:05:00+08:00", source: "chat", duplicate_suspect: false },
  { id: "att_12", storage_path: "demo/2026-09/struk-konsumsi.jpg", url: null, filename: "struk-konsumsi.jpg", sha256: "df9911aa0034", mime: "image/jpeg", bytes: 180_223, uploaded_by: "usr_anggun", uploaded_at: "2026-09-10T09:40:00+08:00", source: "web", duplicate_suspect: true },
  { id: "att_13", storage_path: "demo/2026-09/dokumen-pribadi.jpg", url: null, filename: "dokumen-pribadi.jpg", sha256: "4471bb2200fe", mime: "image/jpeg", bytes: 402_881, uploaded_by: "usr_shared", uploaded_at: "2026-09-07T20:10:00+08:00", source: "chat", duplicate_suspect: false },
  /* Transfer proofs: leadership funding the accounting account. Two already
   * booked against past rounds, one still sitting in chat waiting for somebody
   * to confirm it — which is the second road into the ledger (D81). */
  { id: "att_15", storage_path: "demo/2026-08/bukti-transfer-ronde-0822.jpg", url: null, filename: "bukti-transfer-ronde-0822.jpg", sha256: "aa7712ff0093", mime: "image/jpeg", bytes: 388_120, uploaded_by: "usr_geryle", uploaded_at: "2026-08-20T09:12:00+08:00", source: "chat", duplicate_suspect: false },
  { id: "att_16", storage_path: "demo/2026-08/bukti-transfer-ronde-0831.jpg", url: null, filename: "bukti-transfer-ronde-0831.jpg", sha256: "b18823cc0071", mime: "image/jpeg", bytes: 402_995, uploaded_by: "usr_geryle", uploaded_at: "2026-08-29T08:40:00+08:00", source: "chat", duplicate_suspect: false },
  { id: "att_17", storage_path: "demo/2026-09/bukti-transfer-topup-271.jpg", url: null, filename: "bukti-transfer-topup-271.jpg", sha256: "cd3391ab7724", mime: "image/jpeg", bytes: 431_770, uploaded_by: "usr_geryle", uploaded_at: "2026-09-10T08:20:00+08:00", source: "chat", duplicate_suspect: false },
  { id: "att_18", storage_path: "demo/2026-07/hadi-dp-po0630.pdf", url: null, filename: "hadi-dp-po0630.pdf", sha256: "aa01bb22cc31", mime: "application/pdf", bytes: 122_004, uploaded_by: "usr_putri", uploaded_at: "2026-07-01T16:05:00+08:00", source: "web", duplicate_suspect: false },
  { id: "att_19", storage_path: "demo/2026-07/hadi-progres2-po0630.pdf", url: null, filename: "hadi-progres2-po0630.pdf", sha256: "bb02cc33dd42", mime: "application/pdf", bytes: 118_223, uploaded_by: "usr_putri", uploaded_at: "2026-07-24T16:05:00+08:00", source: "web", duplicate_suspect: false },
  { id: "att_20", storage_path: "demo/2026-07/hadi-pelunasan-po0630.pdf", url: null, filename: "hadi-pelunasan-po0630.pdf", sha256: "cc03dd44ee53", mime: "application/pdf", bytes: 119_884, uploaded_by: "usr_putri", uploaded_at: "2026-07-31T16:05:00+08:00", source: "web", duplicate_suspect: false },
  { id: "att_21", storage_path: "demo/2026-08/hadi-progres1-po0725.pdf", url: null, filename: "hadi-progres1-po0725.pdf", sha256: "dd04ee55ff64", mime: "application/pdf", bytes: 121_337, uploaded_by: "usr_putri", uploaded_at: "2026-08-10T16:05:00+08:00", source: "web", duplicate_suspect: false },
  { id: "att_22", storage_path: "demo/2026-08/hadi-split-3-order.pdf", url: null, filename: "hadi-split-3-order.pdf", sha256: "ee05ff66aa75", mime: "application/pdf", bytes: 130_551, uploaded_by: "usr_putri", uploaded_at: "2026-08-19T16:05:00+08:00", source: "web", duplicate_suspect: false },
  { id: "att_23", storage_path: "demo/2026-07/foto-barang-hadi-0708.jpg", url: null, filename: "foto-barang-hadi-0708.jpg", sha256: "ff06aa77bb86", mime: "image/jpeg", bytes: 884_120, uploaded_by: "usr_made", uploaded_at: "2026-07-08T10:40:00+08:00", source: "chat", duplicate_suspect: false },
  { id: "att_24", storage_path: "demo/2026-08/foto-barang-hadi-0802.jpg", url: null, filename: "foto-barang-hadi-0802.jpg", sha256: "aa07bb88cc97", mime: "image/jpeg", bytes: 792_665, uploaded_by: "usr_made", uploaded_at: "2026-08-02T09:20:00+08:00", source: "chat", duplicate_suspect: false },
  { id: "att_25", storage_path: "demo/2026-07/surat-jalan-hadi-0708.jpg", url: null, filename: "surat-jalan-hadi-0708.jpg", sha256: "bb08cc99dd08", mime: "image/jpeg", bytes: 640_223, uploaded_by: "usr_made", uploaded_at: "2026-07-08T10:42:00+08:00", source: "chat", duplicate_suspect: false },
  { id: "att_26", storage_path: "demo/2026-08/surat-jalan-hadi-0802.jpg", url: null, filename: "surat-jalan-hadi-0802.jpg", sha256: "cc09dd00ee19", mime: "image/jpeg", bytes: 610_884, uploaded_by: "usr_made", uploaded_at: "2026-08-02T09:22:00+08:00", source: "chat", duplicate_suspect: false },
  { id: "att_27", storage_path: "demo/2026-09/surat-jalan-veneer-0902.jpg", url: null, filename: "surat-jalan-veneer-0902.jpg", sha256: "dd10ee11ff20", mime: "image/jpeg", bytes: 588_412, uploaded_by: "usr_made", uploaded_at: "2026-09-02T09:47:00+08:00", source: "chat", duplicate_suspect: false },
  /* Links, not files. What a request is built from before any nota exists:
     the page the price was read off (D125). */
  { id: "att_29", storage_path: "", url: "https://www.tokopedia.com/balipacking/bubble-wrap-125cm-x-50m-double-layer", filename: "tokopedia.com/balipacking/bubble-wrap-125cm", sha256: "", mime: "text/uri-list", bytes: 0, uploaded_by: "usr_andi", uploaded_at: "2026-09-10T08:20:00+08:00", source: "web", duplicate_suspect: false },
  { id: "att_30", storage_path: "", url: "https://www.tokopedia.com/balipacking/kardus-double-wall-60x40x40", filename: "tokopedia.com/balipacking/kardus-double-wall", sha256: "", mime: "text/uri-list", bytes: 0, uploaded_by: "usr_andi", uploaded_at: "2026-09-10T08:22:00+08:00", source: "web", duplicate_suspect: false },
  { id: "att_31", storage_path: "", url: "https://mitrateknikmandiri.co.id/produk/pisau-planer-300mm-hss", filename: "mitrateknikmandiri.co.id/pisau-planer-300mm", sha256: "", mime: "text/uri-list", bytes: 0, uploaded_by: "usr_made", uploaded_at: "2026-09-08T15:10:00+08:00", source: "web", duplicate_suspect: false },
  /* Berkas 201 scans. `storage_path` is the Drive file in Phase 2 — the road
     is the one every other document already travels (ADR-010), so Drive is
     where the bytes land, not a second filing system. */
  { id: "att_40", storage_path: "drive/berkas-201/emp_w009/ktp-karjo.jpg", url: null, filename: "ktp-karjo.jpg", sha256: "a71c04e5b219", mime: "image/jpeg", bytes: 412_880, uploaded_by: "usr_wulan", uploaded_at: "2026-02-03T11:00:00+08:00", source: "web", duplicate_suspect: false },
  { id: "att_41", storage_path: "drive/berkas-201/emp_w012/ktp-sujono.jpg", url: null, filename: "ktp-sujono.jpg", sha256: "b8207de41c6a", mime: "image/jpeg", bytes: 388_120, uploaded_by: "usr_wulan", uploaded_at: "2026-09-10T14:20:00+08:00", source: "web", duplicate_suspect: false },
  { id: "att_42", storage_path: "drive/berkas-201/emp_w006/kk-sarpan.jpg", url: null, filename: "kk-sarpan.jpg", sha256: "c93f18ab7e20", mime: "image/jpeg", bytes: 640_551, uploaded_by: "usr_wulan", uploaded_at: "2026-02-03T12:01:00+08:00", source: "web", duplicate_suspect: false },
  { id: "att_28", storage_path: "demo/2026-09/surat-jalan-veneer-0906.jpg", url: null, filename: "surat-jalan-veneer-0906.jpg", sha256: "ee11ff22aa31", mime: "image/jpeg", bytes: 571_006, uploaded_by: "usr_made", uploaded_at: "2026-09-06T11:22:00+08:00", source: "chat", duplicate_suspect: false },
  { id: "att_14", storage_path: "demo/2026-09/nota-rak-besi.jpg", url: null, filename: "nota-rak-besi.jpg", sha256: "2290ffcc7710", mime: "image/jpeg", bytes: 555_310, uploaded_by: "usr_made", uploaded_at: "2026-09-02T18:30:00+08:00", source: "chat", duplicate_suspect: false },
  /* HR. A doctor's letter and an overtime letter — evidence like any other. */
  { id: "att_40", storage_path: "demo/2026-09/surat-dokter-siti.jpg", url: null, filename: "surat-dokter-siti.jpg", sha256: "d41a77bc0091", mime: "image/jpeg", bytes: 612_884, uploaded_by: "usr_wulan", uploaded_at: "2026-09-02T09:08:00+08:00", source: "web", duplicate_suspect: false },
  { id: "att_41", storage_path: "demo/2026-09/surat-lembur-produksi-310826.pdf", url: null, filename: "surat-lembur-produksi-310826.pdf", sha256: "6b20aa41cc03", mime: "application/pdf", bytes: 96_441, uploaded_by: "usr_wulan", uploaded_at: "2026-09-01T08:18:00+08:00", source: "web", duplicate_suspect: false },
  { id: "att_44", storage_path: "demo/master/gambar-kerja-mj-220.pdf", url: null, filename: "gambar-kerja-mj-220.pdf", sha256: "aa71bb0044cc", mime: "application/pdf", bytes: 1_884_220, uploaded_by: "usr_made", uploaded_at: "2026-07-18T10:00:00+08:00", source: "web", duplicate_suspect: false },
  { id: "att_45", storage_path: "demo/master/foto-jadi-mj-220.jpg", url: null, filename: "foto-jadi-mj-220.jpg", sha256: "77cc1290bb31", mime: "image/jpeg", bytes: 2_104_338, uploaded_by: "usr_made", uploaded_at: "2026-07-30T15:20:00+08:00", source: "web", duplicate_suspect: false },
  { id: "att_46", storage_path: "demo/master/gambar-kerja-lm-3p.pdf", url: null, filename: "gambar-kerja-lm-3p.pdf", sha256: "3390aa7712bc", mime: "application/pdf", bytes: 1_442_009, uploaded_by: "usr_made", uploaded_at: "2026-08-20T09:40:00+08:00", source: "web", duplicate_suspect: false },
  { id: "att_42", storage_path: "demo/2026-09/lembur-andi-010926.png", url: null, filename: "lembur-andi-010926.png", sha256: "ff8123aa5501", mime: "image/png", bytes: 388_112, uploaded_by: "usr_andi", uploaded_at: "2026-09-01T21:41:00+08:00", source: "web", duplicate_suspect: false },
  { id: "att_43", storage_path: "demo/2026-09/lembur-andi-020926.png", url: null, filename: "lembur-andi-020926.png", sha256: "cd90aa112288", mime: "image/png", bytes: 201_553, uploaded_by: "usr_andi", uploaded_at: "2026-09-02T22:11:00+08:00", source: "web", duplicate_suspect: false },
];

export const ATTACHMENT_LINKS: AttachmentLink[] = [
  /* HR evidence. The surat dokter is what makes a sick day a paid one (D144);
   * the surat lembur is what leadership is actually signing (D145). Same road
   * as every other document here: uploaded once, linked by a named person. */
  { id: "lnk_40", attachment_id: "att_40", entity: "day_mark", entity_no: "dmk_03", kind: "Surat Dokter", linked_by: "usr_wulan", linked_at: "2026-09-02T09:10:00+08:00" },
  { id: "lnk_41", attachment_id: "att_41", entity: "overtime", entity_no: "lbr_01", kind: "Surat Lembur", linked_by: "usr_wulan", linked_at: "2026-09-01T08:20:00+08:00" },
  /* A staff session's evidence is the screenshot of what they were doing —
   * the report itself, not a signed form (D146). */
  /* Master data: what the workshop builds from, and what the client was shown
   * (D150). The wardrobe has the working drawing and no photograph yet — which
   * is the normal state of a product that has not been delivered. */
  { id: "lnk_44", attachment_id: "att_44", entity: "product", entity_no: "PRD-MJ-220", kind: "Gambar Kerja", linked_by: "usr_made", linked_at: "2026-07-18T10:02:00+08:00" },
  { id: "lnk_45", attachment_id: "att_45", entity: "product", entity_no: "PRD-MJ-220", kind: "Gambar Jadi", linked_by: "usr_made", linked_at: "2026-07-30T15:22:00+08:00" },
  { id: "lnk_46", attachment_id: "att_46", entity: "product", entity_no: "PRD-LM-3P", kind: "Gambar Kerja", linked_by: "usr_made", linked_at: "2026-08-20T09:42:00+08:00" },
  { id: "lnk_42", attachment_id: "att_42", entity: "overtime", entity_no: "lbr_02", kind: "Laporan Lembur", linked_by: "usr_andi", linked_at: "2026-09-01T21:42:00+08:00" },
  { id: "lnk_43", attachment_id: "att_43", entity: "overtime", entity_no: "lbr_03", kind: "Laporan Lembur", linked_by: "usr_andi", linked_at: "2026-09-02T22:12:00+08:00" },

  { id: "lnk_01", attachment_id: "att_01", entity: "transaction", entity_no: "trx-26-08-20_003", kind: "Receipt / Invoice / Nota", linked_by: "usr_putri", linked_at: "2026-08-20T16:06:00+08:00" },
  { id: "lnk_02", attachment_id: "att_02", entity: "transaction", entity_no: "trx-26-08-20_003", kind: "Payment Proof", linked_by: "usr_putri", linked_at: "2026-08-20T16:09:00+08:00" },
  { id: "lnk_03", attachment_id: "att_03", entity: "pr_line", entity_no: "pr-26-08-18_01-L01", kind: "Receiving Item", linked_by: "usr_made", linked_at: "2026-08-25T13:36:00+08:00" },

  /* One invoice, three ledger rows. Attached from the first, then "juga
   * mencakup" added the other two — a first-class action, not a repair. */
  { id: "lnk_04", attachment_id: "att_04", entity: "transaction", entity_no: "trx-26-08-22_001", kind: "Receipt / Invoice / Nota", linked_by: "usr_anggun", linked_at: "2026-08-31T10:01:00+08:00" },
  { id: "lnk_05", attachment_id: "att_04", entity: "transaction", entity_no: "trx-26-08-31_001", kind: "Receipt / Invoice / Nota", linked_by: "usr_anggun", linked_at: "2026-08-31T10:02:00+08:00" },
  { id: "lnk_06", attachment_id: "att_04", entity: "transaction", entity_no: "trx-26-09-07_001", kind: "Receipt / Invoice / Nota", linked_by: "usr_anggun", linked_at: "2026-09-07T15:12:00+08:00" },

  { id: "lnk_07", attachment_id: "att_05", entity: "transaction", entity_no: "trx-26-08-29_002", kind: "Payment Proof", linked_by: "usr_anggun", linked_at: "2026-08-29T16:26:00+08:00" },
  /* The vendor's nota stands behind **both** halves of that purchase — the
     cash deposit and the transfer that cleared the balance. One document, two
     ledger rows, which `attachment_links` has always allowed and no screen
     ever showed (D206).
     Note which document is shared and which is not: the *transfer proof*
     (att_05) proves only the bank row, because it is evidence of one payment.
     A transfer proof attached to a cash payment would be a document claiming
     something it cannot say. */
  { id: "lnk_40", attachment_id: "att_43", entity: "transaction", entity_no: "trx-26-08-28_002", kind: "Receipt / Invoice / Nota", linked_by: "usr_anggun", linked_at: "2026-08-28T15:45:00+08:00" },
  { id: "lnk_41", attachment_id: "att_43", entity: "transaction", entity_no: "trx-26-08-29_002", kind: "Receipt / Invoice / Nota", linked_by: "usr_anggun", linked_at: "2026-08-29T16:28:00+08:00" },
  { id: "lnk_08", attachment_id: "att_06", entity: "transaction", entity_no: "trx-26-08-29_003", kind: "Payment Proof", linked_by: "usr_anggun", linked_at: "2026-08-29T16:31:00+08:00" },
  { id: "lnk_09", attachment_id: "att_07", entity: "transaction", entity_no: "trx-26-08-21_002", kind: "Payment Proof", linked_by: "usr_putri", linked_at: "2026-08-21T16:16:00+08:00" },
  { id: "lnk_10", attachment_id: "att_08", entity: "receipt", entity_no: "rcv-26-09-02_01", kind: "Receiving Item", linked_by: "usr_made", linked_at: "2026-09-02T09:46:00+08:00" },
  { id: "lnk_11", attachment_id: "att_09", entity: "receipt", entity_no: "rcv-26-09-06_01", kind: "Receiving Item", linked_by: "usr_made", linked_at: "2026-09-06T11:21:00+08:00" },
  { id: "lnk_12", attachment_id: "att_02", entity: "pr_line", entity_no: "pr-26-08-18_01-L01", kind: "Payment Proof", linked_by: "usr_putri", linked_at: "2026-08-20T16:09:30+08:00" },
  { id: "lnk_13", attachment_id: "att_06", entity: "pr_line", entity_no: "pr-26-08-27_01-L02", kind: "Payment Proof", linked_by: "usr_anggun", linked_at: "2026-08-29T16:32:00+08:00" },
  /* The proof sits on the transaction that received the money, which is where
     the ledger reads it from — the round points at the same file. */
  { id: "lnk_20", attachment_id: "att_18", entity: "transaction", entity_no: "trx-26-07-01_001", kind: "Payment Proof", linked_by: "usr_putri", linked_at: "2026-07-01T16:06:00+08:00" },
  { id: "lnk_21", attachment_id: "att_19", entity: "transaction", entity_no: "trx-26-07-24_001", kind: "Payment Proof", linked_by: "usr_putri", linked_at: "2026-07-24T16:06:00+08:00" },
  /* The nota behind the steel racking. It was missing, which made a CONFIRMED
     inbox row read *belum menopang baris mana pun* — a posting with no
     evidence travelling with it, which is exactly what D85 forbids and what
     the runtime flow does attach. The seed was the only place it was untrue. */
  { id: "lnk_42", attachment_id: "att_14", entity: "transaction", entity_no: "trx-26-09-07_001", kind: "Receipt / Invoice / Nota", linked_by: "usr_anggun", linked_at: "2026-09-02T18:40:00+08:00" },
  { id: "lnk_22", attachment_id: "att_20", entity: "transaction", entity_no: "trx-26-07-31_001", kind: "Payment Proof", linked_by: "usr_putri", linked_at: "2026-07-31T16:06:00+08:00" },
  { id: "lnk_23", attachment_id: "att_21", entity: "transaction", entity_no: "trx-26-08-10_001", kind: "Payment Proof", linked_by: "usr_putri", linked_at: "2026-08-10T16:06:00+08:00" },
  { id: "lnk_24", attachment_id: "att_22", entity: "transaction", entity_no: "trx-26-08-19_002", kind: "Payment Proof", linked_by: "usr_putri", linked_at: "2026-08-19T16:06:00+08:00" },
  /* The tanda terima, filed against the receiving report it belongs to. */
  { id: "lnk_25", attachment_id: "att_23", entity: "receipt", entity_no: "rcv-26-07-08_01", kind: "Receiving Item", linked_by: "usr_made", linked_at: "2026-07-08T10:41:00+08:00" },
  { id: "lnk_26", attachment_id: "att_24", entity: "receipt", entity_no: "rcv-26-08-02_01", kind: "Receiving Item", linked_by: "usr_made", linked_at: "2026-08-02T09:21:00+08:00" },
  /* The other half of a delivery: the signed tanda terima. Four shipments
     carry both halves; the rest are the state a real month is in, which is
     why the receiving form now refuses to record one without both (D101). */
  { id: "lnk_27", attachment_id: "att_25", entity: "receipt", entity_no: "rcv-26-07-08_01", kind: "Delivery Note", linked_by: "usr_made", linked_at: "2026-07-08T10:42:00+08:00" },
  { id: "lnk_28", attachment_id: "att_26", entity: "receipt", entity_no: "rcv-26-08-02_01", kind: "Delivery Note", linked_by: "usr_made", linked_at: "2026-08-02T09:22:00+08:00" },
  { id: "lnk_29", attachment_id: "att_27", entity: "receipt", entity_no: "rcv-26-09-02_01", kind: "Delivery Note", linked_by: "usr_made", linked_at: "2026-09-02T09:47:00+08:00" },
  { id: "lnk_30", attachment_id: "att_28", entity: "receipt", entity_no: "rcv-26-09-06_01", kind: "Delivery Note", linked_by: "usr_made", linked_at: "2026-09-06T11:22:00+08:00" },
  /* The shop pages the prices came from. STRETCH FILM 500MM deliberately has
     none — a real week always has one line somebody has not finished, and the
     refusal it produces is worth seeing on the demo. */
  { id: "lnk_31", attachment_id: "att_29", entity: "pr_line", entity_no: "pr-26-09-10_01-L01", kind: "Reference Link", linked_by: "usr_andi", linked_at: "2026-09-10T08:21:00+08:00" },
  { id: "lnk_32", attachment_id: "att_30", entity: "pr_line", entity_no: "pr-26-09-10_01-L02", kind: "Reference Link", linked_by: "usr_andi", linked_at: "2026-09-10T08:23:00+08:00" },
  { id: "lnk_33", attachment_id: "att_31", entity: "pr_line", entity_no: "pr-26-09-08_01-L03", kind: "Reference Link", linked_by: "usr_made", linked_at: "2026-09-08T15:11:00+08:00" },
  { id: "lnk_14", attachment_id: "att_15", entity: "transaction", entity_no: "trx-26-08-20_001", kind: "Payment Proof", linked_by: "usr_putri", linked_at: "2026-08-20T09:20:00+08:00" },
  { id: "lnk_15", attachment_id: "att_16", entity: "transaction", entity_no: "trx-26-08-29_001", kind: "Payment Proof", linked_by: "usr_putri", linked_at: "2026-08-29T08:50:00+08:00" },
];

/** Referenced so the import is used and the ledger fixture stays the source of
 *  truth for transaction ids. */
export const SAMPLE_TRX_ID = trxIdByNo("trx-26-08-20_003");
