# Backlog — reported, not yet built

Things somebody noticed while using the demo, kept here so they are neither
lost nor silently promoted above the work in hand. Each one says what was
observed, not what to build — the fix is decided when it is picked up.

Fixed items stay, struck through, with the commit that closed them. A backlog
that only shows what is left teaches nobody anything.

## Bugs

| # | What happens | Where | Status |
|---|---|---|---|
| B1 | ~~Clicking into the instruction box opens the line drawer behind it and takes the focus with it~~ | `/procurement/meeting` | **fixed** 2026-09-11 — the cell stops the row's click (F36) |
| B2 | ~~The evidence chips — *photo of the goods*, *tanda terima*, *on file* — read as labels and cannot be opened~~ | `/procurement/tracker/[vendor]` | **fixed** 2026-09-13 (M55) — D268. The booleans behind them became attachment ids, so presence is derived from the thing itself; one `EvidenceChip` for all three. It found a mislabelled file on its first use (F88) |
| B3 | ~~An image has to be opened through a button before it can be seen. Every picture in the queue should show its own preview~~ | `/accounting/verifikasi` | **fixed** 2026-09-12 (M39) — a preview on the selected document and on every decided one, swapping in place rather than opening a modal. What it draws is a stand-in that says so on its face (D208); Phase 2 puts the file in the same slot |
| B4 | ~~**Already decided** grows without limit and pushes the queue off the screen~~ | `/accounting/verifikasi` | **fixed** — paging 2026-09-12 (M26, D157); the date window 2026-09-13 (M55, D269). Ninety days by default, and the card always says how many decisions are outside the window and names the oldest, because a list that quietly stops somewhere lies by omission |
| B5 | ~~**Barang datang tidak bisa dicatat di mode live** — `ReceiveForm` mengirim label, `create_receipt` membandingkan kode~~ | `/procurement/tracker/[vendor]` | **fixed** 2026-09-23 — `0128`: the seam resolves kinds through `ops_core.doc_kind_of`, like every other evidence road; an unknown kind is named (`unknown_kind`). The simulation step turned from TEMUAN to OK without being edited |
| B6 | ~~**Halaman *New request* tidak live** — satu dropdown opsional memanggil `production.listWorkOrders`~~ | `/procurement/pr/new` | **fixed** 2026-09-23 — the picker asks `production.listOpenWorkOrderRefs()` (four columns from `ops_prod.work_orders`, readable by anybody signed in), so the route is live; `listWorkOrders` itself stays unwritten |
| B7 | ~~**PO tidak tersambung ke baris PR**~~ | `ops_procure.po_lines` · `/procurement/po` | **fixed** 2026-09-23 — `0129`, D297: `po_lines.pr_line_id`, optional, checked in `create_po` (approved, one live order, same unit, not a lump sum). Arrivals on the order move the request line; *From request line* on the New PO form |
| B8 | ~~**Termin PO tidak bisa dibayar dari layar mana pun**~~ | `/procurement/po/[po]` | **fixed** 2026-09-23 — `0129`, D297: `ops_acct.post_to_po` and *Pay this order*; an allocation names the line and the order, so one payment reads on both and is counted once on each |
| B9 | ~~**Ongkir (baris tanpa jumlah) tidak bisa dibayar dari barisnya dengan jenis SUPPLIERS**~~ | `/procurement/pr` · `ops_acct.post_from_line` | **fixed** 2026-09-23 — `0131`, D298 (owner chose option 1): the ledger detail of a lump-sum payment is *1 lot × the amount paid*; the request line keeps no quantity. The walk now ends with no findings |
| B10 | **Kartu persetujuan PO belum sampai ke Google Chat** — `request_po_approval` memancarkan `procurement.po.approval_requested`, dan `po_approval_card` / `answer_po_approval` sudah siap untuk worker, tetapi belum ada worker yang mengirim kartu dan menerima jawabannya | outbox → Google Chat | open — 2026-09-23 (F151). Needs the owner: which Chat app sends it (the existing John Lau v01 bot, or a new Chat app on this Worker) and who administers it in Google Workspace |
| B11 | ~~**Baris yang vendornya diputuskan di PO tidak bisa dibayar dari barisnya**~~ | `ops_acct.post_from_line` | **fixed** 2026-09-23 — `0135`: the vendor falls back to the order the line is on; a line on no order with no vendor is still refused `vendor_required` (F152) |
| B12 | ~~**Setiap PO draft di live bertuliskan *Changed since it was sent***~~ | `/procurement/po/[po]` | **fixed** 2026-09-23 — the ladder starts a draft at revision 1 with nothing sent (`0011`), the demo at 0/0, so only live showed it. The banner now needs an order that has gone out (F152) |
| B13 | ~~**Kontrak yang didaftarkan dari layar tidak pernah bisa diberlakukan**~~ | `/hrd/kontrak` | **fixed** 2026-09-24 — `0138` `attach_contract_paper` + tombol *Lampirkan kontrak* di halaman kontrak (F154). `activate_contract` menolak `paper_required`, dan satu-satunya jalan melampirkan kertasnya adalah argumen `register_contract` yang tidak dikirim formulir |
| B14 | ~~**Berkas 201 hanya bisa dicatat nomornya, tidak pernah scan-nya**~~ | `/hrd/berkas-201` | **fixed** 2026-09-24 — *Pilih scan / foto* di laci berkas; scan saja atau nomor saja sama-sama boleh (F154) |
| B15 | ~~**Run gaji berhenti di APPROVED — tidak ada layar yang membayarnya**~~ | `/hrd/payroll/[run]` | **fixed** 2026-09-24 — `0139` `ops_acct.post_payroll_run` + kartu *Bayar run ini* untuk pemegang `post_ledger` (D302, F154) |
| B16 | ~~**Timesheet live terkunci di periode data demo (29 Agu – 7 Sep 2026)**~~ | `/hrd/absensi` | **fixed** 2026-09-24 — dua minggu terakhir secara bawaan, geser per minggu, `?from=` di alamat (F154) |
| B17 | ~~**Tombol John Lau menutupi tombol terakhir di halaman pada layar lebar**~~ | semua halaman | **fixed** 2026-09-24 — ruang bawah `pb-24` di semua lebar layar, bukan hanya layar kecil (F65, F154) |
| B18 | ~~**Karyawan yang dicatat dari layar selalu "masuk hari ini"**~~ | `/hrd/karyawan` | **fixed** 2026-09-24 — kolom *Tanggal masuk* di laci karyawan (F154) |

