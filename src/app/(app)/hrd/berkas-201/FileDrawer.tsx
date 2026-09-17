"use client";

import { useState } from "react";
import { FileBadge, Plus, AlertTriangle, Eye, EyeOff, Paperclip } from "lucide-react";
import { Drawer } from "@/components/ui/drawer";
import { Badge, Button } from "@/components/ui/primitives";
import { Loaded, useLoad } from "@/components/ui/loaded";
import { cn } from "@/lib/cn";
import { hr } from "@/demo/api";
import {
  EMPLOYEE_DOC_LABEL, DOC_NO_SOURCE_LABEL, DOC_NO_DIGITS,
  type EmployeeDocKind, type EmployeeFileView, type EmployeeDocumentView,
} from "@/services/hr/contracts";
import { useToast } from "@/store/toast";

/** One person's file, slot by slot.
 *
 *  Every slot is shown, including the empty ones — a missing KTP is a row that
 *  says *belum ada*, not an absence somebody has to notice. A document may be
 *  filed as a **number without a scan**, because the number is usually what is
 *  actually needed (a BPJS registration asks for the number, not the card), and
 *  refusing that would push it back onto a spreadsheet (D177).
 */
export function FileDrawer({
  employeeNo, mayEdit, onClose, onChanged,
}: {
  employeeNo: string;
  mayEdit: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const [file, reload] = useLoad(() => hr.getEmployeeFile(employeeNo), [employeeNo]);
  const [adding, setAdding] = useState<EmployeeDocKind | null>(null);
  const [form, setForm] = useState({ doc_no: "", issued_on: "", expires_on: "", note: "" });
  const [busy, setBusy] = useState(false);

  async function save(kind: EmployeeDocKind) {
    setBusy(true);
    const res = await hr.saveEmployeeDocument({
      employee_no: employeeNo, kind,
      doc_no: form.doc_no || null,
      issued_on: form.issued_on || null,
      expires_on: form.expires_on || null,
      note: form.note || null,
    });
    setBusy(false);
    if (res.error) {
      toast(res.error.status === 403 ? "critical" : "warning", "Tidak tersimpan", res.error.message);
      return;
    }
    toast("success", "Tercatat", EMPLOYEE_DOC_LABEL[kind]);
    setAdding(null);
    setForm({ doc_no: "", issued_on: "", expires_on: "", note: "" });
    reload(); onChanged();
  }

  return (
    <Loaded state={file} onRetry={reload}>
      {(f: EmployeeFileView) => (
        <Drawer
          open onClose={onClose} width="max-w-2xl"
          title={f.full_name}
          subtitle={<span className="font-mono text-[11px]">{f.employee_no} · {f.position} · {f.unit}</span>}
        >
          <div className="space-y-4">
            <div className={cn(
              "flex flex-wrap items-center gap-2 rounded-xl border px-4 py-2.5 text-[13px]",
              f.complete ? "border-emerald-200 bg-emerald-50/60 text-emerald-900" : "border-amber-200 bg-amber-50/70 text-amber-900",
            )}>
              {f.complete ? (
                <span>Semua dokumen wajib sudah ada.</span>
              ) : (
                <>
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span>Belum ada: {f.missing.map((k) => EMPLOYEE_DOC_LABEL[k]).join(", ")}</span>
                </>
              )}
            </div>

            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
              {f.slots.map((s) => (
                <li key={s.kind} className="px-4 py-2.5">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="min-w-[150px] text-[13px] font-medium text-slate-800">
                      {s.label}
                      {s.required && <span className="ml-1.5 text-[10px] uppercase tracking-wide text-slate-400">wajib</span>}
                    </span>
                    {s.documents.length === 0 ? (
                      <Badge tone={s.required ? "amber" : "slate"}>belum ada</Badge>
                    ) : (
                      <Badge tone="green">{s.documents.length} berkas</Badge>
                    )}
                    {s.expires_in_days != null && (
                      <Badge tone={s.expires_in_days < 0 ? "red" : s.expires_in_days <= 60 ? "amber" : "slate"}>
                        {s.expires_in_days < 0
                          ? `lewat ${Math.abs(s.expires_in_days)} hari`
                          : `${s.expires_in_days} hari lagi`}
                      </Badge>
                    )}
                    {mayEdit && (
                      <Button
                        size="sm" variant="ghost" icon={Plus}
                        onClick={() => setAdding(adding === s.kind ? null : s.kind)}
                      >
                        {adding === s.kind ? "Tutup" : "Tambah"}
                      </Button>
                    )}
                  </div>

                  {s.documents.length > 0 && (
                    <ul className="mt-1 space-y-0.5">
                      {s.documents.map((d) => (
                        <DocumentRow key={d.id} doc={d} />
                      ))}
                    </ul>
                  )}
                  {s.documents.length === 0 && s.note && (
                    <p className="mt-0.5 text-[11px] text-slate-400">{s.note}</p>
                  )}

                  {adding === s.kind && (
                    <div className="mt-2 space-y-2 rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2">
                      {/* Three labelled columns. The number field used to be a
                          bare input beside two labelled ones, so it sat a line
                          higher than its neighbours — the misalignment was the
                          missing caption, not the width. */}
                      <div className="grid items-end gap-2 sm:grid-cols-3">
                        <label className="text-[11px] text-slate-500">
                          Nomor dokumen
                          <input
                            value={form.doc_no} onChange={(e) => setForm({ ...form, doc_no: e.target.value })}
                            placeholder="Ketik kalau belum terbaca dari berkas" aria-label="Nomor dokumen"
                            className="h-9 w-full rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                          />
                        </label>
                        <label className="text-[11px] text-slate-500">
                          Terbit
                          <input
                            type="date" value={form.issued_on} onChange={(e) => setForm({ ...form, issued_on: e.target.value })}
                            className="h-9 w-full rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                          />
                        </label>
                        <label className="text-[11px] text-slate-500">
                          Berakhir
                          <input
                            type="date" value={form.expires_on} onChange={(e) => setForm({ ...form, expires_on: e.target.value })}
                            className="h-9 w-full rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                          />
                        </label>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                        <input
                          value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })}
                          placeholder="Catatan — mis. PKWT satu tahun, perpanjangan kedua"
                          className="h-9 rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                        />
                        <Button size="sm" disabled={busy || !form.doc_no.trim()} onClick={() => save(s.kind)}>
                          {busy ? "Menyimpan…" : "Simpan"}
                        </Button>
                      </div>
                      <p className="text-[11px] text-slate-500">
                        Kosongkan <em>Berakhir</em> kalau dokumennya tidak punya masa berlaku.
                        Nomor saja sudah cukup untuk tercatat — pemindaiannya menyusul. Yang tidak
                        boleh kosong keduanya.
                      </p>
                    </div>
                  )}
                </li>
              ))}
            </ul>

            <p className="flex items-start gap-2 text-[11px] text-slate-500">
              <FileBadge className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
              Berkas yang dipindai naik lewat jalur dokumen yang sama dengan bukti lain — satu
              lampiran, satu tautan, satu orang yang menautkannya (ADR-010).
            </p>
          </div>
        </Drawer>
      )}
    </Loaded>
  );
}

