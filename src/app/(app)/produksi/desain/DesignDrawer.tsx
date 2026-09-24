"use client";

import { useState } from "react";
import { PencilRuler, Upload, Send, Check, MessageCircleQuestion, Hammer } from "lucide-react";
import { Drawer } from "@/components/ui/drawer";
import { Badge, Button } from "@/components/ui/primitives";
import { Loaded, useLoad } from "@/components/ui/loaded";
import { cn } from "@/lib/cn";
import { production } from "@/demo/api";
import { DESIGN_KIND_LABEL, DESIGN_STATUS_LABEL, type DesignTaskView } from "@/services/production/contracts";
import { useToast } from "@/store/toast";

/** One drawing: every revision, who is waiting for it, and what is holding it.
 *
 *  Uploading and releasing are two buttons on purpose (D179). A revision saved
 *  on Friday evening and a revision the workshop may cut from are different
 *  things, and the whole failure this module exists to prevent is the second
 *  being assumed from the first.
 */
export function DesignDrawer({
  taskNo, mayEdit, onClose, onChanged,
}: {
  taskNo: string;
  mayEdit: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const [task, reload] = useLoad(() => production.getDesignTask(taskNo), [taskNo]);
  const [busy, setBusy] = useState(false);
  const [rev, setRev] = useState({ rev: "", filename: "", note: "" });
  const [ask, setAsk] = useState({ asked_of: "klien", question: "" });
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [assignee, setAssignee] = useState("");

  function after(message: string, detail?: string) {
    toast("success", message, detail ?? "");
    reload(); onChanged();
  }

  async function upload(release: boolean) {
    setBusy(true);
    const res = await production.addDesignRevision({
      task_no: taskNo, rev: rev.rev, filename: rev.filename || null, note: rev.note || null, release,
    });
    setBusy(false);
    if (res.error) {
      toast(res.error.status === 403 ? "critical" : "warning", release ? "Tidak dirilis" : "Tidak tersimpan", res.error.message);
      return;
    }
    setRev({ rev: "", filename: "", note: "" });
    after(release ? `Revisi ${res.data.released_rev} dirilis` : "Revisi tersimpan",
      release ? "Bengkel boleh memotong dari gambar ini." : "Belum dirilis — lantai produksi belum melihatnya.");
  }

  async function release(r: string) {
    setBusy(true);
    const res = await production.releaseDesignRevision({ task_no: taskNo, rev: r });
    setBusy(false);
    if (res.error) { toast("warning", "Tidak dirilis", res.error.message); return; }
    after(`Revisi ${r} dirilis`, "Bengkel boleh memotong dari gambar ini.");
  }

  async function question() {
    setBusy(true);
    const res = await production.askDesignQuestion({ task_no: taskNo, asked_of: ask.asked_of, question: ask.question });
    setBusy(false);
    if (res.error) { toast("warning", "Tidak tercatat", res.error.message); return; }
    setAsk({ ...ask, question: "" });
    after("Pertanyaan tercatat", "Tugas ini ditandai menunggu jawaban.");
  }

  async function answer(id: string) {
    setBusy(true);
    const res = await production.answerDesignQuestion({ task_no: taskNo, question_id: id, answer: answers[id] ?? "" });
    setBusy(false);
    if (res.error) { toast("warning", "Tidak tersimpan", res.error.message); return; }
    setAnswers({ ...answers, [id]: "" });
    after("Jawaban tercatat");
  }

  async function assign() {
    setBusy(true);
    const res = await production.assignDesignTask({ task_no: taskNo, assignee: assignee || null });
    setBusy(false);
    if (res.error) { toast("warning", "Tidak tersimpan", res.error.message); return; }
    after("Tugas diberikan", assignee || "dilepas");
  }

  return (
    <Loaded state={task} onRetry={reload}>
      {(t: DesignTaskView) => (
        <Drawer
          open onClose={onClose} width="max-w-2xl"
          title={t.product_name}
          subtitle={
            <span className="font-mono text-[11px]">
              {t.task_no} · {t.product_code} · {DESIGN_KIND_LABEL[t.kind]}
            </span>
          }
        >
          <div className="space-y-4">
            <dl className="grid grid-cols-2 gap-2 rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3 sm:grid-cols-4">
              {([
                ["Status", t.blocked ? "Menunggu jawaban" : DESIGN_STATUS_LABEL[t.status], t.assignee ?? "belum ada yang pegang"],
                ["Rilis", t.released_rev ?? "—", t.ahead_of_release ? `terbaru ${t.latest_rev}, belum dirilis` : "terbaru sudah dirilis"],
                ["Dibutuhkan", t.needed_by ?? "—",
                  t.days_left == null ? "belum ada yang menunggu"
                    : t.days_left < 0 ? `lewat ${Math.abs(t.days_left)} hari` : `${t.days_left} hari lagi`],
                ["Ukuran", t.dimension ?? "belum ada", t.dimension ? "dari master produk" : "isi dulu di master produk"],
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
                    Dikerjakan: {t.work_orders.map((w) => `${w.wo_no} (${w.due_date})`).join(" · ")}
                  </span>
                )}
                {t.ordered_by.length > 0 && <span>Dipesan proyek: {t.ordered_by.join(", ")}</span>}
              </p>
            )}

            {/* Questions first: they are what stops a release. */}
            <div>
              <p className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold text-slate-700">
                <MessageCircleQuestion className="h-3.5 w-3.5 text-slate-400" /> Pertanyaan
              </p>
              <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                {t.questions.length === 0 && (
                  <li className="px-4 py-3 text-[12px] text-slate-500">Tidak ada pertanyaan terbuka.</li>
                )}
                {t.questions.map((q) => (
                  <li key={q.id} className="px-4 py-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={q.answer ? "green" : "amber"}>{q.answer ? "terjawab" : `menunggu ${q.waiting_days} hari`}</Badge>
                      <span className="text-[11px] text-slate-500">ke {q.asked_of}</span>
                      <span className="text-[11px] text-slate-400">{q.asked_by_name} · {q.asked_at.slice(0, 10)}</span>
                    </div>
                    <p className="mt-0.5 text-[13px] text-slate-800">{q.question}</p>
                    {q.answer ? (
                      <p className="mt-0.5 text-[12px] text-emerald-800">
                        {q.answer}
                        <span className="ml-2 text-[11px] text-slate-400">— {q.answered_by_name}</span>
                      </p>
                    ) : mayEdit ? (
                      <div className="mt-1 grid gap-2 sm:grid-cols-[1fr_auto]">
                        <input
                          value={answers[q.id] ?? ""}
                          onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
                          placeholder="Jawaban — ini yang dipakai menggambar"
                          className="h-9 rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                        />
                        <Button size="sm" icon={Check} disabled={busy || !(answers[q.id] ?? "").trim()} onClick={() => answer(q.id)}>
                          Jawab
                        </Button>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
              {mayEdit && (
                <div className="mt-2 grid gap-2 sm:grid-cols-[120px_1fr_auto]">
                  <select
                    value={ask.asked_of} onChange={(e) => setAsk({ ...ask, asked_of: e.target.value })}
                    aria-label="Ditanyakan ke"
                    className="h-9 rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                  >
                    <option value="klien">Klien</option>
                    <option value="pimpinan">Pimpinan</option>
                    <option value="produksi">Produksi</option>
                  </select>
                  <input
                    value={ask.question} onChange={(e) => setAsk({ ...ask, question: e.target.value })}
                    placeholder="Yang tidak bisa diputuskan sendiri"
                    className="h-9 rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                  />
                  <Button size="sm" variant="outline" icon={Send} disabled={busy || !ask.question.trim()} onClick={question}>
                    Tanya
                  </Button>
                </div>
              )}
            </div>

            {/* Revisions */}
            <div>
              <p className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold text-slate-700">
                <PencilRuler className="h-3.5 w-3.5 text-slate-400" /> Revisi
              </p>
              <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                {t.revisions.length === 0 && (
                  <li className="px-4 py-3 text-[12px] text-slate-500">Belum ada gambar yang diunggah.</li>
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
                      {r.filename ?? "tanpa berkas"}
                      {r.note && <span className="block text-[11px] text-slate-500">{r.note}</span>}
                    </span>
                    <span className="text-[11px] text-slate-400">
                      {r.uploaded_by_name} · {r.uploaded_at.slice(0, 10)}
                    </span>
                    {r.released_at ? (
                      <Badge tone="green">dirilis {r.released_at.slice(0, 10)}</Badge>
                    ) : mayEdit ? (
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => release(r.rev)}>
                        Rilis
                      </Button>
                    ) : <Badge tone="slate">belum dirilis</Badge>}
                  </li>
                ))}
              </ul>

              {mayEdit && (
                <div className="mt-2 space-y-2 rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2">
                  <div className="grid gap-2 sm:grid-cols-[80px_1fr]">
                    <input
                      value={rev.rev} onChange={(e) => setRev({ ...rev, rev: e.target.value })}
                      placeholder="Rev" aria-label="Nomor revisi"
                      className="h-9 rounded-lg border border-slate-200 px-2 text-sm uppercase focus:border-brand-400 focus:outline-none"
                    />
                    <input
                      value={rev.filename} onChange={(e) => setRev({ ...rev, filename: e.target.value })}
                      placeholder="Nama berkas — mis. PRD-LM-3P_kerja_revD.pdf"
                      className="h-9 rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                    />
                  </div>
                  <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
                    <input
                      value={rev.note} onChange={(e) => setRev({ ...rev, note: e.target.value })}
                      placeholder="Apa yang berubah di revisi ini"
                      className="h-9 rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                    />
                    <Button size="sm" variant="outline" icon={Upload} disabled={busy || !rev.rev.trim()} onClick={() => upload(false)}>
                      Simpan
                    </Button>
                    <Button size="sm" disabled={busy || !rev.rev.trim()} onClick={() => upload(true)}>
                      Simpan &amp; rilis
                    </Button>
                  </div>
                  <p className="text-[11px] text-slate-500">
                    Menyimpan bukan merilis. Lantai produksi hanya melihat revisi yang dirilis — dan
                    rilis ditolak selama masih ada pertanyaan yang belum dijawab.
                  </p>
                </div>
              )}
            </div>

            {mayEdit && (
              <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                <input
                  value={assignee} onChange={(e) => setAssignee(e.target.value)}
                  placeholder={t.assignee ? `Pegang sekarang: ${t.assignee}` : "Siapa yang menggambar"}
                  className="h-9 rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                />
                <Button size="sm" variant="outline" disabled={busy} onClick={assign}>Tetapkan</Button>
              </div>
            )}
          </div>
        </Drawer>
      )}
    </Loaded>
  );
}
