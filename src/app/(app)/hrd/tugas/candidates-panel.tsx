"use client";

import { useState } from "react";
import { Ban, CalendarClock, Lightbulb, Pencil, Play, Plus } from "lucide-react";
import { Badge, Button, Card, CardHeader } from "@/components/ui/primitives";
import { Loaded, useLoad } from "@/components/ui/loaded";
import { cn } from "@/lib/cn";
import { hr } from "@/demo/api";
import type { CandidateGoal, Employee, GoalView } from "@/services/hr/contracts";
import { useToast } from "@/store/toast";
import { useTr } from "@/lib/i18n";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const monthLabel = (d: string | null) => (d ? `${MONTHS[+d.slice(5, 7) - 1]} ${d.slice(0, 4)}` : "—");
const dmy = (d: string) => `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}`;

/** Kandidat — goals that may or may not happen (D393).
 *
 *  The leader's December projects: written down with an estimated start
 *  month and a date by which they are decided, their parts prepared in the
 *  daftar tunggu, and kept **out of the ranked list** — nobody is given work
 *  on a result that may not happen, and nothing here touches a score.
 *
 *  *Jalankan* puts it into the ranked list at the place chosen in the same
 *  step, because priorities change fast and that should be one decision, not
 *  two. *Tidak jadi* closes it with a reason; its waiting items leave with it.
 *  HRD and pimpinan (approve_funds) write and decide; HRD read-only sees. */
