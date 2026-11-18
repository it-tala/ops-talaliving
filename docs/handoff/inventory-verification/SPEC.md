# Spec: Asset verification (inventory recap)

Status: proposal for the owner to approve. UI copy is **English by default**, with an Indonesian version of each string through `tr(en, id)` (D318). Data read from the database is shown as stored.

## 1. Why

Production has stopped, and the company is recapping everything it owns. The current inventory screens are hard to use for this job. The team needs one simple flow:

> Go to a zone → open an item that is already on record → check each field against the real thing → record its condition, location and a photo → save → next item.

Anything that does not match is collected in one list, so someone can correct the record later.

## 2. Scope

**In v1**
- Import the 163 records of the 2013 machine register (`data/legacy_2013_register.csv`) as assets, together with their 2013 photos.
- Add the site-plan zones (`data/zones.csv`) to the shared location list.
- Three screens: **Item list by zone**, **Verify one item**, **Mismatch summary**.
- Record a verification for each asset: a check on each field, condition, current location, note, and photos.
- Apply a correction from the summary to the asset record. This is an explicit action and is audited.

**Not in v1** (do not build)
- Registering new items during the check. The existing *Register an item* / asset create screens stay as they are.
- Site-plan map, voice notes, guided multi-step photo wizard, bays inside zones.
- Offline mode. Wi-Fi is available on site.
- Changing item or asset numbering (D347 stands: `AST-0001` stays meaningless and sequential).

## 3. Users and device

- Field checkers use a **tablet in landscape** (about 1180×820) on site Wi-Fi. The layout must also work on desktop.
- Admin/IT review mismatches on desktop.
- Permissions: follow the repo's existing pattern (`scripts/check-permissions.mjs`). Suggested split:
  - recording a verification needs the permission that already governs asset edits or stock adjustment;
  - applying a correction needs the asset-edit permission.
  - Confirm the exact permission names against the code before using them.

## 4. Data model (suggested; adapt to repo conventions)

### 4.1 `ops_inv.assets`: add legacy columns
| column | type | note |
|---|---|---|
| `legacy_code` | text unique null | 2013 code, e.g. `S2-14`. Searchable |
| `legacy_area` | text null | 2013 floor-grid code, normalised (`M16`). Old layout; does not match today's zones |
| `legacy_department` | text null | 2013 department, cleaned |
| `legacy_notes` | text null | Known issues from the 2013 analysis (`data_issue` + `photo_issue`) |

Optional: a `machine` value in `ops_inv.asset_categories` ("Machines"). Today's `tool` covers "Tools & equipment". Ask the owner which to use; don't decide alone.

### 4.2 `ops_inv.asset_verifications` (new, append-only)
| column | type | note |
|---|---|---|
| `id` | uuid pk | |
| `asset_id` | uuid fk → assets | |
| `result` | enum `match` · `mismatch` · `not_found` | `match` / `mismatch` are derived from the field checks; `not_found` is chosen explicitly |
| `condition` | enum `working` · `broken` · `untested` | null when `not_found` |
| `location` | text fk → `stock_locations(code)` | where it was found; null when `not_found` |
| `checks` | jsonb | `{"name":{"ok":true},"brand":{"ok":false,"found":"HUA HUA"},"model":{"ok":true},"qty":{"ok":true}}`. Fields checked: `name`, `brand`, `model`, `qty` (extendable) |
| `note` | text null | |
| `verified_by`, `verified_at` | | |
| `applied_by`, `applied_at` | null until a correction is applied | |

Rules:
- Never update or delete a verification. A recheck is a new row, and the **latest row per asset is the current status**.
- `mismatch` requires at least one check with `ok:false` and a `found` value.
- `match` requires all four fields checked and all `ok:true`.
- A verification that is not `not_found` needs **at least one photo** (the whole machine). Enforce this at the seam, the same way D309 enforces item photos.

### 4.3 Photos
- Add `asset_verification` to `ops_core.link_entity_t`, so photos attach to the verification itself (proof of that check).
- Add a `drive_paths` row so they are filed under `ops-talaliving/INVENTORY/ASSET VERIFICATION/<asset_no>/` (D313/D320). Check the existing `INVENTORY` paths first and reuse what is there.
- Imported 2013 photos attach to the **asset** (`entity = asset`) as its record photo.

### 4.4 Seams
- `verify_asset(asset_no, result, condition, location, checks, note)` → verification id. Validates the rules above.
- `apply_verification(verification_id)` → writes the `found` values into the asset (name, brand, model; location from `location`) and stamps `applied_*`. For `qty` > 1, see §7.
- `v_asset_verification`: one row per asset with the latest verification (status `unverified` when none), the photo count, and the location of the asset or verification. This feeds the list and the zone counts.
- Add both seams to the API contracts and to both clients, following `docs/plan/03-api.md` and the parity check.

### 4.5 Locations
- Insert the zones from `data/zones.csv` into `ops_inv.stock_locations`. Use `code`, the English `name`, and only rows with `holds_items` = yes or maybe.
- The existing rows `GUDANG`, `BENGKEL`, `FINISHING` (and any others found in production) **stay**. Ask the owner how they map to the new zones before moving anything.

## 5. Screens

Design reference: `reference/design/*.dc.html` (static markup with exact colours and spacing). They are also on the canvas https://claude.ai/artifact/Qx9oewWGEMYFH5WnZxJnmF. The mockups are in Indonesian; use the English copy in §6. Build with the repo's existing components and styles. Don't paste mockup markup.

