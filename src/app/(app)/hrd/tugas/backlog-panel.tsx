"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Ban, Check, Inbox, Lightbulb, Pencil, Plus, Target, UserPlus } from "lucide-react";
import { Badge, Button, Card, CardHeader } from "@/components/ui/primitives";
import { Loaded, useLoad } from "@/components/ui/loaded";
import { cn } from "@/lib/cn";
import { officeToday } from "@/lib/office";
import { hr } from "@/demo/api";
import type { BacklogItem, Employee, GoalView } from "@/services/hr/contracts";
import { useToast } from "@/store/toast";
import { useTr } from "@/lib/i18n";

/** Daftar tunggu — work that is known, not urgent, and has nobody yet (D381).
 *
 *  The owner: *dikumpulkan sebagai daftar tugas, nantinya di-assign ketika ada
 *  resource-nya.* So an item has no person and no due date — nobody is late on
 *  it and it is in nobody's score — and an order, so whoever comes free next
 *  takes the top one. *Tugaskan* picks **one person** (a task is never given
 *  to a team) and a due date, and from then it is an ordinary task.
 *
 *  Staff may propose items; a proposal waits at the top for an answer. The
 *  bidang is a filter, not an assignee: it narrows the list to what somebody
 *  in that field could pick up.
 *
 *  Items can be picked and put into a goal or a candidate together, new or
 *  existing (D393): a December project is often first a handful of things
 *  already on this list.
 */
