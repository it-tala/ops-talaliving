# GitHub — PR menyelesaikan tugas, dan papan GitHub Projects (D382)

Untuk admin. Semua yang di bawah ini dipasang **oleh manusia**, sekali, di
GitHub dan di Cloudflare. Tidak ada secret yang ditulis ke repo ini atau ke
log — semua nilai rahasia hanya diketik di dua tempat: pengaturan webhook
GitHub dan *Variables and Secrets* Worker di Cloudflare.

## Cara kerjanya (ringkas)

```
PR dibuka / di-merge di repo mana pun milik it-tala
   │  webhook organisasi (event: Pull requests), ditandatangani HMAC-SHA256
   ▼
POST https://ops.talaliving.com/api/github/webhook      (Cloudflare Worker)
   │  cek X-Hub-Signature-256 dengan GITHUB_WEBHOOK_SECRET
   ▼
ops_hr.github_pull_request(...)    (hanya service_role yang bisa memanggil)
   │  nomor tugas di judul/badan PR → pemegang tugas?
   │    ya  : dibuka → tugas "mulai"; di-merge ke branch default → selesai & serahkan
   │    tidak: tugas tetap terbuka, PR dicatat, HRD diberi tahu (lonceng)
   ▼
trigger 0215 memberi tahu HRD + pemberi tugas saat tugas diserahkan

Cron Worker (tiap 10 menit) → /api/github/projects/sync
   → ops_hr.github_project_due → GitHub GraphQL (draft issue di papan) → github_project_synced
```

- **Nomor tugas** ditulis di judul atau deskripsi PR, mis. `Tugas: tgs-26-10-06_02`.
  Huruf besar/kecil tidak masalah; satu PR boleh menyebut sampai 10 tugas.
- **Pemegang tugas** = login GitHub penulis PR dipetakan ke akun ops pemegang
  tugas di **IT → GitHub** (`/it/github`). Login yang belum dipetakan
  diperlakukan seperti orang lain: tugas tetap terbuka dan HRD memutuskan.
- **Branch default** dibaca dari repo (`repository.default_branch`), jadi repo
  dengan `main` atau `master` sama-sama jalan. Merge ke branch lain (mis.
  `staging`) hanya dicatat.
- **Kiriman ulang** dari GitHub (otomatis atau tombol *Redeliver*) dikenali
  dari `X-GitHub-Delivery` dan tidak mengubah apa pun dua kali.
- **Tugas IT di papan** = tugas yang pemegangnya punya login GitHub terpetakan.
  Item di papan adalah *draft issue* yang ditulis ops; perubahan di GitHub
  ditimpa saat tugasnya berubah di ops. Tugas dibatalkan → item diarsipkan.

### Biaya dan batasan (diperiksa 2026-10-06)

