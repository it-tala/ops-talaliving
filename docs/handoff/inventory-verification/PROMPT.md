# Prompt for Claude Code

Copy this folder into the repo at `docs/handoff/inventory-verification/` and commit it. Then open Claude Code on `it-tala/ops-talaliving` and paste the prompt below.

---

Read `docs/plan/README.md`, `docs/plan/07-ways-of-working.md` and `CLAUDE.md` first, and follow the loop and standing rules they set out.

Then read everything in `docs/handoff/inventory-verification/`: `SPEC.md` (what to build), `REFERENCE.md` (the source data and how it was derived), `data/` (the 2013 register CSV, 163 photos, the site-plan zones) and `reference/design/*.dc.html` (screen mockups: static markup with exact layout and colours).

Goal: an **asset verification** flow inside the existing inventory module. A field checker opens an existing asset and checks name, brand, model and quantity against the real thing (Match / Different + "should be"). They record condition, current location, a note and at least one photo, then go to the next item. Mismatches and not-found items collect in a summary where a correction can be applied to the asset record. UI copy is **English by default**, with Indonesian through `tr(en, id)` (D318). Build it with the repo's existing components and patterns, not the mockup markup.

Work in this order and stop after each step for my review:

1. **Plan.** Map SPEC §4 onto the real schema:
   - `ops_inv.assets`, `asset_categories`, `stock_locations`, `attachment_links` / `link_entity_t`, `drive_paths`, the permission names, and the API contract and parity scripts.
   - List each change and new migration (next free number), seam and route.
   - Raise SPEC §9's open questions plus anything the code contradicts. **Don't start building until I answer.**
2. **Database.** Migrations for the legacy columns, the `asset_verifications` table and rules, the `asset_verification` link entity and drive path, the `verify_asset` / `apply_verification` seams, the `v_asset_verification` view, and the zones from `data/zones.csv` added to `stock_locations`. Existing locations stay untouched. Add smoke tests. Run `npm run verify:db`.
3. **Import.** An idempotent import step for `data/legacy_2013_register.csv`, following the `supabase/import/` ladder pattern:
   - 164 assets (C1-07 split into two units);
   - `name = suggested_name`, `brand = brand_clean`, `model`;
   - legacy columns filled; `legacy_notes = data_issue + photo_issue`;
   - each 2013 photo uploaded through the app's Drive upload path and linked to its asset.
   - Report counts, and run it twice to prove nothing changes the second time.
4. **Screens.** `/inventory/verify` (list by zone), `/inventory/verify/[asset_no]` (verify one), `/inventory/verify/review` (summary with `DataTable`). Add them to the nav next to the existing inventory pages. Tablet landscape first (~1180×820), still usable on desktop and phone width. Every string goes through `tr()`, using the copy table in SPEC §6.
5. **Finish.** Run `npm run verify`. Add a decision row to `docs/plan/06-decisions.md`, append what you learned to `docs/plan/findings.md`, update the milestone board, commit on a feature branch, and give me the preview link.

Constraints:
- **Don't change asset or item numbering** (D347).
- **Don't build new-item registration, a site-plan map, voice notes, bays, or offline mode.**
- **Don't edit or delete verifications.** A recheck is a new row.
- **Don't modify assets except through `apply_verification`.**
- **Ask before deciding anything SPEC §9 lists as open.**

---

## Shorter follow-up prompts
- After review: `Apply my answers to the open questions, then do step 2 of docs/handoff/inventory-verification/PROMPT.md.`
- Next steps: `Do step 3.` / `Do step 4.` / `Do step 5.`
- Fixes: `On /inventory/verify/[asset_no], <what is wrong>. Fix it, run npm run verify, push.`
