# CLAUDE.md — ops.talaliving

Start every session at `docs/plan/README.md` (milestone board, where things
stand) and `docs/plan/07-ways-of-working.md` (the loop). Decisions are in
`docs/plan/06-decisions.md`, lessons in `docs/plan/findings.md`, endpoints in
`docs/plan/03-api.md`. Do not re-derive what those already settle.

## Standing rules from the owner — apply in every session

### File storage: everything in the app's `ops-talaliving` folder, one folder per task (D313, D320)

> *folder OPS untuk menampung semua file yang dipakai di web apps
> ops.talaliving, dan harus buat per folder untuk tugas tertentu.* (D313,
> 2026-09-25)
>
> *silahkan buat folder drive nya ops-talaliving* (D320, 2026-09-28)

- Every file this app stores goes to the **`ops-talaliving` folder at the
  root of the module's shared drive** (PROCUREMENT, ACCOUNTING, HRD, DRAFTING,
  PRODUCTION, PROJECT MANAGER, IT). **The app makes that folder itself**,
  because uploads use the `drive.file` permission, which sees only what the
  app made. The owner's hand-made OPS folders answered *File not found* for
  that reason (F173). Its id is `ops_core.drive_folders.folder_id`, and the
  shared drive's is `drive_id`. `parent_folder_id` (the hand-made OPS) only
  says which drive it is. IT → Google Drive (`/it/drive`) makes the folder
  for every drive and shows which drives the app cannot reach.
- **Never loose in `ops-talaliving`**: each file goes in a folder for its
  task, e.g. in the Procurement drive:

  ```
  ops-talaliving
  ├── INVENTORY
  │   ├── ITEMS            (item photos, D309)
  │   └── FINISHED GOODS   (finished product photos, D311)
  └── RECEIVING REPORT     (receiving reports, goods photos, vendor delivery notes)
      └── <YYYY-MM>/<YYYY-MM-DD>   by the day it arrived (D360), as ACCOUNTING files
                                   TRANSACTIONS/<YYYY-MM>/<YYYY-MM-DD> (D359)
  ```

- The folder is decided by the database, not the screen:
  `ops_core.drive_paths` (kind + the record the file is filed against → path
  under `ops-talaliving`); no row = the kind's own name in capitals
  (`purchase_order` → `PURCHASE ORDER`). The upload route
  (`src/app/api/documents/upload/route.ts`) finds or creates each folder level
  (`src/lib/drive.ts`).
- **A new feature that stores files must** pass `entity` to
  `documents.upload(...)` and, when its files need their own folder, add a
  `drive_paths` row in its migration. The drive itself is still chosen only by
  `ops_core.doc_kind_drive` — that is the personal-data boundary (0035).

### Presence and identity records keep their trace (D431, narrowed by D432)

> *every automated data collection should record every layer of information
> to help trace back an incident or anomaly detection* (D431, 2026-10-13) —
> narrowed the next day to the records where somebody proves they were
> there, or who they are (D432, 2026-10-14).

**In scope:** attendance taps from a phone (`tap_self`, done in `0270`), and
any future record of the same kind: a sign-in, a QC check-in at a factory, a
delivery signed for. **Not in scope:** uploads, imports and ordinary saves.
They are made by a signed-in person and already traced to them by
`recorded_by`/the audit trail. Adding network and device layers to every
feature costs more than it catches.

What an in-scope record keeps, beside the business fact, in a side table 1:1
with it (like `ops_hr.scan_traces`), append-only:

| Layer | What | Where it comes from |
|---|---|---|
| Network | client IP, the raw forwarded chain, user agent, auth session | `ops_core.request_trace()`, read **inside the seam** from the request. Never a parameter the client fills in |
| Device | a per-install device id, the device's own clock, the app build (`NEXT_PUBLIC_OPS_BUILD_ID`), display mode, timezone | `src/lib/device.ts` → a `p_client jsonb` parameter, stored as sent |
| Place | GPS and its verdict | as `scan_locations` (0188) |
| Corroboration | is the address one of the site's **office networks** (`work_sites.networks`) | matched at write time and stored, so a later edit cannot rewrite it |

- **Never refuse for a missing layer** (A6): no headers, no context or a
  malformed device id is stored as missing.
- **The server's reading beats the client's word.** A device id or device
  clock is evidence, not proof. Flag on it, but never decide on it alone.
  Flag only what is rare when honest (one device for two people). Show,
  don't flag, what is common when honest (off the office network on mobile
  data).
- **Never store `authorization`, `apikey` or `cookie` headers.**
  `request_trace` keeps named headers only.
- **No MAC address.** Browsers never expose it. The device id is the
  stand-in; do not promise a MAC.
- **Personal data** (UU PDP 27/2022): the same RLS as the fact (the person
  and the module's admins), and the screen tells people what a tap records.

## Working conventions

- Two API layers must match: `src/lib/api/*` (real, Supabase) and
  `src/demo/api/*` (sandbox). Contracts in `src/services/*/contracts.ts`.
- Migrations in `supabase/migrations/` are the schema; seams return
  envelopes (`ops_core.ok/refused/invalid/conflict/not_found`). Every new
  table ends with `analyze`; every security-definer function is granted to
  `authenticated` and decides inside. A new enum value cannot be used in the
  migration that adds it (F161).
- Before pushing: `npm run verify` (app) and the database job — rebuild the
  ladder and run the smoke suite (`supabase/local/rebuild.sh`,
  `supabase/local/smoke.sh`, `node scripts/check-view-contracts.mjs`). Walk
  changed screens in a browser, not only `tsc` (F164).
- Record a decision (`D…`) for anything the owner decided, a finding (`F…`)
  for anything the work taught, and update the README board.

## Konvensi kerja per sesi (branch hygiene)

### Satu sesi, satu fitur

Setiap sesi Claude fokus ke **satu fitur/perbaikan**, di satu branch. Jangan
menumpuk beberapa perubahan yang tidak berkaitan ke satu branch/sesi yang sama
— kalau muncul permintaan lain yang lepas dari task berjalan, itu branch baru
(dan sesi baru), bukan tambahan di branch yang sedang berjalan.

### Begitu fitur siap: PR, merge, hapus branch

1. Verifikasi perubahan (typecheck/lint/test/build yang relevan — `npm run
   verify` kalau memungkinkan) sebelum membuka PR.
2. Buka PR ke `main`.
3. Setelah PR di-merge (dan hanya setelah itu — jangan hapus branch yang
   PR-nya masih open atau masih ditinjau CI/reviewer), **langsung hapus
   branch-nya saat itu juga**:
   ```bash
   git push origin --delete <nama-branch>
   ```
   atau lewat tombol "Delete branch" di halaman PR GitHub setelah merge.
4. PR yang ditutup TANPA merge (superseded, dibatalkan, salah arah) juga
   dihapus branch-nya — jangan dibiarkan nyangkut sebagai riwayat mati.

Kalau ada akses ke pengaturan repo, aktifkan **"Automatically delete head
branches"** di GitHub Settings → General, supaya langkah 3 terjadi otomatis
begitu tombol merge ditekan dan tidak bergantung diingat manual.

Tujuannya: daftar branch di repo ini hanya berisi branch yang benar-benar
sedang berjalan, bukan puluhan branch mati dari sesi-sesi lama yang bikin
`git branch -r` / halaman branch GitHub penuh dan sulit dibaca.
