"use client";

import { useState } from "react";
import { Upload, FileSpreadsheet, AlertTriangle, UserMinus } from "lucide-react";
import { Modal } from "@/components/ui/drawer";
import { Button } from "@/components/ui/primitives";
import { hr } from "@/demo/api";
import { readBiometricFile, type ParsedRow } from "@/lib/biometricFile";
import { OFFICE_TZ } from "@/lib/office";
import { useToast } from "@/store/toast";
import { useTr } from "@/lib/i18n";
import type { ScanImportResult } from "@/services/hr/contracts";

/** Taking the fingerprint machine's own export.
 *
 *  The file is read here, in the browser, and turned into taps — one row per
 *  scan, exactly as the device wrote it. Three things are deliberate:
 *
 *  - **Nothing is invented.** A machine number the system has never seen is
 *    reported back as a question, not created as a person. Somebody the payroll
 *    does not know about is a conversation with HRD, and creating them silently
 *    is how a ghost ends up on a payslip (D143).
 *  - **The file is never refused for the people it does not know** (D337).
 *    Every tap of a registered person is filed; a number nobody is registered
 *    under, and a tap after somebody's last working day, are set aside and
 *    named — the rest of the week still goes in.
 *  - **Re-uploading is safe.** A tap is who and when, to the second; the second
 *    upload of the same week adds nothing.
 *  - **The time is read on the office clock** (`src/lib/office.ts`, WIB since
 *    D334). The device writes local time with no zone.
 *    Parsing it as the browser's zone would move every stamp by the distance
 *    between the reader and whoever opened the screen (F17).
 *
 *  The device's own export is `.xlsx`, not CSV — reading and parsing lives in
 *  `@/lib/biometricFile`, which handles both, because a CSV-only reader
 *  rejects every real file HRD is handed.
 */