## Scheduled — the owner's answers of 2026-09-11

| # | What | Note |
|---|---|---|
| S1 | ~~**Stock: materials and hardware, properly categorised**~~ | **built 2026-09-11 (M27)**, D169–D172; **the other half of Q40 closed 2026-09-13 (M54)**, D266. Confirming a receipt stocks the goods; issuing draws them down against the SPK, from a list the BOM proposes and a person confirms. Nothing deducts automatically, and that is the decision rather than an omission |
| S2 | ~~**Berkas 201 and Cuti & Izin**~~ | **built 2026-09-11 (M29)** — D177, D178. Compliance removed from the menu |
| S3 | ~~**Desain, for the drafters**~~ | **built 2026-09-11 (M30)** — `/produksi/desain`, D179 |
| S4 | ~~**Pay schemes as configuration**~~ | **built 2026-09-11 (M28)** — `/it/aturan-gaji`, D173–D176. Overtime now follows the national ladder (Q31 answered); undertime is built and off by default |
| S5 | ~~**Rekening koran upload for the leadership accounts**~~ | **built 2026-09-11 (M31)** — `/accounting/rekening-koran`, D180–D182. Q42 answered: the statement is the only road, and the USD rate is typed per line |
| S6 | ~~**Package: the agent-commission programme**~~ | **built 2026-09-12 (M32)** — `/marketing/pipeline` and `/marketing/agen`, D183–D186, from the owner's own pipeline dashboard as the reference |

