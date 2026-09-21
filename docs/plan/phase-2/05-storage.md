# B6 — where the files live

**Decided by the owner, 2026-09-18.** Raw files in Google Drive, metadata in
Supabase. This is not a new direction: `john-lau` has done it since it began —
`public.blobs` carries `drive_file_id`, `drive_link`, `sha256` and
`size_bytes`, and **1.412 of its 1.412 rows have a Drive id**. What follows is
that arrangement, written down and given the boundaries it was missing.

---

## Superseded: an `ops` folder in each module's shared drive

> **Owner, 2026-09-21:** *pakai folder ops di tiap module shared drive*
>
> and, earlier the same week: *saya ingin membuat manusia dan sistem bisa
> membuka file berdampingan. jadi kalau ini module HRD maka harus di simpan di
> HRD shared drive. mungkin daripada langsung ke shared drive nya buat saja
> folder seperti "ops" di tiap module.*

**This is the arrangement. The two-drive proposal below is kept for its
reasoning and is not what was built** — `0035_core_drive_folders.sql` is.

Seven shared drives already exist and people already work in them: HRD,
PROCUREMENT, PRODUCTION, DRAFTING, ACCOUNTING, PROJECT MANAGER, BACKUP. A
system that files somewhere else creates a second place to look, and the
owner's reason is the one that decides it: a person and the system should open
the same file side by side. The `ops` subfolder keeps them apart *inside* one
drive — everything the application writes lands there, nothing filed by hand
does.

### What the two-drive split was protecting, and where that went

Its one real virtue was making *personal data against business evidence* a rule
in code rather than a habit. Seven drives is seven membership lists, and more
people can see more folders. So the rule moved rather than being dropped:
**the drive is chosen from the kind of document, by the database, at the moment
of upload** (`ops_core.doc_kind_drive`). A KTP resolves to HRD and no argument
to any function can send it elsewhere. That is the sensitivity-at-upload
decision, and it is why `documents.upload` now carries the `kind` — it used to
take a filename and a size, which is not enough to know where a file belongs.

`16_core_drive_folders.sql` asserts every one of the eleven personal kinds
resolves to HRD, and that no kind falls through to nowhere.

### What is still open

**An unclassified file from chat lands in PROCUREMENT.** `uploadToInbox` is the
exception road — a document arrives before the record it belongs to exists, so
there is no kind yet and it is filed as `other`, which maps to procurement. The
inbox is for money evidence and that is what it receives, but somebody
photographing a KTP into that chat would put it in the wrong drive. Changing
one row in `doc_kind_drive` moves it; naming the risk here rather than assuming
it away.

### The eight module folders, and the `ops` inside each

The owner gave the module folder ids on 2026-09-21 — eight, with **IT** added
to the seven. They are recorded in `ops_core.drive_folders.parent_folder_id`.

They are the *module* folders, not `ops` folders: every id begins with `1`, so
each is an ordinary folder rather than a shared drive root (those begin with
`0A`), and the note beside ACCOUNTING — *disini sudah ada folder TRANSACTIONS* —
says what they contain. Recording one as the upload target would drop every
file the system writes in beside the ones people filed by hand.

So the two are kept apart, and **the second fills itself in**: the upload route
finds or creates `ops` inside the module folder the first time it files
something there, and writes the id back through
`ops_core.record_ops_folder`. That function fills a blank only — a caller who
could change a folder already set could redirect every future upload for that
drive, HRD's included, just by being the next person to upload anything.
Changing one afterwards stays `it.admin`.

Asking for eight more ids would have worked, and would have been eight more
chances to paste the wrong one into a column that silently redirects
everything. A name is checkable; an id is not.

`ops_core.v_drive_readiness` shows both stages: `has_parent` (a person did
this) and `has_folder` (the route did).

**The ids are unverified.** The Drive connector available while this was built
could not see them — *Requested entity was not found* — which means either that
its identity is not a member of those drives or that an id is wrong. The first
upload to each drive will say which, in Google's own words.

The Worker also needs the service account, as **runtime secrets** — not build
variables, because these must never reach a browser:

| secret | value |
|---|---|
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | `capture-worker@john-lau-v01.iam.gserviceaccount.com` |
| `GOOGLE_PRIVATE_KEY` | the PEM from that account's key file |

The scope requested is `drive.file` — the service account may touch files **it
created** and nothing else, so a mistake cannot reach the 1.412 documents
already in those drives.

---

## The earlier proposal, kept for its reasoning

**Not built.** Superseded by the section above.

The owner asked whether to make one shared drive for ops or one per division.
Neither. **Two, split by sensitivity.**

