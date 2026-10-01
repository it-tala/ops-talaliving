"use client";

import { useState } from "react";
import Link from "next/link";
import { MessageSquare, Sparkles, CheckCircle2, XCircle, FolderInput } from "lucide-react";
import { Badge, Button, Card, CardHeader } from "@/components/ui/primitives";
import { Loaded, SourceBadge, useLoad } from "@/components/ui/loaded";
import { Paged } from "@/components/ui/pager";
import { ImageTiles } from "@/components/ui/image-tiles";
import { formatNumber } from "@/lib/format";
import { procurement } from "@/demo/api";
import type { ReceivingInboxRow, ReceivingInboxStatus } from "@/services/procurement/contracts";
import { useToast } from "@/store/toast";
import { useTr } from "@/lib/i18n";
import { MatchDrawer, archiveAfterMatch } from "./MatchDrawer";

/** The RECEIVING REPORT space in Google Chat (0203, D358).
 *
 *  Somebody at the gate photographs what came and posts it to the space; the
 *  bridge files every photo here within five minutes, with what the AI read
 *  off it. Procurement says what it was: a purchase already paid (the photo
 *  becomes the ledger row's item photo, the goods go onto the rack or into
 *  the asset register), or a delivery against an order (qty and the tanda
 *  terima, which makes it count). Or not an arrival at all, with a reason.
 */
export function ChatInbox({ mayAct, onMatched }: { mayAct: boolean; onMatched: () => void }) {
  const tr = useTr();
  const [status, setStatus] = useState<ReceivingInboxStatus>("PENDING");
  const [rows, reload] = useLoad(() => procurement.listReceivingInbox({ status }), [status]);
  const [matching, setMatching] = useState<ReceivingInboxRow | null>(null);

  const tabs: [ReceivingInboxStatus, string][] = [
    ["PENDING", tr("Waiting", "Menunggu")],
    ["MATCHED", tr("Matched", "Dicocokkan")],
    ["DISMISSED", tr("Set aside", "Diabaikan")],
  ];

  return (
    <Card className="mb-4">
      <CardHeader
        title={tr("From Google Chat · RECEIVING REPORT", "Dari Google Chat · RECEIVING REPORT")}
        subtitle={tr(
          "Photos posted to the space, filed here within five minutes. Match each one to the transaction that paid for it, or to its purchase order.",
          "Foto yang dikirim ke space, masuk ke sini dalam lima menit. Cocokkan masing-masing dengan transaksi yang membayarnya, atau dengan PO-nya.",
        )}
        icon={MessageSquare}
        action={<SourceBadge state={rows} />}
      />
      <div className="flex flex-wrap gap-1 px-5 pb-3">
        {tabs.map(([k, label]) => (
          <button
            key={k} type="button" onClick={() => setStatus(k)}
            className={k === status
              ? "rounded-full bg-brand-600 px-3 py-1 text-xs font-medium text-white"
              : "rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-200"}
          >
            {label}
          </button>
        ))}
      </div>
      <Loaded state={rows} onRetry={reload}>
        {(all) => all.length === 0 ? (
          <p className="px-5 pb-6 text-[13px] text-slate-500">
            {status === "PENDING"
              ? tr("Nothing from Chat is waiting. Every photo posted has been matched or set aside.",
                "Tidak ada kiriman Chat yang menunggu. Semua foto sudah dicocokkan atau diabaikan.")
              : tr("Nothing here yet.", "Belum ada.")}
          </p>
        ) : (
          <Paged rows={all} pageSize={8} unit={tr("messages", "pesan")}>
            {(shown) => (
              <ul className="divide-y divide-slate-100">
                {shown.map((r) => (
                  <InboxRow key={r.rr_no} row={r} mayAct={mayAct && status === "PENDING"}
                    mayArchive={mayAct && status === "MATCHED"}
                    onMatch={() => setMatching(r)} onDone={reload} />
                ))}
              </ul>
            )}
          </Paged>
        )}
      </Loaded>
      {matching && (
        <MatchDrawer
          row={matching}
          onClose={() => setMatching(null)}
          onMatched={() => { reload(); onMatched(); }}
        />
      )}
    </Card>
  );
}