export function BacklogPanel({
  employees, goals, mayCreate, mayEdit, mayPlan, onChanged,
}: {
  employees: Employee[];
  goals: GoalView[];
  mayCreate: boolean;
  mayEdit: boolean;
  /** HRD at update or pimpinan: may put items into goals and candidates. */
  mayPlan: boolean;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const tr = useTr();
  const [showClosed, setShowClosed] = useState(false);
  const [items, reload] = useLoad(() => hr.listBacklog({ include_closed: showClosed }), [showClosed]);
  const [unit, setUnit] = useState("");
  const [busy, setBusy] = useState(false);
  const blank = { item_no: null as string | null, title: "", deliverable: "", unit: "", goal_no: "", detail: "" };
  const [draft, setDraft] = useState(blank);
  const [editing, setEditing] = useState(false);
  const [giving, setGiving] = useState<{ item_no: string; assignee_no: string; due: string; chase: string } | null>(null);
  const [dropping, setDropping] = useState<{ item_no: string; reason: string } | null>(null);
  /* Candidates are listed apart from goals (D393); a reader who may not see
     them simply gets none. */
  const [cands, reloadCands] = useLoad(() => hr.listCandidateGoals(), []);
  const candidates = cands.status === "ready" ? cands.data : [];
  const candidateNos = new Set(candidates.map((c) => c.goal_no));
  const [picked, setPicked] = useState<string[]>([]);
  const [into, setInto] = useState("");
  const blankGoal = { kind: "CANDIDATE" as "CANDIDATE" | "OPEN", title: "", outcome: "", owner_no: "",
                      target_date: "", decide_by: "", starts_month: "" };
  const [newGoal, setNewGoal] = useState<typeof blankGoal | null>(null);

  const all = items.status === "ready" ? items.data : [];
  const units = Array.from(new Set([
    ...employees.filter((e) => e.active).map((e) => e.unit).filter(Boolean),
    ...all.map((b) => b.unit).filter((u): u is string => Boolean(u)),
  ])).sort();
  const listUnits = Array.from(new Set(all.filter((b) => b.unit).map((b) => b.unit as string))).sort();

  async function save() {
    setBusy(true);
    const res = await hr.saveBacklogItem({
      item_no: draft.item_no, title: draft.title, deliverable: draft.deliverable || null,
      unit: draft.unit || null, goal_no: draft.goal_no || null, detail: draft.detail || null,
    });
    setBusy(false);
    if (res.error) { toast("warning", tr("Not saved", "Tidak tersimpan"), res.error.message); return; }
    toast("success", res.data.item_no, draft.item_no
      ? tr("Item updated.", "Item diperbarui.")
      : tr(`Added to the list at #${res.data.position}.`, `Masuk daftar di urutan #${res.data.position}.`));
    setDraft(blank); setEditing(false);
    reload();
  }

  async function move(b: BacklogItem, dir: -1 | 1) {
    const open = all.filter((x) => x.status === "OPEN");
    const order = open.map((x) => x.item_no);
    const i = order.indexOf(b.item_no);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    setBusy(true);
    const res = await hr.rankBacklog({ item_nos: order });
    setBusy(false);
    if (res.error) { toast("warning", tr("Order not saved", "Urutan tidak tersimpan"), res.error.message); }
    reload();
  }

  async function accept(b: BacklogItem) {
    setBusy(true);
    const res = await hr.acceptBacklogItem({ item_no: b.item_no });
    setBusy(false);
    if (res.error) { toast("warning", tr("Not accepted", "Tidak diterima"), res.error.message); return; }
    toast("success", b.item_no, tr(`On the list at #${res.data.position}. ${b.created_by_name} is told.`,
      `Masuk daftar di urutan #${res.data.position}. ${b.created_by_name} diberi tahu.`));
    reload();
  }

  async function drop() {
    if (!dropping) return;
    setBusy(true);
    const res = await hr.dropBacklogItem({ item_no: dropping.item_no, reason: dropping.reason });
    setBusy(false);
    if (res.error) { toast("warning", tr("Not removed", "Tidak dikeluarkan"), res.error.message); return; }
    toast("success", dropping.item_no, tr("Taken off the list.", "Dikeluarkan dari daftar."));
    setDropping(null);
    reload();
  }

  async function give() {
    if (!giving) return;
    setBusy(true);
    const res = await hr.assignBacklogItem({
      item_no: giving.item_no, assignee_no: giving.assignee_no, due_date: giving.due, chase_date: giving.chase || null,
    });
    setBusy(false);
    if (res.error) { toast("warning", tr("Not assigned", "Tidak ditugaskan"), res.error.message); return; }
    toast("success", res.data.task_no, tr(`Now a task for ${res.data.assignee_name}, who is notified.`,
      `Sekarang tugas untuk ${res.data.assignee_name}, dan ia diberi tahu.`));
    setGiving(null);
    reload(); onChanged();
  }

  function togglePick(itemNo: string) {
    setPicked((p) => (p.includes(itemNo) ? p.filter((x) => x !== itemNo) : [...p, itemNo]));
  }

  async function attachTo(goalNo: string) {
    const res = await hr.attachBacklogToGoal({ item_nos: picked, goal_no: goalNo });
    if (res.error) { toast("warning", tr("Not put in", "Tidak dimasukkan"), res.error.message); return false; }
    toast("success", goalNo, tr(`${res.data.attached} item(s) are now parts of it. They stay on the waiting list until assigned.`,
      `${res.data.attached} item sekarang bagian darinya. Item tetap di daftar tunggu sampai ditugaskan.`));
    setPicked([]); setInto(""); setNewGoal(null);
    reload(); reloadCands(); onChanged();
    return true;
  }

  async function attach() {
    if (!into) return;
    setBusy(true);
    await attachTo(into);
    setBusy(false);
  }

  /* A new goal or candidate made from the picked items: saved, then the
     items put into it. Two calls — if the second is refused the goal stays,
     and the toast says why. */
  async function createAndAttach() {
    if (!newGoal) return;
    setBusy(true);
    const res = newGoal.kind === "CANDIDATE"
      ? await hr.saveCandidateGoal({
          title: newGoal.title, outcome: newGoal.outcome, owner_no: newGoal.owner_no,
          target_date: newGoal.target_date, decide_by: newGoal.decide_by,
          starts_month: newGoal.starts_month ? `${newGoal.starts_month}-01` : null,
        })
      : await hr.saveGoal({
          title: newGoal.title, outcome: newGoal.outcome, owner_no: newGoal.owner_no,
          target_date: newGoal.target_date,
        });
    if (res.error) {
      setBusy(false);
      toast("warning", tr("Not saved", "Tidak tersimpan"), res.error.message);
      return;
    }
    await attachTo(res.data.goal_no);
    setBusy(false);
  }

  function edit(b: BacklogItem) {
    setDraft({ item_no: b.item_no, title: b.title, deliverable: b.deliverable ?? "", unit: b.unit ?? "",
               goal_no: b.goal_open || candidateNos.has(b.goal_no ?? "") ? b.goal_no ?? "" : "",
               detail: b.detail ?? "" });
    setEditing(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /* People for *Tugaskan*: those in the item's field first, then everybody
     else — a hint, never a rule, because fields and units do not line up
     one to one. */
  function peopleFor(b: BacklogItem) {
    const active = employees.filter((e) => e.active);
    const match = (e: Employee) => fits(e, b.unit);
    return [...active.filter(match), ...active.filter((e) => !match(e))];
  }
  /* Whole words only: "IT" must not match "Kitchen" or "Quality". */
  function fits(e: Employee, unit: string | null) {
    const want = (unit ?? "").trim().toLowerCase();
    if (!want) return false;
    const words = `${e.unit} ${e.position}`.toLowerCase().split(/[^a-z0-9]+/);
    return e.unit.toLowerCase() === want || want.split(/\s+/).every((w) => words.includes(w));
  }

  const field = (label: string, node: React.ReactNode, wide = false) => (
    <label className={cn("text-[12px] text-slate-600", wide && "sm:col-span-2")}>{label}{node}</label>
  );
  const input = "mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm";

  return (
    <div>
      <p className="mb-3 rounded-xl border border-slate-200 bg-slate-50/70 px-4 py-3 text-[13px] text-slate-700">
        {tr(
          "Work that is known and not urgent, waiting for somebody to come free. An item has no person and no due date, so nobody is late on it and it counts in nobody's score. When someone is free, take the top item for their field and press Assign: one person, a due date, and it becomes an ordinary task. Staff can propose items; proposals wait at the top for your answer.",
          "Pekerjaan yang sudah diketahui dan tidak mendesak, menunggu ada orang yang longgar. Item belum punya orang dan jatuh tempo, jadi tidak ada yang terlambat dan tidak masuk nilai siapa pun. Saat ada yang longgar, ambil item teratas untuk bidangnya lalu tekan Tugaskan: satu orang, jatuh tempo, dan item menjadi tugas biasa. Staf bisa mengusulkan item; usulan menunggu jawaban Anda di bagian atas.",
        )}
      </p>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-[12px] text-slate-500">{tr("Field", "Bidang")}</span>
        {["", ...listUnits].map((u) => (
          <button key={u || "all"} onClick={() => setUnit(u)}
            className={cn("h-7 rounded-full px-3 text-[12px] font-medium",
              unit === u ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200")}>
            {u || tr("All", "Semua")}
          </button>
        ))}
        <label className="ml-auto flex items-center gap-1.5 text-[12px] text-slate-600">
          <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} />
          {tr("Show assigned and removed", "Tampilkan yang sudah ditugaskan dan dikeluarkan")}
        </label>
        {mayCreate && !editing && (
          <Button size="sm" icon={Plus} onClick={() => { setDraft(blank); setEditing(true); }}>
            {tr("New item", "Item baru")}
          </Button>
        )}
      </div>

      {editing && (
        <Card className="mb-4">
          <CardHeader title={draft.item_no ? tr(`Change ${draft.item_no}`, `Ubah ${draft.item_no}`) : tr("New item", "Item baru")}
            subtitle={tr("No person and no due date — those are chosen when it is assigned.",
                         "Tanpa orang dan jatuh tempo — keduanya dipilih saat ditugaskan.")}
            icon={Inbox} />
          <div className="grid gap-3 px-5 py-4 sm:grid-cols-2">
            {field(tr("What is the work", "Pekerjaannya apa"),
              <input id="blg-title" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} className={input} />, true)}
            {field(tr("What must be handed over", "Yang harus diserahkan"),
              <input id="blg-deliverable" value={draft.deliverable} onChange={(e) => setDraft({ ...draft, deliverable: e.target.value })}
                placeholder={tr("e.g. a page in ops, an Excel file sent to the leader", "mis. halaman di ops, file Excel dikirim ke pimpinan")}
                className={input} />, true)}
            {field(tr("Field", "Bidang"),
              <>
                <input id="blg-unit" list="blg-units" value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value })}
                  placeholder="IT, Drafting, Procurement…" className={input} />
                <datalist id="blg-units">{units.map((u) => <option key={u} value={u} />)}</datalist>
              </>)}
            {field(tr("Part of goal (optional)", "Bagian dari sasaran (boleh kosong)"),
              <select id="blg-goal" value={draft.goal_no} onChange={(e) => setDraft({ ...draft, goal_no: e.target.value })} className={input}>
                <option value="">{tr("— none —", "— tidak ada —")}</option>
                {goals.map((g) => <option key={g.goal_no} value={g.goal_no}>#{g.rank} · {g.title}</option>)}
                {candidates.length > 0 && (
                  <optgroup label={tr("Candidates — not decided yet", "Kandidat — belum diputuskan")}>
                    {candidates.map((c) => <option key={c.goal_no} value={c.goal_no}>{tr("candidate", "kandidat")} · {c.title}</option>)}
                  </optgroup>
                )}
              </select>)}
            {field(tr("Notes (optional)", "Catatan (boleh kosong)"),
              <textarea id="blg-detail" value={draft.detail} rows={2} onChange={(e) => setDraft({ ...draft, detail: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm" />, true)}
          </div>
          <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
            <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setDraft(blank); }}>{tr("Cancel", "Batal")}</Button>
            <Button size="sm" onClick={save} disabled={busy || !draft.title.trim()}>{tr("Save", "Simpan")}</Button>
          </div>
        </Card>
      )}

      <Loaded state={items} onRetry={reload}>
        {(list) => {
          const shown = list.filter((b) => !unit || b.unit === unit);
          const proposals = shown.filter((b) => b.status === "PROPOSED");
          const open = shown.filter((b) => b.status === "OPEN");
          const closed = shown.filter((b) => b.status === "ASSIGNED" || b.status === "DROPPED");
          const openAll = list.filter((b) => b.status === "OPEN");

          const line = (b: BacklogItem) => (
            <li key={b.item_no} className="px-5 py-3">
              <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
                {b.status === "OPEN" && mayPlan && (
                  <input type="checkbox" checked={picked.includes(b.item_no)} onChange={() => togglePick(b.item_no)}
                    aria-label={tr(`Pick ${b.item_no}`, `Pilih ${b.item_no}`)} className="mt-1" />
                )}
                {b.status === "OPEN" && (
                  <span className="mt-0.5 font-mono text-[13px] font-semibold text-slate-500">#{b.position}</span>
                )}
                <div className="min-w-[12rem] flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-medium text-slate-800">{b.title}</span>
                    {b.unit && <Badge tone="slate">{b.unit}</Badge>}
                    {b.goal_title && (candidateNos.has(b.goal_no ?? "")
                      ? <Badge tone="violet">{tr("candidate", "kandidat")} · {b.goal_title}</Badge>
                      : <Badge tone="brand">{b.goal_rank !== null ? `#${b.goal_rank} · ` : ""}{b.goal_title}</Badge>)}
                    {b.status === "PROPOSED" && <Badge tone="amber">{tr("proposal", "usulan")}</Badge>}
                    {b.status === "ASSIGNED" && <Badge tone="green">{tr("assigned", "ditugaskan")}</Badge>}
                    {b.status === "DROPPED" && <Badge tone="slate">{tr("removed", "dikeluarkan")}</Badge>}
                  </div>
                  {b.deliverable && (
                    <p className="text-[12px] text-slate-600">{tr("hand over:", "diserahkan:")} {b.deliverable}</p>
                  )}
                  {b.detail && <p className="text-[12px] text-slate-500">{b.detail}</p>}
                  <p className="font-mono text-[11px] text-slate-400">
                    {b.item_no} · {b.proposed ? tr("proposed by", "diusulkan") : tr("added by", "ditambah")} {b.created_by_name}
                    {b.task_no && <> · {tr("task", "tugas")} {b.task_no} → {b.assignee_name}</>}
                  </p>
                  {b.dropped_reason && <p className="text-[12px] text-slate-500">{tr("Why:", "Alasan:")} {b.dropped_reason}</p>}
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  {b.status === "PROPOSED" && mayEdit && (
                    <Button size="sm" icon={Check} disabled={busy} onClick={() => accept(b)}>{tr("Accept", "Terima")}</Button>
                  )}
                  {b.status === "OPEN" && mayEdit && !unit && (
                    <>
                      <Button size="sm" variant="ghost" icon={ArrowUp} disabled={busy || b.position === 1}
                        onClick={() => move(b, -1)} aria-label={tr("Move up", "Naikkan")} title={tr("Move up", "Naikkan")}><span className="sr-only">{tr("Move up", "Naikkan")}</span></Button>
                      <Button size="sm" variant="ghost" icon={ArrowDown} disabled={busy || b.position === openAll.length}
                        onClick={() => move(b, 1)} aria-label={tr("Move down", "Turunkan")} title={tr("Move down", "Turunkan")}><span className="sr-only">{tr("Move down", "Turunkan")}</span></Button>
                    </>
                  )}
                  {b.status === "OPEN" && mayCreate && (
                    <Button size="sm" icon={UserPlus} disabled={busy}
                      onClick={() => setGiving({ item_no: b.item_no, assignee_no: employees.find((e) => e.active && fits(e, b.unit))?.employee_no ?? "", due: officeToday(), chase: "" })}>
                      {tr("Assign", "Tugaskan")}
                    </Button>
                  )}
                  {(b.status === "OPEN" || b.status === "PROPOSED") && mayEdit && (
                    <>
                      <Button size="sm" variant="ghost" icon={Pencil} disabled={busy} onClick={() => edit(b)}>{tr("Change", "Ubah")}</Button>
                      <Button size="sm" variant="ghost" icon={Ban} disabled={busy}
                        onClick={() => setDropping({ item_no: b.item_no, reason: "" })}>{tr("Remove", "Keluarkan")}</Button>
                    </>
                  )}
                </div>
              </div>

              {giving?.item_no === b.item_no && (
                <div className="mt-2 flex flex-wrap items-end gap-2 rounded-lg bg-slate-50 px-3 py-2">
                  <label className="text-[12px] text-slate-600">
                    {tr("For whom (one person)", "Untuk siapa (satu orang)")}
                    <select value={giving.assignee_no} onChange={(e) => setGiving({ ...giving, assignee_no: e.target.value })}
                      className="mt-1 block h-8 rounded-lg border border-slate-200 bg-white px-2 text-sm">
                      <option value="">{tr("— choose —", "— pilih —")}</option>
                      {peopleFor(b).map((e) => (
                        <option key={e.employee_no} value={e.employee_no}>{e.full_name} · {e.position}</option>
                      ))}
                    </select>
                  </label>
                  <label className="text-[12px] text-slate-600">
                    {tr("Due", "Jatuh tempo")}
                    <input type="date" value={giving.due} min={officeToday()} onChange={(e) => setGiving({ ...giving, due: e.target.value })}
                      className="mt-1 block h-8 rounded-lg border border-slate-200 bg-white px-2 text-sm" />
                  </label>
                  <label className="text-[12px] text-slate-600">
                    {tr("Chase on (optional)", "Ditagih (boleh kosong)")}
                    <input type="date" value={giving.chase} min={officeToday()} max={giving.due}
                      onChange={(e) => setGiving({ ...giving, chase: e.target.value })}
                      className="mt-1 block h-8 rounded-lg border border-slate-200 bg-white px-2 text-sm" />
                  </label>
                  <Button size="sm" disabled={busy || !giving.assignee_no || !giving.due} onClick={give}>{tr("Make it a task", "Jadikan tugas")}</Button>
                  <Button size="sm" variant="ghost" onClick={() => setGiving(null)}>{tr("Cancel", "Batal")}</Button>
                </div>
              )}

              {dropping?.item_no === b.item_no && (
                <div className="mt-2 flex flex-wrap items-end gap-2 rounded-lg bg-slate-50 px-3 py-2">
                  <label className="min-w-0 flex-1 text-[12px] text-slate-600">
                    {tr("Why is it removed? The proposer reads this.", "Kenapa dikeluarkan? Pengusul membaca alasan ini.")}
                    <input value={dropping.reason} onChange={(e) => setDropping({ ...dropping, reason: e.target.value })}
                      className="mt-1 block h-8 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm" />
                  </label>
                  <Button size="sm" variant="outline" disabled={busy || !dropping.reason.trim()} onClick={drop}>{tr("Remove", "Keluarkan")}</Button>
                  <Button size="sm" variant="ghost" onClick={() => setDropping(null)}>{tr("Cancel", "Batal")}</Button>
                </div>
              )}
            </li>
          );

          return (
            <div className="space-y-4">
              {proposals.length > 0 && (
                <Card>
                  <CardHeader title={tr(`Proposals waiting for an answer (${proposals.length})`, `Usulan menunggu jawaban (${proposals.length})`)}
                    subtitle={tr("Accept puts it at the bottom of the list; remove needs a reason, which the proposer reads.",
                                 "Terima menaruhnya di urutan paling bawah; Keluarkan wajib alasan, yang dibaca pengusulnya.")}
                    icon={Inbox} />
                  <ul className="divide-y divide-slate-100">{proposals.map(line)}</ul>
                </Card>
              )}
              {picked.length > 0 && (
                <Card className="z-10 border-brand-200 bg-brand-50/60 sm:sticky sm:top-2">
                  <div className="flex flex-wrap items-end gap-2 px-5 py-3">
                    <p className="w-full text-[13px] font-medium text-slate-800">
                      {tr(`${picked.length} item(s) picked`, `${picked.length} item dipilih`)}
                      <span className="ml-2 font-mono text-[11px] font-normal text-slate-500">{picked.join(", ")}</span>
                    </p>
                    <label className="min-w-[220px] flex-1 text-[12px] text-slate-600">
                      {tr("Put into", "Masukkan ke")}
                      <select id="blg-into" value={into} onChange={(e) => setInto(e.target.value)}
                        className="mt-1 block h-8 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm">
                        <option value="">{tr("— choose a goal or candidate —", "— pilih sasaran atau kandidat —")}</option>
                        {goals.length > 0 && (
                          <optgroup label={tr("Goals in progress", "Sasaran berjalan")}>
                            {goals.map((g) => <option key={g.goal_no} value={g.goal_no}>#{g.rank} · {g.title}</option>)}
                          </optgroup>
                        )}
                        {candidates.length > 0 && (
                          <optgroup label={tr("Candidates — not decided yet", "Kandidat — belum diputuskan")}>
                            {candidates.map((c) => <option key={c.goal_no} value={c.goal_no}>{c.title}</option>)}
                          </optgroup>
                        )}
                      </select>
                    </label>
                    <Button size="sm" icon={Target} disabled={busy || !into} onClick={attach}>{tr("Put in", "Masukkan")}</Button>
                    <span className="text-[12px] text-slate-400">{tr("or", "atau")}</span>
                    <Button size="sm" variant="outline" icon={Lightbulb} disabled={busy}
                      onClick={() => setNewGoal(newGoal ? null : { ...blankGoal })}>
                      {tr("Make a new one from these", "Buat baru dari pilihan ini")}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => { setPicked([]); setNewGoal(null); setInto(""); }}>
                      {tr("Clear", "Batal pilih")}
                    </Button>
                  </div>
                  {newGoal && (
                    <div className="grid gap-3 border-t border-brand-100 px-5 py-3 sm:grid-cols-2">
                      <div className="flex flex-wrap gap-1.5 sm:col-span-2">
                        {([["CANDIDATE", tr("Candidate — may or may not happen", "Kandidat — mungkin jalan, mungkin tidak")],
                           ...(mayEdit ? [["OPEN", tr("Goal — starts now, ranked last", "Sasaran — berjalan sekarang, di urutan terakhir")]] : [])] as const)
                          .map(([k, label]) => (
                            <button key={k} type="button" onClick={() => setNewGoal({ ...newGoal, kind: k as "CANDIDATE" | "OPEN" })}
                              className={cn("h-7 rounded-full px-3 text-[12px] font-medium",
                                newGoal.kind === k ? "bg-slate-800 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100")}>
                              {label}
                            </button>
                          ))}
                      </div>
                      {field(tr("Name", "Nama"),
                        <input id="blg-new-title" value={newGoal.title} onChange={(e) => setNewGoal({ ...newGoal, title: e.target.value })}
                          placeholder={tr("e.g. December furniture fair", "mis. Pameran furnitur Desember")} className={input} />)}
                      {field(tr("Result — what done looks like", "Hasil — seperti apa kalau selesai"),
                        <input id="blg-new-outcome" value={newGoal.outcome} onChange={(e) => setNewGoal({ ...newGoal, outcome: e.target.value })} className={input} />)}
                      {field(tr("Owner", "Penanggung jawab"),
                        <select id="blg-new-owner" value={newGoal.owner_no} onChange={(e) => setNewGoal({ ...newGoal, owner_no: e.target.value })} className={input}>
                          <option value="">{tr("— choose —", "— pilih —")}</option>
                          {employees.filter((e) => e.active).map((e) => (
                            <option key={e.employee_no} value={e.employee_no}>{e.full_name} · {e.position}</option>
                          ))}
                        </select>)}
                      {field(tr("Target date", "Tanggal target"),
                        <input id="blg-new-target" type="date" value={newGoal.target_date} min={officeToday()}
                          onChange={(e) => setNewGoal({ ...newGoal, target_date: e.target.value })} className={input} />)}
                      {newGoal.kind === "CANDIDATE" && (
                        <>
                          {field(tr("Would start in (month, optional)", "Perkiraan mulai (bulan, boleh kosong)"),
                            <input id="blg-new-month" type="month" value={newGoal.starts_month}
                              onChange={(e) => setNewGoal({ ...newGoal, starts_month: e.target.value })} className={input} />)}
                          {field(tr("Decide by", "Diputuskan paling lambat"),
                            <input id="blg-new-decide" type="date" value={newGoal.decide_by} min={officeToday()}
                              max={newGoal.target_date || undefined}
                              onChange={(e) => setNewGoal({ ...newGoal, decide_by: e.target.value })} className={input} />)}
                        </>
                      )}
                      <div className="flex justify-end gap-2 sm:col-span-2">
                        <Button size="sm" variant="ghost" onClick={() => setNewGoal(null)}>{tr("Cancel", "Batal")}</Button>
                        <Button size="sm" onClick={createAndAttach}
                          disabled={busy || !newGoal.title.trim() || !newGoal.outcome.trim() || !newGoal.owner_no
                            || !newGoal.target_date || (newGoal.kind === "CANDIDATE" && !newGoal.decide_by)}>
                          {newGoal.kind === "CANDIDATE"
                            ? tr(`Save candidate with ${picked.length} item(s)`, `Simpan kandidat dengan ${picked.length} item`)
                            : tr(`Save goal with ${picked.length} item(s)`, `Simpan sasaran dengan ${picked.length} item`)}
                        </Button>
                      </div>
                    </div>
                  )}
                </Card>
              )}
              <Card>
                <CardHeader
                  title={tr(`Waiting list (${open.length})`, `Daftar tunggu (${open.length})`)}
                  subtitle={unit
                    ? tr(`Only ${unit}. Clear the field filter to change the order.`, `Hanya ${unit}. Hapus saringan bidang untuk mengubah urutan.`)
                    : tr("Top first: whoever comes free takes the highest item for their field.",
                         "Teratas lebih dulu: siapa pun yang longgar mengambil item tertinggi untuk bidangnya.")}
                  icon={Inbox} />
                {open.length === 0 ? (
                  <p className="px-5 py-6 text-center text-sm text-slate-500">
                    {tr("Nothing waiting. Add an item when work is known but not urgent.",
                        "Tidak ada yang menunggu. Tambahkan item saat ada pekerjaan yang sudah diketahui tapi belum mendesak.")}
                  </p>
                ) : (
                  <ul className="divide-y divide-slate-100">{open.map(line)}</ul>
                )}
              </Card>
              {showClosed && closed.length > 0 && (
                <Card>
                  <CardHeader title={tr("Left the list", "Sudah keluar dari daftar")} icon={Check} />
                  <ul className="divide-y divide-slate-100">{closed.map(line)}</ul>
                </Card>
              )}
            </div>
          );
        }}
      </Loaded>
    </div>
  );
}