Division boundaries are not access boundaries. Accounting reads procurement's
notas; a purchase order is issued by procurement and paid by accounting; a
receiving photo belongs to a PR line and to a ledger row at once. A drive per
division means granting across them constantly, and that always ends as *add
everybody to everything* — which is one drive again, with the administration of
five.

The boundary that actually matters is **personal data against business
evidence**, and `ops_core.doc_kind_t` already draws it:

| shared drive | kinds | members |
|---|---|---|
| **Evidence** | `nota` `transfer_proof` `goods_photo` `delivery_note` `purchase_order` `quotation` `invoice` `surat_jalan` `rekening_koran` `gambar_kerja` `gambar_jadi` `foto` `sertifikat` `other` | anyone holding an ops module |
| **People** | `ktp` `kartu_keluarga` `ijazah` `cv` `kontrak_kerja` `npwp` `bpjs` `surat_dokter` `surat_lembur` `laporan_lembur` `surat_peringatan` | HRD, CEO, IT |

What makes this worth the second drive is that the split becomes **a rule in
code rather than a habit**: the seam already knows the `kind`, so it can refuse
to put a KTP in the Evidence drive. Nobody has to remember to pick the right
folder, which is the thing people stop doing in month three.

Google caps a shared drive at 400.000 items. At 1.412 files across the legacy
system's whole life that is not a near-term constraint, and it is not what
decides this.

---

## Who checks the reader

**Decided: the application hands out a Drive link.** Uploaded files are
view-only by default, and the owner's ruling (2026-09-18) is that the
organisation's data policy covers who may open them. **Sign-in is not changed
by this decision** — B5 stays whatever B5 decides, and nothing in B6 forces it.

An earlier draft of this file argued the opposite: that handing out Drive links
made Workspace sign-in mandatory, because a user holding an application session
and no Google identity would be refused by Drive while the screen that produced
the link said they were allowed. The owner has ruled that out, and it is
recorded here rather than quietly deleted so that the next person does not
re-derive it and change the design again.

One distinction is worth keeping straight, because the two are easy to hear as
one thing. **View-only governs who may *change* a file; it does not decide who
may *open* it.** Which of those applies depends on how the files are shared:

- Shared **to named people or a shared drive's members**, Google checks the
  reader's Workspace account, and membership is the guard.
- Shared **as anyone-with-the-link**, the link *is* the credential, and it
  carries to anybody it is forwarded to.

Both are workable and they are not the same. The second needs no Workspace
account for warehouse staff, which is the cheaper answer; it also means a
People-drive link is protected by not being forwarded. Which one is in force is
a fact about the Workspace configuration rather than about this repository, and
this file does not assert it.

---

## What the database stores

`ops_core.attachments` needs no change, and the reason is worth stating because
the obvious reading is that it does.

The table carries `storage_path` and `url` under a constraint that exactly one
is set. A Drive file has both an id and a link, so it looks like it needs both
columns and a relaxed constraint. It does not:

- **`storage_path` holds the Drive file id.** That is the file's identity.
- **The link is derived** — `https://drive.google.com/file/d/{id}/view` — and
  therefore never stored (A3). A stored link is one more thing that can
  disagree with the id beside it.
- **`url` keeps its meaning**: a link *filed as evidence* (D125) — a
  marketplace page, a quotation in a portal. Somebody else's address, not our
  file. The constraint that separates the two is exactly the distinction that
  matters, and it survives intact.

`attach_file` therefore takes a Drive file id where it says path, and
`ops_core.settings.upload.max_bytes` still governs size.

---

## The metadata leak that is left

`0005` declares `attachments_read` as `using (true)`: every authenticated
account may read every attachment row.

The owner's reading — that KTP and ijazah are safe because only HRD, CEO and IT
can reach them — is about the **file**, and the file is Drive's to protect.
Postgres still hands over the **row**, and the row includes `filename`.
`ktp-budi-santoso.jpg` is frequently the entire disclosure: it names the
document type and the person in one string, and the file it points at is beside
the point.

So the leak is much smaller than a bucket left public, and it is not nothing.

**The fix is not mechanical**, which is why it is written here rather than
applied. The kind lives on `attachment_links`, not on the attachment, so a row
is only classifiable once it is linked — and an upload is a row before it is a
link. Restricting reads by kind therefore leaves a window where a freshly
uploaded KTP is visible to everyone, which is the exact case the restriction
exists for.

The shape that closes it is to decide sensitivity **at upload**, since
`attach_file` must already choose a shared drive and therefore already knows.
That is a column on `attachments` and a seam argument — a small change, and a
real one, so it belongs in a change of its own rather than inside this note.