## Placeholder screens — routes that exist and hold nothing

**A placeholder is a finding, not a file** (F54). A route created to hold a
place goes on this list in the same commit, because the menu is the only other
record that it is empty and the menu is what makes it look full.

| Route | What it should hold | Status |
|---|---|---|
| `/it/audit` · `/it/aktivitas` · `/it/pengguna` · `/it/peran` | ~~the two trails, the grants, the catalogue~~ | **built 2026-09-12 (M34)** — they were placeholders for thirty-one milestones and nothing in the build could say so (F54) |
| ~~`/proyek/pengiriman`~~ | ~~delivery of finished goods to the site~~ | **built 2026-09-13 (M40)** — D209–D212 |
| ~~`/proyek/instalasi`~~ | ~~installation on site, and what it found~~ | **built 2026-09-13 (M40)** — D209–D212 |
| ~~`/proyek/serah-terima`~~ | ~~handover, and what the client signed~~ | **built 2026-09-13 (M40)** — D209–D212 |
| ~~`/pengaturan`~~ | ~~the settings that are today constants in `src/lib/`~~ | **built 2026-09-13 (M42)** — D214–D216. **The placeholder list is now empty.** |
| ~~`/accounting/payslip`~~ | ~~nothing — it duplicates `/hrd/payroll`~~ | **removed** 2026-09-13 (M41) — owner: accounting does not read payslips. Deleted rather than parked: D105 parked two *working* screens over a judgement that might change; this was an empty route, and the question it was holding open has been answered (D213) |

## From the interview of 2026-09-13 — answered, deliberately not built yet

Nineteen questions were answered in one conversation (D227–D249). Five were
small enough to ship in the same commit. **These are the rest**, kept here
rather than in the open-questions table because they are no longer questions —
the decision is made and only the build is outstanding. Numbered as the owner
and I numbered them while agreeing what to do first.

| # | What was decided | Size | Note |
|---|---|---|---|
| #6 | ~~**The pay model splits into pokok + tunjangan**, with the hourly divisor derived from *setahun gaji ÷ hari kerja efektif ÷ jam sehari* rather than 173~~ | large | **built 2026-09-13 (M46)** — D250, D251, D252. The seeded split moves nobody's total at full attendance; what it moves is what a missed day costs. Lateness ships computed and not applied. Four findings fell out (F70–F73) |
| #7 | ~~**Simplify the production stages, and add a subcontract route**~~ | medium | **built 2026-09-13 (M47)** — D253, D254, D255. Seven stages became four; the route is a list of stages, so what a subcontracted order does *not* have is as visible as what it does. Two findings (F74, F75) |
| #8 | ~~**Version the bill of material**, pinned to the work order that used it~~ | medium | **built 2026-09-13 (M48)** — D256. Every pre-existing BOM became rev 1, released, which loses nothing: it was the only list that had ever existed. Two findings (F76, F77) |
| #9 | ~~**Layered BOM, a button that raises a PR from one, and a typed labour cost**~~ | large | **built 2026-09-13 (M49)** — D257, D239, and D258 for the self-check the work exposed. The button existed since M23 and was quietly dropping every sub-assembly (F78) |
| #10b | ~~**BPJS and PPh: the enrolment register, and the per-person reconciliation**~~ | medium | **built 2026-09-13 (M50)** — D259. PPh 21 is recorded and not computed, which is the honest half. One finding (F80) and one new question (Q49) |
| #11 | ~~**KPI analyzer and task tracker**, with lateness as one of the points~~ | large | **built 2026-09-13 (M51)** — D260, D261. One finding in three parts (F81). Two things it deliberately does not do: score production work, and score overtime |
| #12 | ~~**QR per box for installation** (W4)~~ | large | **built 2026-09-13 (M52)** — D262, D263. The half of #12 that was never waiting on anything: the person scanning a box is our own installer, who has a login (F82). The vendor-PO half (W3) is still Phase 2 |