- **GitHub Projects gratis** untuk organisasi di paket Free; tidak ada yang
  berbayar di sini. Batas item: **50.000 item per project** (dinaikkan dari
  1.200; [changelog GitHub 2025-02-26](https://github.blog/changelog/2025-02-26-increased-items-in-github-projects-now-in-public-preview/)).
- **Webhook organisasi**: gratis, termasuk repo privat.
- **Cron Trigger Cloudflare Workers**: termasuk di paket Workers mana pun.
  Versi preview (`wrangler versions upload`) tidak menjalankan cron; hanya
  produksi yang menyinkronkan.
- **Token** (langkah 5) terikat ke satu akun GitHub dan punya masa berlaku.
  Saat kedaluwarsa, papan berhenti tersinkron dan `/it/github` menulis
  galatnya per tugas — webhook PR tetap jalan karena tidak memakai token ini.

## Langkah pemasangan

Urutan penting: database dulu, lalu kode, lalu GitHub.

### 1. Database (oleh Claude, setelah pemilik menyetujui)

Migrasi `supabase/migrations/0226_core_github.sql` diterapkan ke project
Supabase `hhphmfqbtwcxpvubmwbq`. Tanpa ini webhook menjawab 500.

### 2. Kode (merge PR)

Merge PR ke `main`. Workers Builds menjalankan `wrangler deploy`, yang juga
memasang cron `*/10 * * * *` dari `wrangler.jsonc`. Periksa di Cloudflare:
**Workers & Pages → ops-talaliving → Settings**, bagian trigger (*Cron
Triggers*), menampilkan `*/10 * * * *`.

`SUPABASE_SERVICE_ROLE_KEY` sudah ada sebagai Secret (D325) — dipakai juga di
sini. Bila belum ada, webhook menjawab 503 dengan kalimat itu.

### 3. Secret webhook

1. Buat nilai acak di komputer sendiri (jangan di layanan online):
   ```bash
   openssl rand -hex 32
   ```
   Simpan sementara di password manager — nilai ini dipakai di dua tempat.
2. Cloudflare dashboard → **Workers & Pages → ops-talaliving → Settings →
   Variables and Secrets → Add**:
   - Type: **Secret**
   - Variable name: `GITHUB_WEBHOOK_SECRET`
   - Value: nilai dari langkah 1
   - **Deploy**.

### 4. Webhook organisasi `it-tala`

Butuh akun **owner** organisasi.

1. Buka `https://github.com/organizations/it-tala/settings/hooks` →
   **Add webhook**.
2. Isi:
   - **Payload URL**: `https://ops.talaliving.com/api/github/webhook`
     (alamat produksi aplikasi; bila domain belum diarahkan ke Worker, pakai
     URL `*.workers.dev` produksi Worker `ops-talaliving`).
   - **Content type**: `application/json`.
   - **Secret**: nilai yang sama dengan `GITHUB_WEBHOOK_SECRET`.
   - **SSL verification**: Enable.
   - **Which events…**: pilih **Let me select individual events**, centang
     **Pull requests** saja (hapus centang *Pushes*).
   - **Active**: tercentang.
3. **Add webhook**. GitHub langsung mengirim `ping`. Di tab **Recent
   Deliveries** webhook itu harus tampak `200` dengan jawaban
   `{"ok":true,"pong":true}`.
   - `401` → secret di GitHub ≠ `GITHUB_WEBHOOK_SECRET`.
   - `503` → secret belum diisi di Cloudflare, atau belum di-deploy.
   - `404` → kode PR ini belum ter-deploy.

### 5. Petakan akun GitHub tim IT

Login sebagai akun dengan IT admin → **IT → GitHub** → *Akun GitHub*: pilih
akun ops, ketik login GitHub orangnya (tanpa `@`), **Petakan**. Satu login
untuk satu akun. Sampai dipetakan, PR orang itu tidak menggerakkan tugas
(HRD yang diberi tahu).

### 6. Papan GitHub Projects

1. `https://github.com/orgs/it-tala/projects` → **New project** → template
   **Board** → nama mis. `Tugas IT` → **Create project**.
2. Catat **nomor** papan dari URL: `https://github.com/orgs/it-tala/projects/<NOMOR>`.
3. Kolom *Status* bawaan (`Todo`, `In Progress`, `Done`) sudah dipakai apa
   adanya. Opsional:
   - tambahkan opsi Status **`Blocked`** — tugas tertahan masuk ke sana
     (tanpa itu: *In Progress*);
   - tambahkan field **`Jatuh tempo`** bertipe **Date** (⋯ → *Settings* →
     *Custom fields* → **+ New field**) — diisi jatuh tempo tugas.
   Nama opsi/field dicocokkan tanpa peduli huruf besar; `Selesai`,
   `Sedang dikerjakan`, `Belum mulai`, `Tertahan`, `Due date` juga dikenali.

### 7. Token untuk menulis papan

Pakai akun GitHub anggota `it-tala` yang boleh menulis project (sebaiknya
akun IT bersama, bukan akun pribadi yang bisa keluar). Item di papan tampil
"ditambahkan oleh" akun ini.

**Fine-grained token (disarankan):**

1. Masuk sebagai akun itu → `https://github.com/settings/personal-access-tokens/new`.
2. **Token name**: `ops-talaliving projects`. **Resource owner**: `it-tala`.
3. **Expiration**: sepanjang yang diizinkan organisasi; catat tanggalnya
   untuk diperbarui.
4. **Repository access**: *Public repositories* (token ini tidak perlu repo).
5. **Permissions → Organization permissions → Projects**: **Read and write**.
6. **Generate token**, salin nilainya (tampil sekali).
7. Bila organisasi mewajibkan persetujuan token, owner menyetujuinya di
   pengaturan organisasi `it-tala` → **Personal access tokens → Pending
   requests**.

Bila organisasi tidak mengizinkan fine-grained token: *classic* token di
`https://github.com/settings/tokens/new` dengan scope **`project`** saja.
Bila organisasi memakai SAML SSO, klik **Configure SSO → Authorize** untuk
`it-tala` pada token itu.

### 8. Secret papan di Cloudflare

**Workers & Pages → ops-talaliving → Settings → Variables and Secrets → Add**,
semuanya Type **Secret** (dua yang terakhir tidak rahasia, tapi variabel
biasa yang diisi di dashboard hilang saat deploy — lihat `wrangler.jsonc`):

| Name | Value |
|---|---|
| `GITHUB_PROJECTS_TOKEN` | token dari langkah 7 |
| `GITHUB_PROJECT_OWNER` | `it-tala` |
| `GITHUB_PROJECT_NUMBER` | nomor dari langkah 6 |
| `OPS_BASE_URL` *(opsional)* | `https://ops.talaliving.com` — tautan di tiap item |

**Deploy**. Dalam ≤ 10 menit, `/it/github` → *GitHub Projects* menunjukkan
*Item tertulis* > 0 (bila ada tugas terbuka milik orang yang dipetakan).
Galat tampil per tugas dengan kalimat dari GitHub.

### 9. Uji sekali

1. HRD memberi tugas uji ke anggota IT yang sudah dipetakan; catat nomornya.
2. Orang itu membuka PR di repo `it-tala` mana pun, judul/badan memuat
   `Tugas: tgs-…`. → `/hrd/tugas`: tugas *sedang dikerjakan*, PR tampil di
   bawahnya; GitHub *Recent Deliveries*: `200`.
3. Merge PR ke branch default. → tugas **selesai**, catatan serah = PR + judul
   + link; HRD dan pemberi tugas mendapat lonceng; item papan pindah ke
   *Done* dalam ≤ 10 menit.
4. Orang lain membuka PR menyebut nomor yang sama → tugas tetap terbuka, HRD
   mendapat lonceng *bukan dari pemegang tugasnya*.

## Mengganti secret

- **Webhook secret**: buat nilai baru, ubah dulu di Cloudflare
  (`GITHUB_WEBHOOK_SECRET`), lalu di pengaturan webhook GitHub (*Edit* →
  *Secret*). Kiriman di antara dua langkah itu menjawab 401 dan bisa di-
  *Redeliver*.
- **Token papan**: buat token baru, ganti `GITHUB_PROJECTS_TOKEN`, hapus token
  lama di GitHub. Tugas yang gagal tersinkron dicoba lagi saat tugasnya
  berubah; untuk memaksa semua dicoba ulang, minta Claude menjalankan
  `update ops_hr.task_github_items set attempts = 0 where last_error is not null`.