export function ImportScans({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const tr = useTr();
  const { toast } = useToast();
  const [file, setFile] = useState<{ name: string; rows: ParsedRow[]; skipped: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ScanImportResult | null>(null);

  async function read(f: File) {
    const { rows, skipped } = await readBiometricFile(f);
    setResult(null);
    setFile({ name: f.name, rows, skipped });
    if (rows.length === 0) {
      toast("warning", tr("Nothing to read", "Tidak ada yang bisa dibaca"), tr("No row in that file had both a machine number and a time.", "Tidak ada baris di file itu yang memiliki nomor mesin sekaligus waktu."));
    }
  }

  async function run() {
    if (!file) return;
    setBusy(true);
    const res = await hr.importScans({
      filename: file.name,
      rows: file.rows.map(({ employee_ref, at, verify, location }) => ({ employee_ref, at, verify, location })),
    });
    setBusy(false);
    if (res.error) {
      toast(res.error.status === 403 ? "critical" : "warning", tr("Not imported", "Tidak diimpor"), res.error.message);
      return;
    }
    setResult(res.data);
    toast(
      res.data.added > 0 ? "success" : "info",
      tr(`${res.data.added} tap(s) added`, `${res.data.added} tap ditambahkan`),
      tr(
        `${res.data.duplicates} already on file${res.data.unknown.length > 0 ? ` · ${res.data.unknown.length} unknown number(s)` : ""}${res.data.after_left.length > 0 ? ` · ${res.data.after_left.length} already left` : ""}`,
        `${res.data.duplicates} sudah tercatat${res.data.unknown.length > 0 ? ` · ${res.data.unknown.length} nomor tidak dikenal` : ""}${res.data.after_left.length > 0 ? ` · ${res.data.after_left.length} sudah keluar` : ""}`,
      ),
    );
  }

  /* Names in the file, for a preview that reads like the file rather than like
     the database — the person uploading recognises the names, not the ids. */
  const people = file
    ? [...new Map(file.rows.map((r) => [r.employee_ref, r.name])).entries()]
    : [];
  const span = file && file.rows.length > 0
    ? [file.rows.reduce((a, r) => (r.at < a ? r.at : a), file.rows[0].at).slice(0, 10),
       file.rows.reduce((a, r) => (r.at > a ? r.at : a), file.rows[0].at).slice(0, 10)]
    : null;

  return (
    <Modal
      open
      onClose={onClose}
      width="max-w-xl"
      title={tr("Upload biometric file", "Unggah file biometrik")}
      footer={
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] text-slate-500">
            {tr("Uploading the same file twice changes nothing.", "Mengunggah file yang sama dua kali tidak mengubah apa pun.")}
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              {result ? tr("Close", "Tutup") : tr("Cancel", "Batal")}
            </Button>
            {result ? (
              <Button onClick={onDone}>{tr("Back to the timesheet", "Kembali ke absensi")}</Button>
            ) : (
              <Button icon={Upload} onClick={run} disabled={busy || !file || file.rows.length === 0}>
                {busy ? tr("Reading…", "Membaca…") : file ? tr(`Import ${file.rows.length} tap(s)`, `Impor ${file.rows.length} tap`) : tr("Import", "Impor")}
              </Button>
            )}
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <div>
          <label htmlFor="scan-file" className="block text-xs text-slate-500">
            {tr("The device’s export (.xlsx or .csv)", "Ekspor dari mesin (.xlsx atau .csv)")} — <code className="text-[11px]">Department, Name, No., Date/Time, …</code>
          </label>
          <input
            id="scan-file"
            type="file"
            accept=".csv,.xlsx,.xls,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void read(f); }}
            className="mt-1 block w-full rounded-lg border border-dashed border-slate-300 px-3 py-4 text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-brand-700 hover:border-brand-300"
          />
          <p className="mt-1 text-[11px] text-slate-500">
            {tr(`Times are read as ${OFFICE_TZ.short}, the way the machine wrote them.`, `Waktu dibaca sebagai ${OFFICE_TZ.short}, sesuai yang ditulis mesin.`)}
          </p>
        </div>

        {file && !result && (
          <div className="rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3">
            <p className="flex items-center gap-2 text-[13px] font-medium text-slate-800">
              <FileSpreadsheet className="h-4 w-4 text-slate-400" />
              {file.name}
            </p>
            <dl className="mt-2 grid grid-cols-3 gap-2 text-[12px]">
              <div>
                <dt className="text-slate-500">{tr("Taps", "Tap")}</dt>
                <dd className="font-semibold tabular-nums text-slate-800">{file.rows.length}</dd>
              </div>
              <div>
                <dt className="text-slate-500">{tr("People", "Orang")}</dt>
                <dd className="font-semibold tabular-nums text-slate-800">{people.length}</dd>
              </div>
              <div>
                <dt className="text-slate-500">{tr("Period", "Periode")}</dt>
                <dd className="font-semibold tabular-nums text-slate-800">
                  {span ? `${span[0].slice(5)} → ${span[1].slice(5)}` : "—"}
                </dd>
              </div>
            </dl>
            {file.skipped > 0 && (
              <p className="mt-2 text-[11px] text-amber-700">
                {tr(`${file.skipped} line(s) had no readable time or number and will be left out.`, `${file.skipped} baris tidak memiliki waktu atau nomor yang terbaca dan akan dilewati.`)}
              </p>
            )}
            <p className="mt-2 line-clamp-2 text-[11px] text-slate-500">
              {people.map(([ref, name]) => `${name || "?"} (${ref})`).join(" · ")}
            </p>
          </div>
        )}

        {result && (
          <div className="space-y-3">
            <dl className="grid grid-cols-3 gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-[12px]">
              <div>
                <dt className="text-slate-500">{tr("Added", "Ditambahkan")}</dt>
                <dd className="text-lg font-bold tabular-nums text-emerald-700">{result.added}</dd>
              </div>
              <div>
                <dt className="text-slate-500">{tr("Already on file", "Sudah tercatat")}</dt>
                <dd className="text-lg font-bold tabular-nums text-slate-700">{result.duplicates}</dd>
              </div>
              <div>
                <dt className="text-slate-500">{tr("Unknown number", "Nomor tidak dikenal")}</dt>
                <dd className={result.unknown.length > 0 ? "text-lg font-bold tabular-nums text-amber-700" : "text-lg font-bold tabular-nums text-slate-700"}>
                  {result.unknown.length}
                </dd>
              </div>
            </dl>

            {result.unknown.length > 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                <p className="flex items-center gap-2 text-[13px] font-semibold text-amber-900">
                  <AlertTriangle className="h-4 w-4" />
                  {tr("Numbers nobody is registered under", "Nomor yang tidak terdaftar atas nama siapa pun")}
                </p>
                <p className="mt-1 text-[12px] text-amber-900">
                  {tr(
                    "Everybody registered was imported; only these taps were left out. Nobody was created for them — add the person under",
                    "Semua karyawan terdaftar sudah masuk; hanya tap ini yang dilewati. Tidak ada orang yang dibuat untuknya — tambahkan orangnya di",
                  )}
                  <span className="font-medium"> {tr("HRD → Employees", "HRD → Karyawan")}</span>{" "}
                  {tr(
                    "with this number on the machine, then upload the file again.",
                    "dengan nomor mesin ini, lalu unggah file itu lagi.",
                  )}
                </p>
                <ul className="mt-2 flex flex-wrap gap-2">
                  {result.unknown.map((u) => (
                    <li key={u.ref} className="rounded-lg border border-amber-300 bg-white px-2 py-0.5 font-mono text-[11px] text-amber-900">
                      {u.ref} · {u.count} tap
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {result.after_left.length > 0 && (
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="flex items-center gap-2 text-[13px] font-semibold text-slate-800">
                  <UserMinus className="h-4 w-4 text-slate-500" />
                  {tr("Taps after somebody left", "Tap setelah orangnya keluar")}
                </p>
                <p className="mt-1 text-[12px] text-slate-600">
                  {tr(
                    "Set aside, not filed. If the number was given to somebody new, register them under a new number on the machine; if the person came back, reinstate them under HRD → Employees and upload again.",
                    "Disisihkan, tidak dicatat. Kalau nomornya dipakai orang baru, daftarkan orang itu dengan nomor baru di mesin; kalau orangnya kembali bekerja, aktifkan kembali di HRD → Karyawan lalu unggah lagi.",
                  )}
                </p>
                <ul className="mt-2 flex flex-wrap gap-2">
                  {result.after_left.map((u) => (
                    <li key={u.ref} className="rounded-lg border border-slate-300 bg-white px-2 py-0.5 text-[11px] text-slate-700">
                      <span className="font-mono">{u.ref}</span> · {u.name} · {tr("left", "keluar")} {u.left_on} · {u.count} tap
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