function InboxRow({ row, mayAct, mayArchive, onMatch, onDone }: {
  row: ReceivingInboxRow; mayAct: boolean; mayArchive: boolean; onMatch: () => void; onDone: () => void;
}) {
  const tr = useTr();
  const { toast } = useToast();
  const [dismissing, setDismissing] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const notFiled = row.files.filter((f) => !f.archived).length;
  const x = row.extracted ?? {};
  const lines = (x.lines ?? []).filter((l) => l.item);
  const hours = Math.max(Math.round((Date.now() - Date.parse(row.reported_at)) / 3_600_000), 0);

  async function dismiss() {
    setBusy(true);
    const res = await procurement.dismissReceiving(row.rr_no, reason);
    setBusy(false);
    if (res.error) { toast("warning", tr("Not set aside", "Tidak diabaikan"), res.error.message); return; }
    toast("success", tr(`${row.rr_no} set aside`, `${row.rr_no} diabaikan`), reason);
    onDone();
  }

  return (
    <li className="px-5 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-mono text-[12px] text-slate-500">{row.rr_no}</span>
        <span className="min-w-[180px] flex-1 text-[13px] font-medium text-slate-800">
          {row.message || <span className="italic text-slate-400">{tr("(no caption)", "(tanpa keterangan)")}</span>}
        </span>
        {row.status === "PENDING" ? (
          <Badge tone={hours > 24 ? "red" : "amber"}>
            {hours < 1 ? tr("just now", "baru saja") : tr(`${hours}h ago`, `${hours} jam lalu`)}
          </Badge>
        ) : row.status === "MATCHED" ? (
          <Badge tone="green"><CheckCircle2 className="h-3 w-3" />
            {row.matched_to === "po" ? row.po_no : row.trx_no}
          </Badge>
        ) : (
          <Badge tone="slate"><XCircle className="h-3 w-3" />{tr("set aside", "diabaikan")}</Badge>
        )}
        {mayAct && (
          <>
            <Button size="sm" onClick={onMatch}>{tr("Match", "Cocokkan")}</Button>
            <Button size="sm" variant="ghost" onClick={() => setDismissing((v) => !v)}>
              {dismissing ? tr("Cancel", "Batal") : tr("Not an arrival", "Bukan kiriman")}
            </Button>
          </>
        )}
      </div>
      <p className="mt-0.5 text-[11px] text-slate-500">
        {row.sender_name ?? tr("unknown sender", "pengirim tidak dikenal")} · {row.reported_at.slice(0, 16).replace("T", " ")}
        {row.resolved_by_name && <> · {tr("by", "oleh")} {row.resolved_by_name}</>}
        {row.resolve_note && <span className="text-slate-600"> · {row.resolve_note}</span>}
      </p>

      <ImageTiles
        className="mt-2 grid grid-cols-4 gap-2 sm:grid-cols-6"
        files={row.files.map((f) => ({
          id: f.attachment_id, filename: f.filename, mime: f.mime, url: f.url,
          /* The month and day folder; the drive and RECEIVING REPORT are the same for all. */
          caption: f.archived ? (f.drive_path ?? "").replace(/^RECEIVING REPORT\//, "") || null : null,
        }))}
      />

      {(x.doc_kind || x.vendor || x.po_number || lines.length > 0) && (
        <div className="mt-1 rounded-lg bg-violet-50/60 px-3 py-2 text-[12px] text-violet-900">
          <span className="inline-flex items-center gap-1 font-medium"><Sparkles className="h-3 w-3" />{tr("AI reading", "Bacaan AI")}</span>
          {x.doc_kind && <> · {x.doc_kind}</>}
          {x.vendor && <> · {x.vendor}</>}
          {x.po_number && <> · PO {x.po_number}</>}
          {x.delivery_note_no && <> · SJ {x.delivery_note_no}</>}
          {lines.length > 0 && (
            <ul className="mt-1 list-disc pl-5">
              {lines.map((l, i) => (
                <li key={i}>
                  {l.item}{l.received_qty != null && <> — {formatNumber(l.received_qty)} {l.remark ?? ""}</>}
                  {l.condition && l.condition !== "GOOD" && <span className="text-rose-700"> ({l.condition})</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {row.status === "MATCHED" && (
        <p className="mt-1 text-[11px] text-slate-500">
          {row.matched_to === "po" && row.po_no && (
            <>{tr("Receipts", "Penerimaan")} {row.receipt_nos.join(", ")} · <Link className="underline" href={`/procurement/po/${row.po_no}`}>{row.po_no}</Link></>
          )}
          {row.matched_to === "transaction" && (
            <>
              {row.move_nos.length > 0 && <>{tr("stock", "stok")} {row.move_nos.join(", ")} · </>}
              {row.asset_nos.length > 0 && <>{tr("assets", "aset")} {row.asset_nos.join(", ")}</>}
            </>
          )}
        </p>
      )}

      {mayArchive && notFiled > 0 && (
        <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-amber-800">
          <span>
            {tr(
              `${notFiled} file(s) still only in the Chat folder (an unused one stays there).`,
              `${notFiled} file masih hanya di folder Chat (yang tidak dipakai memang tetap di sana).`,
            )}
          </span>
          <Button size="sm" variant="outline" icon={FolderInput} disabled={archiving}
            onClick={async () => { setArchiving(true); await archiveAfterMatch(row.rr_no, tr, toast, onDone); setArchiving(false); }}>
            {archiving ? tr("Filing…", "Menyimpan…") : tr("File in Drive", "Simpan ke Drive")}
          </Button>
        </div>
      )}

      {dismissing && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 py-2">
          <input
            value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder={tr("Why — a chat reply, a duplicate…", "Kenapa — balasan chat, foto dobel…")}
            className="h-8 min-w-[220px] flex-1 rounded-lg border border-slate-200 bg-white px-2 text-sm focus:border-brand-400 focus:outline-none"
          />
          <Button size="sm" variant="outline" disabled={busy || !reason.trim()} onClick={dismiss}>
            {tr("Set aside", "Abaikan")}
          </Button>
        </div>
      )}
    </li>
  );
}
