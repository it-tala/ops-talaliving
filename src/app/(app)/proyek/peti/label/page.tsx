"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { Loaded, useLoad } from "@/components/ui/loaded";
import { QrCode } from "@/components/ui/qr";
import { delivery } from "@/demo/api";
import type { BoxView } from "@/services/delivery/contracts";
import { useBrand } from "@/lib/brand";

/** The labels, on A4, ready for the tape gun.
 *
 *  Six to a sheet — 97 × 88 mm, two columns by three rows, which is exactly
 *  the 194 mm of printable width an A4 sheet has at an 8 mm margin. The
 *  millimetres sit on the element on screen too, so the preview is the paper:
 *  a sheet that reveals its real size only in the print dialog is one you find
 *  out about after forty labels are taped to crates.
 *
 *  The QR is 31.7 mm, which puts a module at 0.86 mm against the ~0.5 mm a
 *  phone needs at arm's length. Measured, not guessed.
 *
 *  What is on a label is decided by what a person standing beside a crate
 *  needs, in the order they need it:
 *
 *  1. **the room** — in the largest type on the label, because it is the only
 *     question being asked at the tailgate;
 *  2. **which box of how many** — so a missing crate is noticed at the lorry
 *     rather than on the fitting day;
 *  3. the contents, so nobody opens it to check;
 *  4. the code and its QR, for the scan;
 *  5. the project, smallest, because it is the one thing the crew already
 *     knows.
 *
 *  The QR opens `/box/<kode>` on whatever host the label was printed from,
 *  and the code is printed under it in mono so a moved domain degrades to
 *  typing rather than to a dead label. See `src/lib/qr.ts` for why that beat
 *  the code-only design it replaced (F83).
 */
export default function BoxLabelPage() {
  const params = useSearchParams();
  const codes = (params.get("kode") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const deliveryNo = params.get("krm");

  const [rows] = useLoad(
    () => delivery.listBoxes(deliveryNo ? { delivery_no: deliveryNo } : {}),
    [deliveryNo],
  );

  useEffect(() => {
    if (rows.status === "ready") {
      const t = setTimeout(() => window.print(), 600);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [rows.status]);

  return (
    <div className="mx-auto w-fit bg-white p-6 text-slate-900 print:p-0">
      <style>{`@media print { @page { size: A4; margin: 8mm; } .no-print { display: none !important; } }`}</style>

      <Loaded state={rows} onRetry={() => {}}>
        {(all) => {
          /* `kode=` keeps the order the caller asked for; without it, the
             consignment's own order, which is the order they come off the
             lorry. */
          const boxes = codes.length > 0
            ? codes.map((c) => all.find((b) => b.box_no === c)).filter(Boolean) as typeof all
            : [...all].sort((a, b) => a.box_no.localeCompare(b.box_no));

          if (boxes.length === 0) {
            return (
              <p className="py-20 text-center text-sm text-slate-500">
                Tidak ada peti untuk dicetak.
              </p>
            );
          }

          return (
            <>
              <p className="no-print mb-4 text-[12px] text-slate-500">
                {boxes.length} label. Cetak di A4, enam per halaman. Kalau hasilnya diperkecil oleh dialog
                cetak, QR-nya masih terbaca — tapi jangan diperkecil di bawah 50%.
              </p>
              <div className="grid w-[194mm] grid-cols-2 gap-0">
                {boxes.map((b) => (
                  <Label key={b.id} box={b} />
                ))}
              </div>
            </>
          );
        }}
      </Loaded>
    </div>
  );
}

function Label({ box }: { box: BoxView }) {
  const brand = useBrand();
  return (
    <div className="flex h-[88mm] w-[97mm] break-inside-avoid flex-col justify-between border border-slate-900 p-3">
      <div>
        <div className="flex items-start justify-between gap-2 border-b border-slate-300 pb-1">
          <span className="text-[10px] font-bold uppercase tracking-wide">{brand.name}</span>
          <span className="text-[10px] font-bold">{box.position ?? "peti lepas"}</span>
        </div>

        <p className="mt-2 text-[9px] uppercase tracking-wide text-slate-500">Tujuan</p>
        <p className="text-[21px] font-bold leading-tight">{box.destination}</p>

        <p className="mt-2 text-[9px] uppercase tracking-wide text-slate-500">Isi</p>
        <ul className="text-[11px] leading-snug">
          {box.lines.map((l) => (
            <li key={l.id}>{l.qty} {l.uom} · {l.description}</li>
          ))}
        </ul>
        {box.note && <p className="mt-1 text-[10px] font-medium italic">{box.note}</p>}
      </div>

      <div className="flex items-end justify-between gap-2">
        <div>
          <p className="font-mono text-[13px] font-bold">{box.box_no}</p>
          <p className="text-[10px] text-slate-600">
            {box.project_code} · {box.project_name}
          </p>
          <p className="text-[9px] text-slate-500">
            Dikemas {box.packed_at.slice(0, 10)} · {box.packed_by_name}
          </p>
        </div>
        <QrCode path={`/box/${encodeURIComponent(box.box_no)}`} title={box.box_no} size={120} />
      </div>
    </div>
  );
}
