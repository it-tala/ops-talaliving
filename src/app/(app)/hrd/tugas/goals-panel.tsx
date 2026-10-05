"use client";

import { useState } from "react";
import {
  ArrowDown, ArrowUp, Ban, ChevronDown, ChevronRight, Flag, Pencil, Plus, Target, Trophy,
} from "lucide-react";
import { Badge, Button, Card, CardHeader } from "@/components/ui/primitives";
import { Loaded, useLoad } from "@/components/ui/loaded";
import { GoalBoardList, GoalProgress } from "@/components/hr/goal-parts";
import { cn } from "@/lib/cn";
import { hr } from "@/demo/api";
import type { Employee, GoalView } from "@/services/hr/contracts";
import { useToast } from "@/store/toast";
import { useTr } from "@/lib/i18n";

/** Sasaran & prioritas — the level above the task (D367).
 *
 *  Built against the leader's message, 2026-10-05: *allocate work by
 *  priorities which are changing rapidly … otherwise we end up with a lot of
 *  parts but no result. we have to put the parts together.*
 *
 *  So this panel is a **ranked list of results**, not of tasks. The order is
 *  the allocation: the person holding parts of #1 and #4 knows which comes
 *  first without asking. Moving a goal up is one tap and visibly moves
 *  another down — an order cannot tie, which is why the owner chose it over
 *  priority levels. The order is sent whole; if somebody else moved it in the
 *  meantime the database refuses (`order_stale`) and this screen reloads,
 *  rather than silently undoing their move.
 */
