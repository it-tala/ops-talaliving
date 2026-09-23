"use client";

import { useEffect, useState } from "react";
import { accounting } from "@/demo/api";
import type { TransactionType } from "@/services/accounting/contracts";

/** The `<option>`s of a transaction-type picker, read from the database.
 *
 *  Types are master data now (Master Data → Transaction types, `0105`). The
 *  fixed list of thirteen this replaces hid five of production's eighteen —
 *  TRANSPORT and EJO among them — from every form. Loaded once per page and
 *  shared by every picker on it; the Transaction types screen calls
 *  `forgetTypes()` after a change so the next picker sees it. */
let cached: Promise<TransactionType[]> | null = null;

function loadTypes(): Promise<TransactionType[]> {
  if (!cached) {
    cached = accounting.listTypeRows().then((r) => {
      if (r.error) {
        cached = null;
        return [];
      }
      return r.data;
    });
  }
  return cached;
}

export function forgetTypes() {
  cached = null;
}

export function useTypes(): TransactionType[] | null {
  const [types, setTypes] = useState<TransactionType[] | null>(null);
  useEffect(() => {
    let live = true;
    void loadTypes().then((t) => { if (live) setTypes(t); });
    return () => { live = false; };
  }, []);
  return types;
}

/** Active types only — a retired type stays on its rows and leaves the
 *  pickers. `current` is always offered, so a select never silently shows a
 *  different type from the one the row holds. With `includeRetired` (a
 *  filter, not a form) every type is listed. */
export function TypeOptions({ current, includeRetired = false }: { current?: string | null; includeRetired?: boolean }) {
  const types = useTypes();
  const codes = (types ?? [])
    .filter((t) => includeRetired || t.is_active !== false)
    .map((t) => t.code);
  const all = current && !codes.includes(current) ? [current, ...codes] : codes;
  return (
    <>
      {all.map((c) => <option key={c} value={c}>{c}</option>)}
    </>
  );
}
