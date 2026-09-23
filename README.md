# Manufaktur OS

Kerangka aplikasi manajemen internal untuk manufaktur furnitur. **Belum ada
backend** — yang ada baru lapisan tampilan, navigasi, dan model izin.

```bash
npm install
npm run dev     # http://localhost:3000
```

## Keadaan sekarang

| | Status |
|---|---|
| Shell aplikasi (sidebar, topbar, layout) | Jadi |
| Design system (token, komponen, grafik) | Jadi |
| Navigasi 9 seksi / 36 rute | Jadi |
| Katalog izin + 8 peran | Jadi (frontend) |
| Halaman Dashboard | Jadi, **data contoh** |
| 35 halaman modul lain | Placeholder |
| Backend | **Belum ada** — `backend/` masih folder kosong |
| Autentikasi | **Belum ada** — peran dipilih lewat dropdown dev di topbar |

## Sebelum ditunjukkan ke siapa pun

Tiga nilai masih sementara dan sengaja ditaruh di satu tempat masing-masing:

1. **Nama aplikasi** — `src/lib/brand.ts`
2. **Warna merek** — `tailwind.config.ts`, skala `brand` (sekarang `#2f6b52`,
   placeholder). Kalau diganti, turunkan **seluruh** skala 50–950, jangan hanya
   menukar `700`. Samakan juga `BRAND` di `src/components/charts/charts.tsx`
   dan `themeColor` di `src/app/layout.tsx`.
3. **Data contoh di Dashboard** — `src/app/(app)/dashboard/page.tsx`

Dan satu yang harus **dihapus**, bukan diganti: pemilih peran di topbar
(`src/components/layout/topbar.tsx`). Itu alat bantu pengembangan; di produksi
peran datang dari sesi, bukan dari dropdown yang bisa diubah siapa saja.

## Cara kerjanya

**Menu adalah data.** `src/lib/nav.ts` mendefinisikan seluruh navigasi sebagai
array. Sidebar menyaringnya dengan `can(item.permission)` — item yang tidak
diizinkan **tidak dirender sama sekali**, bukan disembunyikan CSS, dan seksi
yang jadi kosong ikut hilang. Menambah halaman = menambah satu baris di
`nav.ts`, bukan menyunting komponen navigasi.

**Izin didefinisikan di kode**, bukan sebagai data yang diketik manusia
(`src/lib/roles.ts`). Konsekuensinya database baru bisa di-bootstrap ulang dari
nol tanpa ada yang menebak peran apa saja yang seharusnya ada, dan penambahan
modul terlihat sebagai perubahan yang bisa di-review.

> `can()` di frontend hanya menyembunyikan menu. Penegakan yang sebenarnya
> harus ada di backend — siapa pun bisa memanggil API tanpa lewat halaman ini.

**Detail dibuka di panel kanan (Drawer), bukan halaman baru.** Navigasi antar
halaman hanya untuk berpindah modul. Ini yang membuatnya terasa seperti
perangkat lunak desktop: konteks tabel di belakang tetap terlihat, dan menutup
panel mengembalikan pengguna persis ke tempatnya semula. Lihat Dashboard —
klik salah satu baris order.

**Motion hanya dua keyframe**: `fade-in` dan `slide-in`. Sisanya
`transition-colors`. Aplikasi yang dipakai delapan jam sehari tidak boleh
membuat penggunanya menunggu animasi.

## Catatan uji

Grafik recharts **tampak kosong pada screenshot headless Chrome** — animasi
masuknya tidak pernah maju di bawah virtual time, jadi bentuknya tertangkap
pada keadaan awal (nol). Di browser sungguhan normal. Kalau perlu memverifikasi
grafik lewat screenshot otomatis, matikan animasinya sementara
(`isAnimationActive={false}`), jangan menyimpulkan grafiknya rusak.

## Akun dan kata sandi — technical debt

Belum ada halaman profil, dan akun belum bisa dibuat atau di-reset dari
aplikasi. Setiap akun baru dan setiap *lupa sandi* masih dikerjakan lewat SQL
langsung ke `auth.users` (lihat `supabase/import/RUNLOG.md`). Tercatat sebagai
**W7** (halaman profil + ganti sandi) dan **W8** (setup akun, sandi sementara,
wajib ganti saat login pertama, custom SMTP) di `docs/plan/backlog.md`.

## Yang perlu dibangun berikutnya

Berdasarkan evaluasi, urutan yang disarankan:

1. Backend + autentikasi + audit log (dibutuhkan semua modul)
2. Master data, dengan **model satuan dan konversi yang benar** — lihat di bawah
3. Procurement (PR → PO → Receiving) + lampiran
4. Accounting dasar

### Yang harus dirancang benar sejak awal

**Satuan bukan sekadar label.** Kayu dibeli per m³, digergaji jadi papan dengan
rendemen 45–60%, dikeringkan (susut lagi), lalu dipotong jadi komponen per
batang dengan sisa potong 10–30%. Ini rantai konversi dengan rendemen, bukan
buku stok sederhana. Butuh `UnitOfMeasure` + `UomConversion` + stok disimpan
dalam satuan dasar. Kalau ini salah, Inventory, BOM, dan costing ikut salah.

**Persetujuan berjenjang.** Satu kolom `approved_by` tidak cukup. Manufaktur
butuh batas nominal (di bawah X cukup supervisor, di atas Y harus direksi) dan
routing berdasarkan anggaran. Rancang sebagai tabel aturan, bukan `if` di
service.

**Lampiran dan alur masuk dari luar.** Kalau data masuk lewat Google Chat,
pesan mendarat di tabel `submissions` berstatus pending dengan `message_id`
sebagai kunci unik (anti-duplikat), lampiran ke object storage, dan hasil
ekstraksi AI sebagai **usulan**. Manusia ber-izin menyetujuinya di dalam
aplikasi sebelum menyentuh tabel bisnis. AI mengusulkan, tidak pernah
memposting — kalau tidak, keanggotaan channel chat menjadi batas otorisasi ke
buku besar.