## Open, from building #6

| # | Question | Why it is a question and not a default |
|---|---|---|
| Q44 | ~~**One business, two schedules, one start time.**~~ | **answered 2026-09-13, then answered properly 2026-09-14** — five working patterns, not two (D274): produksi 07.30–16.30 istirahat 45 menit, kantor 08.00–17.15 istirahat 1 jam, Jumat 1,5 jam, satpam 12 jam, ART mulai 14.00. The second answer broke the shape built for the first, which is the finding (F91). A pattern with no stated start reads **tidak terukur**, never *never late* |
| Q45 | **What is this business's own `hari kerja efektif`?** — **evidence built 2026-09-23, number still the owner's to give** | Reopened this morning because the 13 September close answered *who types it*, not what it is (F138). It is no longer a question with nothing behind it: `/it/aturan-gaji` now prints the company's own calendar beside the typed figure — 365 days, minus the weekly rest days the pattern implies, minus the tanggal merah that fall on a working day — with the arithmetic shown (D292). **The gap is the answer.** Production types 240 and its calendar counts 261, because **no tanggal merah for 2026 have been entered at all**; twenty-one days is roughly a year of Indonesian public holidays, so the two agree and nobody has written the days down. The work is now HR's rather than the owner's: enter the holidays, and the figure checks itself. **Default if unanswered**: 240 |
| Q49 | ~~**What is this business's BPJS risk class?**~~ | **answered 2026-09-14 by setting it aside** — *abaikan, yang penting masuk tagihan bulanan dan mana peserta yang ikut kita bisa tau* (D276). The stand-in rate keeps its unconfirmed badge; what the screen now says plainly is that the check is the invoice against the roll of names, not the precision of the percentage |
| Q50 | ~~**Does the business want PPh 21 computed here at all?**~~ | **answered 2026-09-14 — tidak** (D277). Recorded as an enrolment, never derived. The screen said *belum dibangun*, which promised something coming; it now says this is not this system's work |
| Q47 | ~~**Are these the right four stages, and is *amplas* really part of Finishing?**~~ | **answered 2026-09-14** — the owner named his own four: **sanding/amplas · finishing · machinery/instalasi · packing** (D275). *Pembuatan* is gone because rough pieces are bought in (Q48); *QC* is gone and nothing explains that one, so it is asked again as **Q51**. Retired stages keep their work and are shown apart; an unrecorded stage is no longer read as a zero (F92) |
| Q48 | ~~**Does a subcontracted piece ever come back needing more than finishing?**~~ | **answered 2026-09-13 by replacing the question** (D273) — *pernah, seperti amplas ulang, tapi abaikan saja*. The real case is bigger: several vendors each doing one process (barang mentah, jok, amplas, packing) and a piece that can visit more than one. Not a third route; a new shape, raised as **W6** |
| Q46 | ~~**Does a company half day earn the full tunjangan?**~~ | **answered 2026-09-13** — *tunjangan penuh kecuali HR mengabaikan* (D272). The behaviour was already this; what changed is that it is now a ruling rather than our reading of one |