/** One filed document, and the number it carries.
 *
 *  An identity number is never rendered from the list: it is not in the list.
 *  What is here is the mask, its length, and a button that goes and asks for
 *  the real one — which writes an audit row that outlives this screen, this
 *  employee's employment, and the thirty-day activity log (D196, D197).
 *
 *  The revealed number is deliberately **not** kept anywhere but this
 *  component's state: closing the row forgets it, and opening it again is
 *  another row in the trail. A cache would make the second look free, and the
 *  second look is exactly the one worth recording.
 */
function DocumentRow({ doc }: { doc: EmployeeDocumentView }) {
  const { toast } = useToast();
  const [shown, setShown] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function reveal() {
    if (shown) { setShown(null); return; }
    setBusy(true);
    const res = await hr.revealEmployeeDocNo(doc.id);
    setBusy(false);
    if (res.error) { toast("warning", "Tidak bisa dibuka", res.error.message); return; }
    setShown(res.data.doc_no);
    toast("info", "Tercatat di audit", "Pembukaan nomor ini tersimpan atas nama Anda — permanen.");
  }

  const want = DOC_NO_DIGITS[doc.kind];

  return (
    <li className="text-[12px] text-slate-600">
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {doc.sensitive ? (
          doc.doc_no_masked ? (
            <>
              <span className="font-mono text-[11px] tracking-[0.12em] text-slate-700">
                {shown ?? doc.doc_no_masked}
              </span>
              <button
                type="button" onClick={reveal} disabled={busy}
                aria-label={shown ? "Sembunyikan nomor" : "Lihat nomor — tercatat di audit"}
                title={shown ? "Sembunyikan" : "Lihat nomor — tercatat di audit"}
                className="inline-flex h-5 w-5 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
              >
                {shown ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </>
          ) : null
        ) : (
          doc.doc_no && <span className="font-mono text-[11px] text-slate-700">{doc.doc_no}</span>
        )}

        {doc.doc_no_length_ok === false && (
          <Badge tone="amber">
            terbaca {doc.doc_no_length} angka, seharusnya {want}
          </Badge>
        )}
        {doc.doc_no_source === "pending" && <Badge tone="slate">nomor belum dibaca</Badge>}
        {doc.doc_no_source && doc.doc_no_source !== "pending" && (
          <span className="text-[11px] text-slate-400">{DOC_NO_SOURCE_LABEL[doc.doc_no_source]}</span>
        )}

        {doc.issued_on && <span className="text-slate-400">terbit {doc.issued_on}</span>}
        {doc.expires_on && <span className="text-slate-400">berakhir {doc.expires_on}</span>}
        {doc.attachment_id ? (
          <span className="inline-flex items-center gap-1 text-[11px] text-slate-400">
            <Paperclip className="h-3 w-3" /> berkas di Drive
          </span>
        ) : (
          <span className="text-[11px] text-amber-700">nomor saja, berkas belum dipindai</span>
        )}
      </span>
      {doc.note && <span className="block text-[11px] text-slate-500">{doc.note}</span>}
    </li>
  );
}
