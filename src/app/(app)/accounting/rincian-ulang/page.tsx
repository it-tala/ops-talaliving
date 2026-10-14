"use client";

import { useEffect, useState } from "react";
import { ListTree, Check, Save, ChevronLeft, ChevronRight, Paperclip } from "lucide-react";
import { Badge, Button, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import { Loaded, SourceBadge, useDebounced, useLoad } from "@/components/ui/loaded";
import { DocumentPreview } from "@/components/ui/doc-preview";
import { driveOpenUrl } from "@/lib/drive-links";
import { formatIDR } from "@/lib/format";
import { cn } from "@/lib/cn";
import { accounting, documents } from "@/demo/api";
import type { RedetailQueueRow, TransactionDetail } from "@/services/accounting/contracts";
import type { AttachmentView } from "@/services/documents/contracts";
import { toSeamLines, draftsTotal, type LineDraft } from "@/services/accounting/lines";
import { LinesEditor, draftsFrom } from "@/components/accounting/lines-editor";
import { useSession } from "@/store/session";
import { useToast } from "@/store/toast";
import { useTr } from "@/lib/i18n";

/** Re-detailing: every lumped row of 2026, newest first, looked at once
 *  (L12, D434, D435 point 6).
 *
 *  The queue on the left is `v_redetail_queue` — money out with a document
 *  that still reads as one lump: one line, an amount ending in a transfer
 *  fee, or a purchase booked without its items. The right side is the
 *  document and the lines. Two ways out of the queue, both through
 *  `set_transaction_lines`: *Simpan* rewrites the detail, *Sudah benar*
 *  stamps the row as it is. Nothing here moves money, dates, accounts or
 *  vendors — that is the ledger's Edit.
 */
const PAGE_SIZE = 25;

export default function RedetailPage() {
  const tr = useTr();
  const { hasAuthority } = useSession();
  const mayPost = hasAuthority("post_ledger");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const searched = useDebounced(q);
  const [rows, reload] = useLoad(
    () => accounting.listRedetailQueue({ q: searched || undefined, limit: PAGE_SIZE, offset: page * PAGE_SIZE }),
    [searched, page],
    { keepPrevious: true },
  );

  /* After a row is stamped it leaves the queue; the next one is selected so
     the work keeps a rhythm — one row, one decision, next. */
  function done(trxNo: string) {
    const list = rows.status === "ready" ? rows.data : [];
    const i = list.findIndex((r) => r.trx_no === trxNo);
    const next = list[i + 1] ?? list[i - 1] ?? null;
    setSelected(next?.trx_no ?? null);
    reload();
  }

  return (
    <div>
      <PageHeader
        breadcrumb={tr("Accounting", "Akuntansi")}
        title={tr("Re-detailing", "Rincian ulang")}
        description={tr("Every 2026 row booked as one lump, newest first: split it into what it really was — the thing, the admin fee, the tax, the courier — or confirm it as it is. The amount never changes here.",
          "Setiap baris 2026 yang tercatat sebagai satu gumpalan, dari yang terbaru: pecah menjadi apa adanya — barangnya, biaya admin, pajak, ongkir — atau tandai sudah benar. Jumlahnya tidak berubah di sini.")}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <Loaded state={rows} onRetry={reload}>
          {(list) => {
            const total = rows.status === "ready" ? rows.page?.total ?? list.length : list.length;
            const lastPage = Math.max(Math.ceil(total / PAGE_SIZE) - 1, 0);
            return (
              <Card>
                <CardHeader
                  title={tr(`${total} row(s) to look at`, `${total} baris untuk ditinjau`)}
                  subtitle={tr(`Page ${page + 1} of ${lastPage + 1} · newest first`, `Halaman ${page + 1} dari ${lastPage + 1} · terbaru dulu`)}
                  icon={ListTree}
                  action={<SourceBadge state={rows} />}
                />
                <div className="px-4 pb-2">
                  <input
                    id="rd-q" value={q}
                    onChange={(e) => { setPage(0); setQ(e.target.value); }}
                    placeholder={tr("Description or number…", "Deskripsi atau nomor…")}
                    className="h-9 w-full rounded-lg border border-slate-200 px-3 text-sm placeholder:text-slate-400 focus:border-brand-400 focus:outline-none"
                  />
                </div>
                {list.length === 0 ? (
                  <EmptyState icon={Check} title={tr("Nothing left to look at", "Tidak ada lagi yang perlu ditinjau")}
                    description={tr("Every documented 2026 row has been split or confirmed.", "Semua baris 2026 yang berdokumen sudah dipecah atau ditandai benar.")} />
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {list.map((r) => (
                      <li key={r.id}>
                        <button type="button" onClick={() => setSelected(r.trx_no)}
                          className={cn("w-full px-4 py-2.5 text-left hover:bg-slate-50", selected === r.trx_no && "bg-brand-50/60")}>
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate text-[13px] font-medium text-slate-800">{r.description}</p>
                              <p className="text-[11px] text-slate-400">
                                {r.trx_date} · <span className="font-mono">{r.trx_no}</span> · {r.account_code} · {r.type_code}
                                {r.vendor_name && ` · ${r.vendor_name}`}
                              </p>
                              <p className="mt-0.5 flex flex-wrap gap-1">
                                {r.single_line && <Badge tone="slate">{tr(r.line_count === 0 ? "no lines" : "one line", r.line_count === 0 ? "tanpa baris" : "satu baris")}</Badge>}
                                {r.fee_tail && <Badge tone="amber">{tr("fee folded in", "biaya admin terlipat")}</Badge>}
                                {r.is_purchase && !r.single_line && <Badge tone="slate">{tr("purchase", "pembelian")}</Badge>}
                                {r.is_ecommerce && <Badge tone="brand">e-commerce</Badge>}
                              </p>
                            </div>
                            <div className="shrink-0 text-right">
                              <p className="tabular-nums text-[13px] font-medium text-slate-800">{formatIDR(r.amount_idr)}</p>
                              <p className="inline-flex items-center gap-1 text-[11px] text-slate-400"><Paperclip className="h-3 w-3" /> {r.evidence_count}</p>
                            </div>
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-4 py-2.5">
                  <p className="text-[12px] text-slate-500">{tr(`Showing ${list.length} of ${total}`, `Menampilkan ${list.length} dari ${total}`)}</p>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" icon={ChevronLeft} disabled={page === 0} onClick={() => setPage((n) => Math.max(n - 1, 0))}>{tr("Previous", "Sebelumnya")}</Button>
                    <Button variant="outline" size="sm" disabled={page >= lastPage} onClick={() => setPage((n) => Math.min(n + 1, lastPage))}>{tr("Next", "Berikutnya")} <ChevronRight className="ml-1 h-3.5 w-3.5" /></Button>
                  </div>
                </div>
              </Card>
            );
          }}
        </Loaded>

        {selected
          ? <RedetailPanel key={selected} trxNo={selected}
              row={rows.status === "ready" ? rows.data.find((r) => r.trx_no === selected) ?? null : null}
              mayPost={mayPost} onDone={() => done(selected)} />
          : (
            <Card>
              <EmptyState icon={ListTree} title={tr("Pick a row", "Pilih satu baris")}
                description={tr("Its document and its lines open here. Split, or confirm.", "Dokumen dan barisnya terbuka di sini. Pecah, atau tandai benar.")} />
            </Card>
          )}
      </div>
    </div>
  );
}

function RedetailPanel({ trxNo, row, mayPost, onDone }: {
  trxNo: string; row: RedetailQueueRow | null; mayPost: boolean; onDone: () => void;
}) {
  const tr = useTr();
  const { toast } = useToast();
  const [detail] = useLoad(() => accounting.getTransaction(trxNo), [trxNo]);
  const [files] = useLoad(() => documents.byEntity("transaction", trxNo), [trxNo]);
  const [types] = useLoad(() => accounting.listTypeRows(), []);
  const [lines, setLines] = useState<LineDraft[] | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (detail.status === "ready" && lines === null) {
      setLines(draftsFrom(detail.data.lines, detail.data.amount_idr, detail.data.description));
    }
  }, [detail, lines]);

  const d: TransactionDetail | null = detail.status === "ready" ? detail.data : null;
  const createsItems = d && types.status === "ready"
    ? types.data.find((t) => t.code === d.type_code)?.creates_catalog_item ?? false : false;
  const agree = d !== null && lines !== null && draftsTotal(lines) === d.amount_idr;

  async function save() {
    if (!d || !lines) return;
    setBusy(true);
    const res = await accounting.setTransactionLines(
      { trx_no: d.trx_no, lines: toSeamLines(lines, d.description), reason: reason.trim() || null },
      `set-lines-${d.trx_no}-${Date.now()}`,
    );
    setBusy(false);
    if (res.error) { toast(res.error.status === 403 ? "critical" : "warning", tr("Not saved", "Tidak tersimpan"), res.error.message); return; }
    toast("success", tr(`${d.trx_no} re-detailed`, `${d.trx_no} dirinci ulang`), tr(`${lines.length} line(s). The old detail is in the audit log.`, `${lines.length} baris. Rincian lama ada di log audit.`));
    onDone();
  }
  async function confirm() {
    if (!d) return;
    setBusy(true);
    const res = await accounting.setTransactionLines({ trx_no: d.trx_no, lines: null, reason: reason.trim() || null }, `confirm-lines-${d.trx_no}-${Date.now()}`);
    setBusy(false);
    if (res.error) { toast(res.error.status === 403 ? "critical" : "warning", tr("Not confirmed", "Tidak ditandai"), res.error.message); return; }
    toast("success", tr(`${d.trx_no} confirmed`, `${d.trx_no} ditandai benar`));
    onDone();
  }

  return (
    <Card>
      <Loaded state={detail}>
        {(t) => (
          <div className="space-y-4 px-5 py-4 text-sm">
            <div>
              <p className="font-medium text-slate-800">{t.description}</p>
              <p className="text-[12px] text-slate-500">
                <span className="font-mono">{t.trx_no}</span> · {t.trx_date} · {t.account_code} · {t.type_code}{t.vendor_name && ` · ${t.vendor_name}`}
                · <strong className="text-slate-800">{formatIDR(t.amount_idr)}</strong>
              </p>
            </div>

            {/* The paper beside the figures (B3): every file of the row. */}
            <Loaded state={files}>
              {(fs: AttachmentView[]) => fs.length === 0
                ? <p className="text-[12px] text-slate-500">{tr("No document on this row.", "Tidak ada dokumen di baris ini.")}</p>
                : (
                  <div className={cn("grid gap-3", fs.length > 1 && "sm:grid-cols-2")}>
                    {fs.map((f) => (
                      <DocumentPreview key={f.id} height={fs.length > 1 ? 220 : 300}
                        doc={{ id: f.id, filename: f.filename, mime: f.mime, bytes: f.bytes,
                          url: f.url, drive_link: f.url ? null : driveOpenUrl(f), uploaded_at: f.uploaded_at,
                          kind: f.links.find((l) => l.entity_no === t.trx_no)?.kind ?? f.links[0]?.kind ?? null }} />
                    ))}
                  </div>
                )}
            </Loaded>

            {lines && (
              <LinesEditor lines={lines} onChange={setLines} amount={t.amount_idr} idPrefix="rd"
                allowCreate={createsItems} ecommerce={row?.is_ecommerce ?? false} />
            )}

            <div>
              <label htmlFor="rd-reason" className="block text-xs text-slate-500">{tr("Remark (optional)", "Keterangan (opsional)")}</label>
              <input id="rd-reason" value={reason} onChange={(e) => setReason(e.target.value)}
                placeholder={tr("e.g. the nota shows the fee separately", "mis. nota memisahkan biaya adminnya")}
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-3 text-sm focus:border-brand-400 focus:outline-none" />
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2">
              {t.lines_reviewed_at && (
                <span className="mr-auto text-[12px] text-slate-500">
                  {tr(`Reviewed ${t.lines_reviewed_at.slice(0, 10)}`, `Ditinjau ${t.lines_reviewed_at.slice(0, 10)}`)}{t.lines_reviewed_by_name && ` · ${t.lines_reviewed_by_name}`}
                </span>
              )}
              <Button variant="outline" size="sm" icon={Check} disabled={!mayPost || busy} onClick={confirm}>
                {tr("Correct as it is", "Sudah benar")}
              </Button>
              <Button size="sm" icon={Save} disabled={!mayPost || busy || !agree} onClick={save}>
                {busy ? tr("Saving…", "Menyimpan…") : tr("Save the lines", "Simpan rincian")}
              </Button>
            </div>
            {!mayPost && (
              <p className="text-[11px] text-slate-500">{tr("Rewriting a row's detail needs post_ledger.", "Merinci ulang baris butuh post_ledger.")}</p>
            )}
          </div>
        )}
      </Loaded>
    </Card>
  );
}
