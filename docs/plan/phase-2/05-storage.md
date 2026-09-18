# B6 — where the files live

**Decided by the owner, 2026-09-18.** Raw files in Google Drive, metadata in
Supabase. This is not a new direction: `john-lau` has done it since it began —
`public.blobs` carries `drive_file_id`, `drive_link`, `sha256` and
`size_bytes`, and **1.412 of its 1.412 rows have a Drive id**. What follows is
that arrangement, written down and given the boundaries it was missing.

---

## Two shared drives, split by who may see it — not by division

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

## Google checks the reader, not us

**Decided: the application hands out a Drive link and the reader's own
Workspace account is what Drive checks.** Not a service account proxying bytes.

That choice is the one that makes the two drives mean something. Membership of
the People drive is then the real guard on a KTP: a procurement clerk who
somehow reached the link is refused by Google, whatever this application
believes about them. With a service account it would be the other way round —
the account sees everything, the application is the only guard, and a bug in
`can()` is a bug in confidentiality.

### What that costs, and it is not nothing

**Signing in has to be Google.** `src/lib/api/identity.ts` signs in with
`signInWithPassword` today. Under this decision that is wrong, and wrong in a
way that looks fine until somebody clicks a document: they would hold a valid
application session and no Google identity, so every evidence link would either
prompt for a second sign-in or refuse them — while the screen that produced the
link said they were allowed. Two permission systems disagreeing in front of a
user is worse than either being strict.

So **B5 becomes Supabase Auth with Google as the provider**, restricted to the
Workspace domain. That is a simplification as much as a cost: no passwords to
store or reset, and offboarding somebody is one action in Workspace admin
rather than two systems to remember.

It does mean **everyone who files or opens evidence needs a Workspace
account** — including whoever photographs a delivery in the warehouse. That is
a licensing question, and it belongs to the owner.

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
can reach them — **is right about the file and wrong about the row.** Drive
refuses the bytes. Postgres hands over the metadata, and the metadata includes
`filename`. `ktp-budi-santoso.jpg` is frequently the entire disclosure: it
names the document type and the person in one string, and the file it points at
is beside the point.

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
