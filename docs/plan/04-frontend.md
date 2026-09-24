# 04 — Frontend design

> **Phase note.** In Phase 1 this document *is* the work — the whole workflow
> is frontend. Screens call `src/demo/api/*`, which implements `03-api.md`
> exactly, so nothing here changes when the real backend arrives.

**The design system in this repo is finished and we are not redesigning it.**
The shell, the token scale, the component set, the two keyframes and the
menu-as-data model all stay exactly as they are. This document says how the
procurement and accounting screens are built *with* them, and lists the small
number of components that have to be added.

## What already exists and is reused as-is

| Piece | File | Contract |
|---|---|---|
| Shell | `src/app/(app)/layout.tsx` | sidebar + topbar never scroll; only `<main>` does. That is what makes it feel like desktop software |
| Menu as data | `src/lib/nav.ts` | adding a page is one array entry. Items the role may not see are **not rendered at all**, and a section that empties disappears |
| Permissions | `src/lib/roles.ts`, `src/store/session.tsx` | `can()` hides menus and buttons. It is not a guard — the guard is RLS (ADR-002) |
| Cards, badges, buttons, stat cards, page header, empty state, progress | `src/components/ui/primitives.tsx` | six tones: brand · green · amber · red · slate · violet |
| Table | `src/components/ui/data-table.tsx` | column definitions as data, row click opens a drawer |
| Drawer + Modal | `src/components/ui/drawer.tsx` | **details open in the right panel, never a new page.** The table stays visible behind; closing returns you exactly where you were |
| Tabs, combobox, number input, toaster | `src/components/ui/` | |
| Charts | `src/components/charts/charts.tsx` | recharts, brand colour pinned |
| QR | `src/lib/qr.ts`, `src/components/ui/qr.tsx` | `qrcode-generator` (zero transitive dependencies) for the matrix; the rendering is ours — **SVG paths, one per row-run, not a data URL**, because a bitmap at label size is the difference between a scan that works from the tailgate and one that needs three tries. Holds a **URL** built from the host the page is on, with the code printed beside it in type a person can retype (D263). Verified by decoding the emitted path back with `jsqr` — a dev dependency, never shipped |
| Money and dates | `src/lib/format.ts` | `formatIDR`, `formatIDRCompact`, `formatM3` (3 decimals — 0,001 m³ of a log is money) |
| Motion | `tailwind.config.ts` | exactly two keyframes: `fade-in`, `slide-in`. Everything else is `transition-colors`. Software used eight hours a day must never make its user wait for an animation |

## What has to change in the existing shell

| Change | File | Why | Milestone |
|---|---|---|---|
| **Replace the role dropdown with a grant picker** | `src/components/layout/topbar.tsx` | access is now several module grants plus four separate authorities (D23, D24), so a single-choice dropdown cannot express it. In Phase 1 it becomes a demo control that toggles modules and authorities and shows what each unlocks — which demonstrates permissions far better than a dropdown did. **Deleted in Phase 2** with the rest of the demo layer | M2 / P2 |
| Session from the demo identity API | `src/store/session.tsx` | the provider keeps its shape, so `can()` callers do not change when it becomes `/api/v1/identity/me` | M2 |
| Sign-in and no-access pages | new `/signin`, `/no-access` (D38) | an account with no module lands on a page that says so, rather than bouncing | M2 |
| Brand values | `src/lib/brand.ts`, `tailwind.config.ts` | still placeholders. When the real colour arrives, derive the **whole** 50–950 scale, and update `BRAND` in `charts.tsx` and `themeColor` in `layout.tsx` | owner |
| ~~Sample dashboard data~~ | `src/app/(app)/dashboard/page.tsx` | **done (M13)** — the invented sales orders and timber-yield chart are gone; it reads cash, the twelve-month plan, the approval queue, supplier obligations, the inbox and the last ledger rows, all from the demo store (D118) | M13 |

## Components to add (and only these)

| Component | Why it earns its place |
|---|---|
| `<Loaded>` + `<SourceBadge>` | the rekap's own "worth keeping" list: a load failure is carried as a value and shown, never a blank table pretending to be an empty one. Badge says `live` · `cached` · `failed` |
| `<StatusPill status={…}>` | one place maps the nine `line_status` values, four round states, two PO axes and six review states onto the six existing badge tones. **One ladder, one mapping** (D6) |
| `<MoneyInput>` | wraps `NumberInput` with Indonesian grouping, whole rupiah, and a "cannot exceed requested" ceiling for approval fields (A8, at the input) |
| `<ApprovalTrail>` | vertical timeline over `pr_approvals` + revisions + allocations + receipts: who, when, from which door. Append-only data deserves an append-only display |
| `<AdvisoryBanner tone="amber">` | duplicates, receipt-total mismatches, similar transactions. **Never disables the button** (A6). Amber, dismissible, states what it saw |
| `<RefusalToast>` | renders the API `error.outcome`: refused → "this decision belongs to `<role>` — logged, not applied"; duplicate → "already recorded — nothing changed" |
| `<EvidenceStrip>` | **built (M9)**, one component on both drawers: the documents already filed, what each one covers, *also covers* to point one file at another record, and two upload buttons — **Photograph** (opens the camera directly on a phone) and **Choose a file**. A ledger row also shows, read-only, the documents that live on the request lines its money paid for. Older description: the attach block above: thumbnails, kind, the agreement check, *Lampirkan*, *juga mencakup…*. Appears identically in the PR line drawer and the ledger row drawer — **the main road, so it is one component used twice** |
| `<FilterBar>` | date range, account, vendor, status — the same bar on every list, so muscle memory transfers |
| `<RefreshBadge>` | "3 new since you opened this" + a reload button. Backlog §10's own recommended order: **badge and reload first**, polling second, realtime third. Never lose a reviewer's half-typed draft to a refresh |
| `<Pager>` / `usePaged` / `<Paged>` | **built (M26)**. `DataTable` pages itself at 25 rows; the hook is for a screen whose list is state at the top of the component, and the component wrapper is for a list derived **inside** a `Loaded` callback — which is not always called, and so is no place for a hook. The bar always prints `1–25 dari 137`, because a table silently showing a quarter of the data is worse than a slow one (D157) |

