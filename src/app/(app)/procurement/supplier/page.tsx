"use client";

import { useEffect, useRef, useState } from "react";
import { Truck, Plus, Check, Merge, Search, UserRound, Phone, MapPin, Landmark, Boxes, Pencil, Save } from "lucide-react";
import {
  Badge, Button, Card, CardHeader, PageHeader, StatCard,
} from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Drawer, Modal } from "@/components/ui/drawer";
import { Loaded, SourceBadge, useLoad } from "@/components/ui/loaded";
import { formatIDR, formatNumber } from "@/lib/format";
import { cn } from "@/lib/cn";
import { procurement } from "@/demo/api";
import type { VendorView } from "@/services/procurement/contracts";
import { useToast } from "@/store/toast";
import { useSession } from "@/store/session";

/** Vendors.
 *
 *  The rule this screen exists to make visible: **a vendor name a person types
 *  is always accepted, and is born uncurated.** Uncurated does not mean
 *  rejected and does not mean hidden — it means recorded, shown, marked, and
 *  kept out of dropdowns until somebody says it is the real name. Auto-curating
 *  would feed every spelling variant into the catalogue as if it were canonical.
 */
interface VendorDraft {
  pic_name: string;
  pic_phone: string;
  phone: string;
  address: string;
  bank_account: string;
  bank_account_secondary: string;
  npwp: string;
  supplied_categories: string[];
}

const emptyDraft: VendorDraft = {
  pic_name: "", pic_phone: "", phone: "", address: "",
  bank_account: "", bank_account_secondary: "", npwp: "", supplied_categories: [],
};

function Field({
  id, label, value, onChange, placeholder, mono,
}: {
  id: string; label: string; value: string;
  onChange: (v: string) => void; placeholder?: string; mono?: boolean;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-xs text-slate-500">{label}</label>
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn(
          "mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none",
          mono && "font-mono text-[13px]",
        )}
      />
    </div>
  );
}

