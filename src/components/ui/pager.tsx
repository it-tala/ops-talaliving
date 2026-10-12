"use client";

import React, { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTr } from "@/lib/i18n";

/** Paging, for lists that are not tables.
 *
 *  The same rule as `DataTable` (D157): no screen renders the whole of a list
 *  that grows with the business — forty people, a year of timber loads, every
 *  overtime sheet ever signed. The bar says what is being shown, because a
 *  screen that silently holds back half the rows is worse than a slow one.
 */
const DEFAULT_PAGE_SIZE = 25;

export function usePaged<T>(rows: T[], pageSize = DEFAULT_PAGE_SIZE, unit?: string) {
  const [page, setPage] = useState(0);
  /* On for the one frame an Excel download reads the table: the file is the
     whole list, not the page on screen (`ExcelTable`'s `showAll`). */
  const [all, setAll] = useState(false);
  const pages = Math.max(Math.ceil(rows.length / pageSize), 1);

  /* Filtering down to three rows must not leave somebody on page seven. */
  useEffect(() => { setPage(0); }, [rows.length, pageSize]);

  const current = Math.min(page, pages - 1);
  const offset = all ? 0 : current * pageSize;
  const shown = useMemo(() => (all ? rows : rows.slice(offset, offset + pageSize)), [rows, offset, pageSize, all]);

  return {
    shown,
    offset,
    showAll: setAll,
    pager: rows.length > pageSize
      ? (
        <Pager
          from={offset + 1}
          to={Math.min(offset + pageSize, rows.length)}
          total={rows.length}
          page={current}
          pages={pages}
          onPage={setPage}
          unit={unit}
        />
      )
      : null,
  };
}

export function Pager({
  from, to, total, page, pages, onPage, unit,
}: {
  from: number; to: number; total: number; page: number; pages: number;
  onPage: (p: number) => void;
  unit?: string;
}) {
  const tr = useTr();
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-4 py-2.5">
      <p className="text-[12px] text-slate-500">
        <span className="font-medium tabular-nums text-slate-700">{from}–{to}</span> {tr("of", "dari")}{" "}
        <span className="tabular-nums">{total}</span> {unit ?? tr("rows", "baris")}
      </p>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onPage(page - 1)}
          disabled={page === 0}
          aria-label={tr("Previous page", "Halaman sebelumnya")}
          className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="px-1.5 text-[12px] tabular-nums text-slate-600">{page + 1} / {pages}</span>
        <button
          type="button"
          onClick={() => onPage(page + 1)}
          disabled={page >= pages - 1}
          aria-label={tr("Next page", "Halaman berikutnya")}
          className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

/** The same paging, as a component.
 *
 *  Half of these lists are derived inside a `Loaded` callback — filtered by a
 *  search box, grouped by size, sorted by thickness — and a callback is no
 *  place for a hook, because it is not always called. So the state lives in a
 *  component that wraps the list instead: `<Paged rows={…}>{(shown) => …}` and
 *  the bar prints itself underneath.
 */
export function Paged<T>({
  rows, pageSize, unit, children,
}: {
  rows: T[];
  pageSize?: number;
  unit?: string;
  /** `showAll` goes to `ExcelTable`, so its download is every row. */
  children: (shown: T[], offset: number, showAll: (on: boolean) => void) => React.ReactNode;
}) {
  const { shown, offset, pager, showAll } = usePaged(rows, pageSize, unit);
  return <>{children(shown, offset, showAll)}{pager}</>;
}