Nothing else. A component library is allowed (owner, 2026-08-27) but every
addition is a thing to maintain; these each answer a rule.

## Printing a payslip

The slip is a **card, not a page** (D156). The print road is unchanged — it is
the app's own page, so there is no second renderer to drift from the figures on
screen (D133) — but how many land on a sheet is measured rather than assumed:
the slips are laid out once at the printed width (718px = 210mm − margins), their
real heights read off the page, and sheets packed to fill A4 and no further. A
fixed count cuts a tall slip across a page break or wastes a third of the paper,
and workshop slips are half again the height of salaried ones.

Two modes: with the week recap (five to seven per sheet) and without (six to
eight). The recap is the owner's own sketch — the week across, *masuk · pulang ·
jam · lembur* down — and it is the part a daily worker actually reads.

Where the recap and the totals disagree, the slip prints the reason: a day the
machine left incomplete is marked `?` and named in words, and overtime the
machine saw but nobody approved is stated beside the hours that were paid.

## Interaction contract

Carried from what works today, plus what the money rules demand:

1. **A menu entry a user has no access to is not rendered.** Accounting off
   means no ledger entry, not a disabled one (D22). The union of a user's
   module grants decides the menu; their authorities decide the controls
   inside it.
2. **Details in the drawer.** Navigation between pages is for changing module.
   A PR line, a transaction, a vendor, a PO — all open in the right panel.
3. **On a phone the drawer is full height and full width**, with the action
   bar pinned to the bottom. This is the one responsive addition, and it is
   the difference between usable and not on a 6-inch screen.
4. **Never optimistic on money.** A row that is being posted shows a pending
   state and stays put. Optimistic UI on an approval means showing a decision
   that may be refused by the database a moment later.
5. **Every mutation ends in a toast** that names what happened, including
   "nothing changed".
6. **Warnings are amber and never disable anything** (A6).
7. **Refusals are readable** — the name of the role that may act, not
   "Forbidden" (A7).
8. **Approval and payment are never the same button, on any screen** (A1).
   They are not even in the same card.
9. **Evidence is attached from the thing it belongs to.** Every PR line and
   every ledger row carries an attach affordance; no screen asks a person to
   pick a parent off a list unless the parent is genuinely unknown (ADR-010).
10. **A number the database owns is never recomputed in the browser.** If a
   balance does not load, show `—` and the source badge. Never a substitute
   computed client-side, which is how a screen ends up disagreeing with the
   books.

## Screen inventory — v1

Routes that already exist as placeholders are marked ▸; new routes are ✚.
Every new route is one line in `nav.ts`.

### Procurement

| Route | Screen | Milestone |
|---|---|---|
| ▸ `/procurement/pr` | **The working surface** (D74): asking, correcting, documenting, paying. One row per item — item, vendor, quantity, amount, status — with the four meeting-state chips and the paid≠approved chip as filters. Everything else is in the drawer: the decision and its trail, coverage, the variance and its explanation, documents, and recording a payment straight into the ledger. Old description follows. PR list: filter bar, table, row → drawer with lines, coverage, trail, evidence. Line actions: **attach a document here**, **remove** (until money has reached it). Header: **Buat PR** | M4 |
| ▸ `/procurement/pr` (same board) | **Approved against paid.** A strip above the table: how much was paid beyond approval, how much under, how many still unexplained, and the counts by reason — the pattern, not the event (D55). Filters the board to those lines, which are drawn from the variance list rather than the open board, because a difference outlives the line. In the drawer: the three numbers, the gap in words, the explanation or the form that records one, and — on an approved line that is not settled — **Record the payment**, which writes the ledger row, the allocation and the document link in one act (D53) | M4b |
| ✚ `/procurement/meeting` | **The leadership meeting, as a screen** (D74). Four numbers across the top: approved and still to pay, waiting for a decision, the BCA 271 balance, and **the transfer needed before what is approved can be paid** — plus what that transfer becomes if everything waiting is approved today. Then two lists: waiting for a decision — **ticking picks, it does not decide** (D77); the count and the total appear in a bar above the lists with one confirm, *Approve* for the authority holder and *Send to the approver on Chat* for everybody else — and approved-waiting-for-payment with its total at the top of the table, not the foot. **Add an item** creates a real request, submitted on the spot (D73) | M5c |
| ✚ `/demo/chat` | Google Chat, standing in for itself. **Send a transfer proof** puts a receipt in the review queue the way leadership really does — from a phone, booking nothing. And **one card per send**, carrying the list and its three totals — asked for, approved so far, what has to be paid — plus the BCA 271 balance and the top-up if it falls short. Per item: quantity, amount, instructions, approve or not yet; and *approve the rest as asked* for what is left. Answering somebody else's list is refused, which is the point of the route (D69, D70) | M5b |
| ✚ `/procurement/pr/baru` | multi-line create. A full page, not a drawer — this is the one place people type for ten minutes. Item combobox with last price and unit, vendor type-ahead that accepts a new name, running total | M4 |
| ✚ `/procurement/persetujuan` | **the standing queue** — every submitted line not approved and not removed, grouped by document. Per line: **a checkbox**, and an approved amount that starts at what was requested and may only be reduced. Nothing else. Visible only with `approve_goods` | M5 |
| ✚ `/procurement/rounds` | **built (M6), then parked** (D105) — kept and working, no further work. Every live round (usually one, sometimes two — one being funded, one collecting): the four-state rail with what each state means, then requested · BCA 271 · to transfer · remaining after payment. **Roll in what is owed** (idempotent), **approve** (freezes the numbers, `approve_funds`), **record the transfer** — two roads (D81): *we transferred it* uploads the receipt and writes both ledger legs, or *money already in* books what leadership dropped in chat and funds the round from a row that is already in the ledger. Neither can finish without the proof (D80), **close** (which answers with the list of what it just released). A TRANSFERRED round shows every item still `APPROVED` and unpaid — the proof that funding is not paying (A10), and since D126 also the proof that funding reserves nothing for any particular line | M6 |
| ✚ `/procurement/rapat` | meeting board, four columns: ✅ lunas · ⏳ disetujui belum bayar · ⚠️ dibayar belum disetujui · • belum keduanya | M12 |
| ✚ `/procurement/penerimaan` | **built** — the morning queue: arrivals somebody reported at night and nobody has completed, oldest first, with how many hours each has been waiting. Completing one takes the signed tanda terima, the QC name and the daylight count, and only then does it count as received (D131) |
| ✚ `/procurement/po` | **built** — every order as an obligation rather than a document, split into drafts (which owe nothing, D99), open, and finished. Money and goods as two badges, never one bar (A1), plus **exposure**: paid minus received, said in words — *our money is with the vendor* or *the vendor is carrying us* |
| ✚ `/procurement/po/[po]/print` | **built** — the order as the supplier sees it: A4, printed to PDF by the browser, sent on WhatsApp through a prefilled `wa.me` link (D133). Shows what is ordered, the price, the expected delivery and the terms — never our exposure, what we have paid, or who approved it. The app shell is hidden in print everywhere, not just here |
| ✚ `/procurement/po/[po]` | **built** — one order end to end, through its whole life: **ask leadership to confirm → confirm → issue and send → print / WhatsApp** (D132). The part that exists nowhere else is the **schedule**: each term's trigger, its share, what has been paid against it oldest-first, and its state — `PAYABLE`, `BLOCKED` naming the term holding it up, or `NOT DUE` (D128). Then the lines with what has arrived, **Amend** (supersession with a required reason, D129), what the order used to say, everything paid against it, everything filed against it, and **Close** — refused with the list of what is unfinished unless a reason is written (D130) |
| ✚ `/procurement/tracker` | **built (M11)** — opens on what the company owes every supplier at once: contracted, paid, owed, and of that, *billable now*, with the vendor credit stated separately (D102). Live suppliers in one card, fully settled in a collapsed one. `Add new PO` issues an order without leaving the screen (D100) | M11 |
| ✚ `/procurement/tracker/[vendor]` | **built (M11)** — one supplier, full width (D103): four figures, then every order with ordered-vs-received and condition per line (`+2 OVER`, `NOT ARRIVED`), its note, and its delivery history — receipt number, quantity, condition, date, **who received it, who checked it**, and the photo and tanda terima named separately (D101). Then the payment history **across all orders**, because one transfer closes three (D97), each row naming what it applies to and whether its proof is filed. Finally total PO, balance, and *billable now* with the over-delivery credit stated apart (D98, D99). **Record arrival** refuses without both documents | M11 |
| ▸ `/procurement/po` | PO list + detail drawer: **two separate progress bars**, payment and delivery, never merged. Exposure stated in words | M11 |
| ▸ `/procurement/penerimaan` | receiving: pick a live PR or PO line, qty, condition, **photo required**, QC by | M11 |
| ▸ `/procurement/supplier` | vendors: curated and uncurated split, merge proposal, purchase history | M3 |

