"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Printer, Search, Tags } from "lucide-react";
import { Badge, Button, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { Loaded, useDebounced, useLoad } from "@/components/ui/loaded";
import { QrCode } from "@/components/ui/qr";
import { cn } from "@/lib/cn";
import { formatDate, formatNumber } from "@/lib/format";
import { useBrand } from "@/lib/brand";
import { officeToday } from "@/lib/office";
import { inventory } from "@/demo/api";
import { ASSET_OWNERSHIP_LABELS, type LabelKind, type LabelSource } from "@/services/inventory/contracts";
import { useTr } from "@/lib/i18n";
import { ExcelTable } from "@/components/ui/excel-export";

/** Inventory → Labels (D321).
 *
 *  The owner asked for labels for what is newly recorded, printed several
 *  to a sheet, each saying the code, where it is and when it was recorded.
 *
 *  **What gets a label** (the owner's answer): assets, rented ones included;
 *  finished goods; raw and half-finished material. Consumables like
 *  sandpaper are not selected by default (`ops_inv.label_categories`), but
 *  *all categories* still reaches them.
 *
 *  **The date is the day the record was registered**, the same date the
 *  lists now show. *Registered since* defaults to the last seven days, so the
 *  usual job, labelling this week's intake, is one click.
 *
 *  **The sheet is chosen when printing.** Three standard A4 sticker sheets (8,
 *  21 and 40 per page) are measured to the millimetre, so the print lands on
 *  the stickers. *Start at position* uses up a half-used sheet. *Copies* prints
 *  one label several times, e.g. one per board in a stack. Printing is the
 *  browser's print, with the controls hidden and the page margin at zero.
 *  Print at 100%: scaling moves every label off its sticker.
 *
 *  **No preview on the screen** (owner, 2026-09-28): the list is what gets
 *  printed. The sheets are rendered for the printer only.
 *
 *  **The QR opens a card without signing in** (owner, D322): `/l/<token>`,
 *  a random token per record, so holding the label is the permission and the
 *  codes, which run in order, cannot be walked. The card links on to the
 *  record's own screen (`detailPath`) for staff who are signed in.
 */

interface Sheet {
  id: string;
  cols: number;
  rows: number;
  /** Label size, mm. */
  w: number;
  h: number;
  /** Page margins and gaps, mm: the Avery/Tom&Jerry A4 layouts. */
  top: number;
  left: number;
  gapX: number;
  gapY: number;
  tier: "l" | "m" | "s";
  en: string;
  id_: string;
}

const SHEETS: Sheet[] = [
  { id: "8", cols: 2, rows: 4, w: 99.1, h: 67.7, top: 13.1, left: 4.65, gapX: 2.5, gapY: 0, tier: "l",
    en: "8 per sheet · 99 × 68 mm", id_: "8 per lembar · 99 × 68 mm" },
  { id: "21", cols: 3, rows: 7, w: 63.5, h: 38.1, top: 15.15, left: 7.25, gapX: 2.5, gapY: 0, tier: "m",
    en: "21 per sheet · 63.5 × 38 mm", id_: "21 per lembar · 63,5 × 38 mm" },
  { id: "40", cols: 4, rows: 10, w: 45.7, h: 25.4, top: 21.5, left: 9.7, gapX: 2.6, gapY: 0, tier: "s",
    en: "40 per sheet · 45.7 × 25.4 mm", id_: "40 per lembar · 45,7 × 25,4 mm" },
];

const KINDS: { kind: LabelKind; en: string; id: string }[] = [
  { kind: "item", en: "Materials", id: "Bahan" },
  { kind: "asset", en: "Assets", id: "Aset" },
  { kind: "product", en: "Finished goods", id: "Barang jadi" },
];

function daysAgo(n: number): string {
  const d = new Date(`${officeToday()}T00:00:00`);
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

export default function LabelPage() {
  const tr = useTr();
  const params = useSearchParams();
  const askedCodes = useMemo(
    () => (params.get("codes") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    [params],
  );
  const initialKind = (["item", "asset", "product"].includes(params.get("kind") ?? "")
    ? params.get("kind") : "item") as LabelKind;

  const [kind, setKind] = useState<LabelKind>(initialKind);
  /* A link with codes (just registered) wants exactly those, whenever. */
  const [since, setSince] = useState<string>(askedCodes.length ? "" : daysAgo(7));
  const [q, setQ] = useState("");
  const dq = useDebounced(q, 300);
  const [allCategories, setAllCategories] = useState(false);
  const [codes, setCodes] = useState<string[]>(askedCodes);

  const [rows, reload] = useLoad(
    () => inventory.listLabelSources({ kind, since: since || null, codes: codes.length ? codes : null, q: dq }),
    [kind, since, dq, codes.join(",")],
  );

  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [sheetId, setSheetId] = useState("21");
  const [copies, setCopies] = useState(1);
  const [skip, setSkip] = useState(0);
  const [location, setLocation] = useState("");
  const [showQr, setShowQr] = useState(true);
  /* Cut lines, for plain A4 cut by hand (owner, 2026-09-28). Off for
     pre-cut sticker sheets, where a printed line would sit on a sticker. */
  const [cutLines, setCutLines] = useState(true);
  const [locs] = useLoad(() => inventory.listStockLocations(), []);

  const shown = useMemo(() => {
    if (rows.status !== "ready") return [];
    return rows.data.filter((r) => allCategories || codes.length > 0 || r.labelled);
  }, [rows, allCategories, codes.length]);

  /* A fresh list selects everything it shows: the list is already the
     answer to *what came in*, and unticking the odd one is quicker than
     ticking twenty. */
  useEffect(() => {
    setPicked(new Set(shown.map((r) => r.code)));
  }, [shown]);

  const sheet = SHEETS.find((s) => s.id === sheetId)!;
  const perPage = sheet.cols * sheet.rows;
  const chosen = shown.filter((r) => picked.has(r.code));
  const cells: (LabelSource | null)[] = [
    ...Array.from({ length: Math.min(skip, perPage - 1) }, () => null),
    ...chosen.flatMap((r) => Array.from({ length: Math.max(1, copies) }, () => r)),
  ];
  const pages: (LabelSource | null)[][] = [];
  for (let i = 0; i < cells.length; i += perPage) pages.push(cells.slice(i, i + perPage));

  const toggle = (code: string) => setPicked((prev) => {
    const next = new Set(prev);
    if (next.has(code)) next.delete(code); else next.add(code);
    return next;
  });

  return (
    <div>
      {/* Zero page margin: the sheet itself carries the sticker margins. */}
      <style>{`@media print { @page { size: A4; margin: 0; } }`}</style>

      <div className="print:hidden">
        <PageHeader
          breadcrumb={tr("Inventory", "Persediaan")}
          title={tr("Labels", "Label")}
          description={tr(
            "Labels for what was recorded, several to an A4 sticker sheet: code, name, location and the date it was registered.",
            "Label untuk data yang dicatat, beberapa per lembar stiker A4: kode, nama, lokasi, dan tanggal didaftarkan.",
          )}
          actions={
            <Button icon={Printer} disabled={chosen.length === 0} onClick={() => window.print()}>
              {tr(`Print ${cells.length - Math.min(skip, perPage - 1)} labels`, `Cetak ${cells.length - Math.min(skip, perPage - 1)} label`)}
            </Button>
          }
        />

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <Card>
            <CardHeader
              icon={Tags}
              title={tr("What to label", "Yang dilabel")}
              subtitle={codes.length
                ? tr(`Only ${codes.join(", ")}.`, `Hanya ${codes.join(", ")}.`)
                : tr("Newest registered first.", "Yang terbaru didaftarkan di atas.")}
              action={codes.length ? (
                <Button variant="secondary" size="sm" onClick={() => { setCodes([]); setSince(daysAgo(7)); }}>
                  {tr("Show all", "Tampilkan semua")}
                </Button>
              ) : undefined}
            />
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-5 py-3">
              <div className="flex rounded-lg border border-slate-200 p-0.5">
                {KINDS.map((k) => (
                  <button
                    key={k.kind}
                    onClick={() => { setKind(k.kind); setCodes([]); }}
                    className={cn("rounded-md px-3 py-1 text-[12px] font-medium",
                      kind === k.kind ? "bg-brand-600 text-white" : "text-slate-600 hover:bg-slate-50")}
                  >
                    {tr(k.en, k.id)}
                  </button>
                ))}
              </div>
              <label className="flex items-center gap-1.5 text-[12px] text-slate-600">
                {tr("Registered since", "Didaftarkan sejak")}
                <input type="date" value={since} onChange={(e) => setSince(e.target.value)}
                       className="h-8 rounded-lg border border-slate-200 px-2 text-[12px]" />
              </label>
              <div className="relative">
                <Search className="absolute left-2 top-2 h-4 w-4 text-slate-400" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr("Code or name", "Kode atau nama")}
                       className="h-8 w-44 rounded-lg border border-slate-200 pl-7 pr-2 text-[12px]" />
              </div>
              {kind === "item" && codes.length === 0 && (
                <label className="flex items-center gap-1.5 text-[12px] text-slate-600">
                  <input type="checkbox" checked={allCategories} onChange={(e) => setAllCategories(e.target.checked)} />
                  {tr("All categories (incl. consumables)", "Semua kategori (termasuk bahan habis pakai)")}
                </label>
              )}
            </div>

            <Loaded state={rows} onRetry={reload}>
              {() => shown.length === 0 ? (
                <p className="px-5 py-8 text-center text-[13px] text-slate-500">
                  {since
                    ? tr("Nothing registered in this period. Pick an earlier date.", "Tidak ada yang didaftarkan di periode ini. Pilih tanggal yang lebih awal.")
                    : tr("Nothing matches.", "Tidak ada yang cocok.")}
                </p>
              ) : (
                <div className="max-h-[520px] overflow-y-auto">
                  <ExcelTable className="w-full text-[13px]">
                    <thead className="sticky top-0 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="w-8 px-3 py-2">
                          <input type="checkbox" checked={picked.size === shown.length}
                                 onChange={(e) => setPicked(e.target.checked ? new Set(shown.map((r) => r.code)) : new Set())} />
                        </th>
                        <th className="px-3 py-2 text-left">{tr("Code · name", "Kode · nama")}</th>
                        <th className="px-3 py-2 text-left">{tr("Location", "Lokasi")}</th>
                        <th className="px-3 py-2 text-left">{tr("Registered", "Didaftarkan")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shown.map((r) => (
                        <tr key={r.code} onClick={() => toggle(r.code)} className="cursor-pointer border-t border-slate-100 hover:bg-slate-50">
                          <td className="px-3 py-2"><input type="checkbox" readOnly checked={picked.has(r.code)} /></td>
                          <td className="px-3 py-2">
                            <span className="font-mono text-[12px] text-slate-500">{r.code}</span>{" "}
                            <span className="font-medium text-slate-800">{r.name}</span>
                            {r.name_local && <span className="block text-[12px] text-slate-500">{r.name_local}</span>}
                            {r.extra.ownership && r.extra.ownership !== "owned" && (
                              <Badge tone="violet">{tr(ASSET_OWNERSHIP_LABELS[r.extra.ownership].en, ASSET_OWNERSHIP_LABELS[r.extra.ownership].id)}</Badge>
                            )}
                            {kind === "item" && !r.labelled && (
                              <span className="ml-1 text-[11px] text-slate-400">· {r.category}</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-[12px] text-slate-600">{whereText(r) || <span className="text-slate-300">—</span>}</td>
                          <td className="px-3 py-2 text-[12px] text-slate-600">{r.registered_at ? formatDate(new Date(r.registered_at)) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </ExcelTable>
                </div>
              )}
            </Loaded>
          </Card>

          <Card>
            <CardHeader icon={Printer} title={tr("Sheet", "Lembar")} />
            <div className="space-y-3 px-5 py-4 text-[13px]">
              <label className="block">
                <span className="text-[12px] text-slate-500">{tr("Sticker sheet (A4)", "Lembar stiker (A4)")}</span>
                <select value={sheetId} onChange={(e) => { setSheetId(e.target.value); setSkip(0); }}
                        className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2">
                  {SHEETS.map((s) => <option key={s.id} value={s.id}>{tr(s.en, s.id_)}</option>)}
                </select>
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-[12px] text-slate-500">{tr("Copies of each", "Salinan per label")}</span>
                  <input type="number" min={1} max={100} value={copies}
                         onChange={(e) => setCopies(Math.min(100, Math.max(1, Number(e.target.value) || 1)))}
                         className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2" />
                </label>
                <label className="block">
                  <span className="text-[12px] text-slate-500">{tr("Start at position", "Mulai di posisi")}</span>
                  <input type="number" min={1} max={perPage} value={skip + 1}
                         onChange={(e) => setSkip(Math.min(perPage - 1, Math.max(0, (Number(e.target.value) || 1) - 1)))}
                         className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2" />
                </label>
              </div>
              <label className="block">
                <span className="text-[12px] text-slate-500">{tr("Location on the label", "Lokasi di label")}</span>
                <select value={location} onChange={(e) => setLocation(e.target.value)}
                        className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2">
                  <option value="">{tr("As recorded (where the stock is)", "Sesuai catatan (tempat stoknya)")}</option>
                  {locs.status === "ready" && locs.data.map((l) => <option key={l.code} value={l.code}>{l.name} ({l.code})</option>)}
                </select>
              </label>
              <label className="flex items-center gap-2 text-[12px] text-slate-600">
                <input type="checkbox" checked={cutLines} onChange={(e) => setCutLines(e.target.checked)} />
                {tr("Cut lines (plain paper; off for pre-cut sticker sheets)", "Garis potong (kertas biasa; matikan untuk stiker yang sudah terpotong)")}
              </label>
              <label className="flex items-center gap-2 text-[12px] text-slate-600">
                <input type="checkbox" checked={showQr} onChange={(e) => setShowQr(e.target.checked)} />
                {tr("QR code: opens the item's card, no sign-in needed", "QR: membuka kartu item, tanpa login")}
              </label>
              <p className="rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
                {tr(
                  `${chosen.length} selected × ${copies} = ${chosen.length * copies} labels on ${pages.length} sheet(s). Print at 100% (no "fit to page"), A4, no margins.`,
                  `${chosen.length} dipilih × ${copies} = ${chosen.length * copies} label di ${pages.length} lembar. Cetak 100% (jangan "fit to page"), A4, tanpa margin.`,
                )}
              </p>
            </div>
          </Card>
        </div>

      </div>

      {/* The sheets exist for the printer only. The owner asked for no preview
          under the list: the list is what gets printed, and the sheet is
          measured to the sticker paper, not to a screen. */}
      <div className="hidden print:block">
        {pages.map((cellsOnPage, p) => (
          <div
            key={p}
            className="relative bg-white"
            style={{ width: "210mm", height: "297mm", breakAfter: p < pages.length - 1 ? "page" : "auto", overflow: "hidden" }}
          >
            <div
              className="absolute grid"
              style={{
                top: `${sheet.top}mm`, left: `${sheet.left}mm`,
                gridTemplateColumns: `repeat(${sheet.cols}, ${sheet.w}mm)`,
                gridAutoRows: `${sheet.h}mm`,
                columnGap: `${sheet.gapX}mm`, rowGap: `${sheet.gapY}mm`,
              }}
            >
              {cellsOnPage.map((r, i) => (
                <div
                  key={i}
                  className="overflow-hidden"
                  /* An outline, not a border: it takes no room from the label,
                     and two neighbours' outlines fall on one line to cut. */
                  style={cutLines ? { outline: "0.2mm dashed #94a3b8", outlineOffset: "0" } : undefined}
                >
                  {r && <Label r={r} tier={sheet.tier} location={location} qr={showQr} />}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Where a scan lands: the record's own screen, opened on it. The phone that
 *  scans must be signed in, like any other screen here. */
function detailPath(r: Pick<LabelSource, "kind" | "code">): string {
  const code = encodeURIComponent(r.code);
  return r.kind === "asset" ? `/inventory/assets?asset=${code}`
    : r.kind === "product" ? `/inventory/produk?product=${code}`
    : `/inventory/material?item=${code}`;
}

function whereText(r: LabelSource): string {
  return r.locations.map((l) => l.qty == null ? (l.name ?? l.code) : `${l.name ?? l.code} ${formatNumber(l.qty)}`).join(" · ");
}

function Label({ r, tier, location, qr }: { r: LabelSource; tier: Sheet["tier"]; location: string; qr: boolean }) {
  const tr = useTr();
  const brand = useBrand();
  const where = location || r.locations[0]?.name || r.locations[0]?.code || "—";
  const date = r.registered_at ? formatDate(new Date(r.registered_at)) : "—";
  const own = r.extra.ownership && r.extra.ownership !== "owned" ? r.extra.ownership : null;
  const tag = r.kind === "asset"
    ? (own ? tr(ASSET_OWNERSHIP_LABELS[own].en, ASSET_OWNERSHIP_LABELS[own].id).toUpperCase() : tr("ASSET", "ASET"))
    : r.kind === "product" ? tr("FINISHED", "BARANG JADI") : tr("MATERIAL", "BAHAN");
  const size = [r.extra.length_mm, r.extra.width_mm, r.extra.height_mm].every((n) => n != null)
    ? `${r.extra.length_mm}×${r.extra.width_mm}×${r.extra.height_mm} mm` : r.extra.dimension_note ?? null;
  const detail = r.kind === "asset"
    ? [r.extra.identifier && `SN ${r.extra.identifier}`, r.extra.holder,
       own && r.extra.contract_end && `${tr("until", "s/d")} ${formatDate(new Date(r.extra.contract_end))}`]
        .filter(Boolean).join(" · ")
    : r.kind === "product" ? [r.category, size].filter(Boolean).join(" · ")
    : [r.category, r.uom && `${tr("per", "per")} ${r.uom}`].filter(Boolean).join(" · ");

  /* CSS size beats the svg's own width attribute, so the QR is sized in mm. */
  const qrClass = tier === "l" ? "block h-[26mm] w-[26mm]" : tier === "m" ? "block h-[17mm] w-[17mm]" : "block h-[13mm] w-[13mm]";
  const pad = tier === "s" ? "1.5mm" : "2.5mm";

  return (
    <div className="flex h-full w-full gap-[1.5mm] text-slate-900" style={{ padding: pad }}>
      <div className="flex min-w-0 flex-1 flex-col">
        {tier !== "s" && (
          <div className="flex items-center justify-between gap-1 border-b border-slate-300 pb-[0.5mm]">
            <span className={cn("truncate font-bold uppercase tracking-wide", tier === "l" ? "text-[8pt]" : "text-[6pt]")}>{brand.name}</span>
            <span className={cn("shrink-0 font-bold", tier === "l" ? "text-[8pt]" : "text-[6pt]")}>{tag}</span>
          </div>
        )}
        <p className={cn("font-mono font-bold leading-tight",
          tier === "l" ? "mt-1 text-[16pt]" : tier === "m" ? "mt-[0.5mm] text-[11pt]" : "text-[9pt]")}>{r.code}</p>
        <p className={cn("font-medium leading-tight",
          tier === "l" ? "line-clamp-2 text-[10pt]" : tier === "m" ? "line-clamp-2 text-[7.5pt]" : "truncate text-[6.5pt]")}>
          {r.name}
        </p>
        {r.name_local && tier !== "s" && (
          <p className={cn("truncate leading-tight text-slate-700", tier === "l" ? "text-[9pt]" : "text-[6.5pt]")}>{r.name_local}</p>
        )}
        <div className="flex-1" />
        {tier === "l" && detail && <p className="truncate text-[8pt] text-slate-700">{detail}</p>}
        <p className={cn("leading-tight", tier === "l" ? "text-[8.5pt]" : tier === "m" ? "text-[6.5pt]" : "text-[5.5pt]")}>
          <span className="font-semibold">{tr("Loc", "Lok")}:</span> {where}
        </p>
        <p className={cn("leading-tight", tier === "l" ? "text-[8.5pt]" : tier === "m" ? "text-[6.5pt]" : "text-[5.5pt]")}>
          <span className="font-semibold">{tr("Reg.", "Tgl daftar")}:</span> {date}
        </p>
        {tier === "m" && detail && <p className="truncate text-[6pt] text-slate-600">{detail}</p>}
      </div>
      {qr && (
        <div className="flex shrink-0 flex-col items-center justify-end">
          <QrCode path={r.token ? `/l/${r.token}` : detailPath(r)} title={r.code} size={64} className={qrClass} />
        </div>
      )}
    </div>
  );
}
