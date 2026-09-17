"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Link2, AlertTriangle, Users, Check, Undo2 } from "lucide-react";
import { Badge, Button, Card, CardHeader, EmptyState, PageHeader, StatCard } from "@/components/ui/primitives";
import { Loaded, SourceBadge, useLoad } from "@/components/ui/loaded";
import { Combobox } from "@/components/ui/combobox";
import { formatNumber } from "@/lib/format";
import { production, hr } from "@/demo/api";
import type { UnresolvedName } from "@/demo/production-derive";
import type { Employee } from "@/services/hr/contracts";
import { useToast } from "@/store/toast";
import { useSession } from "@/store/session";
import { officeToday } from "@/lib/office";

/** Putting a name to the work — once per name, by a person (D264).
 *
 *  Production writes down a name because a subcontractor is a legitimate
 *  answer to *who did it*. W5 adds a link **beside** that name so the work
 *  becomes countable, and this screen is where the link gets made.
 *
 *  Three rules hold it up, and all three are about not letting software decide
 *  who did what:
 *
 *  - **the suggestion is a suggestion.** An exact name match is offered and
 *    never applied. Matching people by name is how the wrong review lands on
 *    the wrong person, and the fix for that is not a better matcher;
 *  - **two matches is worse than none.** There is an *Andi* in the workshop and
 *    an *Andi Prasetyo* in the office. The row says so and offers neither,
 *    because *we could not tell which* and *we found nobody* are different
 *    answers that need different actions;
 *  - **"not one person" is an answer, not a failure.** *Tim potong* and a
 *    subcontractor's crew are resolved rows: somebody looked and answered. They
 *    count towards coverage exactly like a linked name does.
 *
 *  The question is asked **once per name**, not once per entry: *Pranowo* is
 *  the same Pranowo on all six, and a screen that asks six times is one
 *  somebody abandons halfway — leaving a half-resolved record, which is worse
 *  than an untouched one because it looks complete.
 */