### Accounting

| Route | Screen | Milestone |
|---|---|---|
| ▸ `/accounting/ledger` | **built (M8)**: cash position across the five accounts at the top — the leadership one locked unless you hold `approve_funds` (D87) — and clicking one filters the ledger to it. Paged at the service, 25 a page. **New entry** enforces both rules at the point of writing: at least one primary document (D85), and quantity, price and vendor on a purchase (D86). No "allocated" figure anywhere (D88); a purchase with no request behind it says so in four words. Void is behind *Something wrong with this row?* (D89), and every row carries its own history with what changed (D84). Older description: filter by account, type and text; rows show date, description, amount, **unallocated where a request was expected** (D83), evidence count and status. The drawer holds what it bought, what it paid for, the documents — attached **from the row** (ADR-010) — VOID with a mandatory reason, and mark completed. Nothing is deleted: a voided row stays with its amount at zero and its reason on it. Old description follows. the ledger: filter bar, table, row → drawer with lines, evidence, allocations, the path to PR and PO. Actions: mark COMPLETED, VOID with a reason | M8 |
| ▸ `/accounting/verifikasi` | **built (M10)**: the weekly arrival count on top (a measure of the main road, not of this screen), the queue on the left, and five roads on the right — make a transaction · retro request line · link to a row · note · reject. The last two keep the file and never touch the ledger (D94). A duplicate warning names the row it looks like and offers *link* rather than refusing anything. `Others` starts on the notes road. Resolved rows stay listed underneath. Older description: **The exception inbox.** Only documents whose parent is unknown — bought first, approved later. Photo left, form right; resolve into a transaction, a retroactive PR line, a link to something existing, a note, or a rejection. Should stay small | M10 |
| ▸ `/accounting/cashflow` | five account balances from the view, movement chart, tie-out | M12 |
| ✚ `/procurement/meeting` (revised) | the picked total counts only what is **still to pay** — a line bought first and approved later commits nothing more, and the approval figure is shown beside it when they differ (D124). Lines with no document behind them are marked before the yes and refused at it (D125). There is one status for approved-and-unpaid, and the panel says plainly that an approval is a claim on the account rather than a reservation against it — an older approval can lose its funding to a newer one and have to be asked for again (D126). **Every row carries an instruction column** (D127): on a waiting line it rides along with the approval or with the chat request; on an approved line an approver records it on its own | M5c |
| ✚ `/accounting/liquidation` | **built (M12a)** — every transfer of operating money in, newest first, with how long each one lasted. Open one: what the balance was before it landed, everything that left before the next transfer arrived, and a running column counting the transfer down — negative once spending passes it, because *we carried on out of what was already there* is a different fact from *it ran out*. Grouped by type, vendor and project, and the part with no approved line or order behind it named (D106, D107) | M12a |
| ✚ Guided walk (`?tour=flow-b`) | **built (M13)** — nine steps across the real screens, in the order the business works: request → meeting → chat approval → pay from the line → ledger → tracker → the exception inbox → liquidation → calendar. A bar along the bottom, never a spotlight: everything underneath stays live (D117). Two lines of text on a phone with tap-for-the-rest, and the step lives in the URL so it can be pasted into a chat | M13 |
| ✚ `/hrd/karyawan` | **built (M17)** — everybody on the payroll, what their time costs, and their **hak cuti berbayar**, which is a different number for every person (D144). Two kinds of people, one list: staff on a monthly salary, workshop on a daily rate, and the difference shows up in exactly one place. Changing a rate puts the figure before and after on the audit row |
| ✚ `/hrd/absensi` | **built (M17), rebuilt as a timesheet (M18)** — every person down the side, every office day across, one cell each. Green is a day the six slots read cleanly, **amber is a day somebody still has to read**, violet is a day HRD has spoken for, grey is a day nobody tapped. Click a cell for the taps the machine actually recorded, the slot the rule gave each one, and what it could not place; click a **date** to mark the whole office — *tanggal merah*, *setengah hari*. Upload the reader's own CSV and it reports added · already-on-file · unknown machine numbers, inventing nobody (D141–D143). Every day says **what it is worth to payroll and why**, in Indonesian — *sakit* turns paid the moment the surat dokter is attached from the drawer, *cuti* is paid out of that person's own balance (D144). Overtime moved to its own screen; what stays here is the count of sheets nobody has signed |
| ✚ `/hrd/lembur` | **built (M20)** — lembur as the two pieces of paper the business already has (D146). A **production** sheet is one night and many names, each line carrying the order, the stage and how many; HRD checks the hours, the signed sheet is attached, leadership signs — and that signature also posts the work to the production board (D147). A **staff** session is one person, one evening, their own screenshot report, **paid unless HRD says otherwise**. Every sheet shows the stage it is stuck at, because the one nobody has signed for a week is the only row that needs somebody today |
| ✚ `/inventory/log` | **built (M24)** — timber from log to board. Each stick measured (Ø × length → m³), each board counted, *rendemen* per load, and per vendor **per species**: rupiah per cubic metre of log beside rupiah per cubic metre of board. The demo says the quiet part out loud — the vendor who is cheapest on the invoice is the dearest after the saw, by five million rupiah a cubic metre. A partly-sawn load never sets the price, and the seller's claimed volume sits beside ours (D153) |
| ✚ `/inventory/papan` | **built (M24)** — boards grouped by the size a workshop asks for, valued at **each load's own** cost per board m³ rather than one average. Says plainly that it is what came off the saw, not what is left in the rack (Q40) |
| ✚ `/proyek/produksi` | **built (M23)** — *proyeksi vs aktual*, per project. Projected material cost from the BOM × what was ordered; against it, what was **asked, approved and paid** on the request lines raised from that project's own work orders. Materials against materials — labour is in neither side (Q38) — and the ledger's whole project spend is shown apart, saying that it also contains installation, delivery and subcontract, because subtracting it would be a category error (D151) |
| ✚ `/produksi/bom` | **built (M21)** — master data: the products the business sells and makes, and what each one is made of. Components point at catalogue items by code, carry **susut separately from quantity**, and price themselves from the catalogue's standard price (or the last price paid, and it says which). The material cost is computed on read and **never completed by guessing** — a component with no price leaves the total marked incomplete rather than counting as zero. Every product also carries its **size in millimetres**, a **gambar kerja** and a **gambar jadi**, and the list names what each one is missing rather than leaving it to be discovered (D150). A panel answers the question the BOM exists for: *twelve of these — what do I have to buy?*, waste included. One product ships with no BOM at all and one with an unpriceable component, because that is the honest state of a catalogue in month one (D149) Since M48 the drawer opens on a **revision**: a badge saying draft or released, the diff the draft would introduce (derived from the same component list the table below renders, so the two cannot disagree — F77), a release box that needs a sentence, and the history with how many work orders each released revision is pinned to (D256) M49 adds the **labour cost**: typed with its working beside it, refused without one, and the combined total left blank while either half is (D239) |
| ✚ `/proyek/order` | **built (M21)** — projects as master data: client, location, PIC, start, target, agreed contract value. The **code is fixed** once created, and the drawer shows why — the work orders underneath it are matched on that code across the seam. Contract value is stated as the agreed order value, not an invoice and not a quotation (Q37). The drawer carries **the items ordered and how many**, read beside *dibuat* and *selesai* from the production board — four tables ordered and four made, ten doors ordered and twelve on the floor, a signed job with nothing started (D150) |
| ✚ `/produksi/jadwal` | **built (M20)** — the workshop floor: what is being made, how far each of the **four** stages got (M47, D253), how many, and when it is due. **Late first**, then by due date. One cell per stage per order, so "sampai mana" is readable without opening anything; progress counted as stages finished across the quantity, not as the furthest stage reached. Reports are append-only and a correction is a negative entry with a reason; entries that came from a signed lembur sheet are marked as such (D148). A work order also turns its **BOM into a purchase request** — one button, a draft, every line carrying the SPK number so the projection and the spend can later be read against each other (D151). Since M47 each order carries a **route**: an order the vendor builds draws three cells rather than four with an empty one, its drawer holds the vendor leg (sent · promised back with a `±` · returned), and while the goods are away the reporting form is not there to be offered — the same predicate the API refuses on (D254, D255) Since M49 the projection is the **walked** list: it names the sub-assemblies it went through, the ones it could not break down, and a loop if the BOM contains one — and the request built from it now carries what those sub-assemblies are made of, which it silently did not before (D257, F78) |
| ✚ `/produksi/vendor` → rekam jejak | **extended (M60)** — how each vendor has behaved, with **no rate below a floor** and the basis printed beside every figure (D282). On-time is counted only over trips that carried a promise |
| ✚ `/proyek/pengiriman` → sedang di vendor | **built (M60)** — what is neither in the workshop nor on the road, per project line, with which vendor and how late (D282). The quantity stands on its own rather than as a fraction of the client's line: the two count different things | M60 |
| ✚ `/hrd/karyawan` → jadwal kerja | **built (M60)** — HR switches a person's pattern from the employee record, with the first option **naming their unit's default** rather than reading as unset. The list shows *ditetapkan* against *ikut unit* (D281) | M60 |
| ✚ `/produksi/vendor` | **built (M59)** — where our things are, vendor by vendor (W6, D280). One row per trip, grouped by who is holding it, overdue first. Late only against a promise: a leg with no agreed return date reads *tanpa janji tanggal* and sits in its own group rather than at the top of the late list. The closed list keeps *18 dari 20* with **kurang 2** beside it, because a tick would have swallowed the two that never came back | M59 |
| ✚ `/produksi/jadwal` → legs | **extended (M59)** — the drawer shows every trip this order has made, each with its own dates, and receiving one takes a **quantity** rather than a tick. Sending is per process and per vendor | M59 |
| ✚ `/hrd/jadwal` | **built (M58)** — HR's own screen for the working patterns (Q53, D279): the week and the month per pattern, **derived** from the times and printed with their working, with Friday counted at its own length. A pattern missing a piece shows blanks and the reason, never a zero. *Ditetapkan HR* is counted apart from *ikut bawaan unit*, because a unit default is an assumption — and confirming one is a pre-selected click | M58 |
| ✚ `/hrd/kontrak`, `/hrd/kontrak/[no]` | **built** — kontrak kerja sebagai **daftar periksa dan selisih**, bukan folder PDF. HRD yang membuat kontraknya; yang hilang setiap kali orang HRD berganti bukan berkasnya melainkan kemampuan menjawab pertanyaan tentangnya. Dua angka di kepala daftar yang tidak bisa dijawab siapa pun sebelum ini: berapa kontrak yang **poin wajibnya belum dijawab**, dan berapa yang **isinya tidak sama dengan yang dijalankan**. Halaman satu kontrak menaruh kalimat aslinya di sebelah angkanya — angka tanpa kalimat di belakangnya tidak bisa dibantah di meja — dan menampilkan *kertas* melawan *sistem* berdampingan. **Tidak ada tombol menerapkan di layar ini**, dan itu disengaja: mengubah upah adalah perbuatan lain, di layar karyawan, dengan jejak yang berbunyi *upah berubah* (D155). Usulan mesin ditandai sebagai usulan dan tidak pernah menutup poin wajib. **Rantainya lengkap sejak pembaca PDF ditunda**: *Daftarkan kontrak* membuat draft (PKWT wajib bertanggal berakhir, PKWTT tidak boleh — keduanya ditegakkan di formulir supaya tidak dipelajari lewat penolakan), tiap poin dijawab lewat **bidang sungguhan** menurut `CLAUSE_FIELDS` — pilihan sebagai `select`, angka sebagai angka, jadwal dari daftar jadwal yang benar-benar ada — lalu *Berlakukan*. Kotak JSON yang ada sebelumnya hanya bisa dipakai orang yang menulis seamnya (F130), dan bentuk bidangnya dijaga sama dengan `ops_hr.clause_value_ok` oleh `check-clause-fields.mjs` | 0058 |
| ✚ `/produksi/jadwal` → tahap per produk | **extended (M58)** — the board draws only the stages the **product** goes through (Q52, D278). A dining table no longer gets a Machinery column it will never fill | M58 |
| ✚ `/hrd/wlkp` | **built and live (D304)** — Wajib Lapor Ketenagakerjaan, delapan tabel rincian dan satu pengakuan di atasnya. The screen opens on *how many people are still missing an answer, and which answer*, not on a chart: the job in front of whoever opens it is collecting six facts from twelve people, and a breakdown printed above that would be decoration. Every table shows `Belum diisi` as its own row, highlighted, and prints its own total so the reader can see it adds to the headcount. The date picker is not a convenience — WLKP is filed for a date, and somebody who left in November was staff on the 31 December before it, at an age that was not their age now. Below the tables, the six answers per person with inline editing: three states on disabilitas (*belum ditanyakan*, tidak, ya) because a checkbox has two and would turn the first into the second for everybody the moment the form opened. Prints, and sends nothing anywhere — the numbers are transcribed into the portal by a person, which is the honest boundary | D304 |
| ✚ `/hrd/tugas` | **built and live (D303)** — pemantauan tugas: tugas rutin dan tugas tambahan, dengan periode pengerjaannya, apa yang harus diserahkan, dan kapan ditagih. It opens on **Ditagih hari ini** rather than on the full list, and that ordering is the design: a board that opens on everything makes its reader work out what to do next every time, and the thing they are worst at — remembering to ask — is exactly what gets skipped. The card is a short list of names with one button each, and it empties as the asking is recorded, not as the work arrives. A blocked task never appears on it (D261). Beside it a count of open tasks nobody has marked received, printed and gating nothing: an unacknowledged task is still due and still late when it is late (A6), because a rule that let anybody escape a deadline by not clicking would be a worse tracker than no acknowledgement at all. Routines are a third tab, with the period each one is in right now and the real date it would raise, so *setiap tanggal 5* can be checked before anybody commits to it. Nothing here feeds a score, and the footer says so | D303 |
| ✚ `/hrd/cuti` | **live (D295)** — dark since the ladder landed, and not because the screen was unfinished: leave requests had no table at all. The list is ordered waiting-first, because a queue is not a filing cabinet, and each row shows how its days would be paid **before** anybody decides — a request past the entitlement says so now rather than as an unpaid line on a payslip next month (D178). Days that already carry a mark are named on the row, and approval reports back which it wrote and which it had to skip | D295 |
| ✚ `/hrd/payroll`, `/hrd/payroll/[run]`, `…/payslip`, `…/minggu` | **live (D294)** — dark until now, not because the screens were unfinished but because the seam was eighteen fields short of `PayrollLine` and a client could only have half-filled it and cast the gap away. `0119` closed that; the eight live functions assemble from `run_lines`, `period_lines` and `payroll_totals` and compute nothing — the header totals come from the database rather than from summing the rows just handed over, because two implementations adding up money is two chances to round it differently. The only thing the browser adds is a word: `ADJUSTMENT_LABEL` and `SCHEME_LABEL` | D294 |
| ✚ `/it/aturan-gaji` → hari kerja efektif | **evidence added (D292)** — the typed figure now has the company's own calendar printed under it: 365 days minus the weekly rest days the pattern implies minus the tanggal merah that fall on a working day, with the subtraction shown. It does not replace the field — D271 keeps IT typing it — it makes the number checkable instead of inherited. And it prints what the calendar **does not** know: a year with no holidays entered counts every weekday as worked, so a twenty-day gap reads as days nobody has written down rather than as an error. Keyed on the acting user as well as the rules, because the seam answers null to somebody without the right and caching that is caching a permission (F144) | D292 |
| ✚ `/it/aturan-gaji` → jadwal kerja | **editable (D291)** — was a table you could read and not change, and changing an hour meant a migration, which is how the office's Friday spent a day wrong. Now rows are added, edited and removed on the screen, with the unit map beside them. Three things it is careful about: **empty is an answer and it is not zero** — a cleared time leaves *belum ditetapkan*, which is what the guard's twelve hours actually are (D274); **the consequence is shown while you type** — every row prints its day, Friday, week and month from the same function the demo uses, so *what does 16.00 do to the week* is answered before saving (D279); and **it decides nothing** — the problems listed come from the same statement of the rule the database enforces, and the refusal is still the seam's (ADR-002). Removing a pattern people are on is refused and names them, and the preview says so before the version is written | D291 |
| ✚ `/produksi/jadwal` → tahap lama | **extended (M57)** — work recorded against steps the business no longer has (potong, serut, rakit) is shown **apart from** the four, never folded into Sanding, because a process change must not make past work disappear (D275) | M57 |
| ✚ `/hrd/absensi` → catatan hari | **extended (M56)** — a slate box for what is worth saying about a day the rule read fine, separate from the amber one for what nobody could read. A break over its allowance lands here and does **not** stop the day being paid (F90) | M56 |
| ✚ `/demo/chat` → PO cards | **built (M55)** — the half of W2 that was missing: the card, not the plumbing (D267). An order written by somebody without `approve_goods` arrives here with vendor, contract value and expected date, and is answered from the approver's **own** account — answering from anybody else's is refused with the reason, which is the whole point of the road | M55 |
| ✚ `/procurement/po/[po]` → banner | **extended (M55)** — says which road the confirmation came down. A self-confirmed order states in bold that no second pair of eyes saw it, because a rubber stamp that reads like a review is worse than no stamp (D267) | M55 |
| ✚ `/procurement/tracker/[vendor]` → chips | **fixed (M55)** — *photo of the goods*, *tanda terima* and *on file* open the document they name (B2, D268). Presence is derived from the attachment id at the point of render, so the chip and the link cannot disagree about whether there is a file | M55 |
| ✚ `/accounting/verifikasi` → already decided | **extended (M55)** — a date window with an honest edge: ninety days by default, and the card always says how many decisions are outside it and names the oldest, because a list that quietly stops somewhere lies by omission (B4, D269) | M55 |
| ✚ `/produksi/jadwal` → bahan yang keluar | **built (M54)** — what the run should take against what actually left the rack, in the work-order drawer where both are known (D266). Pre-filled from the order's own pinned BOM revision as a **proposal**, edited to what was really carried out, and confirmed by the storeman. An item the BOM never named reads **di luar BOM** with an em dash, never a variance of zero. The panel prints *3/4 jadi* rather than a percentage until the run is finished, because half a run has taken half its material. Lines that would send the count negative are named **before** the confirm and again after | M54 |
| ✚ `/inventory/material` → drawer | **extended (M54)** — a move whose `spk-…` reference names no work order says so in amber. It has nothing to show now the seed is clean, which is the point: a guard earns its place by what it would catch (F86) | M54 |
| ✚ `/produksi/penautan` | **built (M53)** — where a name on the production board becomes a person (D264). Asked **once per name**, not once per entry, over a date range. A suggestion is offered and never applied; where two employees could be meant — *Andi* in the workshop and *Andi Prasetyo* in the office — the row says so and offers neither. **Bukan satu orang** is an answer, not a failure: *Tim potong* and a subcontractor's crew count towards coverage exactly like a linked name. The four tiles read coverage first, because coverage is what makes an empty production column on a KPI card legible | M53 |
| ✚ `/hrd/kinerja` → hasil produksi | **extended (M53)** — the card now shows what the person actually **made**: pieces, stages, work orders. Shown and deliberately **not scored** — a piece is not a unit, and eight nakas plus four wardrobes is not twelve of anything. Where it is empty the card says how many of the period's entries are still unattributed, so a blank is never read as a zero, with a link to the screen that fixes it | M53 |
| ✚ `/proyek/peti` | **built (M52)** — the crates, grouped by the lorry they are on, with the ones packed and waiting first and the flagged ones above everything (D262). Each row carries its QR, its room, its contents and its place in the consignment. **Cetak label** per group opens the sheet below | M52 |
| ✚ `/proyek/peti/label` | **built (M52)** — A4, six labels to a sheet at **97 × 88 mm**, in real millimetres on screen as well as in print, so the preview is the paper rather than a surprise in the print dialog. What is on a label is ordered by what the person at the tailgate needs: the **room** in the largest type, then *3 dari 5*, then the contents, then the code and its QR, then the project smallest because it is the thing they already know. Printed via the browser's own dialog, on the same road as the purchase order and the payslip (D133) | M52 |
| ✚ `/box/[box]` | **built (M52)** — what the QR opens, and the reason none of this waited for a backend: it is **inside the app, behind the ordinary login**, because the person scanning a packing box is our own installer (F82). Laid out for one thumb in a stairwell: the destination is the largest thing on the screen, three thumb-sized actions, and the only one that asks for typing is the one that must — *what is wrong*. An unknown code is an ordinary 404 with the code in the message | M52 |
| ✚ `/procurement/po/[po]` → QR | **extended (M52)** — the PO's QR rendered **in the app** with the honest note beside it: it opens the order for somebody who already has a login, which is the receiving clerk at the gate. It is deliberately **not** on the PDF the vendor receives, because a vendor has no account here and a QR that fails for the person holding it is worse than no QR — that half needs a public route and a token, and stays Phase 2 (W3) | M52 |
| ✚ `/hrd/kinerja` | **built (M51)** — the KPI analyzer and the task tracker, one screen because one is the evidence for the other (D260, D261). Takes a **date range**, defaulting to the last payroll run's period, because attendance arrives in fortnights and a calendar month can hold three days of taps. Each measure prints **tidak terukur** with the reason where the data does not exist, its source, and what it was computed over. A blocked task is violet and leaves the arithmetic. Overtime is shown and labelled *not scored*. Every card carries the limitation: production work is recorded against a name, not a person, so it is not in the score | M51 |
| ✚ `/hrd/iuran` | **built (M50)** — the register of who is enrolled in which statutory scheme, and the arithmetic beside it: **names × rate**, deliberately the simplest thing a person can check by hand (D259). Member numbers masked; a scheme with no rate for the month shows **no figure rather than an invoice of nil**; an unconfirmed rate carries a badge saying so (Q49). Ended enrolments stay, with the date and the reason. **PPh 21 has its own card saying it is recorded and not computed** — an empty column would read as zero tax. Readable by HRD, payroll **and accounting**, because auditing the bill against the roll is accounting's job | M50 |
| ✚ `/hrd/payroll` + `/[run]` | **built (M17)** — runs by period, every line computed from the days and the approved overtime each time it is read. A day is worth 1, 0,5 or 0 depending on what the timesheet says (D142, D144), and the line breaks the paid days into present · sakit with a letter · cuti berbayar · recorded-not-paid. Approval refused while any day is still **unread** (D139), with the count and a link to it. **Gross only**, said on the screen and on the payslip. Since M46 a **Tunjangan** column sits beside Pokok, showing the days that earned it and the days HRD took it off (D250) |
| ✚ `/hrd/payroll/[run]/payslip` | **built (M17)** — one payslip per person, a page break each, printed to PDF by the browser on the same road as the purchase order (D133). States in Indonesian that it computes bruto and that BPJS and PPh 21 are not included |
| ✚ `/hrd/absensi` → day drawer | **extended (M46)** — the tunjangan for one day, as its own decision with its own reason (D250). *Dibayar — hari ini tercatat hadir* by default; withholding asks why and says explicitly that **lateness is not a reason here**, because lateness costs hours and the allowance survives it. A restored one keeps its row, greyed, with who put it back and why | M46 |
| ✚ `/accounting/calendar` | **built (M12b, extended M12c)** — twelve months across, every line down the side, planned above and actual below (`≈` when matched by category rather than named by a person). A line is **weekly, monthly or one-off** (D113), so a five-payday month shows `Rp 150.0M 5×` and a vendor settlement appears in one month only. **Click a month** and it opens day by day: the dated movements in order, the balance running down, the first day it goes under in red and the lowest point named (D115), with the undated supplier obligations stated underneath rather than spread across the days. The reminder at the top is the same events filtered by date (D116). A cell opens *this month only*, which needs a reason; the **not in the plan** row is what keeps it honest (D111). Since M45 the **estimates themselves are leadership's** — `plan_cash`, which only `accounting: admin` carries (D233) — so accounting reads the whole screen, books real payments against it, and the subtitle says whose the figures are instead of the buttons simply vanishing | M12b |
| ✚ `/accounting/tagihan` | **built (M45)** — accounting's own reminder of what has to be paid this month, and the owner's answer to *is there a monthly bills list?* One month of the cash calendar re-cut: sorted by date, split into **lewat tempo · belum dibayar · sudah dibayar · uang masuk**, with what is still outstanding per line. Last month's figure sits beside this month's and anything more than `ops.bill_anomaly_percent` apart is called unusual (D229) — a line that did not exist last month prints **—**, never 0%. It calls `cashPlan()` rather than recomputing, so it cannot drift from the calendar, and the footer says so and links across (D228) | M45 M50 adds the statutory audit above the bills: each **invoice** with the schemes it pays, what the roll of names says it should come to, what actually left, and the difference in words — which on the seeded data reads *dibayar Rp 1.525.000 untuk 3 orang yang seharusnya Rp 1.225.000*, because somebody came off the roll and the invoice did not notice (D259) |
| ✚ `/accounting/documents` | **built (M9), then parked** (D93, restated in D105). Every file with what it is attached to, filtered by type, month and text. The owner does not need it; it stays as it is and gets no more work. The number that mattered — files attached to nothing — is the exception inbox's job | M9 |
| ✚ `/accounting/bukti` | evidence browser by entity, month, type; and the inbox health number | M9 |
| ✚ `/accounting/catatan` | `Others` documents — a different notepad that does not touch the company ledger (owner, 2026-08-27) | M10 |
| ✖ `/accounting/budget`, `/accounting/payslip` | **both gone.** The cashflow calendar answers what a budget page was for; payslips are HRD's and accounting does not read them (owner, D213) | M41 |

