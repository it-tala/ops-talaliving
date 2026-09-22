"use client";

import { use, useState } from "react";
import Link from "next/link";
import {
  ScrollText, Check, AlertTriangle, Scale, Paperclip, Undo2, CircleDashed, Sparkles,
} from "lucide-react";
import { Badge, Button, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { Loaded, SourceBadge, useLoad } from "@/components/ui/loaded";
import { cn } from "@/lib/cn";
import { hr } from "@/demo/api";
import {
  CLAUSE_LABEL, type ClauseKind, type ContractDetail, type ContractClause,
} from "@/services/hr/contracts";
import { useSession } from "@/store/session";
import { useToast } from "@/store/toast";

/** Satu kontrak, dan jarak antara apa yang tertulis dengan apa yang dijalankan.
 *
 *  Tiga hal yang layar ini lakukan dan folder PDF tidak bisa:
 *
 *  - **Daftar periksa, bukan daftar isi.** Sepuluh poin wajib, dan yang belum
 *    dijawab disebut namanya. Menambah satu poin ke daftar membuat setiap
 *    kontrak melaporkannya hari itu juga.
 *  - **Kalimat aslinya di sebelah angkanya.** Angka tanpa kalimat di
 *    belakangnya adalah angka yang tidak bisa dibantah di meja.
 *  - **Selisih terhadap sistem, tanpa menerapkannya.** Kertas bilang 14 hari,
 *    payroll membayar 12; keduanya ditampilkan dan tombolnya tidak ada di sini.
 *    Mengubah upah adalah perbuatan lain, di layar karyawan, dengan jejak yang
 *    berbunyi *upah berubah* (D155).
 */
export default function ContractPage({ params }: { params: Promise<{ no: string }> }) {
  const { no } = use(params);
  const { can } = useSession();
  const [state, reload] = useLoad(() => hr.getContract(decodeURIComponent(no)), [no]);
  const mayEdit = can("hrd.update");

  return (
    <div>
      <PageHeader
        breadcrumb="HRD · Kontrak kerja"
        title={decodeURIComponent(no)}
        description="Poin wajibnya, kalimat aslinya, dan apa yang tidak sama dengan yang dijalankan."
        actions={<SourceBadge state={state} />}
      />

      <Loaded state={state} onRetry={reload}>
        {(c) => (
          <div className="space-y-4">
            <Summary c={c} mayEdit={mayEdit} onDone={reload} />
            {c.conflicts.some((f) => f.differs) && <Conflicts c={c} />}
            <Clauses c={c} mayEdit={mayEdit} onDone={reload} />
          </div>
        )}
      </Loaded>
    </div>
  );
}

const STATUS_LABEL: Record<ContractDetail["status"], string> = {
  draft: "Draft", active: "Berjalan", superseded: "Digantikan", ended: "Berakhir",
};

function Summary({ c, mayEdit, onDone }: { c: ContractDetail; mayEdit: boolean; onDone: () => void }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [ending, setEnding] = useState(false);
  const [reason, setReason] = useState("");

  async function activate() {
    setBusy(true);
    const res = await hr.activateContract(c.contract_no);
    setBusy(false);
    if (res.error) { toast(res.error.status === 403 ? "critical" : "warning", "Belum diberlakukan", res.error.message); return; }
    toast("success", "Kontrak berlaku", `${c.contract_no} · ${c.full_name}`);
    onDone();
  }

  async function end() {
    setBusy(true);
    const res = await hr.endContract({
      contract_no: c.contract_no, ended_on: new Date().toISOString().slice(0, 10), reason,
    });
    setBusy(false);
    if (res.error) { toast(res.error.status === 403 ? "critical" : "warning", "Belum diakhiri", res.error.message); return; }
    setEnding(false); setReason("");
    toast("success", "Kontrak berakhir", c.contract_no);
    onDone();
  }

  return (
    <Card>
      <CardHeader icon={ScrollText} title={c.full_name} subtitle={`${c.employee_no} · ${c.kind}`} />
      <div className="grid gap-4 px-4 py-3.5 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Status" value={<Badge tone={c.status === "active" ? "green" : "slate"}>{STATUS_LABEL[c.status]}</Badge>} />
        <Field label="Berlaku" value={c.effective_from} />
        <Field
          label="Berakhir"
          value={c.ends_on
            ? <>
                {c.ends_on}
                {c.ends_in_days != null && c.ends_in_days <= 60 && (
                  <span className={cn("ml-1.5 text-[11px]", c.ends_in_days < 0 ? "text-rose-700" : "text-amber-700")}>
                    {c.ends_in_days < 0 ? `lewat ${-c.ends_in_days} hari` : `${c.ends_in_days} hari lagi`}
                  </span>
                )}
              </>
            : <span className="text-slate-400">tanpa batas waktu</span>}
        />
        <Field
          label="Masa percobaan"
          value={c.probation_until
            ? <>sampai {c.probation_until}</>
            : <span className="text-slate-400">belum dijawab</span>}
        />
      </div>

      {c.note && <p className="border-t border-slate-100 px-4 py-2.5 text-[12px] text-slate-600">{c.note}</p>}

      <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 px-4 py-3">
        <span className="inline-flex items-center gap-1.5 text-[12px] text-slate-600">
          <Paperclip className="size-3.5 text-slate-400" />
          {c.attachment_id
            ? <>Berkas yang ditandatangani terlampir{c.sha256 && <span className="ml-1 font-mono text-[11px] text-slate-400">{c.sha256}</span>}</>
            : <span className="text-amber-700">Berkas yang ditandatangani belum terlampir</span>}
        </span>

        {c.superseded_by && (
          <span className="text-[12px] text-slate-500">
            Digantikan oleh{" "}
            <Link href={`/hrd/kontrak/${c.superseded_by}`} className="font-mono text-brand-700 hover:underline">
              {c.superseded_by}
            </Link>
          </span>
        )}
        {c.ended_reason && (
          <span className="text-[12px] text-slate-500">Berakhir {c.ended_on} — {c.ended_reason}</span>
        )}

        <div className="ml-auto flex items-center gap-2">
          {mayEdit && c.status === "draft" && (
            <Button size="sm" icon={Check} disabled={busy} onClick={activate}>
              Berlakukan
            </Button>
          )}
          {mayEdit && c.status === "active" && !ending && (
            <Button size="sm" variant="ghost" icon={Undo2} disabled={busy} onClick={() => setEnding(true)}>
              Akhiri
            </Button>
          )}
        </div>
      </div>

      {ending && (
        <div className="border-t border-slate-100 px-4 py-3">
          <input
            value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder="Kenapa berakhir — habis masa, mengundurkan diri, diakhiri…"
            className="h-9 w-full rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
          />
          <p className="mt-1 text-[11px] text-slate-500">Itu yang ditanyakan enam bulan lagi.</p>
          <div className="mt-2 flex justify-end gap-2">
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setEnding(false); setReason(""); }}>
              Batal
            </Button>
            <Button size="sm" disabled={busy || !reason.trim()} onClick={end}>Akhiri kontrak</Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-0.5 text-[13px] text-slate-700">{value}</dd>
    </div>
  );
}

/** Yang tertulis, dan yang dijalankan. **Tidak ada tombol menerapkan di sini**
 *  dan itu disengaja: mengubah upah adalah perbuatan lain, di layar karyawan,
 *  dengan jejaknya sendiri. */
function Conflicts({ c }: { c: ContractDetail }) {
  const rows = c.conflicts.filter((f) => f.differs);
  return (
    <Card>
      <CardHeader
        icon={Scale}
        title="Tidak sama dengan yang dijalankan"
        subtitle="Kertasnya mengatakan satu hal dan sistem menjalankan yang lain. Keduanya ditampilkan; yang memutuskan adalah orang."
      />
      <div className="divide-y divide-slate-50">
        {rows.map((f) => (
          <div key={f.kind} className="px-4 py-3">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="text-[13px] font-semibold text-slate-800">{CLAUSE_LABEL[f.kind]}</span>
              <span className="rounded bg-amber-50 px-1.5 py-0.5 font-mono text-[12px] text-amber-800 ring-1 ring-amber-200">
                kertas: {f.says}
              </span>
              <span className="rounded bg-slate-50 px-1.5 py-0.5 font-mono text-[12px] text-slate-700 ring-1 ring-slate-200">
                sistem: {f.runs}
              </span>
              {f.bears_on && <span className="font-mono text-[11px] text-slate-400">{f.bears_on}</span>}
            </div>
            <p className="mt-1.5 border-l-2 border-slate-200 pl-2.5 text-[12px] italic text-slate-600">
              {f.quote}
            </p>
          </div>
        ))}
      </div>
      <p className="border-t border-slate-100 px-4 py-2.5 text-[11px] text-slate-500">
        Menerapkannya dilakukan di layar karyawan, bukan di sini — supaya jejaknya berbunyi
        <em> upah berubah</em>, karena itulah yang terjadi.
      </p>
    </Card>
  );
}

function Clauses({ c, mayEdit, onDone }: { c: ContractDetail; mayEdit: boolean; onDone: () => void }) {
  const byKind = new Map(c.clauses.map((cl) => [cl.kind, cl]));
  return (
    <Card>
      <CardHeader
        icon={ScrollText}
        title="Poin kontrak"
        subtitle={c.required_missing > 0
          ? `${c.required_missing} poin wajib belum dijawab. Kontrak yang berlaku tanpa poin wajibnya adalah kontrak yang tidak bisa dijawab waktu ditanya.`
          : "Semua poin wajib sudah dijawab."}
      />
      <div className="divide-y divide-slate-50">
        {c.coverage.map((k) => (
          <ClauseRow
            key={k.kind}
            contractNo={c.contract_no}
            kind={k.kind}
            required={k.required}
            what={k.what}
            clause={byKind.get(k.kind) ?? null}
            mayEdit={mayEdit}
            onDone={onDone}
          />
        ))}
      </div>
    </Card>
  );
}

function ClauseRow({
  contractNo, kind, required, what, clause, mayEdit, onDone,
}: {
  contractNo: string; kind: ClauseKind; required: boolean; what: string;
  clause: ContractClause | null; mayEdit: boolean; onDone: () => void;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [quote, setQuote] = useState(clause?.quote ?? "");
  const [value, setValue] = useState(
    clause?.value ? JSON.stringify(clause.value) : "");

  async function confirm() {
    let parsed: Record<string, string> | null = null;
    if (value.trim()) {
      try { parsed = JSON.parse(value) as Record<string, string>; }
      catch { toast("warning", "Bacaannya belum bisa dibaca", "Tulis sebagai JSON, misalnya {\"amount\":\"180000\",\"per\":\"day\"}."); return; }
    }
    setBusy(true);
    const res = await hr.confirmClause({ contract_no: contractNo, kind, quote, value: parsed });
    setBusy(false);
    if (res.error) { toast(res.error.status === 403 ? "critical" : "warning", "Belum tersimpan", res.error.message); return; }
    setOpen(false);
    toast("success", "Poin dikonfirmasi", CLAUSE_LABEL[kind]);
    onDone();
  }

  return (
    <div className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] font-semibold text-slate-800">{CLAUSE_LABEL[kind]}</span>
        {required && <Badge tone="slate">wajib</Badge>}
        {clause?.confirmed && <Badge tone="green">dikonfirmasi</Badge>}
        {clause && !clause.confirmed && (
          <Badge tone="violet">
            <Sparkles className="mr-1 inline size-3" />usulan mesin
          </Badge>
        )}
        {!clause && required && <Badge tone="amber">belum dijawab</Badge>}
        {!clause && !required && <CircleDashed className="size-3.5 text-slate-300" />}
        {clause?.confirmed && clause.source === "extracted" && (
          <span className="text-[11px] text-slate-400">bacaan mesin, diterima apa adanya</span>
        )}
        {mayEdit && !open && (
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setOpen(true)}>
            {clause?.confirmed ? "Ubah" : clause ? "Periksa usulan" : "Jawab"}
          </Button>
        )}
      </div>

      {what && !clause && <p className="mt-0.5 text-[11px] text-slate-500">{what}</p>}

      {clause && (
        <>
          <p className="mt-1.5 border-l-2 border-slate-200 pl-2.5 text-[12px] italic text-slate-600">
            {clause.quote}
            {clause.page != null && <span className="ml-1.5 not-italic text-[11px] text-slate-400">hal. {clause.page}</span>}
          </p>
          {clause.value && (
            <p className="mt-1 font-mono text-[11px] text-slate-500">
              {Object.entries(clause.value).map(([k, v]) => `${k}: ${v}`).join(" · ")}
            </p>
          )}
        </>
      )}

      {open && (
        <div className="mt-2 space-y-2 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
          <div>
            <label className="text-[11px] uppercase tracking-wide text-slate-400">Kalimat aslinya</label>
            <textarea
              value={quote} onChange={(e) => setQuote(e.target.value)} rows={2}
              placeholder="Salin kalimatnya dari kontrak, apa adanya."
              className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:border-brand-400 focus:outline-none"
            />
            <p className="mt-0.5 text-[11px] text-slate-500">
              Angka tanpa kalimat di belakangnya adalah angka yang tidak bisa dibantah di meja.
            </p>
          </div>
          <div>
            <label className="text-[11px] uppercase tracking-wide text-slate-400">Bacaannya</label>
            <input
              value={value} onChange={(e) => setValue(e.target.value)}
              placeholder={'{"amount":"180000","per":"day"}'}
              className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 font-mono text-[12px] focus:border-brand-400 focus:outline-none"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setOpen(false)}>Batal</Button>
            <Button size="sm" icon={Check} disabled={busy || !quote.trim()} onClick={confirm}>Konfirmasi</Button>
          </div>
        </div>
      )}
    </div>
  );
}
