import type { DemoBacklog } from "../state";

/** The daftar tunggu (D381): known work, no person, no due date yet.
 *
 *  Three on the ordered list in three different fields — so the bidang filter
 *  has something to filter — one of them a part-to-be of the hotel order, and
 *  one proposal from Andi still waiting for HRD's answer.
 */
const base = {
  detail: null, accepted_by: "usr_wulan", task_id: null, assigned_by: null, assigned_at: null,
  dropped_reason: null, dropped_by: null, dropped_at: null, proposed: false,
} as const;

export const BACKLOG: DemoBacklog[] = [
  {
    ...base, id: "blg_001", item_no: "blg-26-10-02_01",
    title: "Halaman selisih stok: opname dibanding saldo",
    deliverable: "Halaman di ops yang menampilkan selisih per item, bisa diunduh Excel",
    unit: "IT", goal_id: null, status: "OPEN", sort_key: 1,
    created_by: "usr_wulan", created_at: "2026-10-02T09:10:00+07:00", accepted_at: "2026-10-02T09:10:00+07:00",
  },
  {
    ...base, id: "blg_002", item_no: "blg-26-10-02_02",
    title: "Gambar kerja meja makan 6 kursi untuk Hotel Sanur",
    deliverable: "PDF gambar kerja + ukuran di DRAFTING/ops-talaliving",
    unit: "Drafting", goal_id: "goal_001", status: "OPEN", sort_key: 2,
    created_by: "usr_wulan", created_at: "2026-10-02T09:20:00+07:00", accepted_at: "2026-10-02T09:20:00+07:00",
  },
  {
    ...base, id: "blg_003", item_no: "blg-26-10-05_01",
    title: "Bandingkan harga tiga vendor busa untuk 2027",
    deliverable: "Tabel perbandingan harga dan syarat bayar, dikirim ke email pimpinan",
    detail: "Tidak mendesak — dipakai saat kontrak vendor busa diperpanjang Januari.",
    unit: "Procurement", goal_id: null, status: "OPEN", sort_key: 3,
    created_by: "usr_wulan", created_at: "2026-10-05T10:00:00+07:00", accepted_at: "2026-10-05T10:00:00+07:00",
  },
  {
    ...base, id: "blg_004", item_no: "blg-26-10-05_02",
    title: "Kolom kode warna kain di BOM",
    deliverable: "Kolom warna di BOM dan ikut tercetak di PR",
    unit: "IT", goal_id: null, status: "PROPOSED", sort_key: null, proposed: true,
    created_by: "usr_andi", created_at: "2026-10-05T14:30:00+07:00",
    accepted_by: null, accepted_at: null,
  },
];