export function GoalsPanel({
  employees, mayCreate, mayEdit, onAddPart, stamp, onChanged,
}: {
  employees: Employee[];
  mayCreate: boolean;
  mayEdit: boolean;
  /** Opens the new-task form with this goal chosen. */
  onAddPart: (goalNo: string) => void;
  /** Changes whenever tasks were written elsewhere on the page. */
  stamp: unknown;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const tr = useTr();
  const [showClosed, setShowClosed] = useState(false);
  const [goals, reload] = useLoad(() => hr.listGoals({ include_closed: showClosed }), [showClosed, stamp]);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const blank = { goal_no: null as string | null, title: "", outcome: "", owner_no: "", target_date: "", detail: "" };
  const [draft, setDraft] = useState(blank);
  const [editing, setEditing] = useState(false);

  async function save() {
    setBusy(true);
    const res = await hr.saveGoal({
      goal_no: draft.goal_no, title: draft.title, outcome: draft.outcome,
      owner_no: draft.owner_no, target_date: draft.target_date, detail: draft.detail || null,
    });
    setBusy(false);
    if (res.error) { toast("warning", tr("Not saved", "Tidak tersimpan"), res.error.message); return; }
    toast("success", res.data.goal_no,
      draft.goal_no
        ? tr("Goal updated.", "Sasaran diperbarui.")
        : tr(`Added at #${res.data.rank}. Move it up if it matters more.`, `Masuk di urutan #${res.data.rank}. Naikkan kalau lebih penting.`));
    setDraft(blank);
    setEditing(false);
    reload();
  }

  async function move(list: GoalView[], goalNo: string, dir: -1 | 1) {
    const ranked = list.filter((g) => g.status === "OPEN");
    const i = ranked.findIndex((g) => g.goal_no === goalNo);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ranked.length) return;
    const order = ranked.map((g) => g.goal_no);
    [order[i], order[j]] = [order[j], order[i]];
    setBusy(true);
    const res = await hr.rankGoals({ goal_nos: order });
    setBusy(false);
    if (res.error) {
      toast("warning", tr("Order not saved", "Urutan tidak tersimpan"), res.error.message);
      reload();
      return;
    }
    reload();
    onChanged();
  }

  async function close(g: GoalView, action: "done" | "cancel") {
    const note = window.prompt(
      action === "done"
        ? tr(`"${g.title}" reached?\n\nWhat was the result? (optional)`, `"${g.title}" tercapai?\n\nHasilnya apa? (boleh kosong)`)
        : tr(`Cancel "${g.title}"?\n\nWhy? Required.`, `Batalkan "${g.title}"?\n\nKenapa? Wajib diisi.`),
      "",
    );
    if (note === null) return;
    setBusy(true);
    const res = await hr.closeGoal({ goal_no: g.goal_no, action, note });
    setBusy(false);
    if (res.error) { toast("warning", tr("Not closed", "Tidak ditutup"), res.error.message); return; }
    toast("success", g.goal_no, action === "done" ? tr("Reached.", "Tercapai.") : tr("Cancelled.", "Dibatalkan."));
    reload();
    onChanged();
  }

  const active = employees.filter((e) => e.active);

  return (
    <div>
      <p className="mb-3 rounded-xl border border-slate-200 bg-slate-50/70 px-4 py-3 text-[13px] text-slate-700">
        {tr(
          "A goal is a result several tasks are parts of. The order below is the priority: #1 first. Every person with a part in a goal sees all its parts on their profile — who holds what, and what waits on what — so the parts can be put together.",
          "Sasaran adalah satu hasil yang disusun dari beberapa tugas. Urutan di bawah adalah prioritasnya: #1 lebih dulu. Setiap orang yang memegang bagian dari sebuah sasaran melihat semua bagiannya di profilnya — siapa memegang apa, dan apa menunggu apa — supaya bagian-bagian itu bisa disatukan.",
        )}
      </p>

      <div className="mb-3 flex flex-wrap items-center justify-end gap-2">
        <label className="mr-auto flex items-center gap-1.5 text-[12px] text-slate-600">
          <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} />
          {tr("Show closed goals", "Tampilkan sasaran yang sudah ditutup")}
        </label>
        {mayCreate && (
          <Button size="sm" onClick={() => { setDraft(blank); setEditing((v) => !v); }}>
            <Plus className="h-4 w-4" /> {tr("New goal", "Sasaran baru")}
          </Button>
        )}
      </div>

      {editing && (
        <Card className="mb-4">
          <CardHeader
            title={draft.goal_no ? tr(`Change ${draft.goal_no}`, `Ubah ${draft.goal_no}`) : tr("New goal", "Sasaran baru")}
            subtitle={tr(
              "A new goal joins the bottom of the order. Putting it first is a decision — made with the arrows, where it visibly moves the others down.",
              "Sasaran baru masuk di urutan paling bawah. Menaruhnya paling atas adalah keputusan — dibuat dengan tanda panah, yang terlihat menurunkan sasaran lain.",
            )}
            icon={Target}
          />
          <div className="grid gap-3 px-5 py-4 sm:grid-cols-2">
            <label className="text-[12px] text-slate-600 sm:col-span-2">
              {tr("The goal", "Sasarannya")}
              <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                placeholder={tr("Hotel order — 40 dining chairs ready for production", "Pesanan hotel — 40 kursi makan siap produksi")}
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm" />
            </label>
            <label className="text-[12px] text-slate-600 sm:col-span-2">
              {tr("What it looks like when it is reached", "Seperti apa kalau sudah tercapai")}
              <input value={draft.outcome} onChange={(e) => setDraft({ ...draft, outcome: e.target.value })}
                placeholder={tr("Materials on the rack and the deposit paid, so the Job Order can start", "Bahan lengkap di rak dan DP vendor terbayar, sehingga Job Order bisa dimulai")}
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm" />
              <span className="mt-0.5 block text-[11px] text-slate-400">
                {tr("Without this, every part can be finished and there is still no result.", "Tanpa ini, semua bagian bisa selesai dan tetap tidak ada hasilnya.")}
              </span>
            </label>
            <label className="text-[12px] text-slate-600">
              {tr("Who puts the parts together", "Siapa yang menyatukan bagian-bagiannya")}
              <select value={draft.owner_no} onChange={(e) => setDraft({ ...draft, owner_no: e.target.value })}
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm">
                <option value="">{tr("— choose —", "— pilih —")}</option>
                {active.map((e) => <option key={e.employee_no} value={e.employee_no}>{e.full_name} · {e.employee_no}</option>)}
              </select>
            </label>
            <label className="text-[12px] text-slate-600">
              {tr("Target date", "Target tanggal")}
              <input type="date" value={draft.target_date} onChange={(e) => setDraft({ ...draft, target_date: e.target.value })}
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm" />
            </label>
            <label className="text-[12px] text-slate-600 sm:col-span-2">
              {tr("Notes (optional)", "Catatan (boleh kosong)")}
              <input value={draft.detail} onChange={(e) => setDraft({ ...draft, detail: e.target.value })}
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm" />
            </label>
          </div>
          <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
            <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setDraft(blank); }}>{tr("Cancel", "Batal")}</Button>
            <Button size="sm" onClick={save}
              disabled={busy || !draft.title || !draft.outcome || !draft.owner_no || !draft.target_date}>
              {tr("Save", "Simpan")}
            </Button>
          </div>
        </Card>
      )}

      <Loaded state={goals} onRetry={reload}>
        {(list) => list.length === 0 ? (
          <Card><p className="px-5 py-8 text-center text-sm text-slate-500">
            {tr(
              "No goals yet. Start with the result that matters most this week, and add its parts as tasks.",
              "Belum ada sasaran. Mulai dari hasil yang paling penting minggu ini, lalu tambahkan bagian-bagiannya sebagai tugas.",
            )}
          </p></Card>
        ) : (
          <div className="space-y-3">
            {list.map((g, idx) => {
              const ranked = g.status === "OPEN";
              const lastRanked = list.filter((x) => x.status === "OPEN").length - 1;
              return (
                <Card key={g.goal_no} className={cn(!ranked && "opacity-80")}>
                  <div className="flex gap-3 px-5 py-4">
                    <div className="flex w-10 shrink-0 flex-col items-center">
                      {ranked ? (
                        <span className="text-xl font-semibold text-slate-800">#{g.rank}</span>
                      ) : g.status === "DONE" ? (
                        <Trophy className="h-5 w-5 text-emerald-600" />
                      ) : (
                        <Ban className="h-5 w-5 text-slate-400" />
                      )}
                      {ranked && mayEdit && (
                        <div className="mt-1 flex flex-col">
                          <button aria-label={tr("Move up", "Naikkan")} disabled={busy || idx === 0}
                            onClick={() => move(list, g.goal_no, -1)}
                            className="rounded p-0.5 text-slate-500 hover:bg-slate-100 disabled:opacity-30">
                            <ArrowUp className="h-4 w-4" />
                          </button>
                          <button aria-label={tr("Move down", "Turunkan")} disabled={busy || idx === lastRanked}
                            onClick={() => move(list, g.goal_no, 1)}
                            className="rounded p-0.5 text-slate-500 hover:bg-slate-100 disabled:opacity-30">
                            <ArrowDown className="h-4 w-4" />
                          </button>
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-start gap-x-2 gap-y-1">
                        <p className="text-[15px] font-semibold text-slate-800">{g.title}</p>
                        {g.late && <Badge tone="red">{tr(`target passed ${-g.days_left} days ago`, `lewat target ${-g.days_left} hari`)}</Badge>}
                        {g.status === "DONE" && <Badge tone="green">{tr("reached", "tercapai")}</Badge>}
                        {g.status === "CANCELLED" && <Badge tone="slate">{tr("cancelled", "dibatalkan")}</Badge>}
                      </div>
                      <p className="mt-0.5 text-[13px] text-slate-600">
                        <Flag className="mr-1 inline h-3.5 w-3.5 text-slate-400" />{g.outcome}
                      </p>
                      <p className="mt-0.5 text-[12px] text-slate-500">
                        <span className="font-mono text-[11px]">{g.goal_no}</span>
                        {" · "}{tr("put together by", "disatukan oleh")} <strong className="font-medium">{g.owner_name}</strong>
                        {" · "}{tr("target", "target")} {g.target_date}
                        {ranked && !g.late && <span className="text-slate-400">{tr(` (${g.days_left} days left)`, ` (${g.days_left} hari lagi)`)}</span>}
                      </p>
                      {g.detail && <p className="mt-0.5 text-[12px] text-slate-500">{g.detail}</p>}
                      {g.closed_note && <p className="mt-0.5 text-[12px] text-slate-500">{g.closed_note}</p>}
                      <div className="mt-2"><GoalProgress g={g} /></div>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1 border-t border-slate-100 px-5 py-2">
                    <Button size="sm" variant="ghost" onClick={() => setOpen(open === g.goal_no ? null : g.goal_no)}>
                      {open === g.goal_no ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      {tr("Parts", "Bagian-bagiannya")}
                    </Button>
                    <span className="ml-auto" />
                    {ranked && mayCreate && (
                      <Button size="sm" variant="ghost" onClick={() => onAddPart(g.goal_no)} disabled={busy}>
                        <Plus className="h-4 w-4" /> {tr("Add a part", "Tambah bagian")}
                      </Button>
                    )}
                    {ranked && mayEdit && (
                      <>
                        <Button size="sm" variant="ghost" disabled={busy}
                          onClick={() => {
                            setDraft({ goal_no: g.goal_no, title: g.title, outcome: g.outcome, owner_no: g.owner_no,
                                       target_date: g.target_date, detail: g.detail ?? "" });
                            setEditing(true);
                            window.scrollTo({ top: 0, behavior: "smooth" });
                          }}>
                          <Pencil className="h-4 w-4" /> {tr("Change", "Ubah")}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => close(g, "done")} disabled={busy}>
                          <Trophy className="h-4 w-4" /> {tr("Reached", "Tercapai")}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => close(g, "cancel")} disabled={busy}>
                          <Ban className="h-4 w-4" /> {tr("Cancel", "Batalkan")}
                        </Button>
                      </>
                    )}
                  </div>
                  {open === g.goal_no && (
                    <div className="border-t border-slate-100">
                      <GoalBoardList goalNo={g.goal_no} stamp={stamp} />
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </Loaded>
    </div>
  );
}
