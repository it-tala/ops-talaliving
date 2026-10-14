"use client";

import { Fragment } from "react";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { Pager } from "./pager";
import { useTr } from "@/lib/i18n";
import { ExcelButton, useExcelExport } from "./excel-export";

export interface Column<T> {
  key: string;
  header: React.ReactNode;
  align?: "left" | "right" | "center";
  className?: string;
  render: (row: T, index: number) => React.ReactNode;
  /** `false` for a column that is a control, not data (an action button) —
   *  left out of the Excel download. */
  export?: boolean;
}

/** How many rows a screen shows at once.
 *
 *  Forty people, two hundred ledger rows, a year of purchase orders: the tables
 *  in here grow with the business, and a screen that renders all of them is a
 *  screen that gets slower every month and shows nobody the bottom of it
 *  anyway (owner). So every table pages, and the bar underneath says what is
 *  being looked at — *1–25 dari 137* — because a table that silently shows a
 *  quarter of the data is worse than one that shows all of it (D157).
 *
 *  The totals in `footer` stay whole-dataset totals: a page of a ledger is a
 *  view, not a subset of the money.
 */
const DEFAULT_PAGE_SIZE = 25;

export function DataTable<T>({
  columns,
  rows,
  onRowClick,
  rowKey,
  empty,
  dense,
  footer,
  pageSize = DEFAULT_PAGE_SIZE,
  paginate = true,
  exportName,
  exportRows,
  renderAfter,
}: {
  columns: Column<T>[];
  rows: T[];
  onRowClick?: (row: T) => void;
  rowKey: (row: T, index: number) => string;
  empty?: React.ReactNode;
  dense?: boolean;
  footer?: React.ReactNode;
  /** Rows per page. */
  pageSize?: number;
  /** Off only where the whole set is the point — a slip, a printed sheet. */
  paginate?: boolean;
  /** File and sheet name for *Unduh Excel*; the page and card title when
   *  left out. */
  exportName?: string;
  /** For a list paged at the server, where `rows` is only this page: every
   *  row under the same filters, fetched when the download is asked for. */
  exportRows?: () => Promise<T[]>;
  /** Extra `<tr>`s drawn under a row — the ledger's a/b lines under their
   *  transaction (D437). Marked `data-no-export`: the file keeps one row per
   *  record. */
  renderAfter?: (row: T) => React.ReactNode;
}) {
  const tr = useTr();
  const alignClass = (a?: "left" | "right" | "center") =>
    a === "right" ? "text-right" : a === "center" ? "text-center" : "text-left";

  const [page, setPage] = useState(0);
  /* Every row, for the one frame the Excel download reads the table — the
     file is the whole list, never just the page on screen. */
  const [all, setAll] = useState(false);
  const [fetched, setFetched] = useState<T[] | null>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const excel = useExcelExport(tableRef, {
    name: exportName,
    showAll: exportRows
      ? async (on) => { setFetched(on ? await exportRows() : null); setAll(on); }
      : paginate ? setAll : undefined,
  });
  const pages = paginate ? Math.max(Math.ceil(rows.length / pageSize), 1) : 1;

  /* A filter that shortens the list must not leave somebody staring at an
     empty page seven. */
  useEffect(() => { setPage(0); }, [rows.length, pageSize]);
  const current = Math.min(page, pages - 1);
  const offset = paginate && !all ? current * pageSize : 0;
  const shown = useMemo(
    () => (fetched && all ? fetched : paginate && !all ? rows.slice(offset, offset + pageSize) : rows),
    [rows, offset, pageSize, paginate, all, fetched],
  );

  return (
    <div>
      {rows.length > 0 && <ExcelButton onClick={excel.run} busy={excel.busy} />}
      <div className="overflow-x-auto">
        <table ref={tableRef} className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/70">
              {columns.map((col) => (
                <th
                  key={col.key}
                  data-no-export={col.export === false ? "" : undefined}
                  className={cn(
                    "whitespace-nowrap px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500",
                    alignClass(col.align),
                    col.className,
                  )}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-10 text-center text-sm text-slate-400">
                  {empty ?? tr("No data.", "Tidak ada data.")}
                </td>
              </tr>
            ) : (
              shown.map((row, i) => (
                <Fragment key={rowKey(row, offset + i)}>
                <tr
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={cn(
                    "border-b border-slate-100 transition-colors last:border-0",
                    /* A clickable row has to look clickable before it is hovered and
                      * change clearly when it is. `brand-50/40` was almost the same
                      * colour as the row beside it, which on a 40-row board means
                      * losing your place mid-scan. */
                      onRowClick && "cursor-pointer hover:bg-slate-100",
                  )}
                >
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      data-no-export={col.export === false ? "" : undefined}
                      className={cn(
                        dense ? "px-4 py-2" : "px-4 py-3",
                        "whitespace-nowrap text-slate-700",
                        alignClass(col.align),
                        col.className,
                      )}
                    >
                      {/* The index a caller sees is the row's place in the whole
                          list, not on this page — a numbered column must not
                          restart at one every page. */}
                      {col.render(row, offset + i)}
                    </td>
                  ))}
                </tr>
                {renderAfter?.(row)}
                </Fragment>
              ))
            )}
          </tbody>
          {footer && <tfoot className="border-t-2 border-slate-200 bg-slate-50/70 font-medium">{footer}</tfoot>}
        </table>
      </div>

      {paginate && rows.length > pageSize && (
        <Pager
          from={offset + 1}
          to={Math.min(offset + pageSize, rows.length)}
          total={rows.length}
          page={current}
          pages={pages}
          onPage={setPage}
        />
      )}
    </div>
  );
}
