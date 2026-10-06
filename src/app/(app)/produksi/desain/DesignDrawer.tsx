"use client";

import { useState } from "react";
import { PencilRuler, Upload, Send, Check, MessageCircleQuestion, Hammer } from "lucide-react";
import { Drawer } from "@/components/ui/drawer";
import { Badge, Button } from "@/components/ui/primitives";
import { Loaded, useLoad } from "@/components/ui/loaded";
import { cn } from "@/lib/cn";
import { documents, production } from "@/demo/api";
import { DESIGN_KIND_LABEL, DESIGN_STATUS_LABEL, type DesignTaskView } from "@/services/production/contracts";
import { useToast } from "@/store/toast";
import { useTr } from "@/lib/i18n";

/** One drawing: every revision, who is waiting for it, and what is holding it.
 *
 *  Uploading and releasing are two buttons on purpose (D179). A revision saved
 *  on Friday evening and a revision the workshop may cut from are different
 *  things, and the whole failure this module exists to prevent is the second
 *  being assumed from the first.
 */
export function DesignDrawer({
  taskNo, mayEdit, mayAsk = mayEdit, onClose, onChanged,
}: {
  taskNo: string;
  /** The drafters: take it on, upload, release. */
  mayEdit: boolean;
  /** Whoever works on the design — the seller included — asks and answers
   *  (0226): the client's answer usually comes through them. */
  mayAsk?: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const tr = useTr();
  const { toast } = useToast();
  const [task, reload] = useLoad(() => production.getDesignTask(taskNo), [taskNo]);
  const [busy, setBusy] = useState(false);
  const [rev, setRev] = useState({ rev: "", note: "" });
  const [file, setFile] = useState<File | null>(null);
  const [ask, setAsk] = useState({ asked_of: "klien", question: "" });
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [assignee, setAssignee] = useState("");

  function after(message: string, detail?: string) {
    toast("success", message, detail ?? "");
    reload(); onChanged();
  }

  /* A revision is a file (0226): it is filed on the design item — or the
     product — first, in its own folder, and the revision points at it. */
  async function upload(t: DesignTaskView, release: boolean) {
    if (!file) return;
    setBusy(true);
    const entity = t.item_no ? "design_item" as const : "product" as const;
    const entity_no = (t.item_no ?? t.product_code)!;
    const kind = t.kind === "gambar_kerja" ? "Gambar Kerja" as const : "Gambar Jadi" as const;
    const up = await documents.upload({ file, kind, entity, entity_no, origin: "tala" });
    if (up.error) { setBusy(false); toast("warning", tr("File not uploaded", "File tidak terunggah"), up.error.message); return; }
    const link = await documents.link({ attachment_id: up.data.id, entity, entity_no, kind });
    if (link.error && link.error.status !== 409) {
      setBusy(false); toast("warning", tr("File not filed on the item", "File tidak terarsip di item"), link.error.message); return;
    }
    const res = await production.addDesignRevision({
      task_no: taskNo, rev: rev.rev, attachment_id: up.data.id, note: rev.note || null, release,
    });
    setBusy(false);
    if (res.error) {
      toast(res.error.status === 403 ? "critical" : "warning", release ? tr("Not released", "Tidak dirilis") : tr("Not saved", "Tidak tersimpan"), res.error.message);
      return;
    }
    setRev({ rev: "", note: "" });
    setFile(null);
    after(release ? tr(`Revision ${res.data.released_rev} released`, `Revisi ${res.data.released_rev} dirilis`) : tr("Revision saved", "Revisi tersimpan"),
      release
        ? tr("The workshop may cut from this drawing.", "Bengkel boleh memotong dari gambar ini.")
        : tr("Not released — the production floor does not see it yet.", "Belum dirilis — lantai produksi belum melihatnya."));
  }

  async function release(r: string) {
    setBusy(true);
    const res = await production.releaseDesignRevision({ task_no: taskNo, rev: r });
    setBusy(false);
    if (res.error) { toast("warning", tr("Not released", "Tidak dirilis"), res.error.message); return; }
    after(tr(`Revision ${r} released`, `Revisi ${r} dirilis`), tr("The workshop may cut from this drawing.", "Bengkel boleh memotong dari gambar ini."));
  }

  async function question() {
    setBusy(true);
    const res = await production.askDesignQuestion({ task_no: taskNo, asked_of: ask.asked_of, question: ask.question });
    setBusy(false);
    if (res.error) { toast("warning", tr("Not recorded", "Tidak tercatat"), res.error.message); return; }
    setAsk({ ...ask, question: "" });
    after(tr("Question recorded", "Pertanyaan tercatat"), tr("This task is marked as waiting for an answer.", "Tugas ini ditandai menunggu jawaban."));
  }

  async function answer(id: string) {
    setBusy(true);
    const res = await production.answerDesignQuestion({ task_no: taskNo, question_id: id, answer: answers[id] ?? "" });
    setBusy(false);
    if (res.error) { toast("warning", tr("Not saved", "Tidak tersimpan"), res.error.message); return; }
    setAnswers({ ...answers, [id]: "" });
    after(tr("Answer recorded", "Jawaban tercatat"));
  }

  async function assign() {
    setBusy(true);
    const res = await production.assignDesignTask({ task_no: taskNo, assignee: assignee || null });
    setBusy(false);
    if (res.error) { toast("warning", tr("Not saved", "Tidak tersimpan"), res.error.message); return; }
    after(tr("Task assigned", "Tugas diberikan"), assignee || tr("unassigned", "dilepas"));
  }

  return (
    <Loaded state={task} onRetry={reload}>
      {(t: DesignTaskView) => (
        <Drawer
          open onClose={onClose} width="max-w-2xl"
          title={t.product_name}
          subtitle={
            <span className="font-mono text-[11px]">
              {t.task_no} · {t.item_no ?? t.product_code} · {DESIGN_KIND_LABEL[t.kind]}
              {t.project_code && (
                <span className="block font-sans text-[12px] text-slate-500">
                  {[t.client_display, `${t.project_code} ${t.project_name ?? ""}`.trim(),
                    t.collection_code && `${t.collection_code} · ${t.collection_name}`, t.room_name].filter(Boolean).join(" › ")}
                </span>
              )}
            </span>
          }
        >
          <div className="space-y-4">
            <dl className="grid grid-cols-2 gap-2 rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3 sm:grid-cols-4">
              {([
                [tr("Status", "Status"), t.blocked ? tr("Waiting for an answer", "Menunggu jawaban") : DESIGN_STATUS_LABEL[t.status], t.assignee ?? tr("nobody assigned", "belum ada yang pegang")],
                [tr("Release", "Rilis"), t.released_rev ?? "—", t.ahead_of_release ? tr(`latest ${t.latest_rev}, not released`, `terbaru ${t.latest_rev}, belum dirilis`) : tr("latest is released", "terbaru sudah dirilis")],
                [tr("Needed by", "Dibutuhkan"), t.needed_by ?? "—",
                  t.days_left == null ? tr("nobody waiting yet", "belum ada yang menunggu")
                    : t.days_left < 0 ? tr(`${Math.abs(t.days_left)} days over`, `lewat ${Math.abs(t.days_left)} hari`) : tr(`${t.days_left} days left`, `${t.days_left} hari lagi`)],
                [tr("Size", "Ukuran"), t.dimension ?? tr("none yet", "belum ada"), t.dimension ? (t.item_no && t.category === "—" ? tr("from the design item", "dari item desain") : tr("from the product master", "dari master produk"))
                  : t.item_no ? tr("fill it in on the design item first", "isi dulu di item desain") : tr("fill it in on the product master first", "isi dulu di master produk")],
              ] as [string, string, string][]).map(([k, v, note]) => (
                <div key={k}>
                  <dt className="text-[10px] uppercase tracking-wide text-slate-400">{k}</dt>
                  <dd className="text-[14px] font-semibold text-slate-800">{v}</dd>
                  <p className="text-[11px] text-slate-500">{note}</p>
                </div>
              ))}
            </dl>

            {(t.work_orders.length > 0 || t.ordered_by.length > 0) && (
              <p className="flex flex-wrap items-center gap-2 text-[12px] text-slate-600">
                <Hammer className="h-3.5 w-3.5 text-slate-400" />
                {t.work_orders.length > 0 && (
                  <span>
                    {tr("In production:", "Dikerjakan:")} {t.work_orders.map((w) => `${w.wo_no} (${w.due_date})`).join(" · ")}
                  </span>
                )}
                {t.ordered_by.length > 0 && (
                  <span>
                    {t.item_no ? tr("For project:", "Untuk proyek:") : tr("Ordered by project:", "Dipesan proyek:")} {t.ordered_by.join(", ")}
                  </span>
                )}
              </p>
            )}

            {/* Questions first: they are what stops a release. */}
            <div>
              <p className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold text-slate-700">
                <MessageCircleQuestion className="h-3.5 w-3.5 text-slate-400" /> {tr("Questions", "Pertanyaan")}
              </p>
              <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                {t.questions.length === 0 && (
                  <li className="px-4 py-3 text-[12px] text-slate-500">{tr("No open questions.", "Tidak ada pertanyaan terbuka.")}</li>
                )}
                {t.questions.map((q) => (
                  <li key={q.id} className="px-4 py-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={q.answer ? "green" : "amber"}>{q.answer ? tr("answered", "terjawab") : tr(`waiting ${q.waiting_days} days`, `menunggu ${q.waiting_days} hari`)}</Badge>
                      <span className="text-[11px] text-slate-500">{tr("to", "ke")} {q.asked_of}</span>
                      <span className="text-[11px] text-slate-400">{q.asked_by_name} · {q.asked_at.slice(0, 10)}</span>
                    </div>
                    <p className="mt-0.5 text-[13px] text-slate-800">{q.question}</p>
                    {q.answer ? (
                      <p className="mt-0.5 text-[12px] text-emerald-800">
                        {q.answer}
                        <span className="ml-2 text-[11px] text-slate-400">— {q.answered_by_name}</span>
                      </p>
                    ) : mayAsk ? (
                      <div className="mt-1 grid gap-2 sm:grid-cols-[1fr_auto]">
                        <input
                          value={answers[q.id] ?? ""}
                          onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
                          placeholder={tr("Answer — this is what the drawing follows", "Jawaban — ini yang dipakai menggambar")}
                          className="h-9 rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                        />
                        <Button size="sm" icon={Check} disabled={busy || !(answers[q.id] ?? "").trim()} onClick={() => answer(q.id)}>
                          {tr("Answer", "Jawab")}
                        </Button>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
              {mayAsk && (
                <div className="mt-2 grid gap-2 sm:grid-cols-[120px_1fr_auto]">
                  <select
                    value={ask.asked_of} onChange={(e) => setAsk({ ...ask, asked_of: e.target.value })}
                    aria-label={tr("Asked of", "Ditanyakan ke")}
                    className="h-9 rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                  >
                    <option value="klien">{tr("Client", "Klien")}</option>
                    <option value="pimpinan">{tr("Leadership", "Pimpinan")}</option>
                    <option value="produksi">{tr("Production", "Produksi")}</option>
                  </select>
                  <input
                    value={ask.question} onChange={(e) => setAsk({ ...ask, question: e.target.value })}
                    placeholder={tr("What cannot be decided alone", "Yang tidak bisa diputuskan sendiri")}
                    className="h-9 rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                  />
                  <Button size="sm" variant="outline" icon={Send} disabled={busy || !ask.question.trim()} onClick={question}>
                    {tr("Ask", "Tanya")}
                  </Button>
                </div>
              )}
            </div>

            {/* Revisions */}
            <div>
              <p className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold text-slate-700">
                <PencilRuler className="h-3.5 w-3.5 text-slate-400" /> {tr("Revisions", "Revisi")}
              </p>
              <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                {t.revisions.length === 0 && (
                  <li className="px-4 py-3 text-[12px] text-slate-500">{tr("No drawing uploaded yet.", "Belum ada gambar yang diunggah.")}</li>
                )}
                {t.revisions.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
                    <span className={cn(
                      "flex h-6 w-6 items-center justify-center rounded font-mono text-[11px] font-semibold",
                      r.released_at ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500",
                    )}>
                      {r.rev}
                    </span>
                    <span className="min-w-[170px] flex-1 text-[12px] text-slate-700">
                      {r.filename ?? tr("no file", "tanpa berkas")}
                      {r.note && <span className="block text-[11px] text-slate-500">{r.note}</span>}
                    </span>
                    <span className="text-[11px] text-slate-400">
                      {r.uploaded_by_name} · {r.uploaded_at.slice(0, 10)}
                    </span>
                    {r.released_at ? (
                      <Badge tone="green">{tr("released", "dirilis")} {r.released_at.slice(0, 10)}</Badge>
                    ) : mayEdit ? (
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => release(r.rev)}>
                        {tr("Release", "Rilis")}
                      </Button>
                    ) : <Badge tone="slate">{tr("not released", "belum dirilis")}</Badge>}
                  </li>
                ))}
              </ul>

              {t.item_no && t.item_approved === false && (
                <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 text-[12px] text-amber-800">
                  {tr(
                    "No client approval is recorded for this item. Releasing is allowed (D378) — but the workshop will cut from a drawing the client has not said yes to.",
                    "Belum ada persetujuan klien untuk item ini. Rilis tetap boleh (D378) — tetapi bengkel akan memotong dari gambar yang belum disetujui klien.",
                  )}
                </p>
              )}
              {mayEdit && (
                <div className="mt-2 space-y-2 rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2">
                  <div className="grid gap-2 sm:grid-cols-[80px_1fr]">
                    <input
                      value={rev.rev} onChange={(e) => setRev({ ...rev, rev: e.target.value })}
                      placeholder="Rev" aria-label={tr("Revision number", "Nomor revisi")}
                      className="h-9 rounded-lg border border-slate-200 px-2 text-sm uppercase focus:border-brand-400 focus:outline-none"
                    />
                    <input
                      type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                      aria-label={tr("Drawing file", "File gambar")}
                      className="h-9 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[12px] file:mr-2 file:rounded file:border-0 file:bg-slate-100 file:px-2 file:py-0.5"
                    />
                  </div>
                  <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
                    <input
                      value={rev.note} onChange={(e) => setRev({ ...rev, note: e.target.value })}
                      placeholder={tr("What changed in this revision", "Apa yang berubah di revisi ini")}
                      className="h-9 rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                    />
                    <Button size="sm" variant="outline" icon={Upload} disabled={busy || !rev.rev.trim() || !file} onClick={() => upload(t, false)}>
                      {tr("Save", "Simpan")}
                    </Button>
                    <Button size="sm" disabled={busy || !rev.rev.trim() || !file} onClick={() => upload(t, true)}>
                      {tr("Save & release", "Simpan & rilis")}
                    </Button>
                  </div>
                  <p className="text-[11px] text-slate-500">
                    {tr(
                      "The file is filed on the item (or the product) in its own folder, and the revision points at it. Saving is not releasing: the production floor only sees released revisions — and a release is refused while any question is unanswered.",
                      "File diarsipkan di item (atau produk) dalam foldernya sendiri, dan revisi menunjuk ke file itu. Menyimpan bukan merilis: lantai produksi hanya melihat revisi yang dirilis — dan rilis ditolak selama masih ada pertanyaan yang belum dijawab.",
                    )}
                  </p>
                </div>
              )}
            </div>

            {mayEdit && (
              <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                <input
                  value={assignee} onChange={(e) => setAssignee(e.target.value)}
                  placeholder={t.assignee ? tr(`Currently with: ${t.assignee}`, `Pegang sekarang: ${t.assignee}`) : tr("Who is drawing it", "Siapa yang menggambar")}
                  className="h-9 rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                />
                <Button size="sm" variant="outline" disabled={busy} onClick={assign}>{tr("Assign", "Tetapkan")}</Button>
              </div>
            )}
          </div>
        </Drawer>
      )}
    </Loaded>
  );
}
