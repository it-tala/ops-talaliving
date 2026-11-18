# Reference material

## Files in this package
| path | what |
|---|---|
| `data/legacy_2013_register.csv` | 163 records extracted from the 2013 PDF. It has both raw and cleaned columns, a suggested English name, and known issues per row |
| `data/photos_2013/` | 163 photos, one per record, named `<row>_<legacy_code>.jpg` (e.g. `101_S2-02.jpg`), cropped from the PDF. They are low resolution, so use them as the record photo only |
| `data/zones.csv` | Zone codes from the 2024 site plan, with English/Indonesian names, floor level, and whether the zone holds items |
| `reference/source/factory_equipment_list_2013.pdf` | Original source: "MACHINE INVENTORY 2013", Excel export, 21 pages, photos dated Nov 2012 |
| `reference/source/SITE_PLAN_2024.pdf` | PT Talahome site plan, Jepara, 25 Nov 2024, 1:350. The owner confirmed it matches the building today |
| `reference/design/Main.dc.html` | Mockup of the item list by zone |
| `reference/design/Detail.dc.html` | Mockup of the verify-one-item screen |
| `reference/design/Review.dc.html` | Mockup of the mismatch summary |

Extracted register with formulas (Google Sheet): https://docs.google.com/spreadsheets/d/1JnGnWyA75mzYNFKp5dAHijKwen-Ok_aN42uyjQcsOLs/edit
Design canvas: https://claude.ai/artifact/Qx9oewWGEMYFH5WnZxJnmF

## CSV columns (`legacy_2013_register.csv`)
| column | meaning |
|---|---|
| `row_no` | Row number in the PDF. It jumps from 119 to 200; there are no rows 120–199 |
| `legacy_code` | 2013 inventory code `L#-##`: first letter of the type, group digit, sequence. Known breaks in the pattern: `C3-03`, `C4-04`, `U-11` |
| `item_name_2013` / `suggested_name` | As printed / title case. The pattern is `TYPE, DESCRIPTOR (SIZE)` |
| `qty` | Always 1 except `C1-07` = 2 |
| `legacy_area` / `legacy_area_raw` | 2013 floor grid (letter A–N + row 1–16), normalised / as printed. This grid is the **old layout** and does not match the 2024 zones |
| `legacy_department` / `_raw` | Cleaned / as printed (10 departments) |
| `brand_raw` / `brand_clean` | `brand_clean` merges spelling variants (HUA HUA ×4, V HOLD, ALTENDORF). Placeholders and engine types become empty |
| `model` / `model_raw` | `model` is empty when the raw value was `_` or `CANNOT BE READ` |
| `catalogue_page` | Page in a machine catalogue; filled on 68 rows. Informational only |
| `photo_file` | Relative path of the photo |
| `photo_issue` | e.g. one photo shared by several records; the area on the placard disagrees with the sheet |
| `data_issue` | Typos, code-pattern breaks, conflicting areas, placeholders |

## How the 2013 register recorded data (summary)
- **Code:** `L#-##`. The letter is the first letter of the item type (A air, B boring, C clamp/construction, D dovetail/drill/dehumidifier, E edgebander, F finishing, G glue, J jointer, L lathe, M metal/moulder, P planer/press, R router, S sander/saw, T toolroom, U upholstery, V veneer). The digit is the family within that letter, followed by a 2-digit sequence. There are 27 groups.
- **Name:** `TYPE, DESCRIPTOR (SIZE/CONDITION)`, written in English and uppercase. The pattern is applied inconsistently, and there are typos (DIHUMIDIFIER, MAHINE, SHARPING, TENNONER, MOLDER/MOULDER).
- **Photo:** each machine was photographed with a handwritten white placard showing INV #, AREA CODE, ITEM and DEPT, using a date-stamping camera (Nov 2012). Many machines also carry an older painted number (T-45, T-123…) that the sheet never recorded.
- **Problems to show in the UI:**
  - F1-05…F1-10 share one photo, and so do C1-04/05 and C1-06/07.
  - All 14 sewing machines (U1-13…U1-26) have placards with areas that disagree with the sheet.
  - The descriptions of U1-24 and U1-26 look swapped.
  - Brand is missing on 37 rows and model on 20.

## Site plan zones (summary)
- **Lot and building:** the lot is about 87.5 m deep and 32 m wide, with the main road on the north-east side. There are three floor levels: the front at ±0.00/+0.60, the left wing (production, finishing, oven) at about -2.00, and the right wing (housing, logistics, packaging, blocks) at +2.00.
- **Confirmed by the owner:**
  - R06 is the shared break room.
  - B1–B3 are storage mixed with maintenance areas (electrical, well).
  - Production has no internal columns.
  - The 2013 list comes from the same factory.

## Numbering rules agreed so far
- **Asset numbers:** one number per physical thing, never reused and meaningless (`AST-0001`, D347). Type, location and condition live in their own fields.
- **Per unit or counted:** things checked one by one (machines, power tools, vehicles, IT, furniture) are assets (`AST-`). Things counted by quantity (materials, consumables) are catalogue items (`I-00001`).
- **Old identifiers:** the 2013 code, the 2013 area and the painted T-number stay as searchable legacy fields and are never reused as keys.
- **Locations:** taken from the one shared list (`stock_locations`, D347), using the zone codes above.
- **Verification photo file name:** `AST-0042_2026-11-18_01.jpg`, filed per asset under the verification folder.
