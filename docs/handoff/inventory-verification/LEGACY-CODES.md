# The 2013 register's codes — a data definition (proposal)

Status: **approved 2026-11-18 (D450)** — names in the 2013 uppercase format
(question 1); the stored `legacy_*` values stay as recorded and are only
flagged (question 2, the proposed default, taken). Read off all 163 rows of
`MACHINE INVENTORY 2013` (`data/legacy_2013_register.csv`).

A 2013 row reads, for example:

```
A1-01   AIR COMPRESSOR   M 16   ASSEMBLY DEPT
code    name             area   department
```

Each of the four parts follows a rule. This document writes the rules down, and
then proposes how the app should show them.

---

## 1. The code — `L#-##`

| Part | Means | Example `S2-14` |
|---|---|---|
| `L` | **Type letter**: the first letter of the machine type's first word | `S` = Saw / Sander |
| `#` | **Family** within that letter, numbered from 1 | `2` = saws (`S1` is sanders) |
| `##` | **Unit**: the machine's number within its family, 01, 02, … | `14` = the 14th saw |

So the code is *type → family → unit*, and it says nothing about where the
machine is (the area does that) or which department uses it.

### The 27 families

| Code | Family | Units | | Code | Family | Units |
|---|---|---:|---|---|---|---:|
| A1 | Air compressor | 2 | | J1 | Jointer | 5 |
| A2 | Air dryer | 2 | | L1 | Lathe | 2 |
| A3 | Air tank | 1 | | M1 | Metal working (buffing, cutting, welding) | 11 |
| B1 | Boring | 8 | | M2 | Moulder | 7 |
| C1 | Clamp (case, single, double) | 7 (8 machines) | | P1 | Planer | 5 |
| C2 | Construction equipment | 2 (+2, see breaks) | | P2 | Press (HF, cold, hot) | 5 |
| D1 | Dovetailing | 1 | | R1 | Router | 6 |
| D2 | Drill press | 2 | | S1 | Sander | 14 |
| D3 | Dehumidifier | 3 | | S2 | Saw | 28 |
| E1 | Edgebander | 3 | | T1 | Toolroom (grinders, sharpeners) | 6 |
| F1 | Finishing — spray booth | 10 | | U1 | Upholstery (foam, fibre, sewing) | 26 |
| G1 | Glue roller | 1 | | V1 | Veneer (cutter, stitching) | 4 |

### Where the rule breaks (keep as recorded, flag in the UI)

| Code | Should have been | Why |
|---|---|---|
| `C3-03`, `C4-04` | `C2-03`, `C2-04` | Construction equipment continued, but the family digit was bumped with the unit |
| `U-11` | `U1-11` | Family digit missing |
| `C1-07` | — | One code for **two** machines (imported as two assets) |

---

## 2. The area — column letter + row number

`M 16` is a cell of a **grid laid over the 2013 floor**: column **A–N**
(14 columns) and row **1–16**. The sheet sometimes wrote it with a space or
without the leading zero (`M 16`, `F7`); the import stores it normalised as
`M16`, `F07`.

Plotting every machine's cell with its department gives clear blocks — the 2013
floor plan, read from the data:

```
        A    B    C    D    E    F    G    H    I    J    K    L    M    N
  1    TR   MC   MC   MC   MC   MC   MC    .   MC
  2    MC   MC   MC   MC   MC   MC   MC   MC   MC
  3     .   MC   MC   MC   MC   MC   MC   MC   MC
  4    MP                       MC
  5                        MC   MC
  6
  7                             AS        AS   FI   FI   FI   FI   AS   AS
  8                                            FI   FI             AS   AS
  9              WH   WH                       FI   FI   FI        AS   AS
 10                                                                AS   AS
 11                                            FI   FI        FI   AS
 12                                                           FT        AS
 13                                                 UP
 14                                                 UP   MC
 15    GH                                                MC
 16                                       UP   UP   UP             PH
```

