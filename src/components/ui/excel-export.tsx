"use client";

import React, { useCallback, useLayoutEffect, useRef, useState } from "react";
import { FileSpreadsheet } from "lucide-react";
import { cn } from "@/lib/cn";
import { useTr } from "@/lib/i18n";
import { downloadTable, guessTableName, readTable } from "@/lib/xlsx-export";

/** The one button every table in ops carries: *Unduh Excel*.
 *
 *  Small and at the table's foot, so it is there when wanted and never the
 *  loudest thing on a screen whose job is something else. Hidden in print —
 *  a printed sheet has no use for a download link. */
export function ExcelButton({ onClick, busy, className }: { onClick: () => void | Promise<void>; busy?: boolean; className?: string }) {
  const tr = useTr();
  return (
    <div className={cn("flex justify-end px-3 py-1.5 print:hidden", className)} data-no-export>
      <button
        type="button"
        onClick={() => void onClick()}
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] font-medium text-emerald-700 transition-colors hover:bg-emerald-50 disabled:opacity-50"
        title={tr("Download this table as an Excel file", "Unduh tabel ini sebagai file Excel")}
      >
        <FileSpreadsheet className="h-3.5 w-3.5" />
        {tr("Download Excel", "Unduh Excel")}
      </button>
    </div>
  );
}

/** Reads a rendered table and downloads it.
 *
 *  `showAll` is for a paged table: the export asks for every row, reads them
 *  in the same frame they render (a layout effect, before paint, so the page
 *  never visibly jumps), then puts the page back. The file is the whole
 *  list, not the page somebody happened to be on. It may be async — a list
 *  paged at the server fetches the rest first. */
export function useExcelExport(
  tableRef: React.RefObject<HTMLTableElement | null>,
  { name, showAll }: { name?: string; showAll?: (on: boolean) => void | Promise<void> } = {},
) {
  const [pending, setPending] = useState(false);
  const [busy, setBusy] = useState(false);

  const exportNow = useCallback(() => {
    const table = tableRef.current;
    if (!table) { setBusy(false); return; }
    const data = readTable(table);
    const title = name || guessTableName(table);
    setBusy(true);
    void downloadTable(data, title).finally(() => setBusy(false));
  }, [tableRef, name]);

  useLayoutEffect(() => {
    if (!pending) return;
    exportNow();
    showAll?.(false);
    setPending(false);
  }, [pending, exportNow, showAll]);

  const run = useCallback(async () => {
    if (!showAll) { exportNow(); return; }
    setBusy(true);
    try {
      await showAll(true);
      setPending(true);
    } catch {
      setBusy(false);
      void showAll(false);
    }
  }, [showAll, exportNow]);

  return { run, busy, exporting: pending };
}

/** A `<table>` that carries the download button underneath it.
 *
 *  Drop-in for a hand-built table: same attributes, same children. `name`
 *  becomes the file and sheet name (today's date is added); without it the
 *  page title and the card's heading are used. */
export function ExcelTable({
  name,
  showAll,
  barClassName,
  children,
  ...props
}: React.TableHTMLAttributes<HTMLTableElement> & {
  name?: string;
  showAll?: (on: boolean) => void;
  barClassName?: string;
}) {
  const ref = useRef<HTMLTableElement>(null);
  const { run, busy } = useExcelExport(ref, { name, showAll });
  return (
    <>
      <table ref={ref} {...props}>{children}</table>
      <ExcelButton onClick={run} busy={busy} className={barClassName} />
    </>
  );
}
