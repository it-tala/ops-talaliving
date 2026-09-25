"use client";

import { useEffect, useState } from "react";
import { Route, Search, EyeOff, AlertTriangle } from "lucide-react";
import { Badge, Button, Card, CardHeader, PageHeader, type Tone } from "@/components/ui/primitives";
import { Loaded, useLoad } from "@/components/ui/loaded";
import { formatIDR, formatNumber, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/cn";
import { inventory, production } from "@/demo/api";
import {
  MATERIAL_STATUS_LABEL, TRAIL_STAGE_LABEL,
  type JobTrail, type TrailStage,
} from "@/services/production/contracts";

/** One number, the whole story (`0171`, D312).
 *
 *  The owner asked for *1 nomor di setiap event* — inventory → BOM → PR → PO →
 *  receiving → stock → Job Order → done → project done, reviewable afterwards.
 *  Every document keeps its own number (a PO covers three JOs; a JO buys from
 *  five vendors), and every row carries the two keys that thread them: the
 *  **item code** (what) and the **Job Order** (for which job, and through it
 *  the project). So any one number opens the whole project here: the project
 *  code, a JO, a PR, a PO, a receiving report or a surat jalan.
 */
export default function JobTrailPage() {
  const [input, setInput] = useState("");
  const [no, setNo] = useState("");
  /* A link from a Job Order lands here already opened. Read once from the
     address rather than through `useSearchParams`, which would make the page
     wait on a suspense boundary for one string. */
  useEffect(() => {
    const n = new URLSearchParams(window.location.search).get("no");
    if (n) { setInput(n); setNo(n); }
  }, []);

  function open(n: string) {
    setInput(n); setNo(n.trim());
    try { window.history.replaceState(null, "", `?no=${encodeURIComponent(n.trim())}`); } catch { /* not essential */ }
  }

  return (
    <div>
      <PageHeader
        breadcrumb="Produksi"
        title="Jejak pembelian–produksi"
        description="Ketik satu nomor — proyek, Job Order, PR, PO, receiving report, atau surat jalan — untuk melihat seluruh kejadiannya dari permintaan barang sampai BAST."
      />
      <form
        className="mb-4 flex flex-wrap items-center gap-2"
        onSubmit={(e) => { e.preventDefault(); open(input); }}
      >
        <label className="flex h-9 flex-1 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 sm:max-w-md">
          <Search className="h-4 w-4 text-slate-400" />
          <input value={input} onChange={(e) => setInput(e.target.value)} aria-label="Nomor"
            placeholder="25007, spk-26-08-24_01, pr-…, po-…, rcv-…, krm-…"
            className="h-8 w-full text-sm focus:outline-none" />
        </label>
        <Button size="sm" icon={Route} disabled={!input.trim()}>Buka jejak</Button>
      </form>

      {no ? <Trail key={no} no={no} onOpen={open} /> : (
        <Card>
          <p className="px-5 py-8 text-center text-[13px] text-slate-500">
            Satu nomor cukup. Nomor dokumen apa pun di rantai ini membuka proyeknya — lalu semua Job Order,
            pembelian, penerimaan, stok, produksi, dan pengirimannya ikut.
          </p>
        </Card>
      )}
    </div>
  );
}

const STAGE_TONE: Record<TrailStage, Tone> = {
  job_order: "brand", purchase_request: "violet", purchase_order: "violet", receipt: "green",
  stock_in: "green", issue: "amber", return: "amber", progress: "slate", finished: "brand",
  delivery: "slate", handover: "green",
};

function Trail({ no, onOpen }: { no: string; onOpen: (n: string) => void }) {
  const [state, reload] = useLoad(() => production.jobTrail(no), [no]);
  const [jo, setJo] = useState<string | null>(null);
  return (
    <Loaded state={state} onRetry={reload}>
      {(t) => {
        const shown = t.events.filter((e) => !jo || e.wo_no === jo);
        return (
          <>
            <Summary trail={t} jo={jo} onJo={setJo} />
            {t.hidden.length > 0 && (
              <p className="mb-3 flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-[12px] text-slate-600">
                <EyeOff className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Tidak ditampilkan untuk akun ini: {t.hidden.map((h) => TRAIL_STAGE_LABEL[h]).join(", ")}.
                Bukan berarti tidak terjadi — akses modulnya tidak ada.
              </p>
            )}
            {(t.unlinked_purchase_lines ?? 0) > 0 && (
              <p className="mb-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-2.5 text-[12px] text-amber-900">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {t.unlinked_purchase_lines} baris pembelian di proyek ini tidak menyebut Job Order — biayanya
                masuk proyek, tapi tidak bisa ditelusuri ke produksi mana.
              </p>
            )}
            <Card>
              <CardHeader
                title={`${shown.length} kejadian${jo ? ` · ${jo}` : ""}`}
                subtitle="Urut waktu. Kode barang menyambung bahan dari PR sampai keluar ke JO; nomor JO menyambung ke proyek."
                icon={Route}
              />
              <div className="overflow-x-auto">
                <table className="w-full min-w-[860px] border-collapse text-[12.5px]">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] uppercase tracking-wide text-slate-500">
                      <th className="px-4 py-2 text-left">Waktu</th>
                      <th className="px-4 py-2 text-left">Kejadian</th>
                      <th className="px-4 py-2 text-left">Nomor</th>
                      <th className="px-4 py-2 text-left">JO</th>
                      <th className="px-4 py-2 text-left">Barang</th>
                      <th className="px-4 py-2 text-right">Jumlah</th>
                      <th className="px-4 py-2 text-right">Rupiah</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((e, i) => (
                      <tr key={`${e.stage}-${e.no}-${i}`} className="border-b border-slate-100 align-top">
                        <td className="whitespace-nowrap px-4 py-1.5 text-slate-500">{formatDateTime(new Date(e.at))}</td>
                        <td className="px-4 py-1.5">
                          <Badge tone={STAGE_TONE[e.stage]}>{TRAIL_STAGE_LABEL[e.stage]}</Badge>
                          {e.status && <div className="mt-0.5 text-[11px] text-slate-400">{e.status}</div>}
                        </td>
                        <td className="px-4 py-1.5 font-mono text-[11px]">
                          <button type="button" className="text-brand-700 hover:underline" onClick={() => onOpen(e.doc_no ?? e.no)}>
                            {e.no}
                          </button>
                        </td>
                        <td className="px-4 py-1.5 font-mono text-[11px] text-slate-600">
                          {e.wo_no ?? <span className="text-slate-300">—</span>}
                        </td>
                        <td className="px-4 py-1.5">
                          {e.item_code && <span className="font-mono text-[11px] text-slate-500">{e.item_code} </span>}
                          <span className="text-slate-700">{e.text}</span>
                        </td>
                        <td className={cn("px-4 py-1.5 text-right tabular-nums", (e.qty ?? 0) < 0 && "text-rose-700")}>
                          {e.qty == null ? "" : `${formatNumber(e.qty)} ${e.uom ?? ""}`}
                        </td>
                        <td className="px-4 py-1.5 text-right tabular-nums text-slate-600">
                          {e.amount != null && formatIDR(e.amount)}
                          {e.paid != null && e.paid > 0 && <div className="text-[11px] text-emerald-700">dibayar {formatIDR(e.paid)}</div>}
                        </td>
                      </tr>
                    ))}
                    {shown.length === 0 && (
                      <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-500">Belum ada kejadian yang tercatat.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        );
      }}
    </Loaded>
  );
}

function Summary({ trail: t, jo, onJo }: { trail: JobTrail; jo: string | null; onJo: (w: string | null) => void }) {
  return (
    <div className="mb-4 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-card">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        {t.project ? (
          <>
            <span className="font-mono text-[12px] text-slate-500">{t.project.code}</span>
            <span className="text-base font-semibold text-slate-800">{t.project.name}</span>
            {t.project.client_name && <span className="text-[12px] text-slate-500">{t.project.client_name}</span>}
            {t.project.status && <Badge tone="slate">{t.project.status}</Badge>}
          </>
        ) : (
          <span className="text-[13px] text-slate-500">Tidak terhubung ke proyek mana pun.</span>
        )}
        <span className="ml-auto text-[11px] text-slate-400">dibuka dari {t.no}</span>
      </div>
      {t.job_orders.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-2">
          <button type="button" onClick={() => onJo(null)}
            className={cn("rounded-lg border px-2.5 py-1.5 text-left text-[12px]",
              !jo ? "border-brand-300 bg-brand-50" : "border-slate-200 hover:bg-slate-50")}>
            Semua JO
          </button>
          {t.job_orders.map((w) => (
            <button key={w.wo_no} type="button" onClick={() => onJo(jo === w.wo_no ? null : w.wo_no)}
              className={cn("rounded-lg border px-2.5 py-1.5 text-left text-[12px]",
                jo === w.wo_no ? "border-brand-300 bg-brand-50" : "border-slate-200 hover:bg-slate-50")}>
              <span className="block font-mono text-[11px] text-slate-500">{w.wo_no} · {w.status}</span>
              <span className="block text-slate-700">{w.item_name}</span>
              <span className="block text-[11px] text-slate-500">
                {formatNumber(w.completed)}/{formatNumber(w.qty)} {w.uom} jadi · <JoMaterial woNo={w.wo_no} />
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** *Material ready* is read from the JO's material plan, computed from the
 *  rack now — never a status somebody set. */
function JoMaterial({ woNo }: { woNo: string }) {
  const [plan] = useLoad(() => inventory.materialForWorkOrder(woNo), [woNo]);
  if (plan.status !== "ready") return <span className="text-slate-300">…</span>;
  const s = plan.data.material_status;
  return (
    <span className={cn(s === "ready" ? "text-emerald-700" : s === "waiting" ? "text-amber-700" : "text-slate-500")}>
      {MATERIAL_STATUS_LABEL[s]}
    </span>
  );
}