Every other module keeps its honest "not built yet" placeholder. A page that
looks nearly finished generates false bug reports; a page that says it is not
built does not.

## Attaching a document: the main road

ADR-010 changes where evidence enters. It is worth drawing, because it is the
interaction the whole system now turns on and it has to be two taps.

Every PR line drawer and every ledger row drawer carries the same block:

```
┌──────────────────────────────────────────────────────────────┐
│  pr-26-09-10_01-L03   KAYU JATI SORTIMEN A   4,2 m³          │
│  diminta Rp 18.900.000 · disetujui Rp 18.900.000             │
├──────────────────────────────────────────────────────────────┤
│  Dokumen                                    [ + Lampirkan ]  │
│  ┌──────┐ ┌──────┐                                           │
│  │ nota │ │bukti │   nota · 09 Sep · Rp 18.900.000  ✓ cocok  │
│  │      │ │bayar │   bukti bayar · 10 Sep · trx-26-09-10_004 │
│  └──────┘ └──────┘                                           │
│  ⚠ nota Rp 19.100.000 — Rp 200.000 di atas yang disetujui.   │
│    Dicatat, tidak diblokir.                                  │
└──────────────────────────────────────────────────────────────┘
```

What makes it work:

1. **The parent is known, so nothing is asked twice.** Tapping *Lampirkan*
   opens the camera or the file picker, asks only for the document kind
   (nota · bukti bayar · foto barang · lainnya), and links it. Vendor, amount,
   line and PR come from the record.
