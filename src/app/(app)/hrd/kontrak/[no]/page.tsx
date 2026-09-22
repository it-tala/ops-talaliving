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
  CLAUSE_LABEL, CLAUSE_FIELDS, clauseValueOk,
  type ClauseKind, type ClauseField, type ContractDetail, type ContractClause,
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
  /* *Jam kerja* menunjuk sebuah jadwal yang harus benar-benar ada — mengetik
     kodenya bebas berarti menunjuk jadwal yang tidak ada dan baru tahu di
     payroll. Kalau daftarnya belum datang, bidangnya turun jadi kotak ketik
     biasa: satu daftar yang gagal dimuat tidak boleh mengunci seluruh
     formulir. */
  const [schedules] = useLoad(() => hr.listSchedules(), []);
  const codes = schedules.status === "ready"
    ? schedules.data.schedules.map((w) => ({ code: w.code, name: w.name }))
    : null;
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
            codes={codes}
            onDone={onDone}
          />
        ))}
      </div>
    </Card>
  );
}

function ClauseRow({
  contractNo, kind, required, what, clause, mayEdit, codes, onDone,
}: {
  contractNo: string; kind: ClauseKind; required: boolean; what: string;
  clause: ContractClause | null; mayEdit: boolean; codes: Schedule[] | null;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const fields = CLAUSE_FIELDS[kind];
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [quote, setQuote] = useState(clause?.quote ?? "");
  const [value, setValue] = useState<Record<string, string>>(clause?.value ?? {});

  /* Poin tanpa bentuk disimpan sebagai kalimat saja, jadi jawabannya *tidak
     punya* nilai — mengirim `{}` ke sana akan menyimpan objek kosong yang
     terbaca seperti jawaban yang hilang isinya. */
  const shaped = fields.length > 0;
  const ready = quote.trim() !== "" && (!shaped || clauseValueOk(kind, value));

  async function confirm() {
    setBusy(true);
    const res = await hr.confirmClause({
      contract_no: contractNo, kind, quote, value: shaped ? value : null,
    });
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
          <Button
            size="sm" variant="ghost" className="ml-auto"
            /* Dibaca ulang dari klausulnya tiap kali dibuka. Tanpa ini sebuah
               ketikan yang ditinggalkan lewat *Batal* masih ada waktu kotaknya
               dibuka lagi, terlihat persis seperti nilai yang tersimpan. */
            onClick={() => {
              setQuote(clause?.quote ?? "");
              setValue(clause?.value ?? {});
              setOpen(true);
            }}
          >
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
            <p className="mt-1 text-[11px] text-slate-500">
              {fields.map((f) => `${f.label}: ${readable(f, clause.value?.[f.key] ?? "")}`).join(" · ")}
            </p>
          )}
        </>
      )}

      {open && (
        <div className="mt-2 space-y-2.5 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
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

          {shaped ? (
            <div className="grid gap-2.5 sm:grid-cols-2">
              {fields.map((f) => (
                <FieldInput
                  key={f.key}
                  field={f}
                  codes={codes}
                  value={value[f.key] ?? ""}
                  onChange={(v) => setValue((prev) => ({ ...prev, [f.key]: v }))}
                />
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-slate-500">
              Poin ini disimpan sebagai kalimatnya saja — tidak ada angka yang dibandingkan
              dengan apa pun, jadi tidak ada yang perlu diisi selain kutipannya.
            </p>
          )}

          <div className="flex items-center justify-end gap-2">
            {shaped && !ready && quote.trim() !== "" && (
              <span className="mr-auto text-[11px] text-slate-500">Lengkapi isian di atas.</span>
            )}
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setOpen(false)}>Batal</Button>
            <Button size="sm" icon={Check} disabled={busy || !ready} onClick={confirm}>Konfirmasi</Button>
          </div>
        </div>
      )}
    </div>
  );
}

interface Schedule { code: string; name: string }

/** Satu bidang, bentuknya menurut `CLAUSE_FIELDS` — yang dijaga sama dengan
 *  `ops_hr.clause_value_ok` oleh `scripts/check-clause-fields.mjs`. */
function FieldInput({
  field, value, codes, onChange,
}: {
  field: ClauseField; value: string; codes: Schedule[] | null;
  onChange: (v: string) => void;
}) {
  const box = "mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm focus:border-brand-400 focus:outline-none";
  return (
    <div>
      <label className="text-[11px] uppercase tracking-wide text-slate-400">{field.label}</label>
      {field.input === "choice" ? (
        <select value={value} onChange={(e) => onChange(e.target.value)} className={box}>
          <option value="">— pilih —</option>
          {field.options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      ) : field.input === "schedule" ? (
        codes
          ? (
            <select value={value} onChange={(e) => onChange(e.target.value)} className={box}>
              <option value="">— pilih —</option>
              {codes.map((c) => (
                <option key={c.code} value={c.code}>{c.code} — {c.name}</option>
              ))}
            </select>
          )
          : (
            <input
              value={value} onChange={(e) => onChange(e.target.value)}
              placeholder="kode jadwal" className={cn(box, "font-mono text-[12px]")}
            />
          )
      ) : (
        <div className="relative">
          <input
            value={value} inputMode="numeric"
            onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, ""))}
            placeholder={field.placeholder}
            className={cn(box, "tabular-nums", field.unit && "pr-12")}
          />
          {field.unit && (
            <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] text-slate-400">
              {field.unit}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/** Nilai tersimpan dibaca kembali sebagai kata, bukan sebagai kode: sebuah
 *  baris yang berbunyi `mode: pro_rata` menyuruh pembacanya menebak. */
function readable(field: ClauseField, stored: string): string {
  if (field.input === "choice") {
    return field.options.find((o) => o.value === stored)?.label ?? stored;
  }
  if (field.input === "digits" && /^[0-9]+$/.test(stored)) {
    const n = Number(stored).toLocaleString("id-ID");
    return field.unit === "Rp" ? `Rp ${n}` : field.unit ? `${n} ${field.unit}` : n;
  }
  return stored;
}
