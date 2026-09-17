import type { EmployeeDocument, LeaveRequest } from "@/services/hr/contracts";

/** Berkas 201, as it really looks: mostly complete, and not evenly (D177).
 *
 *  The office staff were hired with a folder each; the workshop was hired by
 *  somebody who needed people on Monday. So Karjo has no ijazah on file and
 *  Trisno has no contract at all, which is not a demo contrivance — it is the
 *  ordinary state of a workshop of forty, and it is the thing this screen has
 *  to be able to say out loud.
 *
 *  Two contracts expire inside sixty days. That is the other half of why the
 *  file is worth building: nobody notices a date inside a scan.
 */
export const EMPLOYEE_DOCUMENTS: EmployeeDocument[] = [
  /* Office — files kept properly. */
  { id: "edc_01", employee_id: "emp_02", kind: "ktp", attachment_id: null, doc_no: "5171045208910002", doc_no_source: "typed", issued_on: "2019-04-11", expires_on: null, note: null, recorded_by: "usr_wulan", recorded_at: "2026-01-12T09:00:00+08:00" },
  { id: "edc_02", employee_id: "emp_02", kind: "kartu_keluarga", attachment_id: null, doc_no: "5171040812080004", doc_no_source: "typed", issued_on: "2020-02-03", expires_on: null, note: null, recorded_by: "usr_wulan", recorded_at: "2026-01-12T09:02:00+08:00" },
  { id: "edc_03", employee_id: "emp_02", kind: "kontrak_kerja", attachment_id: null, doc_no: "PKWTT/2021/014", doc_no_source: "typed", issued_on: "2021-06-14", expires_on: null, note: "Karyawan tetap — tidak ada tanggal berakhir.", recorded_by: "usr_wulan", recorded_at: "2026-01-12T09:05:00+08:00" },
  { id: "edc_04", employee_id: "emp_02", kind: "foto", attachment_id: null, doc_no: null, doc_no_source: null, issued_on: "2021-06-14", expires_on: null, note: null, recorded_by: "usr_wulan", recorded_at: "2026-01-12T09:06:00+08:00" },
  { id: "edc_05", employee_id: "emp_02", kind: "npwp", attachment_id: null, doc_no: "72.145.883.4-904.000", doc_no_source: "typed", issued_on: "2021-07-01", expires_on: null, note: null, recorded_by: "usr_wulan", recorded_at: "2026-01-12T09:08:00+08:00" },
  { id: "edc_06", employee_id: "emp_02", kind: "bpjs_kesehatan", attachment_id: null, doc_no: "0001428855013", doc_no_source: "typed", issued_on: "2021-08-01", expires_on: null, note: null, recorded_by: "usr_wulan", recorded_at: "2026-01-12T09:10:00+08:00" },
  { id: "edc_07", employee_id: "emp_02", kind: "ijazah", attachment_id: null, doc_no: null, doc_no_source: null, issued_on: "2018-08-20", expires_on: null, note: "S1 Akuntansi.", recorded_by: "usr_wulan", recorded_at: "2026-01-12T09:12:00+08:00" },

  { id: "edc_08", employee_id: "emp_04", kind: "ktp", attachment_id: null, doc_no: "5171041709940007", doc_no_source: "typed", issued_on: "2018-05-02", expires_on: null, note: null, recorded_by: "usr_wulan", recorded_at: "2026-01-12T10:00:00+08:00" },
  { id: "edc_09", employee_id: "emp_04", kind: "kartu_keluarga", attachment_id: null, doc_no: "5171041102150009", doc_no_source: "typed", issued_on: "2019-11-20", expires_on: null, note: null, recorded_by: "usr_wulan", recorded_at: "2026-01-12T10:01:00+08:00" },
  { id: "edc_10", employee_id: "emp_04", kind: "foto", attachment_id: null, doc_no: null, doc_no_source: null, issued_on: "2022-08-01", expires_on: null, note: null, recorded_by: "usr_wulan", recorded_at: "2026-01-12T10:02:00+08:00" },
  /* Expires in a fortnight, and nobody has noticed. */
  { id: "edc_11", employee_id: "emp_04", kind: "kontrak_kerja", attachment_id: null, doc_no: "PKWT/2025/031", doc_no_source: "typed", issued_on: "2025-09-25", expires_on: "2026-09-24", note: "PKWT satu tahun, perpanjangan kedua.", recorded_by: "usr_wulan", recorded_at: "2026-01-12T10:05:00+08:00" },

  { id: "edc_12", employee_id: "emp_05", kind: "ktp", attachment_id: null, doc_no: "5103021203880001", doc_no_source: "typed", issued_on: "2017-03-14", expires_on: null, note: null, recorded_by: "usr_wulan", recorded_at: "2026-01-13T08:30:00+08:00" },
  { id: "edc_13", employee_id: "emp_05", kind: "kartu_keluarga", attachment_id: null, doc_no: "5103020705110003", doc_no_source: "typed", issued_on: "2018-06-09", expires_on: null, note: null, recorded_by: "usr_wulan", recorded_at: "2026-01-13T08:31:00+08:00" },
  { id: "edc_14", employee_id: "emp_05", kind: "kontrak_kerja", attachment_id: null, doc_no: "PKWTT/2020/008", doc_no_source: "typed", issued_on: "2020-03-16", expires_on: null, note: null, recorded_by: "usr_wulan", recorded_at: "2026-01-13T08:33:00+08:00" },
  { id: "edc_15", employee_id: "emp_05", kind: "foto", attachment_id: null, doc_no: null, doc_no_source: null, issued_on: "2020-03-16", expires_on: null, note: null, recorded_by: "usr_wulan", recorded_at: "2026-01-13T08:34:00+08:00" },
  /* A certificate that lapsed in July. The kind of date that is only ever
     found when somebody needs it. */
  { id: "edc_16", employee_id: "emp_05", kind: "sertifikat", attachment_id: null, doc_no: "K3-FORKLIFT-2023-114", doc_no_source: "typed", issued_on: "2023-07-18", expires_on: "2026-07-17", note: "Lisensi operator forklift.", recorded_by: "usr_wulan", recorded_at: "2026-01-13T08:36:00+08:00" },

  /* Workshop — hired fast, filed later. */
  { id: "edc_17", employee_id: "emp_w009", kind: "ktp", attachment_id: "att_40", doc_no: "3301091506900004", doc_no_source: "extracted", issued_on: "2016-09-02", expires_on: null, note: null, recorded_by: "usr_wulan", recorded_at: "2026-02-03T11:00:00+08:00" },
  { id: "edc_18", employee_id: "emp_w009", kind: "kartu_keluarga", attachment_id: null, doc_no: "3301090211120002", doc_no_source: "typed", issued_on: "2019-01-15", expires_on: null, note: null, recorded_by: "usr_wulan", recorded_at: "2026-02-03T11:01:00+08:00" },
  { id: "edc_19", employee_id: "emp_w009", kind: "kontrak_kerja", attachment_id: null, doc_no: "PKWT/2026/007", doc_no_source: "typed", issued_on: "2026-01-02", expires_on: "2026-10-02", note: "PKWT sembilan bulan.", recorded_by: "usr_wulan", recorded_at: "2026-02-03T11:03:00+08:00" },
  { id: "edc_20", employee_id: "emp_w009", kind: "foto", attachment_id: null, doc_no: null, doc_no_source: null, issued_on: "2024-01-02", expires_on: null, note: null, recorded_by: "usr_wulan", recorded_at: "2026-02-03T11:04:00+08:00" },

  { id: "edc_21", employee_id: "emp_w011", kind: "ktp", attachment_id: null, doc_no: "3301092108870009", doc_no_source: "typed", issued_on: "2015-04-22", expires_on: null, note: null, recorded_by: "usr_wulan", recorded_at: "2026-02-03T11:20:00+08:00" },
  { id: "edc_22", employee_id: "emp_w011", kind: "foto", attachment_id: null, doc_no: null, doc_no_source: null, issued_on: "2024-01-02", expires_on: null, note: null, recorded_by: "usr_wulan", recorded_at: "2026-02-03T11:21:00+08:00" },
  /* The warning letter that produced the payslip deduction (D155). Same event,
     two records, and this is the one somebody can hold. */
  { id: "edc_23", employee_id: "emp_w011", kind: "sp", attachment_id: null, doc_no: "SP-1/2026/003", doc_no_source: "typed", issued_on: "2026-09-02", expires_on: "2027-03-02", note: "SP-1: meninggalkan pekerjaan tanpa izin, 2 September. Berlaku enam bulan.", recorded_by: "usr_wulan", recorded_at: "2026-09-02T16:00:00+08:00" },

  /* The reading came back fifteen digits. Nobody can see that from the number
     — it is masked — so the screen says the length is wrong instead, which is
     a fact about the scan rather than about Sujono (D195). */
  { id: "edc_24", employee_id: "emp_w012", kind: "ktp", attachment_id: "att_41", doc_no: "330109010392001", doc_no_source: "extracted", issued_on: "2017-08-30", expires_on: null, note: null, recorded_by: "usr_wulan", recorded_at: "2026-02-03T11:40:00+08:00" },
  /* Filed last week, nobody has read the number out of it yet. Absent, not
     blank: somebody is expected to come back to this one. */
  { id: "edc_28", employee_id: "emp_w012", kind: "kartu_keluarga", attachment_id: "att_42", doc_no: null, doc_no_source: "pending", issued_on: null, expires_on: null, note: "Berkas sudah di Drive, nomornya belum dibaca.", recorded_by: "usr_wulan", recorded_at: "2026-09-10T14:21:00+08:00" },
  { id: "edc_25", employee_id: "emp_w006", kind: "ktp", attachment_id: null, doc_no: "3301095512850006", doc_no_source: "typed", issued_on: "2014-12-11", expires_on: null, note: null, recorded_by: "usr_wulan", recorded_at: "2026-02-03T12:00:00+08:00" },
  { id: "edc_26", employee_id: "emp_w006", kind: "kartu_keluarga", attachment_id: "att_42", doc_no: "3301091809100005", doc_no_source: "extracted", issued_on: "2018-03-07", expires_on: null, note: null, recorded_by: "usr_wulan", recorded_at: "2026-02-03T12:01:00+08:00" },
  { id: "edc_27", employee_id: "emp_w006", kind: "foto", attachment_id: null, doc_no: null, doc_no_source: null, issued_on: "2024-01-02", expires_on: null, note: null, recorded_by: "usr_wulan", recorded_at: "2026-02-03T12:02:00+08:00" },
];