2. **The check runs after, and only warns.** The extraction compares what it
   reads against what the line says. Agreement gets a quiet ✓; disagreement
   gets an amber line stating both numbers. Never a blocked button (A6).
3. **One document, several parents** is a first-class action, not a repair.
   An attached document's menu has *juga mencakup…* — pick the other lines or
   transactions it covers, and each becomes its own link, each recording who
   declared it.
4. **Every link says who and when.** Tracing was the thing that was hard;
   a link that records the person who declared it is the fix.
5. **Removing a link is not deleting a file.** The file stays, the link goes,
   both are in the audit log.

## The exception inbox

The old review screen, minus everything that existed to support a guess. It
holds only documents whose parent is genuinely unknown — someone bought
something before any PR existed, photographed it into Chat, and the system
has no idea what it belongs to.

Resolutions, one of five:

| Action | Result |
|---|---|
| **Jadikan transaksi** | posts a ledger row, off-PR, visible in `v_unlinked_transactions` |
| **Buat baris PR retroaktif** | the purchase-first case with a name on it: creates the line it should have had, still needing approval |
| **Tautkan** | it belongs to something that already exists — link it and create no money |
| **Catatan** | `Others`. Goes to notes, never the ledger, and branches before anything else is touched |
| **Tolak** | recorded, never discarded (A16) |

