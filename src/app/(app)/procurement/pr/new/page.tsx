"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, Trash2, Send, Save, ArrowLeft, Info } from "lucide-react";
import { Button, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { NumberInput } from "@/components/ui/number-input";
import { MoneyInput } from "@/components/ui/money-input";
import { useLoad } from "@/components/ui/loaded";
import { formatIDR, formatNumber } from "@/lib/format";
import { FileEvidence } from "@/components/ui/file-evidence";
import { documents, procurement, production } from "@/demo/api";
import {
  PR_CATEGORIES, type UomCode, type PrCategory,
} from "@/services/procurement/contracts";
import { useToast } from "@/store/toast";
import { UomOptions } from "@/components/ui/uom-options";

/** Raise a purchase request.
 *
 *  A full page, not a drawer: this is the one place in the whole application
 *  where somebody types for ten minutes, and a panel that can be dismissed by
 *  a stray click on the backdrop is the wrong container for ten minutes of
 *  work.
 *
 *  Two rules are visible here rather than merely enforced:
 *
 *  - **Uncurated things are not offered.** The item and vendor pickers list
 *    curated entries only. This is the half of the curation rule M3 could
 *    assert but not demonstrate.
 *  - **…and a vendor nobody has recorded is still accepted.** Typing a new
 *    name offers to add it, and it is created uncurated. Refusing it would
 *    make the form lie about what actually happens in a workshop.
 */

interface DraftLine {
  key: string;
  item_id: string;
  description: string;
  qty: number;
  uom: UomCode;
  unit_price: number;
  vendor_id: string;
  category: PrCategory;
  purpose: string;
  need_by: string;
  /** The work order this line is for, when it is for one (D152). */
  source_wo_no: string;
  /* ── What stands behind the number (D125) ──────────────────────────────
   *
   * The meeting board refuses a line with nothing behind it, and until now
   * there was nowhere to put anything here: the requester filled the form,
   * submitted, and found out at the meeting that leadership could not decide.
   * The fix belongs at the moment the price is typed, because that is when the
   * shop page is still open in the next tab.
   *
   * Two roads, because evidence arrives as both: an address somebody else can
   * open (a marketplace listing, a quotation in a portal) and a file (the
   * quotation itself, a nota for something already bought). A file wins if
   * both are given — it is the stronger of the two and saying so beats
   * silently filing one and dropping the other.
   *
   * The kinds offered are only the ones that actually satisfy
   * `v_line_evidence.has_support`. "Invoice" is deliberately NOT among them:
   * it maps to the `invoice` enum, which that view does not count, so offering
   * it would produce a line that looks supported here and is refused there. */
  support_kind: SupportKind;
  support_url: string;
  support_file: { id: string; name: string } | null;
  /** The open order this line is against — a balance payment, a call-off. Picked
   *  from what we hold rather than uploaded: none of our open orders carries an
   *  attachment, so "attach the PO" meant photographing a record already in the
   *  database (`0158`). */
  against_po_no: string;
}

/** The document kinds that `ops_procure.v_line_evidence.has_support` counts —
 *  `quotation`, `nota`, `purchase_order`, `other` — named as a person reads
 *  them. Anything outside this list attaches happily and still leaves the line
 *  refusable, which is the worst of both. */
const SUPPORT_KINDS = [
  "Reference Link",
  "Receipt / Invoice / Nota",
  "Purchase Order",
  "Others",
] as const;
type SupportKind = (typeof SUPPORT_KINDS)[number];

/* The key is per-form state, not module state.
 *
 * A module-level counter looked fine and was not: React may call a `useState`
 * initialiser more than once for a render it then discards, so the first line
 * came out as `l1` and the second as `l7`. Harmless here — the keys were still
 * unique — but a counter whose value depends on how many times React changed
 * its mind is not something to hang identity on, and two module instances
 * would hand out the same keys. A ref is scoped to this form and cannot drift. */
const blankLine = (key: string): DraftLine => ({
  key,
  item_id: "", description: "", qty: 1, uom: "pcs",
  unit_price: 0, vendor_id: "", category: "RAW MATERIAL", purpose: "", need_by: "",
  source_wo_no: "",
  support_kind: "Reference Link", support_url: "", support_file: null,
  against_po_no: "",
});

/** Does this line have something behind it? The same question the meeting
 *  board asks, asked here while it can still be answered cheaply. */
const hasSupport = (l: DraftLine) =>
  Boolean(l.support_file || l.support_url.trim() || l.against_po_no);

export default function NewPurchaseRequestPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [projectId, setProjectId] = useState("");
  const lineSeq = useRef(1);
  const [lines, setLines] = useState<DraftLine[]>(() => [blankLine("l1")]);
  const [saving, setSaving] = useState(false);

  /* Curated only. `is_curated: false` means recorded but not yet judged, and a
   * dropdown is exactly where that judgement matters — offering every spelling
   * variant is how a catalogue stops meaning anything. */
  const [items, reloadItems] = useLoad(() => procurement.listItemViews({ curated: true }), []);
  const [vendors, reloadVendors] = useLoad(() => procurement.listVendors({ curated: true }), []);
  const [projects] = useLoad(() => procurement.listProjects(), []);
  /* Only what a request can honestly be raised against: an order we hold that
     is still open. The seam refuses anything else by name, and offering a
     closed order here would be offering a refusal. */
  const [openPos] = useLoad(async () => {
    const res = await procurement.listPo();
    if (res.error) return res;
    return { ...res, data: res.data.filter((p) => p.status === "DRAFT" || p.status === "ISSUED") };
  }, []);
  /* What is actually on the floor right now. A request line can name one, and
     then it is not "plywood" — it is plywood for the BABY ISLAND tables, which
     is what makes it countable against a projection later (D152). */
  const [wos] = useLoad(() => production.listOpenWorkOrderRefs(), []);

  const itemOptions: ComboboxOption[] = items.status === "ready"
    ? items.data.map((i) => ({
        value: i.id,
        label: i.name,
        sublabel: `${i.suggested_price != null ? formatIDR(i.suggested_price) : "no price on record"} per ${i.base_uom}`,
      }))
    : [];

  const vendorOptions: ComboboxOption[] = vendors.status === "ready"
    ? vendors.data.map((v) => ({ value: v.id, label: v.name, sublabel: v.code }))
    : [];

  function patch(key: string, next: Partial<DraftLine>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...next } : l)));
  }

  /** Choosing an item fills what the catalogue knows — description, unit and a
   *  suggested price. All of it stays editable: it is a hint, not a price
   *  list, and the person in front of the vendor knows more than the record. */
  function chooseItem(key: string, itemId: string) {
    const item = items.status === "ready" ? items.data.find((i) => i.id === itemId) : undefined;
    if (!item) { patch(key, { item_id: itemId }); return; }
    patch(key, {
      item_id: itemId,
      description: item.name,
      uom: item.base_uom,
      unit_price: item.suggested_price ?? 0,
      vendor_id: item.last_vendor_id ?? "",
    });
  }

  async function createVendorInline(key: string, name: string) {
    const res = await procurement.createVendor({ name }, `inline-${name}`);
    if (res.error) { toast("warning", "Not added", res.error.message); return; }
    await reloadVendors();
    patch(key, { vendor_id: res.data.id });
    toast("info", "Vendor added", `"${res.data.name}" is on record as not yet curated. It can be used here straight away.`);
  }

  const total = lines.reduce((s, l) => s + Math.round(l.qty * l.unit_price), 0);
  const usable = lines.filter((l) => l.description.trim() && l.qty > 0);
  const canSave = usable.length > 0 && !saving;
  const bareCount = usable.filter((l) => !hasSupport(l)).length;

  async function save(thenSubmit: boolean) {
    setSaving(true);
    const res = await procurement.createPr({
      project_id: projectId || null,
      lines: usable.map((l) => ({
        item_id: l.item_id || null,
        description: l.description.trim(),
        qty: l.qty,
        uom: l.uom,
        unit_price: l.unit_price,
        vendor_id: l.vendor_id || null,
        category: l.category,
        purpose: l.purpose.trim() || null,
        need_by: l.need_by || null,
        source_wo_no: l.source_wo_no || null,
        /* The seam resolves the order by number and refuses one we do not hold
           or one already closed — by name, before anything is written. */
        against_po_no: l.against_po_no || null,
      })),
    });
    if (res.error) { setSaving(false); toast("critical", "Not saved", res.error.message); return; }

    /* ── File what stands behind each line, before anybody is asked ────────
     *
     * Only now: a line's `line_no_full` is minted by the seam, so nothing can
     * be attached to it until the document exists. The numbers are READ BACK
     * from what was created rather than built from the document number and a
     * counter — `pr-26-09-24_01-L03` is derivable and deriving it is how the
     * bridge once filed 38 documents under names nothing else used.
     *
     * A failure here does not lose the request. The document is saved either
     * way; what the person is told is which lines went in bare, in the same
     * words the meeting board will use when it refuses them. */
    const created = res.data.lines ?? [];
    const bare: string[] = [];
    for (const [i, draft] of usable.entries()) {
      const line = created[i];
      if (!line) continue;
      if (!hasSupport(draft)) { bare.push(line.line_no_full); continue; }
      /* An order is not a document. It went in with the line itself and there
         is nothing to file — filing a copy of a record we already hold is the
         thing this road exists to stop. */
      if (draft.against_po_no) continue;

      let attachmentId = draft.support_file?.id ?? null;
      if (!attachmentId) {
        const filed = await documents.addLink(
          { url: draft.support_url.trim(), title: draft.description.trim() || null },
          `pr-support-${line.line_no_full}`,
        );
        if (filed.error) { bare.push(line.line_no_full); continue; }
        attachmentId = filed.data.id;
      }

      const linked = await documents.link(
        {
          attachment_id: attachmentId,
          entity: "pr_line",
          entity_no: line.line_no_full,
          kind: draft.support_kind,
        },
        `pr-link-${line.line_no_full}`,
      );
      if (linked.error) bare.push(line.line_no_full);
    }

    if (bare.length > 0) {
      toast(
        "warning",
        `${bare.length} line(s) have nothing behind them`,
        `${bare.join(", ")} — attach the link or the invoice on the requests board, `
        + "or leadership will be asked to approve a number with nothing to check it against.",
      );
    }

    if (thenSubmit) {
      const sub = await procurement.submitPr(res.data.doc_no, `submit-${res.data.doc_no}`);
      setSaving(false);
      if (sub.error) {
        toast("warning", "Saved as draft", `${res.data.doc_no} was created but not submitted: ${sub.error.message}`);
      } else {
        toast("success", "Submitted", `${res.data.doc_no} is waiting for approval.`);
      }
    } else {
      setSaving(false);
      toast("success", "Saved as draft", `${res.data.doc_no} is not in anyone's queue until you submit it.`);
    }
    router.push("/procurement/pr");
  }

  return (
    <div>
      <PageHeader
        breadcrumb="Procurement · Purchase Requests"
        title="New request"
        description="One document, as many lines as arrived together. Each line is approved on its own later, so keep unrelated things apart."
        actions={
          <Link href="/procurement/pr">
            <Button variant="ghost" icon={ArrowLeft}>Back</Button>
          </Link>
        }
      />

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          {lines.map((l, idx) => (
            <Card key={l.key}>
              <CardHeader
                title={`Line ${idx + 1}`}
                subtitle={l.description || "Nothing chosen yet"}
                action={
                  lines.length > 1 && (
                    <button
                      onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                      className="inline-flex items-center gap-1 text-xs text-slate-400 transition-colors hover:text-rose-600"
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Remove
                    </button>
                  )
                }
              />
              <div className="space-y-3 px-5 py-4">
                <div>
                  <label className="block text-xs text-slate-500" htmlFor={`item-${l.key}`}>Item</label>
                  <div className="mt-1">
                    <Combobox
                      value={l.item_id}
                      onChange={(v) => chooseItem(l.key, v)}
                      options={itemOptions}
                      placeholder="Search the catalogue…"
                      emptyOptionLabel="— not in the catalogue —"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs text-slate-500" htmlFor={`desc-${l.key}`}>Description</label>
                  <input
                    id={`desc-${l.key}`}
                    value={l.description}
                    onChange={(e) => patch(l.key, { description: e.target.value })}
                    placeholder="What is actually being bought"
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div>
                    <label className="block text-xs text-slate-500" htmlFor={`qty-${l.key}`}>Quantity</label>
                    <NumberInput
                      id={`qty-${l.key}`}
                      value={l.qty}
                      onChange={(v) => patch(l.key, { qty: v })}
                      min={0}
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500" htmlFor={`uom-${l.key}`}>Unit</label>
                    <select
                      id={`uom-${l.key}`}
                      value={l.uom}
                      onChange={(e) => patch(l.key, { uom: e.target.value as UomCode })}
                      className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm focus:border-brand-400 focus:outline-none"
                    >
                      <UomOptions current={l.uom} />
                    </select>
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs text-slate-500" htmlFor={`price-${l.key}`}>Unit price</label>
                    <MoneyInput
                      id={`price-${l.key}`}
                      value={l.unit_price}
                      onChange={(v) => patch(l.key, { unit_price: v })}
                      className="mt-1"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs text-slate-500" htmlFor={`purpose-${l.key}`}>
                    What is it for
                  </label>
                  <input
                    id={`purpose-${l.key}`}
                    value={l.purpose}
                    onChange={(e) => patch(l.key, { purpose: e.target.value })}
                    placeholder="e.g. Table tops, VILLA SEMINYAK — kiln-dried only"
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none"
                  />
                  <p className="mt-1 text-[11px] text-slate-500">
                    The one field that turns a price into a decision. Each item can be
                    for a different job — that is why it lives here and not on the
                    request as a whole.
                  </p>
                </div>

                {/* Which job on the floor. Optional, and worth asking for:
                    a line that names a work order can be counted against that
                    order's BOM projection later, and one that does not cannot
                    (D152). */}
                <div>
                  <label className="block text-xs text-slate-500" htmlFor={`wo-${l.key}`}>
                    For which job in production
                  </label>
                  <select
                    id={`wo-${l.key}`}
                    value={l.source_wo_no}
                    onChange={(e) => {
                      const w = wos.status === "ready"
                        ? wos.data.find((x) => x.wo_no === e.target.value)
                        : null;
                      patch(l.key, {
                        source_wo_no: e.target.value,
                        /* Fill the purpose if it is still blank: "for the BABY
                           ISLAND tables" is what an approver reads. */
                        purpose: l.purpose.trim() || (w
                          ? `${w.item_name} — ${w.wo_no}${w.project_code ? ` · proyek ${w.project_code}` : ""}`
                          : l.purpose),
                      });
                    }}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none"
                  >
                    <option value="">— not tied to a job —</option>
                    {wos.status === "ready" && wos.data.map((w) => (
                      <option key={w.wo_no} value={w.wo_no}>
                        {w.item_name} · {w.wo_no}
                        {w.project_code ? ` · ${w.project_code}` : ""}
                        {` · jatuh tempo ${w.due_date}`}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-[11px] text-slate-500">
                    Only jobs that are open. Naming one is what lets this purchase be
                    counted against that job&rsquo;s BOM projection at the end — leave it
                    empty for stock, office and anything not for a specific order.
                  </p>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs text-slate-500">Vendor</label>
                    <div className="mt-1">
                      <Combobox
                        value={l.vendor_id}
                        onChange={(v) => patch(l.key, { vendor_id: v })}
                        options={vendorOptions}
                        placeholder="Search vendors…"
                        emptyOptionLabel="— not decided yet —"
                        onCreate={(name) => createVendorInline(l.key, name)}
                        createLabel={(qq) => `Add “${qq}” as a new vendor`}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500" htmlFor={`cat-${l.key}`}>Category</label>
                    <select
                      id={`cat-${l.key}`}
                      value={l.category}
                      onChange={(e) => patch(l.key, { category: e.target.value as PrCategory })}
                      className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm focus:border-brand-400 focus:outline-none"
                    >
                      {PR_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                </div>

                <div className="flex items-baseline justify-between border-t border-slate-100 pt-3">
                  <label className="text-xs text-slate-500" htmlFor={`need-${l.key}`}>
                    Needed by
                    <input
                      id={`need-${l.key}`}
                      type="date"
                      value={l.need_by}
                      onChange={(e) => patch(l.key, { need_by: e.target.value })}
                      className="ml-2 rounded-lg border border-slate-200 px-2 py-1 text-sm focus:border-brand-400 focus:outline-none"
                    />
                  </label>
                  <span className="tabular-nums text-sm font-semibold text-slate-800">
                    {formatIDR(Math.round(l.qty * l.unit_price))}
                  </span>
                </div>

                {/* What stands behind the number. Here rather than only on the
                    requests board, because the shop page is open in the next
                    tab right now and will not be at the meeting. */}
                <div className="mt-3 border-t border-slate-100 pt-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="text-[13px] font-medium text-slate-600" htmlFor={`sup-${l.key}`}>
                      What stands behind it
                    </label>
                    <select
                      id={`sup-${l.key}`}
                      value={l.support_kind}
                      onChange={(e) => patch(l.key, { support_kind: e.target.value as SupportKind })}
                      className="rounded-lg border border-slate-200 px-2 py-1 text-sm focus:border-brand-400 focus:outline-none"
                    >
                      {SUPPORT_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
                    </select>
                    {l.support_kind === "Purchase Order" ? (
                      /* An order is a record here, not a document. Picked from
                         what we hold — nothing to upload, and nothing to keep
                         in step with the order if it is amended. */
                      <select
                        value={l.against_po_no}
                        onChange={(e) => patch(l.key, { against_po_no: e.target.value })}
                        className="min-w-[240px] flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-sm focus:border-brand-400 focus:outline-none"
                      >
                        <option value="">— which order is this against? —</option>
                        {openPos.status === "ready" && openPos.data.map((p) => (
                          <option key={p.po_no} value={p.po_no}>
                            {p.po_no} · {p.vendor_name} · {formatIDR(p.status_view.contract_value)}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="url"
                        inputMode="url"
                        placeholder="Paste the shop link or the quotation address"
                        value={l.support_url}
                        disabled={Boolean(l.support_file)}
                        onChange={(e) => patch(l.key, { support_url: e.target.value })}
                        className="min-w-[240px] flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-sm focus:border-brand-400 focus:outline-none disabled:bg-slate-50 disabled:text-slate-400"
                      />
                    )}
                    {l.support_kind !== "Purchase Order" && (
                      <>
                        <span className="text-[12px] text-slate-400">or</span>
                        <FileEvidence
                          kind={l.support_kind}
                          label="Attach the quotation or the nota"
                          value={l.support_file}
                          onChange={(v) => patch(l.key, { support_file: v })}
                        />
                      </>
                    )}
                  </div>
                  {!hasSupport(l) && l.description.trim() !== "" && (
                    <p className="mt-1.5 text-[12px] text-amber-700">
                      Nothing behind this yet — leadership will be asked to approve a number
                      with nothing to check it against, and the meeting board refuses that.
                    </p>
                  )}
                  {l.support_file && l.support_url.trim() !== "" && (
                    <p className="mt-1.5 text-[12px] text-slate-500">
                      The file is what gets filed; the link is ignored while one is attached.
                    </p>
                  )}
                </div>
              </div>
            </Card>
          ))}

          <Button
            variant="outline"
            icon={Plus}
            onClick={() => setLines((ls) => [...ls, blankLine(`l${++lineSeq.current}`)])}
          >
            Add another line
          </Button>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader title="This request" icon={Info} />
            <div className="space-y-3 px-5 py-4">
              <div>
                <label className="block text-xs text-slate-500" htmlFor="pr-project">Project</label>
                <select
                  id="pr-project"
                  value={projectId}
                  onChange={(e) => setProjectId(e.target.value)}
                  className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm focus:border-brand-400 focus:outline-none"
                >
                  <option value="">— no project —</option>
                  {projects.status === "ready" && projects.data.filter((p) => p.is_active).map((p) => (
                    <option key={p.id} value={p.id}>{p.code} {p.name}</option>
                  ))}
                </select>
              </div>
              <p className="text-[11px] text-slate-500">
                A request can hold items for several jobs and several suppliers.
                What each item is for is written on the item.
              </p>
            </div>
          </Card>

          <Card className="sticky top-20">
            <CardHeader title="Total requested" subtitle={`${usable.length} of ${lines.length} line(s) usable`} />
            <div className="px-5 py-4">
              <p className="text-2xl font-bold tabular-nums tracking-tight text-slate-800">
                {formatIDR(total)}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {formatNumber(usable.length)} line(s) will be saved. A line needs a
                description and a quantity above zero.
              </p>

              {/* Said before the press, not after. The meeting board already
                  refuses these; finding that out at the meeting costs a week,
                  and finding it out here costs one paste. */}
              {bareCount > 0 && (
                <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
                  <strong className="font-semibold">{formatNumber(bareCount)}</strong>{" "}
                  of these have nothing behind them. They will be saved, but leadership
                  cannot decide on a number with nothing to check it against — the meeting
                  board refuses them until something is attached.
                </p>
              )}

              <div className="mt-4 flex flex-col gap-2">
                <Button icon={Send} onClick={() => save(true)} disabled={!canSave}>
                  {saving ? "Saving…" : "Submit for approval"}
                </Button>
                <Button variant="outline" icon={Save} onClick={() => save(false)} disabled={!canSave}>
                  Save as draft
                </Button>
              </div>

              <p className="mt-3 text-[11px] text-slate-500">
                A draft is in nobody&rsquo;s queue. Submitting is what puts these lines
                in front of the CEO.
              </p>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
