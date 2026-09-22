-- 0042_acct_legacy_types.sql — the five kinds of transaction the ledger had no
-- word for.
--
-- ── Why this is a migration and not a decision the import makes ──────────
--
-- `0013` seeded thirteen transaction types, taken from the contracts. Measured
-- against the live legacy database there are eighteen, and the five missing
-- ones are not stragglers:
--
--     TRANSPORT                      186 rows    Rp     23.079.235
--     RECCURING - PAYROLL MONTHLY    154 rows    Rp    651.486.643
--     EJO                             87 rows    Rp    539.975.440
--     RECCURING - OVERTIME            35 rows    Rp     13.341.000
--     RECCURING - PAYROLL WEEKLY       1 row     Rp     30.412.718
--     (no type at all)                10 rows    Rp     27.760.775
--                                    ───────    ──────────────────
--                                    473 rows    Rp  1.286.055.811
--
-- **Every opening balance in `ops_acct.accounts` is 0 as of 2026-01-01, and
-- the legacy data begins 2026-01-01.** So a balance in the new system is
-- exactly the sum of what was imported. Leaving 473 rows out does not make the
-- ledger incomplete — it makes every balance on every screen *wrong*, by up to
-- a billion and a quarter, with nothing on the page suggesting so.
--
-- An import may not invent a category, so the codes had to exist first. Owner,
-- 2026-09-21: **add all five.**
--
-- ── The flags, and which of them are a reading rather than a fact ────────
--
-- The three `RECCURING` variants are not a judgement: `RECCURING - PAYROLL` is
-- already here at `is_purchase = false`, and monthly, weekly and overtime are
-- the same thing at different cadences. Wages are not a purchase; nothing about
-- them belongs in a vendor's last-paid price.
--
-- The other two are read from what the rows actually say, and are stated here
-- so they can be corrected by somebody who knows rather than discovered later:
--
--   **TRANSPORT** — *BENSIN GRAND MAX 03-09-2026*, *TRANSPORT PAK IRWAN KE
--   SMG*. Money out for fuel and journeys, so `is_purchase`. Not
--   `creates_catalog_item`: a tank of petrol is not a thing to carry a
--   last-paid price, and letting it into the catalogue would fill it with one
--   entry per fill-up.
--
--   **EJO** — *MAKAN KUCING - EJO*, *SERVIS SEPEDA EJO*, *TRASPORT PAK IRWAN
--   JEMPUT EJO*. These read as the principal's own spending rather than the
--   company buying something, so not a purchase and not a catalogue source.
--   Rp 540 juta across 87 rows; if that reading is wrong it is worth correcting
--   in its own migration rather than quietly.
--
-- ── The ten with no type at all ─────────────────────────────────────────
--
-- Not fixed here, because there is nothing to fix: somebody left the field
-- blank. `type_code` is `not null`, so the import must name something, and it
-- names `OTHERS` — which is what the new system already calls a transaction
-- nobody classified.
--
-- That is a real cost and it is written down rather than hidden: those ten
-- become indistinguishable on screen from the 62 rows somebody deliberately
-- filed as `OTHERS`. `0031` refused the same trade for units — it made
-- `base_uom` nullable rather than defaulting 587 items to `pcs` — and the
-- reason it is taken here instead is the arithmetic above: a null unit costs a
-- question, a missing transaction costs a wrong balance. The import records
-- each of the ten in `ops_core.legacy_map` with the note that the original was
-- blank, so *which ten* stays answerable.

insert into ops_acct.transaction_types (code, is_purchase, auto_complete, creates_catalog_item) values
  ('TRANSPORT',                   true,  false, false),
  ('EJO',                         false, false, false),
  ('RECCURING - PAYROLL MONTHLY', false, false, false),
  ('RECCURING - PAYROLL WEEKLY',  false, false, false),
  ('RECCURING - OVERTIME',        false, false, false)
on conflict (code) do nothing;