Two rules the screen keeps from the old one, because both were paid for:
`Others` branches before the ledger is touched, and duplicate warnings are
advisory and point at *Tautkan* rather than blocking.

And one number on it that is not decoration: **how many documents came in
this way this week.** If the exception road grows, the normal road has a
problem — people are routing around it, and the reason is worth finding.

## The approval screen

Worth drawing, because it is now almost nothing — and that is the point.

```
┌──────────────────────────────────────────────────────────────┐
│  pr-26-09-11_02 · Andi · 11 Sep                              │
├───┬──────────────────────────────────────────┬───────────────┤
│ ☑ │ KAYU JATI SORTIMEN A      4,2 m³         │ Rp 18.900.000 │
│ ☐ │ AMPLAS 120 GRIT           50 lembar      │ Rp    375.000 │
│ ☑ │ LEM PUTIH FOX 5 KG         2 pail        │ Rp    460.000 │
│   │                            ↳ disetujui   │ Rp    230.000 │
└───┴──────────────────────────────────────────┴───────────────┘
   3 baris · 2 dicentang · Rp 19.130.000 akan naik ke ronde
```

- **A checkbox is the whole decision** (D28). Checked is approved; unchecked
  is not yet. There is no hold, no reject, no reason field.
- **An unchecked line simply stays.** It is on the list tomorrow and the day
  after, until it is checked or removed. Nothing expires (D21, D29).
