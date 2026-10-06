"use client";

import { BarChart3 } from "lucide-react";
import { Loaded, useLoad } from "@/components/ui/loaded";
import { formatIDR } from "@/lib/format";
import { cn } from "@/lib/cn";
import { officeToday } from "@/lib/office";
import { procurement } from "@/demo/api";
import type { ProjectOutcome, ProjectStatus } from "@/services/procurement/contracts";
import { useTr } from "@/lib/i18n";

const DAY = 86_400_000;
const within = (day: string | null, months: number, today: string) =>
  !!day && Date.parse(today) - Date.parse(day) <= months * 31 * DAY;

/** The pipeline's numbers, counted from what was recorded (0229, P7, kajian
 *  §4.6): how many sales are won, how long a deal takes, how long a project
 *  sits in each stage, and who and which source wins. Values are offers,
 *  never receivables or profit (D164). */
export function PipelineNumbers({ pic }: {
  /** The board's salesperson filter: a name, the "unassigned" label, or ALL. */
  pic: string;
}) {
  const tr = useTr();
  const [state, reload] = useLoad(() => procurement.listProjectOutcomes(), []);
  const today = officeToday();
  return (
    <Loaded state={state} onRetry={reload} skeletonRows={2}>
      {(all) => {
        /* The board's own filter: by the salesperson's name, "unassigned" for
           none — the same words, so the numbers and the cards agree. */
        const unassigned = tr("Unassigned", "Belum ada PIC");
        const rows = pic === "ALL" ? all : all.filter((r) => (r.sales_pic_name ?? unassigned) === pic);
        /* Decided in the last twelve months: won on its deal day, lost on its
           closing day. An open project is not a loss yet. */
        const decided = rows.filter((r) => (r.outcome === "won" && within(r.deal_on, 12, today))
          || (r.outcome === "lost" && within(r.lost_on, 12, today)));
        const won = decided.filter((r) => r.outcome === "won");
        const rate = decided.length ? won.length / decided.length : null;
        const toDeal = won.map((r) => r.days_to_deal).filter((d): d is number => d != null);
        const avgDeal = toDeal.length ? Math.round(toDeal.reduce((a, b) => a + b, 0) / toDeal.length) : null;
        const wonValue = won.reduce((a, r) => a + (r.value ?? 0), 0);
        const open = rows.filter((r) => r.outcome === "open");
        return (
          <section className="mt-5 rounded-xl border border-slate-200 bg-white">
            <header className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-2.5">
              <BarChart3 className="h-4 w-4 text-slate-400" />
              <h2 className="text-[13px] font-semibold text-slate-800">{tr("The pipeline's numbers", "Angka pipeline")}</h2>
              <span className="text-[12px] text-slate-500">
                {tr("decided in the last 12 months · values are offers, not profit (D164)",
                  "diputuskan 12 bulan terakhir · nilai adalah penawaran, bukan laba (D164)")}
              </span>
            </header>
            <dl className="grid grid-cols-2 divide-slate-100 border-b border-slate-100 sm:grid-cols-4 sm:divide-x">
              <Num label={tr("Win rate", "Win rate")} value={rate == null ? "—" : `${Math.round(rate * 100)}%`}
                sub={tr(`${won.length} won of ${decided.length} decided`, `${won.length} deal dari ${decided.length} yang diputuskan`)} />
              <Num label={tr("Inquiry to deal", "Inquiry sampai deal")} value={avgDeal == null ? "—" : tr(`${avgDeal} days`, `${avgDeal} hari`)}
                sub={tr("average, deals won", "rata-rata, yang deal")} />
              <Num label={tr("Won", "Deal")} value={formatIDR(wonValue)} sub={tr("accepted offers", "penawaran disetujui")} />
              <Num label={tr("Open", "Terbuka")} value={String(open.length)}
                sub={formatIDR(open.reduce((a, r) => a + (r.value ?? 0), 0))} />
            </dl>
            <div className="grid gap-4 p-4 lg:grid-cols-3">
              <AgeByStage open={open} />
              <WinTable title={tr("By salesperson", "Per PIC sales")} rows={rows} today={today}
                keyOf={(r) => r.sales_pic_name ?? tr("nobody named", "belum ada PIC")} />
              <WinTable title={tr("By source", "Per sumber")} rows={rows} today={today}
                keyOf={(r) => r.source_note?.trim() || tr("not written down", "tidak dicatat")} />
            </div>
          </section>
        );
      }}
    </Loaded>
  );
}

