"use client";

import { useEffect, useState } from "react";
import { procurement } from "@/demo/api";
import type { Uom } from "@/services/procurement/contracts";

/** The `<option>`s of a unit picker, read from the database.
 *
 *  Units are master data now (Master Data → Units), so a fixed list in code
 *  would hide every unit added there — which is what the old 18-code constant
 *  did to the 33 units production actually holds. Loaded once per page and
 *  shared by every picker on it: a request with twenty lines is one read, not
 *  twenty. The Units screen calls `forgetUnits()` after any change so the next
 *  picker sees it. */
let cached: Promise<Uom[]> | null = null;

function loadUnits(): Promise<Uom[]> {
  if (!cached) {
    cached = procurement.listUom().then((r) => {
      if (r.error) {
        cached = null;
        return [];
      }
      return r.data;
    });
  }
  return cached;
}

export function forgetUnits() {
  cached = null;
}

export function useUnits(): Uom[] | null {
  const [units, setUnits] = useState<Uom[] | null>(null);
  useEffect(() => {
    let live = true;
    void loadUnits().then((u) => { if (live) setUnits(u); });
    return () => { live = false; };
  }, []);
  return units;
}

/** `current` is always offered, even before the list arrives or if it is not
 *  in it, so a select never silently shows a different unit from the one the
 *  row holds. */
export function UomOptions({ current }: { current?: string | null }) {
  const units = useUnits();
  const codes = (units ?? []).map((u) => u.code);
  const all = current && !codes.includes(current) ? [current, ...codes] : codes;
  return (
    <>
      {all.map((c) => <option key={c} value={c}>{c}</option>)}
    </>
  );
}
