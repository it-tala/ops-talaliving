"use client";

import { useState } from "react";
import { ScrollText, Search, ShieldAlert, Eye } from "lucide-react";
import { Badge, Button, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { Loaded, SourceBadge, useLoad } from "@/components/ui/loaded";
import { Paged } from "@/components/ui/pager";
import { cn } from "@/lib/cn";
import { identity } from "@/demo/api";
import type { AuditRowView } from "@/services/identity/contracts";

/** The audit trail — what changed, who changed it, and what it was before.
 *
 *  Every mutation in every service writes one of these rows in the same
 *  transaction as the work (D84), **including the ones that were refused**. That
 *  last part is what makes this screen worth opening: a person hitting three
 *  403s in a week is either missing a grant they need or doing somebody else's
 *  job, and neither shows up anywhere else.
 *
 *  Nothing here is ever deleted. This is evidence about **records**; the
 *  activity log next door is evidence about **people**, and that one expires
 *  (D188).
 */
const OUTCOME_TONE = {
  ok: "green", refused: "red", duplicate: "amber", noop: "slate",
} as const;

export default function AuditPage() {
  const [q, setQ] = useState("");
  const [outcome, setOutcome] = useState("");
  const [action, setAction] = useState("");
  const [rows, reload] = useLoad(
    () => identity.listAudit({ entity_no: q || undefined, outcome: outcome || undefined, action: action || undefined }),
    [q, outcome, action],
  );

  return (
    <div>
      <PageHeader
        breadcrumb="IT"
        title="Audit log"
        description="Apa yang berubah, oleh siapa, dan nilainya sebelum–sesudah. Penolakan ikut tercatat — itu justru yang paling sering dicari."
        actions={<SourceBadge state={rows} />}
      />

      <Loaded state={rows} onRetry={reload}>
        {(all) => {
          const refused = all.filter((r) => r.outcome === "refused");
          /* Only the ones that actually opened. A refused reveal is a number
             that was **not** read, and counting it here would have made this
             banner say four where three is the truth — the refusals have their
             own banner below, which is where that row belongs. */
          const reveals = all.filter((r) => r.action === "reveal" && r.outcome === "ok");
          return (
            <>
              {reveals.length > 0 && (
                <div className="mb-4 flex flex-wrap items-start gap-2 rounded-xl border border-violet-200 bg-violet-50/70 px-4 py-3 text-[13px] text-violet-900">
                  <Eye className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    {reveals.length} nomor identitas dibuka —{" "}
                    {[...new Set(reveals.map((r) => r.actor_email))].join(", ")}. Membaca nomor KTP,
                    KK, NPWP atau BPJS tidak mengubah apa pun, tapi tercatat di sini dan tidak pernah
                    dihapus: pertanyaan <em>siapa yang melihat data saya</em> datang berbulan-bulan
                    kemudian. Baris ini menyebut dokumen siapa, bukan nomornya.
                  </span>
                </div>
              )}
              {refused.length > 0 && (
                <div className="mb-4 flex flex-wrap items-start gap-2 rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-[13px] text-amber-900">
                  <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    {refused.length} tindakan ditolak dalam rentang ini —{" "}
                    {[...new Set(refused.map((r) => r.actor_email))].join(", ")}. Ditolak berulang kali
                    berarti salah satu dari dua: haknya kurang, atau dia mengerjakan pekerjaan orang lain.
                  </span>
                </div>
              )}

              <Card>
                <CardHeader
                  title={`${all.length} baris`}
                  subtitle="Terbaru di atas. Setiap baris ditulis dalam transaksi yang sama dengan perubahannya — tidak ada perubahan tanpa jejak."
                  icon={ScrollText}
                  action={
                    <div className="flex flex-wrap items-center gap-2">
                      <label className="flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 px-2">
                        <Search className="h-3.5 w-3.5 text-slate-400" />
                        <input
                          value={q} onChange={(e) => setQ(e.target.value)}
                          placeholder="Nomor dokumen…" aria-label="Cari nomor dokumen"
                          className="h-7 w-44 text-sm focus:outline-none"
                        />
                      </label>
                      <select
                        value={outcome} onChange={(e) => setOutcome(e.target.value)}
                        aria-label="Hasil"
                        className="h-8 rounded-lg border border-slate-200 px-2 text-[13px] focus:border-brand-400 focus:outline-none"
                      >
                        <option value="">Semua hasil</option>
                        <option value="ok">Berhasil</option>
                        <option value="refused">Ditolak</option>
                        <option value="duplicate">Duplikat</option>
                        <option value="noop">Tidak ada perubahan</option>
                      </select>
                      <select
                        value={action} onChange={(e) => setAction(e.target.value)}
                        aria-label="Tindakan"
                        className="h-8 rounded-lg border border-slate-200 px-2 text-[13px] focus:border-brand-400 focus:outline-none"
                      >
                        <option value="">Semua tindakan</option>
                        <option value="reveal">Buka nomor identitas</option>
                      </select>
                    </div>
                  }
                />
                <Paged rows={all} pageSize={20} unit="baris">
                  {(page) => (
                    <ul className="divide-y divide-slate-100">
                      {page.map((r) => <Row key={r.id} row={r} />)}
                      {all.length === 0 && (
                        <li className="px-5 py-8 text-[13px] text-slate-500">Tidak ada yang cocok.</li>
                      )}
                    </ul>
                  )}
                </Paged>
              </Card>
            </>
          );
        }}
      </Loaded>
    </div>
  );
}

function Row({ row: r }: { row: AuditRowView }) {
  const [open, setOpen] = useState(false);
  const before = r.detail?.before as Record<string, unknown> | undefined;
  const after = r.detail?.after as Record<string, unknown> | undefined;

  return (
    <li className="px-5 py-2.5">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 text-left">
        <span className="w-[120px] shrink-0 font-mono text-[10px] text-slate-400">
          {r.at.slice(5, 16).replace("T", " ")}
        </span>
        <Badge tone={OUTCOME_TONE[r.outcome]}>{r.outcome}</Badge>
        <span className="text-[13px] font-medium text-slate-800">{r.action}</span>
        <span className="text-[12px] text-slate-500">{r.service} · {r.entity}</span>
        <span className="font-mono text-[11px] text-slate-600">{r.entity_no}</span>
        <span className="flex-1" />
        <span className="text-[11px] text-slate-400">{r.actor_email}</span>
      </button>

      {r.reason && <p className="mt-0.5 text-[12px] text-slate-600">{r.reason}</p>}

      {open && r.detail && (
        <div className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-[12px]">
          {/* Before and after side by side where the row carries them — the
              shape a void or a rate change writes (D84). */}
          {before && after ? (
            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <p className="text-[10px] uppercase tracking-wide text-slate-400">Sebelum</p>
                <pre className="whitespace-pre-wrap break-words text-[11px] text-slate-700">
                  {JSON.stringify(before, null, 1)}
                </pre>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-slate-400">Sesudah</p>
                <pre className="whitespace-pre-wrap break-words text-[11px] text-slate-700">
                  {JSON.stringify(after, null, 1)}
                </pre>
              </div>
            </div>
          ) : (
            <pre className="whitespace-pre-wrap break-words text-[11px] text-slate-700">
              {JSON.stringify(r.detail, null, 1)}
            </pre>
          )}
        </div>
      )}
    </li>
  );
}