function Num({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="px-4 py-3">
      <dt className="text-[11px] uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-0.5 text-lg font-bold tabular-nums text-slate-800">{value}</dd>
      <p className="text-[11px] text-slate-500">{sub}</p>
    </div>
  );
}

const STAGES: { code: ProjectStatus; en: string; id: string }[] = [
  { code: "INQUIRY", en: "Inquiry", id: "Inquiry" },
  { code: "QUOTATION_SENT", en: "Quotation sent", id: "Quotation terkirim" },
];

/** How long the open ones have sat where they are — the stage a sale stalls
 *  in is where to look. */
function AgeByStage({ open }: { open: ProjectOutcome[] }) {
  const tr = useTr();
  return (
    <div>
      <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{tr("Age in stage", "Umur di tahap")}</h3>
      <table className="w-full text-[13px]">
        <thead>
          <tr className="text-[11px] text-slate-400">
            <th className="py-1 text-left font-normal">{tr("Stage", "Tahap")}</th>
            <th className="py-1 text-right font-normal">{tr("Open", "Terbuka")}</th>
            <th className="py-1 text-right font-normal">{tr("Avg days", "Rata-rata hari")}</th>
            <th className="py-1 text-right font-normal">{tr("Oldest", "Terlama")}</th>
          </tr>
        </thead>
        <tbody>
          {STAGES.map((s) => {
            const xs = open.filter((r) => r.status === s.code).map((r) => r.days_in_status ?? 0);
            const avg = xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null;
            const max = xs.length ? Math.max(...xs) : null;
            return (
              <tr key={s.code} className="border-t border-slate-100">
                <td className="py-1.5 text-slate-700">{tr(s.en, s.id)}</td>
                <td className="py-1.5 text-right tabular-nums">{xs.length}</td>
                <td className="py-1.5 text-right tabular-nums">{avg ?? "—"}</td>
                <td className={cn("py-1.5 text-right tabular-nums", (max ?? 0) > 30 && "font-medium text-amber-700")}>{max ?? "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function WinTable({
  title, rows, today, keyOf,
}: { title: string; rows: ProjectOutcome[]; today: string; keyOf: (r: ProjectOutcome) => string }) {
  const tr = useTr();
  const groups = new Map<string, { won: number; lost: number; open: number; value: number }>();
  for (const r of rows) {
    const k = keyOf(r);
    const g = groups.get(k) ?? { won: 0, lost: 0, open: 0, value: 0 };
    if (r.outcome === "won" && within(r.deal_on, 12, today)) { g.won++; g.value += r.value ?? 0; }
    else if (r.outcome === "lost" && within(r.lost_on, 12, today)) g.lost++;
    else if (r.outcome === "open") g.open++;
    else continue;
    groups.set(k, g);
  }
  const sorted = [...groups.entries()].sort((a, b) => b[1].value - a[1].value || b[1].won - a[1].won);
  return (
    <div>
      <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
      {sorted.length === 0 ? (
        <p className="text-[12px] text-slate-400">{tr("Nothing recorded yet.", "Belum ada catatan.")}</p>
      ) : (
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-[11px] text-slate-400">
              <th className="py-1 text-left font-normal" />
              <th className="py-1 text-right font-normal">{tr("Won", "Deal")}</th>
              <th className="py-1 text-right font-normal">{tr("Lost", "Tidak jadi")}</th>
              <th className="py-1 text-right font-normal">{tr("Open", "Terbuka")}</th>
              <th className="py-1 text-right font-normal">{tr("Win rate", "Win rate")}</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(([k, g]) => (
              <tr key={k} className="border-t border-slate-100">
                <td className="max-w-[140px] truncate py-1.5 text-slate-700" title={k}>{k}</td>
                <td className="py-1.5 text-right tabular-nums">{g.won}</td>
                <td className="py-1.5 text-right tabular-nums">{g.lost}</td>
                <td className="py-1.5 text-right tabular-nums text-slate-500">{g.open}</td>
                <td className="py-1.5 text-right tabular-nums">
                  {g.won + g.lost ? `${Math.round((g.won / (g.won + g.lost)) * 100)}%` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
