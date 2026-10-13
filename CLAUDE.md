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

### Automated data collection records every layer it can see (D431)

> *every automated data collection should record every layer of information
> to help trace back an incident or anomaly detection* (D431, 2026-10-13)

Any record the system captures **on its own** at the moment something
happens — an attendance tap (`tap_self`), a reader/biometric import, a
location reading, an upload, a sign-in, a webhook — stores, beside the
business fact, **everything that was observable about where it came from**,
so an incident can be traced back and anomalies (one phone clocking in for
two people, a tap from an unknown network, a spoofed GPS point) can be found
later. At minimum, per event:

| Layer | What to store | Where it comes from |
|---|---|---|
| Who | `auth.uid()`, the employee/record it is for, the session id | the seam, never the client |
| When | server time (`now()`), and the device's own clock if sent | server; client clock only as a second reading |
| Network | client IP (`x-forwarded-for` first hop / `cf-connecting-ip`), and the full forwarded chain | read **inside the seam** from `current_setting('request.headers', true)` — never a parameter the client fills in |
| Device / app | user agent, platform, a stable per-install device id (generated once, kept in the app's storage), app build, PWA vs browser, screen, language, timezone | sent by the client as a `jsonb` context; stored as given |
| Place | GPS lat/lng/accuracy, and the verdict against the site (0188) | the phone, read once at the event |
| Evidence | photo, note, file ids | as today |
| Source | `source` (`self`/`import`/`manual`), import file, reader serial and verify mode | the importer |

- **Store it raw, as a side table or `jsonb` column next to the fact**
  (like `scan_locations`, 1:1 with the scan), append-only. Collecting is
  never a reason to **refuse** the event: missing layers are stored as
  missing and flagged, not blocked (A6, F267).
- **A header the server reads beats a value the client reports.** Anything a
  client sends (device id, local clock) is evidence, not proof — label it
  that way and never base a decision on it alone.
- **MAC addresses are not collectable** from a web app/PWA: browsers never
  expose them, and IP traffic only carries the MAC of the last router hop.
  The per-install device id is the stand-in. Only a native app or the
  office Wi-Fi/router logs can give a MAC; do not promise one.
- **It is personal data** (UU PDP 27/2022): readable only by the record's
  owner and the module's admins (the same RLS as the fact), kept in the
  module's schema, and employees are told it is collected.
- A new feature that collects data automatically is not done until its
  migration stores these layers and the review screen can show them.

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
