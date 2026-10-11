"use client";

import { useState } from "react";
import { FileText, Plus, Send } from "lucide-react";
import { Badge, Button, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Loaded, SourceBadge, useLoad } from "@/components/ui/loaded";
import { formatIDR, formatMoney } from "@/lib/format";
import { cn } from "@/lib/cn";
import { useTr } from "@/lib/i18n";
import { procurement } from "@/demo/api";
import type { PoView } from "@/demo/api/procurement";
import { useSession } from "@/store/session";
import { NewPo } from "../tracker/NewPo";

/** Every order, as an obligation rather than a document.
 *
 *  The tracker reads by supplier — *what do we owe HADI GLASS*. This reads by
 *  order, which is the other half of the same question and the one somebody
 *  asks with a vendor on the phone: *what did we agree on po-26-08-14_01, has
 *  it arrived, and what have we paid against it.*
 *
 *  Money and goods stay apart (A1). An order can be fully paid and empty, or
 *  full and unpaid, and one progress bar would say neither — so there are two
 *  badges, never a single percentage.
 */
export default function PoPage() {
  const tr = useTr();
  const { can } = useSession();
  const [rows, reload] = useLoad(() => procurement.listPo(), []);
  const [creating, setCreating] = useState(false);
  const mayCreate = can("procurement.create");

  const columns: Column<PoView>[] = [
    {
      key: "po",
      header: tr("Order", "Order"),
      className: "whitespace-normal",
      render: (p) => (
        <div className="max-w-[260px]">
          <p className="font-mono text-[13px] font-medium text-slate-800">{p.po_no}</p>
          <p className="whitespace-normal break-words text-[12px] text-slate-500">{p.vendor_name}</p>
          {p.project_code && (
            <p className="text-[11px] text-violet-700">{tr("factory order", "order pabrik")} · {p.project_code} · {p.project_name}</p>
          )}
          {p.note && <p className="whitespace-normal break-words text-[11px] text-slate-400">{p.note}</p>}
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (p) => (
        <div className="whitespace-nowrap">
          <Badge tone={p.status === "ISSUED" ? "brand" : p.status === "DRAFT" ? "slate" : "green"}>
            {p.status}
          </Badge>
          {p.status === "DRAFT" && (
            <p className="mt-0.5 text-[11px] text-slate-500">
              {p.approved_at ? tr("confirmed — ready to send", "dikonfirmasi — siap dikirim")
                : p.approval_asked_at ? tr("waiting on leadership", "menunggu pimpinan")
                  : tr("not asked yet", "belum ditanyakan")}
            </p>
          )}
          {p.days_late != null && (
            <p className="mt-0.5 text-[11px] text-rose-700">{tr(`${p.days_late} day(s) late`, `terlambat ${p.days_late} hari`)}</p>
          )}
        </div>
      ),
    },
    {
      key: "contract",
      header: tr("Contract", "Kontrak"),
      align: "right",
      render: (p) => (
        <span className="whitespace-nowrap tabular-nums text-slate-800">
          {(p.currency ?? "IDR") === "IDR"
            ? formatIDR(p.lines.reduce((s, l) => s + l.line_total, 0))
            : formatMoney(p.contract_value_own, p.currency)}
          {p.needs_rate && <span className="block text-[11px] text-amber-700">{tr("kurs not typed", "kurs belum diisi")}</span>}
        </span>
      ),
    },
    {
      key: "money",
      header: tr("Money", "Uang"),
      render: (p) => (
        <Badge tone={p.status_view.payment_state === "SETTLED" ? "green"
          : p.status_view.payment_state === "PARTIAL" ? "amber" : "slate"}>
          {p.status_view.payment_state === "SETTLED" ? tr("paid", "lunas")
            : p.status_view.payment_state === "PARTIAL"
              ? tr(`${formatIDR(p.status_view.paid_to_date)} paid`, `${formatIDR(p.status_view.paid_to_date)} dibayar`)
              : tr("nothing paid", "belum dibayar")}
        </Badge>
      ),
    },
    {
      key: "goods",
      header: tr("Goods", "Barang"),
      render: (p) => (
        <Badge tone={p.status_view.delivery_state === "COMPLETE" ? "green"
          : p.status_view.delivery_state === "PARTIAL" ? "amber" : "slate"}>
          {p.status_view.delivery_state === "COMPLETE" ? tr("all arrived", "semua tiba")
            : p.status_view.delivery_state === "PARTIAL" ? tr("part arrived", "sebagian tiba") : tr("nothing arrived", "belum ada yang tiba")}
        </Badge>
      ),
    },
    {
      key: "exposure",
      header: tr("Exposure", "Eksposur"),
      align: "right",
      /* Paid minus received. Positive is money out ahead of goods — our risk;
         negative is goods here we have not paid for — theirs. One number that
         two bars cannot say. */
      render: (p) => {
        const e = p.status_view.exposure;
        return (
          <div className="whitespace-nowrap text-right">
            <span className={cn("tabular-nums font-medium", e > 0 ? "text-amber-700" : e < 0 ? "text-slate-700" : "text-slate-400")}>
              {e === 0 ? tr("level", "seimbang") : formatIDR(Math.abs(e))}
            </span>
            {e !== 0 && (
              <p className="text-[11px] text-slate-500">{e > 0 ? tr("paid ahead", "dibayar lebih dulu") : tr("delivered ahead", "dikirim lebih dulu")}</p>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <div>
      <PageHeader
        breadcrumb={tr("Procurement", "Pengadaan")}
        title={tr("Purchase orders", "Purchase order")}
        description={tr(
          "What we agreed with each supplier, what has arrived against it, and what has been paid. Money and goods are read separately, never merged.",
          "Apa yang kita sepakati dengan tiap pemasok, apa yang sudah tiba, dan apa yang sudah dibayar. Uang dan barang dibaca terpisah, tidak pernah digabung.",
        )}
        actions={mayCreate ? <Button icon={Plus} onClick={() => setCreating(true)}>{tr("Add new PO", "Tambah PO baru")}</Button> : undefined}
      />

      <Loaded state={rows} onRetry={reload}>
        {(all) => {
          const drafts = all.filter((p) => p.status === "DRAFT");
          const live = all.filter((p) => p.status === "ISSUED");
          const done = all.filter((p) => p.status === "CLOSED" || p.status === "CANCELLED");
          const open = (p: PoView) => { window.location.href = `/procurement/po/${p.po_no}`; };

          return (
            <>
              {drafts.length > 0 && (
                /* A draft owes nothing however large it is (D99). Kept apart so
                   nobody reads it as an obligation. */
                <Card className="mb-4">
                  <CardHeader
                    title={tr(`${drafts.length} draft — not sent, so nothing is owed`, `${drafts.length} draf — belum dikirim, jadi belum ada utang`)}
                    subtitle={tr(
                      "Issue it and the deposit becomes payable and it starts counting against what we owe suppliers.",
                      "Terbitkan, maka uang muka menjadi wajib dibayar dan mulai dihitung dalam utang kita ke pemasok.",
                    )}
                    icon={Send}
                  />
                  <DataTable
                    dense columns={columns} rows={drafts} rowKey={(p) => p.po_no}
                    onRowClick={open} empty={tr("No drafts.", "Tidak ada draf.")}
                  />
                </Card>
              )}

              <Card className="mb-4">
                <CardHeader
                  title={tr(`${live.length} order(s) open`, `${live.length} order terbuka`)}
                  subtitle={tr(
                    "Issued and not closed. Open one to see its terms, its deliveries and what may be paid next.",
                    "Sudah terbit dan belum ditutup. Buka salah satu untuk melihat syarat, pengiriman, dan apa yang boleh dibayar berikutnya.",
                  )}
                  icon={FileText}
                  action={<SourceBadge state={rows} />}
                />
                <DataTable
                  dense columns={columns} rows={live} rowKey={(p) => p.po_no}
                  onRowClick={open} empty={tr("No orders are open.", "Tidak ada order yang terbuka.")}
                />
              </Card>

              {done.length > 0 && (
                <Card>
                  <CardHeader
                    title={tr(`${done.length} finished`, `${done.length} selesai`)}
                    subtitle={tr(
                      "Closed or cancelled — kept, because last month's questions arrive next month.",
                      "Ditutup atau dibatalkan — tetap disimpan, karena pertanyaan bulan lalu datang bulan depan.",
                    )}
                    icon={FileText}
                  />
                  <DataTable
                    dense columns={columns} rows={done} rowKey={(p) => p.po_no}
                    onRowClick={open} empty={tr("Nothing finished yet.", "Belum ada yang selesai.")}
                  />
                </Card>
              )}
            </>
          );
        }}
      </Loaded>

      {creating && (
        <NewPo onClose={() => setCreating(false)} onCreated={() => { setCreating(false); reload(); }} />
      )}
    </div>
  );
}
