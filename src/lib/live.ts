/** Which screens may open against the real database, and which may not yet.
 *
 *  ## The problem this solves
 *
 *  Phase 1 built 52 screens against browser-held fixtures. Phase 2 is replacing
 *  that layer one service at a time, and `src/lib/api` today implements three
 *  of the eleven: `identity`, `procurement` and `accounting`. A screen that
 *  calls `hr.listEmployees()` in live mode does not degrade — it throws, or
 *  worse, renders an empty table that reads as *this business has no
 *  employees*.
 *
 *  So the deployment that carries real money opens the screens whose services
 *  exist, and says plainly that the rest are not live. Demo mode opens
 *  everything, unchanged: `ops-talaliving.vercel.app` stays the full walkthrough
 *  it has been since D1.
 *
 *  ## Why the list is generated rather than written
 *
 *  A hand-kept list of live routes is a list that is correct on the day it is
 *  written. It goes stale the first time somebody adds a `hr.` call to a
 *  procurement screen for one small thing — and the failure is silent, because
 *  the route is still in the list and the screen still renders, right up until
 *  the call runs.
 *
 *  `scripts/check-live-routes.mjs` derives `LIVE_ROUTES` from what each route
 *  actually imports, and CI fails when this file disagrees with the code. The
 *  list below is therefore evidence, not intent: to make a route live, give its
 *  service the functions that route calls, then run the script.
 *
 *  **Functions, not services.** The check used to ask only whether the service
 *  existed, which passed a screen calling a function nobody had written —
 *  `/accounting/rekening-koran` reaching for `accounting.importStatement()`
 *  against a client that has never had one. That is the same silent failure
 *  described above, one level down, and it was true of seven of the seventeen
 *  routes this list used to carry. They are gone from it until B2 and B3 give
 *  them the views and seams they call; the script names which ones when it
 *  refuses.
 *
 *  ## What this is not
 *
 *  It is not a permission, and it is not a security boundary. `can()` hides
 *  menus and RLS refuses calls; this only answers *does this screen have a
 *  backend yet*. The real guard for the eight unimplemented services is that
 *  `ops_hr`, `ops_prod` and `ops_inv` have no tables in them at all — a call
 *  that got past this would find nothing to read.
 */

import { isRealApi } from "@/lib/supabase/env";

/** The services `src/lib/api` actually implements.
 *
 *  Mirrors the exports of `src/lib/api/index.ts`. Adding a service here without
 *  writing it is how a screen ships pointing at nothing, so the check script
 *  reads that file rather than trusting this comment — and, since the check
 *  counts functions, a service being listed here no longer implies that every
 *  function of it exists.
 */
export const LIVE_SERVICES = ["identity", "procurement", "accounting", "inventory", "hr"] as const;

/** Routes whose every service call is implemented. GENERATED — see above.
 *  Regenerate with `node scripts/check-live-routes.mjs --write`.
 */
export const LIVE_ROUTES: readonly string[] = [
  "/accounting/calendar",
  "/accounting/documents",
  "/accounting/ledger",
  "/accounting/rekening-koran",
  "/accounting/tagihan",
  "/accounting/verifikasi",
  "/box/[box]",
  "/dashboard",
  "/hrd/absensi",
  "/hrd/berkas-201",
  /* Lit by `0123`, which gave leave requests a table. This screen was dark
     for a different reason from the payroll ones: they had a seam short of
     its contract, this had nothing underneath it at all. */
  "/hrd/cuti",
  "/hrd/jadwal",
  "/hrd/karyawan",
  "/hrd/kontrak",
  "/hrd/kontrak/[no]",
  /* Lit by `0119`, which brought `payroll_figures` up to the contract, and by
     the eight live functions that became writable once it had. Until then the
     seam could only have half-filled `PayrollLine` and cast the gap away — a
     payroll screen missing half its figures looks like a payroll screen. */
  "/hrd/payroll",
  "/hrd/payroll/[run]",
  "/hrd/payroll/[run]/payslip",
  "/hrd/payroll/minggu",
  "/inventory/assets",
  "/inventory/log",
  "/inventory/material",
  "/inventory/papan",
  "/inventory/penyesuaian",
  "/it/aktivitas",
  "/it/aturan-gaji",
  "/it/audit",
  "/it/john-lau",
  "/it/pengguna",
  "/it/peran",
  "/john-lau",
  "/master-data/accounts",
  "/master-data/asset-categories",
  "/master-data/categories",
  "/master-data/clients",
  "/master-data/items",
  "/master-data/suppliers",
  "/master-data/transaction-types",
  "/master-data/units",
  "/procurement/meeting",
  "/procurement/penerimaan",
  "/procurement/po",
  "/procurement/po/[po]",
  "/procurement/po/[po]/print",
  "/procurement/pr",
  "/procurement/pr/documents",
  "/procurement/pr/new",
  "/procurement/rounds",
  "/procurement/tracker",
  "/procurement/tracker/[vendor]",
  "/produksi/bom",
  "/produksi/jadwal",
  "/proyek/instalasi",
  "/proyek/order",
  "/proyek/pengiriman",
  "/proyek/peti",
  "/proyek/peti/label",
  "/proyek/produksi",
  "/proyek/quotation",
  "/proyek/quotation/[no]",
  "/proyek/quotation/[no]/print",
  "/proyek/serah-terima",
];

/** Is this deployment talking to a database at all?
 *
 *  Demo mode is a mode somebody chooses, never a fallback for a misconfigured
 *  deployment — `isRealApi()` requires the flag *and* both keys, so a missing
 *  key is a broken deployment rather than a production app quietly serving
 *  fixtures with every screen looking entirely correct.
 */
export function isLiveMode(): boolean {
  return isRealApi();
}

/** May this route open here?
 *
 *  In demo mode: always. In live mode: only if every service it calls exists.
 *  Dynamic segments are matched by shape, so `/procurement/tracker/mahoni`
 *  resolves against `/procurement/tracker/[vendor]`.
 */
export function isRouteLive(pathname: string): boolean {
  if (!isLiveMode()) return true;
  return LIVE_ROUTES.some((r) => matches(r, pathname));
}

function matches(pattern: string, pathname: string): boolean {
  if (pattern === pathname) return true;
  const p = pattern.split("/");
  const a = pathname.split("/");
  if (p.length !== a.length) return false;
  return p.every((seg, i) => (seg.startsWith("[") && seg.endsWith("]") ? a[i]!.length > 0 : seg === a[i]));
}
