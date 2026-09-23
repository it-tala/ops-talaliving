"use client";

import { useState } from "react";
import { Flag, Undo2 } from "lucide-react";
import { Modal } from "@/components/ui/drawer";
import { Button } from "@/components/ui/primitives";
import { Loaded, useLoad } from "@/components/ui/loaded";
import { hr } from "@/demo/api";
import { DAY_MARK_LABEL, type DayMarkKind } from "@/services/hr/contracts";
import { useToast } from "@/store/toast";

/** What happened to a whole date.
 *
 *  A public holiday is not marked person by person — it is a fact about the
 *  day, so the mark carries no employee at all and covers everybody who was on
 *  the books. The same is true of the afternoon the power went, or the morning
 *  the office closed for a funeral.
 *
 *  Marking never touches a tap. Somebody who came in on the tanggal merah still
 *  has their scans; what changes is that those hours are lembur rather than an
 *  ordinary day (D142).
 */
const NOTE: Record<DayMarkKind, string> = {
  holiday: "Everybody who scanned gets those hours as lembur; nobody loses a day for not coming.",
  half_day: "Counted as 0,5 hari for everybody — acara kantor, kecelakaan, blackout.",
  absent: "For a whole date this is unusual — normally an absence belongs to one person, from their own cell.",
  sick: "For a whole date this is unusual — sickness belongs to one person, from their own cell.",
  leave: "Cuti bersama — nobody is counted as working.",
  permit: "Izin for the whole office — nobody is counted as working.",
};

export function MarkDay({
  date, onClose, onDone,
}: {
  date: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [sheet, reload] = useLoad(() => hr.getTimesheet({ from: date, to: date }), [date]);
  const [kind, setKind] = useState<DayMarkKind>("holiday");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  /* A mark is withdrawn rather than deleted, and a withdrawal with no sentence
     is refused by the database (C19). */
  const [undoing, setUndoing] = useState(false);
  const [undoReason, setUndoReason] = useState("");

  async function mark() {
    setBusy(true);
    const res = await hr.markDay({ work_date: date, kind, reason });
    setBusy(false);
    if (res.error) {
      toast(res.error.status === 403 ? "critical" : "warning", "Not marked", res.error.message);
      return;
    }
    toast("success", "Day marked", `${date} · ${DAY_MARK_LABEL[res.data.kind]} · seluruh kantor`);
    onDone();
  }

  async function unmark(markId: string) {
    setBusy(true);
    const res = await hr.unmarkDay(markId, undoReason);
    setBusy(false);
    if (res.error) {
      toast(res.error.status === 403 ? "critical" : "warning", "Not removed", res.error.message);
      return;
    }
    setUndoing(false); setUndoReason("");
    toast("success", "Mark withdrawn", `${date} is back to what the machine recorded.`);
    reload();
    onDone();
  }

  return (
    <Modal
      open onClose={onClose} width="max-w-lg"
      title={`Mark ${date}`}
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button icon={Flag} onClick={mark} disabled={busy || !reason.trim()}>
            {busy ? "Marking…" : `Mark for everybody`}
          </Button>
        </div>
      }
    >
      <Loaded state={sheet} onRetry={reload} skeletonRows={3}>
        {(s) => {
          /* A mark that already covers the whole office, if there is one. */
          const existing = s.days.find((d) => d.mark && d.mark.employee_id === null)?.mark ?? null;
          return (
            <div className="space-y-4">
              {existing ? (
                <div className="rounded-xl border border-violet-200 bg-violet-50 px-4 py-3">
                  <p className="text-[13px] font-semibold text-violet-900">
                    Already marked — {DAY_MARK_LABEL[existing.kind]}
                  </p>
                  <p className="mt-0.5 text-[12px] text-violet-900">{existing.reason}</p>
                  {!undoing && (
                    <Button size="sm" variant="ghost" icon={Undo2} className="mt-2" disabled={busy}
                      onClick={() => setUndoing(true)}>
                      Withdraw this mark
                    </Button>
                  )}
                  {undoing && (
                    <div className="mt-2">
                      <input
                        value={undoReason} onChange={(e) => setUndoReason(e.target.value)}
                        placeholder="Kenapa ditarik — salah tanggal, bukan tanggal merah…"
                        className="h-9 w-full rounded-lg border border-violet-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                      />
                      <p className="mt-1 text-[11px] text-violet-800">
                        Tandanya tetap tercatat. Yang dibaca orang berikutnya adalah alasannya.
                      </p>
                      <div className="mt-2 flex justify-end gap-2">
                        <Button size="sm" variant="ghost" disabled={busy}
                          onClick={() => { setUndoing(false); setUndoReason(""); }}>
                          Batal
                        </Button>
                        <Button size="sm" icon={Undo2} disabled={busy || !undoReason.trim()}
                          onClick={() => unmark(existing.id)}>
                          Withdraw
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-[13px] text-slate-600">
                  This covers all {s.employees.length} people on the books. The taps stay exactly as the
                  machine recorded them — what changes is how payroll counts the day.
                </p>
              )}

              <div>
                <span className="block text-xs text-slate-500">What this day was</span>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {(Object.keys(DAY_MARK_LABEL) as DayMarkKind[]).map((k) => (
                    <Button key={k} size="sm" variant={kind === k ? "primary" : "outline"} onClick={() => setKind(k)}>
                      {DAY_MARK_LABEL[k]}
                    </Button>
                  ))}
                </div>
                <p className="mt-1.5 text-[11px] text-slate-500">{NOTE[kind]}</p>
              </div>

              <div>
                <label htmlFor="mark-reason" className="block text-xs text-slate-500">Keterangan</label>
                <input
                  id="mark-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder={kind === "holiday" ? "Maulid Nabi Muhammad SAW" : "Listrik padam sejak pukul 13.00"}
                  className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                />
                <p className="mt-1 text-[11px] text-slate-500">
                  Required. <em>Setengah hari</em> with no reason is a decision nobody can check in six months.
                </p>
              </div>

              {s.days.some((d) => d.scans.length > 0) && (
                <p className="rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
                  {s.days.filter((d) => d.scans.length > 0).length} people scanned on this date. Their taps are kept.
                </p>
              )}
            </div>
          );
        }}
      </Loaded>
    </Modal>
  );
}
