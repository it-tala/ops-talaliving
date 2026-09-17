"use client";

import { useState } from "react";
import Link from "next/link";
import { PackageCheck, AlertTriangle, MapPin, ArrowLeft, Wrench } from "lucide-react";
import { Badge, Button, Card, PageHeader } from "@/components/ui/primitives";
import { Loaded, useLoad } from "@/components/ui/loaded";
import { QrCode } from "@/components/ui/qr";
import { delivery } from "@/demo/api";
import type { BoxStatus, BoxView } from "@/services/delivery/contracts";
import { useToast } from "@/store/toast";
import { useSession } from "@/store/session";

const TONE: Record<BoxStatus, "slate" | "amber" | "green" | "red" | "violet"> = {
  PACKED: "slate", IN_TRANSIT: "amber", ON_SITE: "violet", INSTALLED: "green", PROBLEM: "red",
};

/** What the QR opens.
 *
 *  This route is inside the application, behind the ordinary login, and that
 *  is the whole reason none of it waited for a backend (F82). The person
 *  scanning a packing box is our own installer: they have an account, they are
 *  already signed in on the phone in their hand, and the scan is a link into
 *  software they use every day. It is the **vendor** PO QR that needs a public
 *  route and a token, because the person holding that paper works for somebody
 *  else — and that one, correctly, waits.
 *
 *  Laid out for one thumb in a stairwell: the room it is going to is the
 *  largest thing on the screen, the three actions are thumb-sized, and the
 *  only one that asks for typing is the one that must — *what is wrong*.
 */
export default function BoxScanPage({ params }: { params: { box: string } }) {
  const boxNo = decodeURIComponent(params.box);
  const { can } = useSession();
  const [state, reload] = useLoad(() => delivery.getBox(boxNo), [boxNo]);
  const mayEdit = can("project.update");

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader
        breadcrumb="Peti & label"
        title={boxNo}
        description="Dibuka dari QR di peti."
      />

      <Loaded state={state} onRetry={reload}>
        {(b) => <BoxCard box={b} mayEdit={mayEdit} onDone={reload} />}
      </Loaded>

      <Link href="/proyek/peti" className="mt-4 inline-flex items-center gap-1.5 text-[13px] text-slate-500 hover:text-slate-700">
        <ArrowLeft className="h-3.5 w-3.5" /> Semua peti
      </Link>
    </div>
  );
}

function BoxCard({ box, mayEdit, onDone }: { box: BoxView; mayEdit: boolean; onDone: () => void }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState(false);
  const [note, setNote] = useState("");

  async function run(label: string, fn: () => Promise<{ error?: { status: number; message: string } | undefined; meta: { outcome: string } }>) {
    setBusy(label);
    const res = await fn();
    setBusy(null);
    if (res.error) {
      toast(res.error.status === 409 ? "critical" : "warning", "Tidak dicatat", res.error.message);
      return false;
    }
    if (res.meta.outcome === "noop") {
      toast("info", "Sudah tercatat", "Tidak ada yang berubah.");
    } else {
      toast("success", label, box.box_no);
    }
    onDone();
    return true;
  }

  return (
    <>
      <Card className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] uppercase tracking-wide text-slate-400">Tujuan</p>
            <p className="flex items-start gap-1.5 text-xl font-semibold leading-tight text-slate-900">
              <MapPin className="mt-1 h-4 w-4 shrink-0 text-slate-400" />
              {box.destination}
            </p>
            <p className="mt-1 text-[13px] text-slate-500">
              {box.project_code} · {box.project_name}
              {box.position && <> · peti {box.position}</>}
            </p>
          </div>
          <QrCode path={`/box/${encodeURIComponent(box.box_no)}`} title={box.box_no} size={72} className="shrink-0 rounded ring-1 ring-slate-200" />
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Badge tone={TONE[box.status]} dot>{box.status_label}</Badge>
          {box.scanned_at && (
            <span className="text-[12px] text-slate-500">
              Di-scan {box.scanned_at.slice(0, 16).replace("T", " ")} oleh {box.scanned_by_name}
            </span>
          )}
          {box.delivery_no && <span className="font-mono text-[12px] text-slate-400">{box.delivery_no}</span>}
        </div>

        {box.problem_note && (
          <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-[13px] text-rose-700">
            {box.problem_note}
          </p>
        )}

        {box.warnings.map((w) => (
          <p key={w} className="mt-2 flex items-start gap-1.5 text-[12px] text-amber-700">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {w}
          </p>
        ))}

        <div className="mt-4 border-t border-slate-100 pt-3">
          <p className="text-[11px] uppercase tracking-wide text-slate-400">Isi</p>
          <ul className="mt-1 space-y-0.5 text-[14px] text-slate-800">
            {box.lines.map((l) => (
              <li key={l.id}>{l.qty} {l.uom} · {l.description}</li>
            ))}
          </ul>
          {box.note && <p className="mt-2 text-[13px] italic text-slate-500">{box.note}</p>}
          <p className="mt-2 text-[11px] text-slate-400">
            Dikemas {box.packed_at.slice(0, 10)} oleh {box.packed_by_name}
          </p>
        </div>
      </Card>

      {mayEdit && (
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <Button
            size="lg" variant="secondary" icon={PackageCheck}
            disabled={busy !== null || box.scanned_at !== null}
            onClick={() => run("Sampai di site", () => delivery.scanBox({ box_no: box.box_no }))}
          >
            {box.scanned_at ? "Sudah di-scan" : "Sampai di site"}
          </Button>
          <Button
            size="lg" icon={Wrench}
            disabled={busy !== null || box.status === "INSTALLED"}
            onClick={() => run("Terpasang", () => delivery.markBoxInstalled({ box_no: box.box_no }))}
          >
            Terpasang
          </Button>
          <Button
            size="lg" variant="outline" icon={AlertTriangle}
            disabled={busy !== null}
            onClick={() => setProblem((v) => !v)}
          >
            Ada masalah
          </Button>
        </div>
      )}

      {problem && (
        <Card className="mt-3 p-4">
          <label className="block">
            <span className="mb-1 block text-[12px] font-medium text-slate-600">Apa yang salah?</span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="Handle kuningan cuma 6 dari 8."
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </label>
          <p className="mt-1 text-[11px] text-slate-500">
            Wajib diisi. Tanda merah tanpa kalimat tidak bisa ditindaklanjuti siapa pun di workshop —
            dan hanya Anda yang melihat isinya.
          </p>
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setProblem(false)}>Batal</Button>
            <Button
              variant="danger"
              disabled={busy !== null}
              onClick={async () => {
                const done = await run("Ditandai bermasalah", () =>
                  delivery.flagBoxProblem({ box_no: box.box_no, problem_note: note }));
                if (done) { setProblem(false); setNote(""); }
              }}
            >
              Simpan masalah
            </Button>
          </div>
        </Card>
      )}
    </>
  );
}
