# CLAUDE.md — ops.talaliving

Start every session at `docs/plan/README.md` (milestone board, where things
stand) and `docs/plan/07-ways-of-working.md` (the loop). Decisions are in
`docs/plan/06-decisions.md`, lessons in `docs/plan/findings.md`, endpoints in
`docs/plan/03-api.md`. Do not re-derive what those already settle.

## Standing rules from the owner — apply in every session

### File storage: everything in the OPS folder, one folder per task (D313, 2026-09-25)

> *folder OPS untuk menampung semua file yang dipakai di web apps
> ops.talaliving, dan harus buat per folder untuk tugas tertentu.*

- Every file this app stores goes to the **`OPS` folder of the module's shared
  drive** (PROCUREMENT, ACCOUNTING, HRD, DRAFTING, PRODUCTION, PROJECT MANAGER,
  IT). The id in `ops_core.drive_folders.parent_folder_id` **is** that OPS
  folder — never create an `ops` folder inside it.
- **Never loose in OPS**: each file goes in a folder for its task, e.g. in the
  Procurement drive:

  ```
  OPS
  ├── INVENTORY
  │   ├── ITEMS            (item photos, D309)
  │   └── FINISHED GOODS   (finished product photos, D311)
  └── RECEIVING REPORT     (receiving reports, goods photos, vendor delivery notes)
  ```

- The folder is decided by the database, not the screen:
  `ops_core.drive_paths` (kind + the record the file is filed against → path
  under OPS); no row = the kind's own name in capitals (`purchase_order` →
  `PURCHASE ORDER`). The upload route (`src/app/api/documents/upload/route.ts`)
  finds or creates each folder level (`src/lib/drive.ts`).
- **A new feature that stores files must** pass `entity` to
  `documents.upload(...)` and, when its files need their own folder, add a
  `drive_paths` row in its migration. The drive itself is still chosen only by
  `ops_core.doc_kind_drive` — that is the personal-data boundary (0035).

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
