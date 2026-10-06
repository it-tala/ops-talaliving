"use client";

import { useState } from "react";
import { Inbox, Lightbulb, Undo2 } from "lucide-react";
import { Badge, Button, Card, CardHeader } from "@/components/ui/primitives";
import { Loaded, useLoad } from "@/components/ui/loaded";
import { hr } from "@/demo/api";
import { useToast } from "@/store/toast";
import { useTr } from "@/lib/i18n";

/** The daftar tunggu as staff see it (D381): what is waiting to be done, in
 *  order, before anybody is handed it, and a way to propose work they have
 *  noticed. A proposal waits for HRD; its author can change or withdraw it
 *  until then, and hears the answer either way. */
export function StaffBacklog() {
  const { toast } = useToast();
  const tr = useTr();
  const [items, reload] = useLoad(() => hr.listBacklog({ include_closed: true }), []);
  const blank = { item_no: null as string | null, title: "", deliverable: "", unit: "", detail: "" };
  const [draft, setDraft] = useState(blank);
  const [writing, setWriting] = useState(false);
  const [busy, setBusy] = useState(false);

  async function propose() {
    setBusy(true);
    const res = await hr.saveBacklogItem({
      item_no: draft.item_no, title: draft.title, deliverable: draft.deliverable || null,
      unit: draft.unit || null, detail: draft.detail || null,
    });
    setBusy(false);
    if (res.error) { toast("warning", tr("Not sent", "Tidak terkirim"), res.error.message); return; }
    toast("success", res.data.item_no, res.data.status === "PROPOSED"
      ? tr("Proposed. HRD is told and will answer here.", "Terkirim sebagai usulan. HRD diberi tahu dan menjawab di sini.")
      : tr("Added to the waiting list.", "Masuk daftar tunggu."));
    setDraft(blank); setWriting(false);
    reload();
  }

  async function withdraw(itemNo: string) {
    setBusy(true);
    const res = await hr.dropBacklogItem({ item_no: itemNo });
    setBusy(false);
    if (res.error) { toast("warning", tr("Not withdrawn", "Tidak ditarik"), res.error.message); return; }
    reload();
  }

  const input = "mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm";

  return (
    <Card>
      <CardHeader
        title={tr("Waiting list", "Daftar tunggu")}
        subtitle={tr(
          "Work that is known and not urgent, in the order it will be given out. Nothing here is yours until HRD assigns it to you.",
          "Pekerjaan yang sudah diketahui dan belum mendesak, dalam urutan akan dibagikan. Belum ada yang menjadi tugas Anda sampai HRD menugaskannya.",
        )}
        icon={Inbox}
      />
      <Loaded state={items} onRetry={reload}>
        {(list) => {
          const open = list.filter((b) => b.status === "OPEN");
          const mine = list.filter((b) => b.is_mine && b.proposed).slice(0, 6);
          return (
            <div>
              {open.length === 0 ? (
                <p className="px-5 py-4 text-[13px] text-slate-500">{tr("Nothing waiting.", "Tidak ada yang menunggu.")}</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {open.map((b) => (
                    <li key={b.item_no} className="flex gap-3 px-5 py-2.5 text-[13px]">
                      <span className="font-mono font-semibold text-slate-400">#{b.position}</span>
                      <span className="min-w-0 flex-1">
                        <span className="text-slate-800">{b.title}</span>
                        {b.unit && <Badge tone="slate" className="ml-1.5">{b.unit}</Badge>}
                        {b.goal_title && <span className="block text-[12px] text-slate-500">{tr("goal:", "sasaran:")} {b.goal_title}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              {mine.length > 0 && (
                <div className="border-t border-slate-100 px-5 py-3">
                  <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-400">{tr("My proposals", "Usulan saya")}</p>
                  <ul className="space-y-1.5">
                    {mine.map((b) => (
                      <li key={b.item_no} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
                        <span className="text-slate-800">{b.title}</span>
                        {b.status === "PROPOSED" && <Badge tone="amber">{tr("waiting for HRD", "menunggu HRD")}</Badge>}
                        {b.status === "OPEN" && <Badge tone="green">{tr(`on the list #${b.position}`, `masuk daftar #${b.position}`)}</Badge>}
                        {b.status === "ASSIGNED" && <Badge tone="green">{tr(`assigned to ${b.assignee_name}`, `ditugaskan ke ${b.assignee_name}`)}</Badge>}
                        {b.status === "DROPPED" && <Badge tone="slate">{tr("not taken", "tidak diambil")}</Badge>}
                        {b.status === "DROPPED" && b.dropped_reason && <span className="text-[12px] text-slate-500">{b.dropped_reason}</span>}
                        {b.status === "PROPOSED" && (
                          <Button size="sm" variant="ghost" icon={Undo2} disabled={busy} onClick={() => withdraw(b.item_no)}>
                            {tr("Withdraw", "Tarik")}
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="border-t border-slate-100 px-5 py-3">
                {!writing ? (
                  <Button size="sm" variant="outline" icon={Lightbulb} onClick={() => setWriting(true)}>
                    {tr("Propose work", "Usulkan pekerjaan")}
                  </Button>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="text-[12px] text-slate-600 sm:col-span-2">
                      {tr("What is the work", "Pekerjaannya apa")}
                      <input id="prop-title" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} className={input} />
                    </label>
                    <label className="text-[12px] text-slate-600">
                      {tr("What should be handed over", "Yang perlu diserahkan")}
                      <input id="prop-deliverable" value={draft.deliverable} onChange={(e) => setDraft({ ...draft, deliverable: e.target.value })} className={input} />
                    </label>
                    <label className="text-[12px] text-slate-600">
                      {tr("Field", "Bidang")}
                      <input id="prop-unit" value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value })}
                        placeholder="IT, Drafting, Procurement…" className={input} />
                    </label>
                    <label className="text-[12px] text-slate-600 sm:col-span-2">
                      {tr("Why it is needed (optional)", "Kenapa perlu (boleh kosong)")}
                      <textarea id="prop-detail" value={draft.detail} rows={2} onChange={(e) => setDraft({ ...draft, detail: e.target.value })}
                        className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm" />
                    </label>
                    <div className="flex justify-end gap-2 sm:col-span-2">
                      <Button size="sm" variant="ghost" onClick={() => { setWriting(false); setDraft(blank); }}>{tr("Cancel", "Batal")}</Button>
                      <Button size="sm" disabled={busy || !draft.title.trim()} onClick={propose}>{tr("Send proposal", "Kirim usulan")}</Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        }}
      </Loaded>
    </Card>
  );
}