export default function WorkAttributionPage() {
  const { can } = useSession();
  const mayEdit = can("production.update");
  const [to, setTo] = useState(officeToday());
  const [from, setFrom] = useState(() => {
    const d = new Date(`${officeToday()}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 60);
    return d.toISOString().slice(0, 10);
  });

  const [rows, reload] = useLoad(() => production.listUnresolvedNames({ from, to }), [from, to]);
  const [people] = useLoad(() => hr.listEmployees(), []);

  return (
    <div>
      <PageHeader
        breadcrumb="Production"
        title="Penautan nama"
        description="Papan produksi mencatat nama, bukan orang — karena subkon itu jawaban yang sah. Di sini nama itu dihubungkan ke karyawan, satu kali per nama, oleh manusia. Sistem boleh menyarankan; menautkan sendiri tidak."
        actions={
          <div className="flex items-center gap-2 text-[12px]">
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
              className="rounded-lg border border-slate-300 px-2 py-1.5" />
            <span className="text-slate-400">—</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
              className="rounded-lg border border-slate-300 px-2 py-1.5" />
          </div>
        }
      />

      <Loaded state={rows} onRetry={reload}>
        {(d) => {
          const a = d.attribution;
          const coverage = Math.round(a.coverage * 100);
          const employees = people.status === "ready" ? people.data : [];

          return (
            <>
              <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
                <StatCard
                  label="Sudah jelas siapa" value={`${coverage}%`} icon={Check}
                  tone={coverage >= 80 ? "green" : coverage >= 50 ? "amber" : "red"}
                />
                <StatCard label="Tertaut ke karyawan" value={String(a.employee)} icon={Link2} />
                <StatCard label="Bukan satu orang" value={String(a.not_a_person)} icon={Users} />
                <StatCard
                  label="Belum dijawab" value={String(a.unknown)} icon={AlertTriangle}
                  tone={a.unknown > 0 ? "amber" : "slate"}
                />
              </div>

              <p className="mb-4 text-[12px] text-slate-500">
                Selama masih ada entri yang belum dijawab, kolom hasil produksi yang kosong di{" "}
                <Link href="/hrd/kinerja" className="underline">kinerja</Link> tidak bisa dibaca sebagai
                nol — bisa jadi orangnya bekerja dan tidak ada yang menuliskan siapa. Cakupan itu sifat
                catatannya, bukan sifat orangnya.
                {a.unnamed > 0 && (
                  <> {a.unnamed} entri periode ini bahkan tidak menyebut nama sama sekali, dan itu tidak
                  bisa diselesaikan dari sini — hanya oleh yang mencatatnya.</>
                )}
              </p>

              {d.names.length === 0 ? (
                <EmptyState
                  icon={Check}
                  title="Tidak ada nama yang menunggu jawaban"
                  description="Semua nama pada periode ini sudah tertaut ke karyawan atau sudah ditandai bukan satu orang."
                />
              ) : (
                <Card>
                  <CardHeader
                    title={`${d.names.length} nama menunggu jawaban`}
                    subtitle="Satu jawaban berlaku untuk semua entri dengan nama itu pada periode ini. Entri yang sudah dijawab sebelumnya tidak ikut tersentuh."
                    icon={Link2}
                    action={<SourceBadge state={rows} />}
                  />
                  <ul className="divide-y divide-slate-100">
                    {d.names.map((n) => (
                      <NameRow
                        key={n.name} row={n} employees={employees} mayEdit={mayEdit}
                        from={from} to={to} onDone={reload}
                      />
                    ))}
                  </ul>
                </Card>
              )}
            </>
          );
        }}
      </Loaded>
    </div>
  );
}

type NameRowProps = {
  row: UnresolvedName;
  employees: Employee[];
  mayEdit: boolean;
  from: string;
  to: string;
  onDone: () => void;
};

function NameRow({ row, employees, mayEdit, from, to, onDone }: NameRowProps) {
  const { toast } = useToast();
  const [picked, setPicked] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const options = useMemo(
    () => employees.filter((e) => e.active).map((e) => ({
      value: e.id,
      label: `${e.employee_no} · ${e.full_name}`,
      sublabel: e.unit,
    })),
    [employees],
  );

  async function save(answer: { employee_id?: string; not_a_person?: boolean }) {
    setBusy(true);
    const res = await production.resolveWorkName({ name: row.name, from, to, ...answer });
    setBusy(false);
    if (res.error) {
      toast(res.error.status === 409 ? "critical" : "warning", "Belum ditautkan", res.error.message);
      return;
    }
    toast("success", `${row.name} · ${res.data.updated} entri`,
      answer.not_a_person ? "Ditandai bukan satu orang." : "Tertaut ke karyawan.");
    onDone();
  }

  return (
    <li className="px-5 py-3">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <span className="min-w-[220px] flex-1">
          <span className="block text-[14px] font-medium text-slate-800">{row.name}</span>
          <span className="block text-[11px] text-slate-500">
            {row.entries} entri · {formatNumber(row.qty)} pcs · {row.first_seen} — {row.last_seen}
          </span>
          <span className="block text-[11px] text-slate-400">{row.work_orders.join(" · ")}</span>
        </span>

        <span className="flex min-w-[260px] flex-1 flex-wrap items-center gap-2">
          {/* A suggestion, offered and never applied. */}
          {row.suggestion && (
            <Badge tone="brand">
              saran: {row.suggestion.employee_no} · {row.suggestion.full_name}
            </Badge>
          )}
          {row.ambiguous && (
            <span className="flex items-center gap-1.5 text-[11px] text-amber-700">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              {row.ambiguous.length} orang bernama sama ({row.ambiguous.map((m) => m.employee_no).join(", ")}) —
              tidak ada saran, pilih sendiri
            </span>
          )}
          {!row.suggestion && !row.ambiguous && (
            <span className="text-[11px] text-slate-400">tidak ada karyawan dengan nama ini</span>
          )}
        </span>
      </div>

      {mayEdit && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {row.suggestion && (
            <Button
              size="sm" variant="secondary" icon={Check} disabled={busy}
              onClick={() => save({ employee_id: row.suggestion!.employee_id })}
            >
              Ya, {row.suggestion.full_name}
            </Button>
          )}
          <div className="w-[260px]">
            <Combobox
              options={options}
              value={picked}
              onChange={(v) => setPicked(v)}
              placeholder="Pilih karyawan lain…"
            />
          </div>
          <Button
            size="sm" variant="outline" icon={Link2}
            disabled={busy || !picked}
            onClick={() => save({ employee_id: picked })}
          >
            Tautkan
          </Button>
          <Button
            size="sm" variant="ghost" icon={Users} disabled={busy}
            onClick={() => save({ not_a_person: true })}
          >
            Bukan satu orang
          </Button>
        </div>
      )}
    </li>
  );
}
