"use client";

import { useMemo, useState } from "react";
import { ArrowRightLeft, Ban, Landmark, Lock, Save, ScanLine } from "lucide-react";
import { Badge, Button, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { Loaded, SourceBadge, useLoad } from "@/components/ui/loaded";
import { Modal } from "@/components/ui/drawer";
import { ImageTiles } from "@/components/ui/image-tiles";
import { NumberInput } from "@/components/ui/number-input";
import { MoneyInput } from "@/components/ui/money-input";
import { ExcelTable } from "@/components/ui/excel-export";
import { formatIDR } from "@/lib/format";
import { cn } from "@/lib/cn";
import { accounting } from "@/demo/api";
import type {
  AccountBalance, AccountStateView, EvidenceInboxRow, FxConversionView,
} from "@/services/accounting/contracts";
import { guessConversion } from "@/services/accounting/conversion";
import { useSession } from "@/store/session";
import { useToast } from "@/store/toast";
import { useTr } from "@/lib/i18n";

const USD_ACCOUNT = "BCA USD 081";
const IDR_ACCOUNT = "BCA 064";

const usd = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const idr = (n: number | null | undefined) => (n === null || n === undefined ? "—" : formatIDR(n));
const inCcy = (ccy: string, n: number | null | undefined) => (ccy === "IDR" ? idr(n) : usd(n));
const day = (d: string) => `${d.slice(8)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

/** One Chat message: every file Evin sent together. The capture worker files
 *  each as `<message id>~<file id>`. */
interface Message { id: string; rows: EvidenceInboxRow[]; caption: string | null; sentAt: string; by: string | null }

/** Files that belong here: bank screens and advices for 064/081, as opposed
 *  to a nota for Verifikasi. A guess for the list only — nothing is booked
 *  from it. */
const LEADERSHIP_TEXT = /(064|081|USD|portfolio|account summary|konversi|IDR\s*1)/i;

function groupMessages(rows: EvidenceInboxRow[]): Message[] {
  const by = new Map<string, EvidenceInboxRow[]>();
  for (const r of rows) {
    const id = r.ref_id.split("~")[0];
    by.set(id, [...(by.get(id) ?? []), r]);
  }
  return [...by.entries()]
    .map(([id, rs]) => ({
      id, rows: rs,
      caption: rs.map((r) => (r.extracted as { caption?: string | null }).caption).find(Boolean) ?? null,
      sentAt: rs[0].reported_at, by: rs[0].reported_by_name,
    }))
    .filter((m) => m.rows.some((r) => LEADERSHIP_TEXT.test(`${r.extracted.note ?? ""} ${m.caption ?? ""}`)))
    .sort((a, b) => (a.sentAt < b.sentAt ? 1 : -1));
}

/** BCA USD 081 and BCA 064, read from the bank's own screen (D456).
 *
 *  Nobody here sees every movement on these two accounts — client money,
 *  dollars arriving, the bank's monthly fee — so their balance is not summed
 *  from rows. It is what Evin's screenshots show: a conversion records USD
 *  awal, dikonversi, kurs, IDR diterima and the balances after it; a
 *  screenshot alone records a balance. Whatever moved between two readings
 *  that no row explains is shown as *tidak tercatat*, never booked. */
export default function LeadershipAccountsPage() {
  const tr = useTr();
  const { hasAuthority } = useSession();
  const mayRead = hasAuthority("approve_funds");
  const [data, reload] = useLoad(async () => {
    const [accounts, conversions, states, inbox] = await Promise.all([
      accounting.listAccounts(), accounting.listFxConversions(),
      accounting.listAccountStates(), accounting.listInbox(),
    ]);
    if (accounts.error) return accounts;
    if (conversions.error) return conversions;
    if (states.error) return states;
    if (inbox.error) return inbox;
    return { data: { accounts: accounts.data, conversions: conversions.data, states: states.data, inbox: inbox.data } };
  }, []);
  const [converting, setConverting] = useState<Message | null>(null);
  const [reading, setReading] = useState<{ row: EvidenceInboxRow; caption: string | null } | null>(null);

  return (
    <div>
      <PageHeader
        breadcrumb={tr("Accounting", "Akuntansi")}
        title={tr("Leadership accounts", "Rekening pimpinan")}
        description={tr(
          "BCA USD 081 and BCA 064 are read from the bank's screen in Evin's messages, not summed from rows: a conversion records USD before, converted, rate, rupiah received and the balances after; a screenshot records a balance. What moved between two readings that no row explains is shown, never booked.",
          "BCA USD 081 dan BCA 064 dibaca dari layar bank di pesan Evin, bukan dijumlah dari baris: konversi mencatat USD awal, dikonversi, kurs, IDR diterima dan saldo sesudahnya; screenshot mencatat saldo. Yang bergerak di antara dua bacaan tanpa baris yang menjelaskannya ditampilkan, tidak dibukukan.")}
        actions={<SourceBadge state={data} />}
      />

      {!mayRead ? (
        <Card className="p-6 text-[13px] text-slate-600">
          <Lock className="mb-2 h-5 w-5 text-slate-400" />
          {tr("These two accounts are held by leadership. Only someone who approves funds sees them (D391).",
            "Dua rekening ini dipegang pimpinan. Hanya pemegang wewenang approve_funds yang melihatnya (D391).")}
        </Card>
      ) : (
        <Loaded state={data} onRetry={reload}>
          {(d) => (
            <div className="space-y-5">
              <Balances accounts={d.accounts} />
              <Waiting messages={groupMessages(d.inbox)}
                onConvert={setConverting} onRead={(row, caption) => setReading({ row, caption })} />
              <ConversionLog rows={d.conversions} />
              <Readings rows={d.states} onVoided={reload} />
            </div>
          )}
        </Loaded>
      )}

      {converting && (
        <ConversionModal message={converting} onClose={() => setConverting(null)}
          onSaved={() => { setConverting(null); reload(); }} />
      )}
      {reading && (
        <ReadingModal row={reading.row} caption={reading.caption} onClose={() => setReading(null)}
          onSaved={() => { setReading(null); reload(); }} />
      )}
    </div>
  );
}

function Balances({ accounts }: { accounts: AccountBalance[] }) {
  const tr = useTr();
  const two = accounts.filter((a) => a.code === USD_ACCOUNT || a.code === IDR_ACCOUNT);
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {two.map((a) => (
        <Card key={a.code} className="p-4">
          <div className="flex items-center gap-2 text-[12px] text-slate-500"><Landmark className="h-4 w-4" />{a.code}</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">
            {a.balance_anchored_on ? inCcy(a.currency, a.balance) : "—"}
          </div>
          <div className="text-[12px] text-slate-500">
            {a.balance_anchored_on
              ? tr(`From the bank reading of ${day(a.balance_anchored_on)}, plus the rows recorded after it.`,
                `Dari bacaan bank ${day(a.balance_anchored_on)}, ditambah baris yang tercatat sesudahnya.`)
              : tr("No bank reading yet — record one from Evin's screenshot.", "Belum ada bacaan bank — catat dari screenshot Evin.")}
          </div>
        </Card>
      ))}
    </div>
  );
}

function Waiting({ messages, onConvert, onRead }: {
  messages: Message[]; onConvert: (m: Message) => void; onRead: (row: EvidenceInboxRow, caption: string | null) => void;
}) {
  const tr = useTr();
  return (
    <Card>
      <CardHeader icon={ScanLine} title={tr("Waiting from Chat", "Menunggu dari Chat")}
        subtitle={tr("Evin's messages about 064 and 081 not yet recorded. A transfer 064 → 271 or to EJO is booked in Purchase Verification as before.",
          "Pesan Evin tentang 064 dan 081 yang belum dicatat. Transfer 064 → 271 atau ke EJO tetap dibukukan di Verifikasi seperti biasa.")} />
      {messages.length === 0 ? (
        <p className="px-4 pb-4 text-[13px] text-slate-500">{tr("Nothing waiting.", "Tidak ada yang menunggu.")}</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {messages.map((m) => {
            const g = guessConversion(m.caption);
            return (
              <li key={m.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-start">
                <ImageTiles className="w-full sm:w-56 sm:shrink-0"
                  files={m.rows.map((r) => ({ id: r.attachment_id, filename: r.extracted.note ?? r.ref_id, url: r.file_key?.startsWith("http") ? r.file_key : null }))} />
                <div className="min-w-0 flex-1 text-[13px]">
                  <div className="text-slate-500">{day(m.sentAt.slice(0, 10))} · {m.by ?? "—"} · {m.rows.length} {tr("file(s)", "file")}</div>
                  {m.caption && <div className="mt-1 font-mono text-[12px] text-slate-800">“{m.caption}”</div>}
                  <ul className="mt-1 space-y-0.5 text-[12px] text-slate-600">
                    {m.rows.map((r) => (
                      <li key={r.ref_id} className="flex flex-wrap items-center gap-2">
                        <span>{r.extracted.doc_type ?? "—"} · {r.extracted.note ?? r.ref_id}</span>
                        <Button size="sm" variant="ghost" onClick={() => onRead(r, m.caption)}>{tr("Record balance", "Catat saldo")}</Button>
                      </li>
                    ))}
                  </ul>
                </div>
                <Button icon={ArrowRightLeft} variant={g.usd ? "primary" : "outline"} onClick={() => onConvert(m)}>
                  {tr("Record conversion", "Catat konversi")}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function ConversionLog({ rows }: { rows: FxConversionView[] }) {
  const tr = useTr();
  return (
    <Card>
      <CardHeader icon={ArrowRightLeft} title={tr("BCA USD 081 — conversions", "BCA USD 081 — konversi")}
        subtitle={tr("No running balance on 081: each conversion is its own state. A USD before that does not follow from the last USD after is money nobody saw arrive — shown, not booked.",
          "Tidak ada saldo berjalan di 081: setiap konversi adalah state sendiri. USD awal yang tidak sama dengan USD sisa sebelumnya adalah uang masuk yang tidak terlihat — ditampilkan, tidak dibukukan.")} />
      <div className="overflow-x-auto">
        <ExcelTable className="w-full text-[13px]">
          <thead>
            <tr className="border-y border-slate-100 bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
              <th className="px-4 py-2">{tr("Date", "Tanggal")}</th>
              <th className="px-4 py-2 text-right">{tr("USD before", "USD awal")}</th>
              <th className="px-4 py-2 text-right">{tr("Converted", "Dikonversi")}</th>
              <th className="px-4 py-2 text-right">{tr("Rate", "Kurs")}</th>
              <th className="px-4 py-2 text-right">{tr("IDR received", "IDR diterima")}</th>
              <th className="px-4 py-2 text-right">{tr("USD after", "USD sisa")}</th>
              <th className="px-4 py-2 text-right">{tr("IDR after (064)", "IDR sisa (064)")}</th>
              <th className="px-4 py-2">{tr("Rows", "Baris")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-4 text-slate-500">{tr("No conversion recorded yet.", "Belum ada konversi tercatat.")}</td></tr>
            )}
            {rows.map((c) => (
              <tr key={c.transfer_id} className="border-b border-slate-100 align-top">
                <td className="whitespace-nowrap px-4 py-2 font-mono text-[12px]">{day(c.trx_date)}</td>
                <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums">
                  {usd(c.foreign_before)}
                  {c.foreign_jump !== null && Math.abs(c.foreign_jump) >= 0.01 && (
                    <span className="mt-0.5 block" title={tr(`Last USD after was ${usd(c.previous_foreign_after)}`, `USD sisa sebelumnya ${usd(c.previous_foreign_after)}`)}>
                      <Badge tone={c.foreign_jump > 0 ? "brand" : "amber"}>
                        {c.foreign_jump > 0 ? "+" : ""}{usd(c.foreign_jump)} {tr("new state", "state baru")}
                      </Badge>
                    </span>
                  )}
                </td>
                <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums">{usd(c.foreign_amount)}</td>
                <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums">{(c.rate ?? c.effective_rate).toLocaleString("id-ID")}</td>
                <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums">{idr(c.idr_amount)}</td>
                <td className="whitespace-nowrap px-4 py-2 text-right font-medium tabular-nums">{usd(c.foreign_after)}</td>
                <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums">{idr(c.idr_after)}</td>
                <td className="whitespace-nowrap px-4 py-2 font-mono text-[11px] text-slate-500">{c.out_trx_no}<br />{c.in_trx_no}</td>
              </tr>
            ))}
          </tbody>
        </ExcelTable>
      </div>
    </Card>
  );
}

function Readings({ rows, onVoided }: { rows: AccountStateView[]; onVoided: () => void }) {
  const tr = useTr();
  const { toast } = useToast();
  async function voidIt(s: AccountStateView) {
    const reason = window.prompt(tr("Why was this reading wrong?", "Kenapa bacaan ini salah?"));
    if (!reason) return;
    const res = await accounting.voidAccountState(s.id, reason);
    if (res.error) { toast("warning", tr("Not voided", "Tidak dibatalkan"), res.error.message); return; }
    onVoided();
  }
  return (
    <Card>
      <CardHeader icon={Landmark} title={tr("Bank readings", "Bacaan bank")}
        subtitle={tr("Each balance the bank showed, against the one before it. 'Not recorded' is what the bank moved that no ledger row explains — a bank fee, money arriving.",
          "Setiap saldo yang ditunjukkan bank, dibanding bacaan sebelumnya. 'Tidak tercatat' adalah gerak bank yang tidak dijelaskan baris ledger mana pun — biaya bank, uang masuk.")} />
      <div className="overflow-x-auto">
        <ExcelTable className="w-full text-[13px]">
          <thead>
            <tr className="border-y border-slate-100 bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
              <th className="px-4 py-2">{tr("Date", "Tanggal")}</th>
              <th className="px-4 py-2">{tr("Account", "Rekening")}</th>
              <th className="px-4 py-2 text-right">{tr("Bank shows", "Saldo bank")}</th>
              <th className="px-4 py-2 text-right">{tr("Previous", "Sebelumnya")}</th>
              <th className="px-4 py-2 text-right">{tr("Rows in between", "Baris di antaranya")}</th>
              <th className="px-4 py-2 text-right">{tr("Not recorded", "Tidak tercatat")}</th>
              <th className="px-4 py-2">{tr("Note", "Catatan")}</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-4 text-slate-500">{tr("No reading recorded yet.", "Belum ada bacaan tercatat.")}</td></tr>
            )}
            {rows.map((s) => (
              <tr key={s.id} className={cn("border-b border-slate-100 align-top", s.voided_at && "opacity-50 line-through")}>
                <td className="whitespace-nowrap px-4 py-2 font-mono text-[12px]">
                  {day(s.as_of)}
                  <span className="block text-[10px] text-slate-400 no-underline">{s.after_trx_no ? tr(`after ${s.after_trx_no}`, `sesudah ${s.after_trx_no}`) : tr("end of day", "akhir hari")}</span>
                </td>
                <td className="whitespace-nowrap px-4 py-2">{s.account_code}</td>
                <td className="whitespace-nowrap px-4 py-2 text-right font-medium tabular-nums">{inCcy(s.currency, s.balance)}</td>
                <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums text-slate-500">{inCcy(s.currency, s.previous_balance)}</td>
                <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums text-slate-500">{inCcy(s.currency, s.recorded_movement)}</td>
                <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums">
                  {s.unrecorded === null ? <span className="text-slate-300">—</span>
                    : Math.abs(s.unrecorded) < 0.005 ? <Badge tone="green">{tr("matches", "cocok")}</Badge>
                    : <span className={s.unrecorded < 0 ? "text-amber-700" : "text-sky-700"}>{s.unrecorded > 0 ? "+" : ""}{inCcy(s.currency, s.unrecorded)}</span>}
                </td>
                <td className="px-4 py-2 text-[12px] text-slate-500">
                  {s.voided_at ? s.void_reason : s.note}
                  {s.recorded_by_name && <span className="block text-[10px] text-slate-400">{s.recorded_by_name}</span>}
                </td>
                <td className="px-4 py-2 text-right">
                  {!s.voided_at && <Button size="sm" variant="ghost" icon={Ban} onClick={() => voidIt(s)} aria-label={tr("Void", "Batalkan")} />}
                </td>
              </tr>
            ))}
          </tbody>
        </ExcelTable>
      </div>
    </Card>
  );
}

const field = "mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none";

function ConversionModal({ message, onClose, onSaved }: { message: Message; onClose: () => void; onSaved: () => void }) {
  const tr = useTr();
  const { toast } = useToast();
  const g = useMemo(() => guessConversion(message.caption), [message.caption]);
  const proof = message.rows.find((r) => r.extracted.doc_type === "Payment Proof") ?? message.rows[0];
  const [date, setDate] = useState(proof.extracted.document_date ?? message.sentAt.slice(0, 10));
  const [before, setBefore] = useState(0);
  const [amount, setAmount] = useState(g.usd ?? 0);
  const [rate, setRate] = useState(g.rate ?? 0);
  const [rupiah, setRupiah] = useState(g.idr ?? 0);
  const [idrAfter, setIdrAfter] = useState(0);
  const [busy, setBusy] = useState(false);
  const after = Math.round((before - amount) * 100) / 100;
  const product = Math.round(amount * rate);
  const rateOff = rate > 0 && amount > 0 && Math.abs(product - rupiah) > 1;

  async function save() {
    setBusy(true);
    const res = await accounting.recordConversion({
      trx_date: date, foreign_before: before, foreign_amount: amount, idr_amount: rupiah,
      rate: rate > 0 ? rate : null, idr_after: idrAfter > 0 ? idrAfter : null,
      inbox_ref: proof.ref_id, also_inbox_refs: message.rows.map((r) => r.ref_id).filter((r) => r !== proof.ref_id),
    });
    setBusy(false);
    if (res.error) { toast("warning", tr("Not recorded", "Tidak tercatat"), res.error.message); return; }
    toast("success", tr("Conversion recorded", "Konversi tercatat"),
      `${usd(amount)} → ${idr(rupiah)} · ${tr("USD after", "USD sisa")} ${usd(res.data.foreign_after)}`);
    onSaved();
  }

  return (
    <Modal open onClose={onClose} width="max-w-lg" title={tr("Record a conversion", "Catat konversi")}>
      <div className="space-y-4 text-[13px]">
        {message.caption && <p className="rounded-lg bg-slate-50 px-3 py-2 font-mono text-[12px] text-slate-700">“{message.caption}”</p>}
        <p className="text-[12px] text-slate-500">
          {tr("From the advice and the Account Summary in this message. USD before is what 081 showed before the conversion; it does not have to follow from the last one.",
            "Dari advice dan Account Summary di pesan ini. USD awal adalah saldo 081 sebelum konversi; tidak harus sama dengan USD sisa sebelumnya.")}
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="cv-date" className="block text-xs text-slate-500">{tr("Date", "Tanggal")}</label>
            <input id="cv-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className={field} />
          </div>
          <div>
            <label htmlFor="cv-before" className="block text-xs text-slate-500">{tr("USD before (081)", "USD awal (081)")}</label>
            <NumberInput id="cv-before" value={before} onChange={setBefore} step={0.01} min={0} className="mt-1" />
          </div>
          <div>
            <label htmlFor="cv-amount" className="block text-xs text-slate-500">{tr("USD converted", "USD dikonversi")}</label>
            <NumberInput id="cv-amount" value={amount} onChange={setAmount} step={0.01} min={0} className="mt-1" />
          </div>
          <div>
            <label htmlFor="cv-rate" className="block text-xs text-slate-500">{tr("Rate", "Kurs")}</label>
            <NumberInput id="cv-rate" value={rate} onChange={setRate} step={1} min={0} className="mt-1" />
          </div>
          <div>
            <label htmlFor="cv-idr" className="block text-xs text-slate-500">{tr("IDR received (064)", "IDR diterima (064)")}</label>
            <MoneyInput id="cv-idr" value={rupiah} onChange={setRupiah} className="mt-1" />
          </div>
          <div>
            <label htmlFor="cv-after" className="block text-xs text-slate-500">{tr("064 balance after (optional)", "Saldo 064 sesudah (opsional)")}</label>
            <MoneyInput id="cv-after" value={idrAfter} onChange={setIdrAfter} className="mt-1" />
          </div>
        </div>
        <p className={cn("rounded-lg px-3 py-2 text-[12px]", before >= amount && amount > 0 ? "bg-slate-50 text-slate-700" : "bg-amber-50 text-amber-800")}>
          {tr("USD after", "USD sisa")}: <strong className="tabular-nums">{usd(after)}</strong>
          {rateOff && <span className="block text-amber-700">{tr(`${usd(amount)} × ${rate} = ${idr(product)}, not ${idr(rupiah)}.`, `${usd(amount)} × ${rate} = ${idr(product)}, bukan ${idr(rupiah)}.`)}</span>}
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>{tr("Cancel", "Batal")}</Button>
          <Button icon={Save} onClick={save} disabled={busy || !date || amount <= 0 || rupiah <= 0 || before < amount || rateOff}>
            {busy ? tr("Saving…", "Menyimpan…") : tr("Record", "Catat")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function ReadingModal({ row, caption, onClose, onSaved }: {
  row: EvidenceInboxRow; caption: string | null; onClose: () => void; onSaved: () => void;
}) {
  const tr = useTr();
  const { toast } = useToast();
  const [account, setAccount] = useState<string>(/081|usd/i.test(row.extracted.note ?? "") && !/064/.test(row.extracted.note ?? "") ? USD_ACCOUNT : IDR_ACCOUNT);
  const [date, setDate] = useState(row.extracted.document_date ?? row.reported_at.slice(0, 10));
  const [balance, setBalance] = useState(0);
  const [busy, setBusy] = useState(false);
  const isUsd = account === USD_ACCOUNT;

  async function save() {
    setBusy(true);
    const res = await accounting.recordAccountState({ account_code: account, as_of: date, balance, inbox_ref: row.ref_id });
    setBusy(false);
    if (res.error) { toast("warning", tr("Not recorded", "Tidak tercatat"), res.error.message); return; }
    toast("success", tr("Balance recorded", "Saldo tercatat"), `${account} · ${day(date)} · ${inCcy(isUsd ? "USD" : "IDR", balance)}`);
    onSaved();
  }

  return (
    <Modal open onClose={onClose} width="max-w-md" title={tr("Record a bank balance", "Catat saldo bank")}>
      <div className="space-y-4 text-[13px]">
        <p className="text-slate-600">{row.extracted.note ?? row.ref_id}</p>
        {caption && <p className="font-mono text-[12px] text-slate-500">“{caption}”</p>}
        <p className="text-[12px] text-slate-500">
          {tr("Type the balance exactly as the screenshot shows it, at the end of that day. An Account Summary that shows both accounts is recorded once for each.",
            "Ketik saldo persis seperti di screenshot, per akhir hari itu. Account Summary yang memuat dua rekening dicatat sekali untuk masing-masing.")}
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="rd-acc" className="block text-xs text-slate-500">{tr("Account", "Rekening")}</label>
            <select id="rd-acc" value={account} onChange={(e) => setAccount(e.target.value)} className={field}>
              <option value={IDR_ACCOUNT}>{IDR_ACCOUNT}</option>
              <option value={USD_ACCOUNT}>{USD_ACCOUNT}</option>
            </select>
          </div>
          <div>
            <label htmlFor="rd-date" className="block text-xs text-slate-500">{tr("Date", "Tanggal")}</label>
            <input id="rd-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className={field} />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="rd-bal" className="block text-xs text-slate-500">{isUsd ? tr("Balance (USD)", "Saldo (USD)") : tr("Balance (IDR)", "Saldo (IDR)")}</label>
            {isUsd
              ? <NumberInput id="rd-bal" value={balance} onChange={setBalance} step={0.01} min={0} className="mt-1" />
              : <MoneyInput id="rd-bal" value={balance} onChange={setBalance} className="mt-1" />}
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>{tr("Cancel", "Batal")}</Button>
          <Button icon={Save} onClick={save} disabled={busy || !date || balance < 0}>{busy ? tr("Saving…", "Menyimpan…") : tr("Record", "Catat")}</Button>
        </div>
      </div>
    </Modal>
  );
}
