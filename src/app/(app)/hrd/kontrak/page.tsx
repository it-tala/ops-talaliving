"use client";

import { useState } from "react";
import Link from "next/link";
import { ScrollText, AlertTriangle, CalendarClock, Search, Scale, Plus } from "lucide-react";
import { Badge, Button, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { Loaded, SourceBadge, useLoad } from "@/components/ui/loaded";
import { Paged } from "@/components/ui/pager";
import { cn } from "@/lib/cn";
import { hr } from "@/demo/api";
import type { ContractView } from "@/services/hr/contracts";
import { useSession } from "@/store/session";
import { NewContract } from "./NewContract";

/** Kontrak kerja — bukan folder PDF, melainkan jawaban atas *apa isinya*.
 *
 *  HRD yang membuat kontraknya, di Word, di atas kop surat, ditandatangani di
 *  kertas. Yang hilang setiap kali orang HRD berganti bukan berkasnya —
 *  berkasnya ada di Drive — melainkan kemampuan menjawab pertanyaan tentangnya
 *  tanpa membuka empat puluh PDF satu per satu.
 *
 *  Dua angka yang membuat layar ini layak dibuka, dan keduanya tidak bisa
 *  dijawab siapa pun sebelum ini:
 *
 *  - **Berapa kontrak yang poin wajibnya belum dijawab.** Bukan berapa yang
 *    belum diunggah; berapa yang isinya belum pernah dibaca oleh sistem.
 *  - **Berapa kontrak yang isinya tidak sama dengan yang dijalankan.** Kertas
 *    menjanjikan cuti 14 hari, payroll membayar 12. Itu tidak diterapkan
 *    otomatis di mana pun — dilaporkan, dan seseorang memutuskan (D155).
 */
export default function ContractsPage() {
  const { can } = useSession();
  const [rows, reload] = useLoad(() => hr.listContracts(), []);
  const [q, setQ] = useState("");
  const [making, setMaking] = useState(false);

  return (
    <div>
      <PageHeader
        breadcrumb="HRD"
        title="Kontrak kerja"
        description="Apa yang tertulis di kertas, dan apakah itu yang benar-benar dijalankan. Poin wajib yang belum dijawab dan selisih terhadap sistem dihitung per kontrak, bukan dicari waktu dibutuhkan."
        actions={
          <div className="flex items-center gap-2">
            <SourceBadge state={rows} />
            {can("hrd.update") && (
              <Button icon={Plus} onClick={() => setMaking(true)}>Daftarkan kontrak</Button>
            )}
          </div>
        }
      />

      {making && (
        <NewContract onClose={() => setMaking(false)} onDone={() => { setMaking(false); reload(); }} />
      )}

      <Loaded state={rows} onRetry={reload}>
        {(all) => {
          const shown = all.filter((c) => !q
            || `${c.full_name} ${c.employee_no} ${c.contract_no}`.toLowerCase().includes(q.toLowerCase()));
          const active = all.filter((c) => c.status === "active");
          const incomplete = all.filter((c) => c.required_missing > 0);
          const differing = active.filter((c) => c.conflict_count > 0);
          const soon = active.filter((c) => c.ends_in_days != null && c.ends_in_days <= 60);

          return (
            <>
              <div className="mb-4 rounded-xl border border-slate-200 bg-white shadow-card">
                <dl className="grid divide-y divide-slate-100 sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x">
                  {([
                    ["Berjalan", String(active.length), "kontrak yang berlaku hari ini", false],
                    ["Poin wajib belum dijawab", String(incomplete.length),
                      incomplete.length > 0 ? "isinya belum pernah dibaca sistem" : "semua lengkap",
                      incomplete.length > 0],
                    ["Tidak sama dengan sistem", String(differing.length),
                      differing.length > 0 ? "kertas dan payroll berbeda" : "semua sesuai",
                      differing.length > 0],
                    ["Berakhir ≤ 60 hari", String(soon.length),
                      soon.length > 0 ? "siapkan perpanjangannya" : "tidak ada", soon.length > 0],
                  ] as [string, string, string, boolean][]).map(([k, v, note, warn]) => (
                    <div key={k} className="px-4 py-3.5">
                      <dt className="text-[11px] uppercase tracking-wide text-slate-400">{k}</dt>
                      <dd className={cn("mt-0.5 text-xl font-bold tabular-nums tracking-tight",
                        warn ? "text-amber-700" : "text-slate-800")}>{v}</dd>
                      <p className="mt-0.5 text-[11px] text-slate-500">{note}</p>
                    </div>
                  ))}
                </dl>
              </div>

              <Card>
                <CardHeader
                  icon={ScrollText}
                  title="Semua kontrak"
                  subtitle="Yang belum lengkap di atas, lalu yang paling cepat habis."
                  action={
                    <label className="relative block">
                      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                      <input
                        value={q} onChange={(e) => setQ(e.target.value)}
                        placeholder="Cari nama atau nomor…"
                        className="h-9 w-56 rounded-lg border border-slate-200 pl-8 pr-2 text-sm focus:border-brand-400 focus:outline-none"
                      />
                    </label>
                  }
                />
                <Paged rows={shown} pageSize={20} unit="kontrak">
                  {(page) => (
                    <table className="w-full text-sm">
                      <thead className="border-b border-slate-100 text-left text-[11px] uppercase tracking-wide text-slate-400">
                        <tr>
                          <th className="px-4 py-2 font-medium">Karyawan</th>
                          <th className="px-4 py-2 font-medium">Kontrak</th>
                          <th className="px-4 py-2 font-medium">Berlaku</th>
                          <th className="px-4 py-2 font-medium">Berakhir</th>
                          <th className="px-4 py-2 font-medium">Kelengkapan</th>
                          <th className="px-4 py-2 font-medium">Selisih</th>
                          <th className="px-4 py-2 font-medium">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {page.map((c) => <Row key={c.contract_no} c={c} />)}
                        {page.length === 0 && (
                          <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                            Belum ada kontrak yang cocok.
                          </td></tr>
                        )}
                      </tbody>
                    </table>
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

const STATUS_LABEL: Record<ContractView["status"], string> = {
  draft: "Draft", active: "Berjalan", superseded: "Digantikan", ended: "Berakhir",
};

function Row({ c }: { c: ContractView }) {
  return (
    <tr className="hover:bg-slate-50/60">
      <td className="px-4 py-2.5">
        <Link href={`/hrd/kontrak/${c.contract_no}`} className="font-medium text-slate-800 hover:text-brand-700">
          {c.full_name}
        </Link>
        <div className="text-[11px] text-slate-400">{c.employee_no}</div>
      </td>
      <td className="px-4 py-2.5">
        <div className="font-mono text-[12px] text-slate-600">{c.contract_no}</div>
        <div className="text-[11px] text-slate-400">{c.kind}</div>
      </td>
      <td className="px-4 py-2.5 tabular-nums text-slate-600">{c.effective_from}</td>
      <td className="px-4 py-2.5 tabular-nums">
        {c.ends_on
          ? (
            <>
              <span className="text-slate-600">{c.ends_on}</span>
              {c.ends_in_days != null && c.ends_in_days <= 60 && (
                <span className={cn("ml-1.5 text-[11px]",
                  c.ends_in_days < 0 ? "text-rose-700" : "text-amber-700")}>
                  {c.ends_in_days < 0 ? `lewat ${-c.ends_in_days} hari` : `${c.ends_in_days} hari lagi`}
                </span>
              )}
            </>
          )
          : <span className="text-slate-400">—</span>}
      </td>
      <td className="px-4 py-2.5">
        {c.required_missing === 0
          ? <span className="text-slate-500">lengkap</span>
          : <Badge tone="amber">{c.required_missing} belum dijawab</Badge>}
        {c.clauses_proposed > 0 && (
          <span className="ml-1.5 text-[11px] text-slate-400">
            {c.clauses_proposed} usulan menunggu
          </span>
        )}
      </td>
      <td className="px-4 py-2.5">
        {c.status !== "active"
          ? <span className="text-slate-300">—</span>
          : c.conflict_count === 0
            ? <span className="text-slate-500">sesuai</span>
            : <Badge tone="amber">{c.conflict_count} poin</Badge>}
      </td>
      <td className="px-4 py-2.5">
        <Badge tone={c.status === "active" ? "green" : "slate"}>
          {STATUS_LABEL[c.status]}
        </Badge>
      </td>
    </tr>
  );
}