| Q54 | ~~**Is Friday short because the break is longer, or because people go home earlier?**~~ | **answered 2026-09-23 — pulang lebih awal**: *jumat pulang lebih awal, bukan 17.15 tapi 16.30, jam kerjanya 7 jam istirahatnya yang 90 menit* (D289). The 1,5-hour break from Q44 was right all along; the 135-minute break D288 invented to force a seven-hour Friday was the shape complaining, not the business speaking (F139). `friday_end_minutes` added in `0113`, null meaning *Friday ends when every other day does* — not D274's *nobody has said*. **Closed the same day** (D290): *jumat produksi pulang 16.00*. 07.30–16.00 less 90 minutes is 7,00 hours and a 40,00-hour week, so both patterns now reach 40 by different arithmetic — the office leaves 45 minutes early, the workshop 30 — and both land on 173,33 hours a month, which is the `monthly_divisor` that was right all along |
| Q53 | ~~**The three gaps the working patterns still have.**~~ | **answered 2026-09-17** — *setiap karyawan akan punya jadwal kerja tertaut. HR harus bisa setup dan lihat total jam kerja per minggu dan bulannya* (D279). Built as `/hrd/jadwal`. The three gaps themselves — satpam's start, ART's finish, their breaks — are now **HR's to fill in on a screen** rather than questions for the owner |
| Q52 | ~~**Does every product go through all four stages?**~~ | **answered 2026-09-17** — *anggap per produk melewati setiap prosesnya* (D278). Stages belong to the product; a product goes through all of its own, and reporting one it does not have is refused. Null means nobody has set it up, not *all four* |
| Q51 | ~~**Is QC really not a step of its own?**~~ | **answered 2026-09-17 — oke**: the owner's four stand, QC stays out (D278). Old `QC` entries keep rolling into Packing, the step they always immediately preceded |
| W6 | ~~**Track which vendor did which process to which item**~~ | **built 2026-09-17 (M59)** — D280. `vendor_legs` replaces the four `subcon_*` columns that could hold one trip; `/produksi/vendor` answers *where is my chair* with *at the upholsterer since Tuesday*. What came back is a number rather than a tick, late is measured only against a promise, and `goodsOnSite` became a quantity — six of twelve at the vendor leaves six on the bench |
| W5 | ~~**Link production work to people.**~~ — **built 2026-09-13 (M53)**, D264. An optional `employee_id` beside the name, resolved once per name by a person; the software suggests and never matches. Production work is now shown on the KPI card as the *deliverable* half and still deliberately not scored, because a piece is not a unit |

## Asked for, not yet scheduled

| # | What | Note |
|---|---|---|
| W2 | ~~**Two roads to a confirmed PO**~~ | **built 2026-09-13 (M55)** — D267. Leadership writing their own order confirms it in the same act, recorded as `self_confirmed` and said plainly on the banner; anybody else's order goes out as a chat card answered from the approver's own account, refused from anybody else's (D69's rule, one level up) |
| W3 | **The PDF a vendor receives should carry its own signature** — answered: a **QR resolving to our own PO page** (D244). Still Phase 2: a vendor has no account here, so it needs a public read route and a token scoped per order. The PO screen now renders the QR **inside the app** with a note saying exactly that, and it is deliberately not printed on the vendor's PDF — a QR that fails for the person holding it is worse than no QR | Raised 2026-09-11, answered 2026-09-13. The two other candidates are dead: a scanned signature survives a photocopier and therefore proves nothing, a cryptographic one nobody in this trade can verify. The QR also catches an amended order presented as the original, because what the vendor sees is live |
| W4 | ~~**QR per box, as the marker for installation**~~ — **built 2026-09-13 (M52)**, D262/D263 — the owner's second sentence on Q29, and a different thing from W3 | Raised 2026-09-13 (D244). A purchase order is one document with one QR; an installation needs a code **per box** that survives being carried to a site, and resolves to what is inside it and where it goes. Not built by widening W3 |
| W1 | ~~Receiving reported by whoever actually saw the goods arrive~~ | **answered and built** 2026-09-11 (D131). The owner's answer changed the shape: there *is* a procurement team with access, so accountability was never in doubt — the problem is only that goods arrive outside working hours. So receiving split into a report (photo, anyone present) and a confirmation (tanda terima, procurement). The Chat route is no longer required for it: the same two acts work from the app tonight, and a bot can produce the report later without changing anything |