export default function SuppliersPage() {
  const { can } = useSession();
  const { toast } = useToast();
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<VendorView | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [merging, setMerging] = useState<VendorView | null>(null);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<VendorDraft>(emptyDraft);

  const [state, reload] = useLoad(() => procurement.listVendorViews({ q }), [q]);
  const [cats] = useLoad(() => procurement.listCategories(), []);

  /* The list leaves out `items_bought` and `absorbed`: each costs a subquery
     per row over the purchase history, and no row in the table draws them.
     With 296 vendors that was a statement timeout, so the drawer opens
     immediately on what the list already has and the history arrives a moment
     later — which is also the only place either field is read.

     Keyed by id in a ref rather than by "is it empty": a vendor we have never
     bought from has an empty history legitimately, and testing the field would
     refetch it on every render. */
  const detailFor = useRef<string | null>(null);
  useEffect(() => {
    const id = selected?.id;
    if (!id || detailFor.current === id) return;
    detailFor.current = id;
    let live = true;
    void procurement.getVendor(id).then((res) => {
      if (live && res.data) setSelected((cur) => (cur?.id === id ? res.data : cur));
    });
    return () => { live = false; };
  }, [selected?.id]);
  const mayEdit = can("procurement.update");

  const refresh = () => { reload(); setSelected(null); setEditing(false); };

  /** Opening a vendor always lands in read mode. Details are read far more
   *  often than they are changed, and a form that opens by default invites
   *  edits nobody meant to make. */
  function open(v: VendorView) {
    setSelected(v);
    setEditing(false);
  }

  function startEditing(v: VendorView) {
    setDraft({
      pic_name: v.pic_name ?? "",
      pic_phone: v.pic_phone ?? "",
      phone: v.phone ?? "",
      address: v.address ?? "",
      bank_account: v.bank_account ?? "",
      bank_account_secondary: v.bank_account_secondary ?? "",
      npwp: v.npwp ?? "",
      supplied_categories: [...v.supplied_categories],
    });
    setEditing(true);
  }

  async function saveContact() {
    if (!selected) return;
    setSaving(true);
    /* Empty means "not on record", not an empty string — a blank that reads as
     * a value is how a field stops being answerable. */
    const blankToNull = (s: string) => (s.trim() === "" ? null : s.trim());
    const res = await procurement.updateVendorContact(selected.id, {
      pic_name: blankToNull(draft.pic_name),
      pic_phone: blankToNull(draft.pic_phone),
      phone: blankToNull(draft.phone),
      address: blankToNull(draft.address),
      bank_account: blankToNull(draft.bank_account),
      bank_account_secondary: blankToNull(draft.bank_account_secondary),
      npwp: blankToNull(draft.npwp),
      supplied_categories: draft.supplied_categories,
    });
    setSaving(false);
    if (res.error) { toast("critical", "Not saved", res.error.message); return; }
    toast("success", "Vendor updated", `Contact details for "${res.data.name}" are on record.`);
    setSelected(res.data);
    setEditing(false);
    reload();
  }

  async function addVendor() {
    if (!newName.trim()) return;
    setSaving(true);
    const res = await procurement.createVendor({ name: newName }, `vendor-${newName}`);
    setSaving(false);
    if (res.error) {
      toast(res.error.status === 409 ? "warning" : "critical", "Not added", res.error.message);
      return;
    }
    toast("success", "Vendor added", `"${res.data.name}" is recorded and not yet curated. Open it to add a contact and bank details.`);
    setNewName("");
    setAdding(false);
    reload();
  }

  async function curate(v: VendorView, curated: boolean) {
    const res = await procurement.curateVendor(v.id, curated);
    if (res.error) { toast("warning", "Nothing changed", res.error.message); return; }
    toast("success", curated ? "Curated" : "Moved back to uncurated",
      curated ? `"${v.name}" will now appear in dropdowns.` : `"${v.name}" is still recorded, just not offered.`);
    refresh();
  }

  async function merge(loser: VendorView, winnerId: string) {
    const res = await procurement.mergeVendor(loser.id, winnerId);
    if (res.error) { toast("warning", "Not merged", res.error.message); return; }
    toast("success", "Merged", `"${loser.name}" is kept as an alternative spelling. Its history stays where it is.`);
    setMerging(null);
    refresh();
  }

  const columns: Column<VendorView>[] = [
    {
      key: "name",
      header: "Vendor",
      className: "max-w-[280px]",
      render: (v) => (
        <div>
          <p className="font-medium text-slate-800">{v.name}</p>
          <p className="font-mono text-[11px] text-slate-400">{v.code}</p>
          {v.aka.length > 0 && (
            <p className="mt-0.5 text-[11px] text-slate-400">also written: {v.aka.join(" · ")}</p>
          )}
        </div>
      ),
    },
    {
      key: "curated",
      header: "Catalogue",
      render: (v) =>
        v.is_curated
          ? <Badge tone="green" dot>Curated</Badge>
          : <Badge tone="amber" dot>Not yet curated</Badge>,
    },
    {
      key: "supplies",
      header: "Supplies",
      className: "max-w-[220px] whitespace-normal",
      render: (v) => {
        /* What we have actually bought wins over what the record claims: the
         * first is history, the second is a note somebody typed once. */
        const shown = v.bought_categories.length
          ? v.bought_categories.map((c) => c.name)
          : v.supplied_category_names;
        if (!shown.length) return <span className="text-slate-300">&mdash;</span>;
        return (
          <span className="flex flex-wrap gap-1">
            {shown.slice(0, 3).map((c) => (
              <span key={c} className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">{c}</span>
            ))}
            {shown.length > 3 && <span className="text-[11px] text-slate-400">+{shown.length - 3}</span>}
          </span>
        );
      },
    },
    { key: "trx", header: "Transactions", align: "right", render: (v) => formatNumber(v.transaction_count) },
    { key: "spend", header: "Total spend", align: "right", render: (v) => <span className="tabular-nums">{formatIDR(v.total_spend)}</span> },
    { key: "last", header: "Last purchase", render: (v) => v.last_purchase ?? <span className="text-slate-300">—</span> },
  ];

  return (
    <div>
      <PageHeader
        breadcrumb="Procurement"
        title="Suppliers"
        description="Everyone we buy from, curated or not. A name somebody types is always accepted — it is recorded first and judged later."
        actions={
          mayEdit && <Button icon={Plus} onClick={() => setAdding(true)}>Add vendor</Button>
        }
      />

      <Loaded state={state} onRetry={reload}>
        {(vendors) => {
          const curated = vendors.filter((v) => v.is_curated);
          const uncurated = vendors.filter((v) => !v.is_curated);
          return (
            <>
              <div className="mb-6 grid gap-4 sm:grid-cols-3">
                <StatCard label="Vendors on record" value={vendors.length} icon={Truck} hint={`${curated.length} curated`} />
                <StatCard
                  label="Not yet curated"
                  value={uncurated.length}
                  icon={Search}
                  tone="amber"
                  hint="Recorded and visible — absent from dropdowns"
                />
                <StatCard
                  label="Spend on record"
                  value={formatIDR(vendors.reduce((s, v) => s + v.total_spend, 0))}
                  icon={Truck}
                  tone="green"
                />
              </div>

              <Card>
                <CardHeader
                  title="All vendors"
                  subtitle="Search reaches into what each vendor supplies — type an item like “thinner” and the vendor comes back, not the other way round."
                  icon={Truck}
                  action={
                    <div className="flex items-center gap-2">
                      <SourceBadge state={state} />
                      <input
                        id="vendor-search"
                        value={q}
                        onChange={(e) => setQ(e.target.value)}
                        placeholder="Vendor, contact, or item…"
                        className="h-9 w-44 rounded-lg border border-slate-200 px-3 text-sm text-slate-700 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none"
                      />
                    </div>
                  }
                />
                <DataTable
                  columns={columns}
                  rows={vendors}
                  rowKey={(v) => v.id}
                  onRowClick={open}
                  empty={q ? `Nothing matches “${q}”.` : "No vendors yet."}
                />
              </Card>
            </>
          );
        }}
      </Loaded>

      <Drawer
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.name ?? ""}
        subtitle={editing ? `${selected?.code} · editing` : selected?.code}
        footer={
          selected && mayEdit ? (
            editing ? (
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setEditing(false)} disabled={saving}>
                  Cancel
                </Button>
                <Button size="sm" icon={Save} onClick={saveContact} disabled={saving}>
                  {saving ? "Saving…" : "Save details"}
                </Button>
              </div>
            ) : (
              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="outline" size="sm" icon={Merge} onClick={() => setMerging(selected)}>
                  Merge
                </Button>
                <Button variant="outline" size="sm" icon={Pencil} onClick={() => startEditing(selected)}>
                  Edit details
                </Button>
                <Button
                  size="sm"
                  icon={Check}
                  variant={selected.is_curated ? "outline" : "primary"}
                  onClick={() => curate(selected, !selected.is_curated)}
                >
                  {selected.is_curated ? "Uncurate" : "Curate"}
                </Button>
              </div>
            )
          ) : null
        }
      >
        {selected && editing && (
          <div className="space-y-6 text-sm">
            <p className="rounded-lg bg-slate-50 px-3 py-2.5 text-[13px] text-slate-600">
              Leave anything blank that is genuinely unknown. A blank field reads as
              &ldquo;not on record&rdquo; and the screen will say so; a placeholder
              typed in to fill the gap reads as an answer.
            </p>

            <section className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Contact</p>
              <Field id="v-pic" label="PIC name" value={draft.pic_name}
                     onChange={(v) => setDraft({ ...draft, pic_name: v })}
                     placeholder="e.g. Hendra Wijaya" />
              <Field id="v-picphone" label="PIC phone" value={draft.pic_phone}
                     onChange={(v) => setDraft({ ...draft, pic_phone: v })}
                     placeholder="e.g. 0812-3811-4402" mono />
              <Field id="v-phone" label="Office phone" value={draft.phone}
                     onChange={(v) => setDraft({ ...draft, phone: v })}
                     placeholder="e.g. 0361-812445" mono />
              <div>
                <label htmlFor="v-address" className="block text-xs text-slate-500">Address</label>
                <textarea
                  id="v-address"
                  value={draft.address}
                  onChange={(e) => setDraft({ ...draft, address: e.target.value })}
                  rows={2}
                  placeholder="Street, city"
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none"
                />
              </div>
            </section>

            <section className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Payment details</p>
              <Field id="v-bank" label="Bank account" value={draft.bank_account}
                     onChange={(v) => setDraft({ ...draft, bank_account: v })}
                     placeholder="e.g. BCA 145-0882-771" mono />
              <Field id="v-bank2" label="Second account" value={draft.bank_account_secondary}
                     onChange={(v) => setDraft({ ...draft, bank_account_secondary: v })}
                     placeholder="Only if they really have two" mono />
              <Field id="v-npwp" label="NPWP" value={draft.npwp}
                     onChange={(v) => setDraft({ ...draft, npwp: v })}
                     placeholder="00.000.000.0-000.000" mono />
            </section>

            <section>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                What they supply
              </p>
              <p className="mb-2 text-xs text-slate-500">
                A claim on the record, useful before we have bought anything. Once we
                have, the screen shows what we actually bought instead — that one
                cannot go stale.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {cats.status === "ready" && cats.data
                  .filter((c) => c.code !== "uncurated")
                  .map((c) => {
                    const on = draft.supplied_categories.includes(c.code);
                    return (
                      <button
                        key={c.code}
                        type="button"
                        onClick={() => setDraft({
                          ...draft,
                          supplied_categories: on
                            ? draft.supplied_categories.filter((x) => x !== c.code)
                            : [...draft.supplied_categories, c.code],
                        })}
                        className={cn(
                          "rounded-lg border px-2.5 py-1.5 text-xs transition-colors",
                          on
                            ? "border-brand-300 bg-brand-50 font-medium text-brand-800"
                            : "border-slate-200 text-slate-600 hover:bg-slate-50",
                        )}
                      >
                        {c.name}
                      </button>
                    );
                  })}
              </div>
            </section>
          </div>
        )}

        {selected && !editing && (
          <div className="space-y-6 text-sm">
            {!selected.is_curated && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-800">
                <p className="font-medium">Not yet curated</p>
                <p className="mt-1">
                  Recorded, and it will not be offered in a dropdown or treated as a
                  canonical name until someone curates it. That is deliberate:
                  promoting every new spelling automatically is how a vendor ends up
                  in the books under four different names.
                </p>
              </div>
            )}

            <section>
              <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <UserRound className="h-3.5 w-3.5" /> Who to contact
              </p>
              {selected.pic_name || selected.pic_phone ? (
                <div className="rounded-lg border border-slate-200 px-4 py-3">
                  <p className="font-medium text-slate-800">{selected.pic_name ?? "—"}</p>
                  {selected.pic_phone && (
                    <a href={`tel:${selected.pic_phone.replace(/[^0-9+]/g, "")}`}
                       className="mt-0.5 inline-flex items-center gap-1.5 font-mono text-[13px] text-brand-700 hover:underline">
                      <Phone className="h-3.5 w-3.5" /> {selected.pic_phone}
                    </a>
                  )}
                  {selected.phone && (
                    <p className="mt-1 text-xs text-slate-500">Office: {selected.phone}</p>
                  )}
                </div>
              ) : (
                /* An empty contact on a vendor we keep buying from is a question,
                   not a blank. Say so rather than showing a dash. */
                <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50/60 px-4 py-3 text-slate-500">
                  No contact on record{selected.transaction_count > 0 && ` — and we have bought from them ${selected.transaction_count} time(s)`}.
                </div>
              )}
              {selected.address && (
                <p className="mt-2 flex items-start gap-1.5 text-[13px] text-slate-600">
                  <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" /> {selected.address}
                </p>
              )}
            </section>

            <section>
              <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <Landmark className="h-3.5 w-3.5" /> Payment details
              </p>
              <dl className="space-y-2.5">
                {([
                  ["Bank account", selected.bank_account],
                  ["Second account", selected.bank_account_secondary],
                  ["NPWP", selected.npwp],
                ] as [string, string | null][]).map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-4 border-b border-slate-100 pb-2">
                    <dt className="text-slate-500">{k}</dt>
                    <dd className={cn("text-right font-mono text-[13px]", v ? "text-slate-800" : "text-slate-300")}>
                      {v ?? "—"}
                    </dd>
                  </div>
                ))}
              </dl>
              {selected.bank_account_secondary && (
                <p className="mt-2 text-xs text-slate-500">
                  Two accounts on record. Check the invoice for which one to use —
                  paying into the wrong one is a week of chasing.
                </p>
              )}
            </section>

            <section>
              <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <Boxes className="h-3.5 w-3.5" /> What we buy here
              </p>
              {selected.bought_categories.length > 0 ? (
                <div className="mb-3 flex flex-wrap gap-1.5">
                  {selected.bought_categories.map((c) => (
                    <Badge key={c.code} tone="brand">{c.name} · {c.count}</Badge>
                  ))}
                </div>
              ) : (
                <p className="mb-3 text-slate-500">Nothing bought from them yet.</p>
              )}

              {selected.items_bought.length > 0 && (
                <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                  {selected.items_bought.slice(0, 8).map((i) => (
                    <li key={i.item_id} className="flex items-baseline justify-between gap-3 px-3 py-2">
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] text-slate-700">{i.item_name}</span>
                        <span className="block text-[11px] text-slate-400">{i.last_date}</span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block tabular-nums text-[13px] text-slate-700">
                          {i.last_price != null ? formatIDR(i.last_price) : "—"}
                        </span>
                        {i.uom && <span className="block text-[11px] text-slate-400">per {i.uom}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              {selected.supplied_categories.length > 0 && (
                <p className="mt-2 text-xs text-slate-500">
                  Also listed as supplying{" "}
                  {selected.supplied_category_names.join(", ")} — a note on the record
                  rather than something we have bought.
                </p>
              )}
            </section>

            <section>
              <dl className="space-y-2.5">
                {([
                  ["Transactions", formatNumber(selected.transaction_count)],
                  ["Total spend", formatIDR(selected.total_spend)],
                  ["Last purchase", selected.last_purchase ?? "—"],
                  ["Open PR lines", formatNumber(selected.open_pr_lines)],
                ] as [string, string][]).map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-4 border-b border-slate-100 pb-2">
                    <dt className="text-slate-500">{k}</dt>
                    <dd className="text-right font-medium text-slate-800">{v}</dd>
                  </div>
                ))}
              </dl>
            </section>

            {(selected.aka.length > 0 || selected.absorbed.length > 0) && (
              <section>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Other spellings
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {selected.aka.map((a) => <Badge key={a} tone="slate">{a}</Badge>)}
                </div>
                {selected.absorbed.length > 0 && (
                  <p className="mt-2 text-xs text-slate-500">
                    {selected.absorbed.length} merged record(s) still carry their own
                    history — nothing was rewritten.
                  </p>
                )}
              </section>
            )}
          </div>
        )}
      </Drawer>

      <Modal open={adding} onClose={() => setAdding(false)} title="Add vendor">
        <div className="space-y-3">
          <label htmlFor="new-vendor" className="block text-sm text-slate-600">
            Vendor name
          </label>
          <input
            id="new-vendor"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="e.g. UD SUMBER MAKMUR"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none"
          />
          <p className="text-xs text-slate-500">
            Whatever you type is accepted. It is saved as <strong>not yet curated</strong>,
            which means it is on record and searchable but will not be offered in
            dropdowns until someone confirms it is the real name. Contact and bank
            details are added afterwards, from the vendor&rsquo;s own panel.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setAdding(false)}>Cancel</Button>
            <Button onClick={addVendor} disabled={saving || !newName.trim()}>
              {saving ? "Saving…" : "Add vendor"}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={!!merging} onClose={() => setMerging(null)} title="Merge into another vendor" width="max-w-lg">
        {merging && state.status === "ready" && (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">
              Pick the vendor <strong>{merging.name}</strong> is really the same as. Its
              spelling is kept as an alternative, and its existing transactions stay
              pointed where they are — history does not move because a name was
              corrected later.
            </p>
            <div className="max-h-72 space-y-1 overflow-y-auto">
              {state.data.filter((v) => v.id !== merging.id).map((v) => (
                <button
                  key={v.id}
                  onClick={() => merge(merging, v.id)}
                  className="flex w-full items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2 text-left text-sm transition-colors hover:border-brand-300 hover:bg-brand-50/40"
                >
                  <span className="font-medium text-slate-700">{v.name}</span>
                  {v.is_curated && <Badge tone="green">Curated</Badge>}
                </button>
              ))}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