export function CandidatesPanel({
  employees, ranked, mayPlan, stamp, onChanged,
}: {
  employees: Employee[];
  ranked: GoalView[];
  mayPlan: boolean;
  stamp?: unknown;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const tr = useTr();
  const [list, reload] = useLoad(() => hr.listCandidateGoals(), [stamp]);
  const blank = { goal_no: null as string | null, title: "", outcome: "", owner_no: "", starts_month: "",
                  decide_by: "", target_date: "", detail: "" };
  const [draft, setDraft] = useState(blank);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [deciding, setDeciding] = useState<{ goal_no: string; run: boolean; rank: string; note: string } | null>(null);

  async function save() {
    setBusy(true);
    const res = await hr.saveCandidateGoal({
      goal_no: draft.goal_no, title: draft.title, outcome: draft.outcome, owner_no: draft.owner_no,
      target_date: draft.target_date, decide_by: draft.decide_by,
      starts_month: draft.starts_month ? `${draft.starts_month}-01` : null, detail: draft.detail || null,
    });
    setBusy(false);
    if (res.error) { toast("warning", tr("Not saved", "Tidak tersimpan"), res.error.message); return; }
    toast("success", res.data.goal_no, draft.goal_no ? tr("Candidate updated.", "Kandidat diperbarui.")
      : tr("Candidate written down — not ranked, nobody tasked until it is decided.",
           "Kandidat dicatat — belum masuk peringkat, belum ada yang ditugaskan sampai diputuskan."));
    setDraft(blank); setEditing(false);
    reload();
  }

  async function decide() {
    if (!deciding) return;
    setBusy(true);
    const res = await hr.decideCandidateGoal({
      goal_no: deciding.goal_no, run: deciding.run,
      rank: deciding.run && deciding.rank ? Number(deciding.rank) : null, note: deciding.note || null,
    });
    setBusy(false);
    if (res.error) { toast("warning", tr("Not decided", "Belum diputuskan"), res.error.message); return; }
    toast("success", res.data.goal_no, deciding.run
      ? tr(`Running — now #${res.data.rank}. Its parts can be assigned from the waiting list.`,
           `Dijalankan — sekarang #${res.data.rank}. Bagian-bagiannya bisa ditugaskan dari daftar tunggu.`)
      : tr(`Not going ahead. ${res.data.items_removed ?? 0} waiting items left the list with it.`,
           `Tidak jadi. ${res.data.items_removed ?? 0} item daftar tunggu ikut keluar.`));
    setDeciding(null);
    reload(); onChanged();
  }

  function edit(c: CandidateGoal) {
    setDraft({ goal_no: c.goal_no, title: c.title, outcome: c.outcome, owner_no: c.owner_no,
               starts_month: c.starts_month ? c.starts_month.slice(0, 7) : "", decide_by: c.decide_by,
               target_date: c.target_date, detail: c.detail ?? "" });
    setEditing(true);
  }

  const input = "mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm";
  const openRanked = ranked.filter((g) => g.status === "OPEN").sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));

  return (
    <Card className="mt-4">
      <CardHeader
        title={tr("Candidates — may or may not happen", "Kandidat — mungkin jalan, mungkin tidak")}
        subtitle={tr(
          "Projects under consideration, with the month they would start and the date they are decided by. Not ranked, nobody is tasked, nothing is scored. Prepare their parts in the waiting list.",
          "Proyek yang sedang dipertimbangkan, dengan bulan perkiraan mulai dan tanggal keputusannya. Belum masuk peringkat, belum ada yang ditugaskan, tidak dinilai. Siapkan bagian-bagiannya di daftar tunggu.",
        )}
        icon={Lightbulb}
        action={mayPlan && !editing ? (
          <Button size="sm" icon={Plus} className="whitespace-nowrap" onClick={() => { setDraft(blank); setEditing(true); }}>
            {tr("New candidate", "Kandidat baru")}
          </Button>
        ) : undefined}
      />

      {editing && (
        <div className="grid gap-3 border-b border-slate-100 bg-slate-50/60 px-5 py-4 sm:grid-cols-2">
          <label className="text-[12px] text-slate-600 sm:col-span-2">
            {tr("The project", "Proyeknya")}
            <input id="cand-title" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              placeholder={tr("December furniture fair", "Pameran furnitur Desember")} className={input} />
          </label>
          <label className="text-[12px] text-slate-600 sm:col-span-2">
            {tr("What it looks like when it is reached", "Seperti apa kalau sudah tercapai")}
            <input id="cand-outcome" value={draft.outcome} onChange={(e) => setDraft({ ...draft, outcome: e.target.value })} className={input} />
          </label>
          <label className="text-[12px] text-slate-600">
            {tr("Who would put it together", "Siapa yang akan menyatukannya")}
            <select id="cand-owner" value={draft.owner_no} onChange={(e) => setDraft({ ...draft, owner_no: e.target.value })} className={input}>
              <option value="">{tr("— choose —", "— pilih —")}</option>
              {employees.filter((e) => e.active).map((e) => (
                <option key={e.employee_no} value={e.employee_no}>{e.full_name} · {e.position}</option>
              ))}
            </select>
          </label>
          <label className="text-[12px] text-slate-600">
            {tr("Would start (month)", "Perkiraan mulai (bulan)")}
            <input id="cand-month" type="month" value={draft.starts_month} onChange={(e) => setDraft({ ...draft, starts_month: e.target.value })} className={input} />
          </label>
          <label className="text-[12px] text-slate-600">
            {tr("Decided by", "Diputuskan paling lambat")}
            <input id="cand-decide" type="date" value={draft.decide_by} onChange={(e) => setDraft({ ...draft, decide_by: e.target.value })} className={input} />
          </label>
          <label className="text-[12px] text-slate-600">
            {tr("Target date (estimate)", "Target tanggal (perkiraan)")}
            <input id="cand-target" type="date" value={draft.target_date} onChange={(e) => setDraft({ ...draft, target_date: e.target.value })} className={input} />
          </label>
          <label className="text-[12px] text-slate-600 sm:col-span-2">
            {tr("Notes — what the decision depends on", "Catatan — keputusannya tergantung apa")}
            <input id="cand-detail" value={draft.detail} onChange={(e) => setDraft({ ...draft, detail: e.target.value })} className={input} />
          </label>
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setDraft(blank); }}>{tr("Cancel", "Batal")}</Button>
            <Button size="sm" disabled={busy || !draft.title.trim() || !draft.outcome.trim() || !draft.owner_no || !draft.decide_by || !draft.target_date}
              onClick={save}>{tr("Save", "Simpan")}</Button>
          </div>
        </div>
      )}

      <Loaded state={list} onRetry={reload}>
        {(items) => items.length === 0 ? (
          <p className="px-5 py-5 text-[13px] text-slate-500">
            {tr("No candidates. Write down a project that may happen, so its parts can be prepared before it is decided.",
                "Belum ada kandidat. Catat proyek yang mungkin dijalankan, supaya bagian-bagiannya bisa disiapkan sebelum diputuskan.")}
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {items.map((c) => {
              const due = c.days_to_decide;
              return (
                <li key={c.goal_no} className="px-5 py-3.5">
                  <div className="flex flex-wrap items-start gap-x-3 gap-y-1.5">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-sm font-semibold text-slate-800">{c.title}</span>
                        <Badge tone="violet">{tr("candidate", "kandidat")}</Badge>
                        <Badge tone={due < 0 ? "red" : due <= 7 ? "amber" : "slate"}>
                          <CalendarClock className="mr-0.5 inline h-3 w-3" />
                          {due < 0 ? tr(`decision ${-due} d overdue`, `keputusan lewat ${-due} hari`)
                            : due === 0 ? tr("decide today", "putuskan hari ini")
                            : tr(`decide by ${dmy(c.decide_by)}`, `putuskan sebelum ${dmy(c.decide_by)}`)}
                        </Badge>
                      </div>
                      <p className="text-[12px] text-slate-600">{c.outcome}</p>
                      <p className="text-[12px] text-slate-500">
                        {tr("would start", "perkiraan mulai")} <strong>{monthLabel(c.starts_month)}</strong>
                        {" · "}{tr("target", "target")} {dmy(c.target_date)}
                        {" · "}{tr("put together by", "disatukan oleh")} {c.owner_name}
                      </p>
                      {c.detail && <p className="text-[12px] text-slate-500">{c.detail}</p>}
                      <p className="mt-1 text-[12px] text-slate-600">
                        {c.items === 0
                          ? <span className="text-slate-400">{tr("No parts prepared yet — add them from the waiting list.", "Belum ada bagian yang disiapkan — tambahkan dari daftar tunggu.")}</span>
                          : <>{tr(`${c.items} ${c.items === 1 ? "part" : "parts"} prepared:`, `${c.items} bagian disiapkan:`)} {c.item_titles.join(" · ")}</>}
                      </p>
                    </div>
                    {mayPlan && (
                      <div className="flex flex-wrap items-center gap-1">
                        <Button size="sm" icon={Play} disabled={busy}
                          onClick={() => setDeciding({ goal_no: c.goal_no, run: true, rank: String(openRanked.length + 1), note: "" })}>
                          {tr("Run it", "Jalankan")}
                        </Button>
                        <Button size="sm" variant="ghost" icon={Pencil} disabled={busy} onClick={() => edit(c)}>{tr("Change", "Ubah")}</Button>
                        <Button size="sm" variant="ghost" icon={Ban} disabled={busy}
                          onClick={() => setDeciding({ goal_no: c.goal_no, run: false, rank: "", note: "" })}>
                          {tr("Not going ahead", "Tidak jadi")}
                        </Button>
                      </div>
                    )}
                  </div>

                  {deciding?.goal_no === c.goal_no && (
                    <div className={cn("mt-2 flex flex-wrap items-end gap-2 rounded-lg px-3 py-2",
                      deciding.run ? "bg-emerald-50" : "bg-slate-50")}>
                      {deciding.run && (
                        <label className="text-[12px] text-slate-600">
                          {tr("Place in the priority order", "Masuk ke urutan prioritas")}
                          <select value={deciding.rank} onChange={(e) => setDeciding({ ...deciding, rank: e.target.value })}
                            className="mt-1 block h-8 rounded-lg border border-slate-200 bg-white px-2 text-sm">
                            {openRanked.map((g, i) => (
                              <option key={g.goal_no} value={String(i + 1)}>
                                #{i + 1} — {tr("before", "sebelum")} {g.title}
                              </option>
                            ))}
                            <option value={String(openRanked.length + 1)}>#{openRanked.length + 1} — {tr("last", "paling bawah")}</option>
                          </select>
                        </label>
                      )}
                      <label className="min-w-0 flex-1 text-[12px] text-slate-600">
                        {deciding.run ? tr("Note (optional)", "Catatan (boleh kosong)") : tr("Why not? Required.", "Kenapa tidak jadi? Wajib.")}
                        <input value={deciding.note} onChange={(e) => setDeciding({ ...deciding, note: e.target.value })}
                          className="mt-1 block h-8 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm" />
                      </label>
                      <Button size="sm" variant={deciding.run ? "primary" : "outline"} disabled={busy || (!deciding.run && !deciding.note.trim())}
                        onClick={decide}>
                        {deciding.run ? tr("Run it", "Jalankan") : tr("Not going ahead", "Tidak jadi")}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setDeciding(null)}>{tr("Cancel", "Batal")}</Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Loaded>
    </Card>
  );
}
