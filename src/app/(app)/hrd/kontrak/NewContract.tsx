"use client";

import { useState } from "react";
import { Drawer } from "@/components/ui/drawer";
import { Button } from "@/components/ui/primitives";
import { Loaded, useLoad } from "@/components/ui/loaded";
import { hr } from "@/demo/api";
import type { ContractKind } from "@/services/hr/contracts";
import { useToast } from "@/store/toast";
import { officeToday } from "@/lib/office";

/** Mendaftarkan kontrak yang sudah ditandatangani di kertas.
 *
 *  Ini **bukan** tempat kontraknya dibuat. Kontraknya dibuat HRD di Word, di
 *  atas kop surat, dan ditandatangani dengan pena — yang dilakukan di sini
 *  adalah mencatat bahwa ia ada, supaya poin-poinnya bisa dijawab satu per
 *  satu di layar berikutnya. Kontrak lahir sebagai **draft** dan tidak
 *  berlaku sampai seseorang menekan *Berlakukan*; itu disengaja, karena
 *  kontrak yang berlaku dengan poin wajib kosong adalah kontrak yang tidak
 *  bisa dijawab waktu ditanya.
 *
 *  Dua aturan yang ditegakkan basis data dan diulang di sini supaya tidak
 *  dipelajari lewat penolakan: **PKWT selalu punya tanggal berakhir**, dan
 *  **PKWTT tidak pernah punya**. Yang kedua bukan kerewelan — kontrak tanpa
 *  waktu yang diberi tanggal berakhir membantah dirinya sendiri, dan yang
 *  membacanya setahun lagi tidak akan tahu sisi mana yang benar.
 */
export function NewContract({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { toast } = useToast();
  const [people] = useLoad(() => hr.listEmployees(), []);
  const [employeeNo, setEmployeeNo] = useState("");
  const [kind, setKind] = useState<ContractKind>("PKWT");
  const [from, setFrom] = useState(officeToday());
  const [endsOn, setEndsOn] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const needsEnd = kind === "PKWT";
  const backwards = needsEnd && endsOn !== "" && endsOn < from;
  const ready = employeeNo !== "" && from !== ""
    && (needsEnd ? endsOn !== "" && !backwards : true);

  async function save() {
    setBusy(true);
    const res = await hr.registerContract({
      employee_no: employeeNo,
      kind,
      effective_from: from,
      /* PKWTT mengirim null, bukan string kosong: yang dicatat adalah *tidak
         ada tanggal berakhir*, bukan *tanggalnya belum diisi*. */
      ends_on: needsEnd ? endsOn : null,
      note: note.trim() || null,
    });
    setBusy(false);
    if (res.error) { toast("warning", "Kontrak tidak dibuat", res.error.message); return; }
    toast("success", "Kontrak didaftarkan", `${res.data.contract_no} · masih draft`);
    onDone();
  }

  return (
    <Drawer
      open onClose={onClose} width="max-w-lg"
      title="Daftarkan kontrak"
      subtitle="Kertasnya sudah ada dan sudah ditandatangani. Yang dicatat di sini adalah keberadaannya — isinya dijawab poin per poin setelah ini."
      footer={
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] text-slate-500">Lahir sebagai draft. Tidak berlaku sampai diberlakukan.</p>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose} disabled={busy}>Batal</Button>
            <Button onClick={save} disabled={busy || !ready}>
              {busy ? "Menyimpan…" : "Daftarkan"}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <Loaded state={people} skeletonRows={2}>
          {(emps) => (
            <div>
              <label htmlFor="k-emp" className="block text-xs text-slate-500">Karyawan</label>
              <select
                id="k-emp" value={employeeNo} onChange={(e) => setEmployeeNo(e.target.value)}
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
              >
                <option value="">Pilih karyawan…</option>
                {emps.map((e) => (
                  <option key={e.employee_no} value={e.employee_no}>
                    {e.full_name} · {e.employee_no} · {e.position}
                  </option>
                ))}
              </select>
            </div>
          )}
        </Loaded>

        <div>
          <span className="block text-xs text-slate-500">Jenis</span>
          <div className="mt-1 grid gap-2 sm:grid-cols-2">
            {([
              ["PKWT", "Waktu tertentu", "Ada tanggal berakhirnya."],
              ["PKWTT", "Waktu tidak tertentu", "Tetap, tanpa tanggal berakhir."],
            ] as [ContractKind, string, string][]).map(([k, label, note2]) => (
              <button
                key={k} type="button"
                onClick={() => { setKind(k); if (k === "PKWTT") setEndsOn(""); }}
                className={`rounded-xl border px-3 py-2 text-left transition ${
                  kind === k
                    ? "border-brand-400 bg-brand-50/60 ring-1 ring-brand-200"
                    : "border-slate-200 hover:bg-slate-50"}`}
              >
                <span className="block text-sm font-semibold text-slate-800">{k}</span>
                <span className="block text-[11px] text-slate-500">{label} — {note2}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="k-from" className="block text-xs text-slate-500">Mulai berlaku</label>
            <input
              id="k-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)}
              className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="k-to" className="block text-xs text-slate-500">
              Berakhir {needsEnd ? "" : "— tidak berlaku untuk PKWTT"}
            </label>
            <input
              id="k-to" type="date" value={endsOn} disabled={!needsEnd}
              onChange={(e) => setEndsOn(e.target.value)}
              className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none disabled:bg-slate-50 disabled:text-slate-400"
            />
            {backwards && (
              <p className="mt-1 text-[11px] text-rose-700">Berakhir sebelum mulai berlaku.</p>
            )}
          </div>
        </div>

        <div>
          <label htmlFor="k-note" className="block text-xs text-slate-500">Catatan</label>
          <textarea
            id="k-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2}
            placeholder="Tautan berkas di Drive, nomor surat, atau apa yang membedakan kontrak ini dari yang sebelumnya."
            className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:border-brand-400 focus:outline-none"
          />
        </div>
      </div>
    </Drawer>
  );
}