- **The amount may come down, never up.** It starts at what was requested;
  editing it below is how the CEO approves two of the five that were asked
  for (A8). The reduction shows inline, as above.
- **A line nobody wants is removed, not rejected** — from the PR drawer, by
  whoever knows it is no longer needed, and never once money has reached it.
- **Every toggle is recorded**: time, name, email, and which door it came
  through. That is the metadata the owner asked for, and it is why the
  checkbox can be this plain — the audit trail carries the nuance the status
  vocabulary used to.

## The demo layer, from the screen's point of view

A screen never knows it is a demo. It calls a service module and handles an
envelope:

```ts
const res = await procurement.approveLine({
  lineNo: "pr-26-09-10_01-L03",
  step: "GOODS",
  decision: "APPROVED",
  approvedAmount: 4_950_000,
  idempotencyKey: formKey,          // made when the form opened, not on submit
});

if (res.error) return toastRefusal(res.error);   // 403 / 409 / 422, with outcome
toastOk(res.data);
```

That is the same code in Phase 2. The only difference is what
`src/demo/api/procurement.ts` does internally — a reducer over a browser store
today, a `fetch` later.

Three things the demo must do that a naive mock would not:

1. **Refuse.** Approving above requested is a 422. Approving a step that is
   not your role is a 403 whose message names the role that may. A repeated
   submit with the same idempotency key is a 409 `duplicate` that changes
   nothing. If the demo always succeeds, every screen is written optimistic
   and the real API breaks all of them at once.
2. **Derive.** Coverage, the nine-value line status, account balances and the
   two PO axes are computed in `src/demo/derive.ts` on every read. There is no
   stored status field anywhere, because there will not be one later (A3).
3. **Take time.** 150–400 ms of simulated latency, so pending states, disabled
   buttons and the confirm overlay are all exercised for real.

## Saying it is a demo, without shouting

- a small persistent marker in the topbar: `DEMO · data is not real`
- "Reset demo data" in the topbar menu, with a confirm
- the sign-in page states that any of the demo users can be picked and no
  password is checked

That is enough. Watermarking every card would make the workflow harder to
judge, which defeats the purpose of building it.


## Phone

The owner is driving this from a phone this week, and warehouse staff will
report receiving from one. Not an afterthought:

- sidebar is already a drawer under `md`
- tables collapse to stacked cards under `sm`; the first two columns become
  the card title and subtitle
- drawer → full screen, actions pinned bottom, thumb-reachable
- the receiving flow is camera-first: photo, then quantity, then condition
- no hover-only affordance anywhere