### 5.1 Item list by zone — `/inventory/verify`
- Top: search (asset no, legacy code, name, brand, model) and overall progress (*37 of 163 verified*).
- Left rail: zones with `verified/total` and a thin progress bar, plus *All zones* and *No location*. Imported machines start with no location, so *No location* is where most work begins.
- Main: status tabs with counts: *All · Unverified · Match · Mismatch · Not found*.
- Grid of cards, 3 per row on a tablet: the record photo, a status pill, the asset no in mono font, *Old: S2-01*, the name, and brand · model.
- Clicking a card opens 5.2.

### 5.2 Verify one item — `/inventory/verify/[asset_no]`
- Header: back to the zone, the asset no, *Item 13 of 40*, previous/next.
- Left: the record photo (large), and *Verification photos* (up to 4; the first is required, labelled *Whole machine*, *Name plate*, *Other*).
- Right:
  - title, old code and 2013 area;
  - a live result pill (*Match*, *Mismatch: Brand*, or *2 fields unchecked*);
  - a field-check table with **Field · On record · On site [Match | Different]**. *Different* reveals a *Should be* input, prefilled with the record value;
  - a card with *Condition* (segmented: Working / Broken / Can't test), *Current location* (select from `stock_locations`, defaulting to the zone being worked), and *Note*.
- Footer:
  - *Not found* (red outline; asks for a note, then saves `not_found`);
  - *Save*;
  - *Save & next* (primary).
  - Save stays disabled until all fields are checked and the whole-machine photo is attached.

### 5.3 Mismatch summary — `/inventory/verify/review`
- Filters: zone and result (default: *Mismatch + Not found*).
- Stat row: Verified, Match, Mismatch, Not found.
- Table (use `DataTable`, so the Excel download from D427 comes for free) with these columns:
  - item (thumbnail, asset no, name, old code);
  - result pill;
  - differences, shown as `Brand: ~~MAS~~ → HUA HUA`;
  - condition · location;
  - verified by · time;
  - action: *Apply correction* for a mismatch, *Follow up* for not found (sets asset status `lost` only after confirmation; see §7).

## 6. Copy (EN default / ID)

| key | EN | ID |
|---|---|---|
| title | Asset verification | Verifikasi aset |
| progress | {n} of {total} verified | {n} dari {total} terverifikasi |
| zones | Zones | Zona |
| all zones | All zones | Semua zona |
| no location | No location | Tanpa lokasi |
| tab all / unverified / match / mismatch / not found | All · Unverified · Match · Mismatch · Not found | Semua · Belum · Sesuai · Tidak sesuai · Tidak ditemukan |
| old code | Old: {code} | Lama: {code} |
| record photo | Photo on record | Foto tercatat |
| verification photos | Verification photos | Foto verifikasi |
| photo slots | Whole machine · Name plate · Other | Seluruh mesin · Plat nama · Lainnya |
| photo required | Whole-machine photo required | Foto seluruh mesin wajib |
| table head | Field · On record · On site | Kolom · Data tercatat · Di lapangan |
| fields | Name · Brand · Model · Quantity | Nama · Merek · Model · Jumlah |
| buttons | Match · Different | Sesuai · Beda |
| should be | Should be | Seharusnya |
| condition | Condition: Working · Broken · Can't test | Kondisi: Berfungsi · Rusak · Tidak bisa dicek |
| location | Current location | Lokasi sekarang |
| note | Note | Catatan |
| footer | Not found · Save · Save & next | Tidak ditemukan · Simpan · Simpan & berikutnya |
| result pill | Match · Mismatch: {fields} · {n} fields unchecked | Sesuai · Tidak sesuai: {fields} · {n} kolom belum dicek |
| summary title | Mismatch summary | Ringkasan ketidaksesuaian |
| summary actions | Apply correction · Follow up | Terapkan koreksi · Tindak lanjut |

## 7. Edge cases

- **Qty > 1 under one legacy code** (only C1-07, qty 2). Import it as **two assets**, each with `legacy_code = C1-07` plus a suffix in notes (*unit 1 of 2*). If that breaks the unique constraint, drop `unique` and keep an index instead. One asset = one physical unit.
- **Shared 2013 photos.** F1-05…F1-10 share one photo, and so do C1-04/05 and C1-06/07. Import the photo for each record anyway, and show the `legacy_notes` warning on the verify screen so checkers know the photo proves nothing.
- **Not found** never changes the asset by itself. *Follow up* in the summary can set `status = lost` (with `ended_on`), and only after a confirm.
- **Rechecks** create a new row; the summary shows the latest only.
- **Applying a correction** is idempotent: `applied_at` is set once and a second apply is refused.

## 8. Acceptance

- The import loads 164 assets (163 rows, C1-07 split in two), each with a record photo, `legacy_code` and `legacy_notes`. Running it twice changes nothing.
- The zones appear in the location select. Existing locations are untouched.
- On a tablet-size viewport, a checker can verify an item in under 30 seconds: open it, tick four fields, take one photo, *Save & next*.
- A mismatch appears in the summary with its field differences. *Apply correction* updates the asset, and the asset's history shows it.
- Every string switches between EN and ID with the topbar toggle.
- `npm run verify` and `npm run verify:db` pass. A decision row is added to `docs/plan/06-decisions.md`, findings go in `findings.md`, and the milestone board is updated.

## 9. Open questions for the owner (ask, don't assume)

1. Should the imported machines use the existing `tool` category or a new `machine` category?
2. How do the existing locations `GUDANG`, `BENGKEL` and `FINISHING` map to the new zones?
3. What status should imported machines start with: `in_storage` (production stopped) or `in_use`?
4. Who may apply corrections: IT only, or anyone with asset edit rights?