/** Requests: one waiting, one approved, one refused, and one that would run
 *  past the person's entitlement (D178).
 *
 *  The last is the interesting one. Utami has three days a year and has asked
 *  for four; nothing refuses it — days beyond the balance are still taken and
 *  still recorded, they are simply not paid (D144). What the screen must do is
 *  say so **before** the decision, rather than leaving it to be discovered on
 *  a payslip.
 */
export const LEAVE_REQUESTS: LeaveRequest[] = [
  {
    id: "lvr_01", request_no: "izn-26-09-08_01", employee_id: "emp_w016",
    kind: "cuti", from_date: "2026-09-21", to_date: "2026-09-23", days: 3,
    reason: "Pernikahan adik di Banyuwangi.",
    status: "PENDING",
    requested_by: "usr_wulan", requested_at: "2026-09-08T09:15:00+08:00",
    decided_by: null, decided_at: null, decision_note: null,
  },
  {
    id: "lvr_02", request_no: "izn-26-09-09_01", employee_id: "emp_w020",
    kind: "cuti", from_date: "2026-09-28", to_date: "2026-10-01", days: 4,
    reason: "Pulang kampung, ibu sakit.",
    status: "PENDING",
    requested_by: "usr_wulan", requested_at: "2026-09-09T14:20:00+08:00",
    decided_by: null, decided_at: null, decision_note: null,
  },
  {
    id: "lvr_03", request_no: "izn-26-09-01_01", employee_id: "emp_w026",
    kind: "cuti", from_date: "2026-09-03", to_date: "2026-09-03", days: 1,
    reason: "Mengurus keluarga di kampung.",
    status: "APPROVED",
    requested_by: "usr_wulan", requested_at: "2026-09-01T10:00:00+08:00",
    decided_by: "usr_wulan", decided_at: "2026-09-02T15:00:00+08:00", decision_note: null,
  },
  {
    id: "lvr_04", request_no: "izn-26-09-07_01", employee_id: "emp_w012",
    kind: "izin", from_date: "2026-09-10", to_date: "2026-09-10", days: 1,
    reason: "Antar anak daftar sekolah.",
    status: "REJECTED",
    requested_by: "usr_wulan", requested_at: "2026-09-07T08:00:00+08:00",
    decided_by: "usr_wulan", decided_at: "2026-09-07T09:30:00+08:00",
    decision_note: "Hari itu pengiriman BABY ISLAND. Diizinkan pindah ke Jumat berikutnya.",
  },
];
