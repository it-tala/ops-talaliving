"use client";

import { KeyRound, Table2 } from "lucide-react";
import { Badge, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { Loaded, SourceBadge, useLoad } from "@/components/ui/loaded";
import { cn } from "@/lib/cn";
import { identity } from "@/demo/api";
import {
  MODULES, MODULE_LABEL, LEVELS, LEVEL_LABEL, AUTHORITIES, AUTHORITY_LABEL,
  PERMISSION_CATALOG, describeGrant, IT_ACCESS_RULE,
} from "@/lib/roles";
import { useTr } from "@/lib/i18n";
import { ExcelTable } from "@/components/ui/excel-export";

/** What each level actually unlocks, and who holds which decision.
 *
 *  There are no roles to edit here on purpose (D24). A role is a bundle
 *  somebody has to keep true, and the bundles drift: `finance` ends up meaning
 *  four different things to four people. What exists instead is a **catalogue**
 *  — modules × levels, seeded from `src/lib/roles.ts` — and per-person grants
 *  on the screen next door.
 *
 *  So this page answers two questions and edits nothing: *what does "write" on
 *  Accounting actually let somebody do*, and *who can approve money today*.
 */
export default function RolesPage() {
  const tr = useTr();
  const [users] = useLoad(() => identity.listUsers(), []);

  return (
    <div>
      <PageHeader
        breadcrumb="IT"
        title={tr("Roles & permissions", "Peran & izin")}
        description={tr(
          "The access catalogue: what each level unlocks, and who holds which authority. No role can be edited — grants are given per person.",
          "Katalog akses: apa yang dibuka tiap level, dan siapa memegang wewenang apa. Tidak ada peran yang bisa diedit — grant diberikan per orang.",
        )}
        actions={<SourceBadge state={users} />}
      />

      {/* The one module whose readership is a policy rather than a convenience,
          stated where the catalogue is read as well as where a grant is made. */}
      <Card className="mb-4">
        <CardHeader title={tr("Who may open the IT module", "Siapa boleh membuka modul IT")} subtitle={tr("The owner's answer to Q22", "Jawaban pemilik atas Q22")} icon={KeyRound} />
        <div className="px-4 py-3 text-[13px] text-slate-700">
          <p>{tr(IT_ACCESS_RULE.en, IT_ACCESS_RULE.id)}</p>
          <Loaded state={users}>
            {(rows) => {
              /* Switched off holds nothing (0183), so it is not a holder. */
              const holders = rows.filter((u) => u.user.is_active && u.modules.some((m) => m.module === "it"));
              return (
                <ul className="mt-2 space-y-1">
                  {holders.map((u) => {
                    const level = u.modules.find((m) => m.module === "it")!.level;
                    return (
                      <li key={u.user.id} className="flex items-center gap-2 text-[12px]">
                        <span className="text-slate-800">{u.user.full_name}</span>
                        <Badge tone={level === "admin" ? "brand" : "slate"}>{LEVEL_LABEL[level]}</Badge>
                        <span className="text-slate-500">
                          {level === "admin" ? tr("manages and deletes", "mengelola dan menghapus") : tr("read only", "membaca saja")}
                        </span>
                      </li>
                    );
                  })}
                  {holders.length === 0 && <li className="text-[12px] text-slate-500">{tr("Nobody has been given access yet.", "Belum ada yang diberi akses.")}</li>}
                </ul>
              );
            }}
          </Loaded>
        </div>
      </Card>

      <Card className="mb-4">
        <CardHeader
          title={tr("What each level unlocks", "Apa yang dibuka tiap level")}
          subtitle={tr("Read: one module, three levels. Verbs marked admin open only at the Full level.", "Baca: satu modul, tiga tingkat. Verb yang bertanda admin hanya terbuka di level Full.")}
          icon={Table2}
        />
        <div className="overflow-x-auto">
          <ExcelTable className="w-full min-w-[720px] border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] uppercase tracking-wide text-slate-500">
                <th className="px-4 py-2 text-left">{tr("Module", "Modul")}</th>
                {LEVELS.map((l) => <th key={l} className="px-4 py-2 text-left">{LEVEL_LABEL[l]}</th>)}
                <th className="px-4 py-2 text-left">{tr("Permissions", "Izin yang ada")}</th>
              </tr>
            </thead>
            <tbody>
              {MODULES.map((m) => (
                <tr key={m} className="border-b border-slate-100">
                  <td className="px-4 py-2 font-medium text-slate-800">{MODULE_LABEL[m]}</td>
                  {LEVELS.map((l) => (
                    <td key={l} className="px-4 py-2 text-slate-600">{describeGrant(m, l)}</td>
                  ))}
                  <td className="px-4 py-2">
                    <span className="font-mono text-[11px] text-slate-500">
                      {PERMISSION_CATALOG[m].map((a) => `${m}.${a}`).join(" · ")}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </ExcelTable>
        </div>
        <p className="border-t border-slate-100 px-4 py-2 text-[11px] text-slate-500">
          {tr("This catalogue is code", "Katalog ini adalah kode")} (<span className="font-mono">src/lib/roles.ts</span>),{" "}
          {tr(
            "not rows somebody typed — adding a verb is a change that can be reviewed, and the list people read is the list the system uses.",
            "bukan baris yang diketik orang — menambah satu verb adalah perubahan yang bisa ditinjau, dan daftar yang dibaca manusia sama dengan daftar yang dipakai sistem.",
          )}
        </p>
      </Card>

      <Loaded state={users}>
        {(all) => (
          <Card>
            <CardHeader
              title={tr("Who holds which authority", "Siapa memegang wewenang apa")}
              subtitle={tr("Named decisions, granted one by one. Never implied by a module level.", "Keputusan bernama, diberikan sendiri-sendiri. Tidak pernah tersirat dari level modul.")}
              icon={KeyRound}
            />
            <ul className="divide-y divide-slate-100">
              {AUTHORITIES.map((a) => {
                const holders = all.filter((u) => u.user.is_active && u.authorities.includes(a));
                return (
                  <li key={a} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3">
                    <span className="min-w-[220px] text-[13px] font-medium text-slate-800">
                      {AUTHORITY_LABEL[a]}
                      <span className="ml-2 font-mono text-[10px] font-normal text-slate-400">{a}</span>
                    </span>
                    <span className="flex-1 text-[12px] text-slate-600">
                      {holders.length === 0
                        ? <span className="text-rose-700">{tr("nobody holds it — this action will always be refused", "tidak ada yang memegang — tindakan ini akan selalu ditolak")}</span>
                        : holders.map((u) => u.user.full_name).join(", ")}
                    </span>
                    <Badge tone={holders.length === 0 ? "red" : holders.length === 1 ? "green" : "amber"}>
                      {tr(`${holders.length} person(s)`, `${holders.length} orang`)}
                    </Badge>
                  </li>
                );
              })}
            </ul>
            <p className="border-t border-slate-100 px-4 py-2 text-[12px] text-slate-500">
              {tr(
                "One holder means the decision is clearly theirs — and means work stops while that person travels. Two or more means somebody has to know who answers first. Both are management decisions, not technical settings.",
                "Satu pemegang berarti keputusan itu jelas miliknya — dan berarti pekerjaan berhenti saat orangnya bepergian. Dua atau lebih berarti harus ada yang tahu siapa yang menjawab lebih dulu. Keduanya keputusan pimpinan, bukan setelan teknis.",
              )}
            </p>
          </Card>
        )}
      </Loaded>
    </div>
  );
}