`MC` Machinery · `AS` Assembly · `FI` Finishing · `UP` Upholstery · `WH`
Warehouse · `MP` Metal production · `TR` Toolroom · `GH` Guard house · `PH`
Power house · `FT` Fitting

| Block | Cells | Department |
|---|---|---|
| Front strip | A–I, rows 1–5 | Machinery |
| Middle | I–L, rows 7–11 | Finishing |
| Right side | M–N, rows 7–12 | Assembly |
| Back right | H–J, rows 13–16 | Upholstery |
| Corners | A01 · A04 · A15 · M16 · C09/D09 | Toolroom · Metal production · Guard house · Power house · Warehouse |

**This is the old layout.** The owner confirmed the 2024 site plan is the
building today, and its zones (`PRD`, `FN1`, …) do not line up with this grid.
The area tells a checker *roughly where the machine stood in 2013*, not where to
look now.

Cells that contradict their block, already in `legacy_notes`: `M16` is the power
house, but A1-01/A1-02 are recorded there as Assembly; `A01` holds both Toolroom
and Warehouse rows; four production machines sit at the guard house (`A15`);
`K14`/`K15` (clamps) are Machinery inside Upholstery's corner.

---

## 3. The department — ten values

| 2013, as printed | Clean name | Proposed short code |
|---|---|---|
| MACHINERY DEP'T | Machinery | `MCH` |
| ASSEMBLY DEPT | Assembly | `ASM` |
| UPHOLSTERY | Upholstery | `UPH` |
| FINISHING DEPARTMENT | Finishing | `FIN` |
| WAREHOUSE | Warehouse | `WHS` |
| METAL PROD AREA | Metal production | `MTL` |
| TOOLROOM AREA | Toolroom | `TRM` |
| GUARD HOUSE | Guard house | `GRD` |
| POWER HOUSE AREA | Power house | `PWR` |
| FITTING DEPT | Fitting | `FIT` |

The department says **who used the machine in 2013**, which is not always where
it stood (see the contradictions above).

---

## 4. The name — `TYPE, DESCRIPTOR (SIZE/CONDITION)`

The sheet's pattern, applied unevenly: the type first, then what kind, then
size or condition in brackets — `SAW, BAND`, `SANDER, WIDE BELT (LRG)`,
`FINISHING, SPRAY BOOTH (NEW)`. Breaks: the descriptor first (`SINGLE CLAMP,
CASE`), no comma (`SANDER HORIZONTAL BELT`), typos (`DIHUMIDIFIER`, `MAHINE`,
`SHARPING`, `TENNONER`), and two names that look swapped (U1-24 / U1-26).

---

## 5. Proposal — how the app shows it

Today a card shows the new title-case name and *Old: A1-01*. Proposed, without
touching asset numbers (D347):

1. **Name in the 2013 format, corrected.** Keep the sheet's `TYPE, DESCRIPTOR
   (SIZE)` order and its uppercase, fix only spelling and the broken patterns:
   `AIR COMPRESSOR`, `SAW, BAND`, `CLAMP, CASE (SINGLE)`, `DEHUMIDIFIER`,
   `SAW, DOUBLE END TENONER`. The floor reads the same words as on the 2013
   placards.
2. **The code decoded on the card and the verify screen**, e.g.
   `A1-01 · Air compressor, unit 1 of 2`.
3. **The 2013 place as one line**: `2013: M16 · Assembly` (grid cell · department),
   with the warning icon when the cell contradicts its block.
4. **Search** by family (`S2`), cell (`M16`) and department code (`ASM`) as well
   as by name.

Points 2–4 are read from the data already imported — no data change. Point 1
renames 164 assets in production through a one-time, audited update (the old
title-case names stay in the audit trail), so it is the one that needs the
owner's go-ahead.

### Open questions

1. Name: the 2013 uppercase format, corrected (proposed) — or keep today's
   title case and only add points 2–4?
2. Should the four contradictions and the three code breaks also be corrected in
   the stored `legacy_*` values, or stay as recorded and only be flagged
   (proposed: stay as recorded)?
