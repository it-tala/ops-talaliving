"use client";

import { useState } from "react";
import { Upload, FileSpreadsheet, AlertTriangle } from "lucide-react";
import { Modal } from "@/components/ui/drawer";
import { Button } from "@/components/ui/primitives";
import { hr } from "@/demo/api";
import { readBiometricFile, type ParsedRow } from "@/lib/biometricFile";
import { useToast } from "@/store/toast";

/** Taking the fingerprint machine's own export.
 *
 *  The file is read here, in the browser, and turned into taps — one row per
 *  scan, exactly as the device wrote it. Three things are deliberate:
 *
 *  - **Nothing is invented.** A machine number the system has never seen is
 *    reported back as a question, not created as a person. Somebody the payroll
 *    does not know about is a conversation with HRD, and creating them silently
 *    is how a ghost ends up on a payslip (D143).
 *  - **Re-uploading is safe.** A tap is who and when, to the second; the second
 *    upload of the same week adds nothing.
 *  - **The time is read as WITA.** The device writes local time with no zone.
 *    Parsing it as the browser's zone would move every stamp by the distance
 *    between the reader and whoever opened the screen (F17).
 *
 *  The device's own export is `.xlsx`, not CSV — reading and parsing lives in
 *  `@/lib/biometricFile`, which handles both, because a CSV-only reader
 *  rejects every real file HRD is handed.
 */

export function ImportScans({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { toast } = useToast();
  const [file, setFile] = useState<{ name: string; rows: ParsedRow[]; skipped: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    added: number; duplicates: number; unknown: { ref: string; count: number }[];
  } | null>(null);

  async function read(f: File) {
    const { rows, skipped } = await readBiometricFile(f);
    setResult(null);
    setFile({ name: f.name, rows, skipped });
    if (rows.length === 0) {
      toast("warning", "Nothing to read", "No row in that file had both a machine number and a time.");
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
      toast(res.error.status === 403 ? "critical" : "warning", "Not imported", res.error.message);
      return;
    }
    setResult(res.data);
    toast(
      res.data.added > 0 ? "success" : "info",
      `${res.data.added} tap(s) added`,
      `${res.data.duplicates} already on file${res.data.unknown.length > 0 ? ` · ${res.data.unknown.length} unknown number(s)` : ""}`,
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
      title="Upload biometric file"
      footer={
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] text-slate-500">
            Uploading the same file twice changes nothing.
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              {result ? "Close" : "Cancel"}
            </Button>
            {result ? (
              <Button onClick={onDone}>Back to the timesheet</Button>
            ) : (
              <Button icon={Upload} onClick={run} disabled={busy || !file || file.rows.length === 0}>
                {busy ? "Reading…" : file ? `Import ${file.rows.length} tap(s)` : "Import"}
              </Button>
            )}
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <div>
          <label htmlFor="scan-file" className="block text-xs text-slate-500">
            The device&rsquo;s export (.xlsx or .csv) — <code className="text-[11px]">Department, Name, No., Date/Time, …</code>
          </label>
          <input
            id="scan-file"
            type="file"
            accept=".csv,.xlsx,.xls,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void read(f); }}
            className="mt-1 block w-full rounded-lg border border-dashed border-slate-300 px-3 py-4 text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-brand-700 hover:border-brand-300"
          />
          <p className="mt-1 text-[11px] text-slate-500">
            Times are read as WITA, the way the machine wrote them.
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
                <dt className="text-slate-500">Taps</dt>
                <dd className="font-semibold tabular-nums text-slate-800">{file.rows.length}</dd>
              </div>
              <div>
                <dt className="text-slate-500">People</dt>
                <dd className="font-semibold tabular-nums text-slate-800">{people.length}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Period</dt>
                <dd className="font-semibold tabular-nums text-slate-800">
                  {span ? `${span[0].slice(5)} → ${span[1].slice(5)}` : "—"}
                </dd>
              </div>
            </dl>
            {file.skipped > 0 && (
              <p className="mt-2 text-[11px] text-amber-700">
                {file.skipped} line(s) had no readable time or number and will be left out.
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
                <dt className="text-slate-500">Added</dt>
                <dd className="text-lg font-bold tabular-nums text-emerald-700">{result.added}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Already on file</dt>
                <dd className="text-lg font-bold tabular-nums text-slate-700">{result.duplicates}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Unknown number</dt>
                <dd className={result.unknown.length > 0 ? "text-lg font-bold tabular-nums text-amber-700" : "text-lg font-bold tabular-nums text-slate-700"}>
                  {result.unknown.length}
                </dd>
              </div>
            </dl>

            {result.unknown.length > 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                <p className="flex items-center gap-2 text-[13px] font-semibold text-amber-900">
                  <AlertTriangle className="h-4 w-4" />
                  Numbers nobody is registered under
                </p>
                <p className="mt-1 text-[12px] text-amber-900">
                  These taps were left out. Nobody was created for them — add the person under
                  <span className="font-medium"> HRD → Karyawan</span> with this number on the machine,
                  then upload the file again.
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
          </div>
        )}
      </div>
    </Modal>
  );
}
