import { cookies } from "next/headers";
import { supabaseServer } from "@/lib/supabase/server";
import { serviceAccountEmail } from "@/lib/drive";
import { ledgerSheetToken, writeLedgerTab, LedgerSheetError } from "@/lib/ledger-sheet";
import { buildGrid, summaryRow, type LedgerSheetRow } from "@/services/accounting/ledger-sheet";
import type { LedgerSheetResult } from "@/services/accounting/contracts";

/** `POST /api/accounting/ledger-sheet` — the ops ledger into the `GL OPS 2026`
 *  tab of the accounting workbook (D455).
 *
 *  One-way (D9): the tab is cleared and written whole, never read back, so a
 *  voided or edited transaction is right after the next sync with no state to
 *  keep. Which rows, in which order, with which balance — all of that is
 *  `ops_acct.ledger_sheet_rows()`, which also decides who may press
 *  (`post_ledger`). This route lays the rows into cells and writes them.
 *
 *  A person's button only, for now (the owner, 2026-11-25). The automatic
 *  sync on every new row is a later step; it will add a second caller here,
 *  the way `/api/procurement/sheet-sync` takes `x-ops-sync-key`.
 */

function envelope(status: number, body: { data?: unknown; error?: unknown; outcome: string }): Response {
  return Response.json(
    { ...body, meta: { request_id: "", service: "accounting", version: "1", outcome: body.outcome } },
    { status },
  );
}

function refuse(status: number, code: string, message: string): Response {
  return envelope(status, { error: { code, message, outcome: "refused", status }, outcome: "refused" });
}

/** `2026-11-25 14:05`, at the office (WIB). */
function wibNow(): string {
  return new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 16).replace("T", " ");
}

export async function POST(): Promise<Response> {
  const sb = supabaseServer(await cookies());
  const { data: auth } = await sb.auth.getSession();
  if (!auth.session) return refuse(401, "not_signed_in", "Silakan masuk dulu.");

  const { data, error } = await sb.schema("ops_acct").rpc("ledger_sheet_rows");
  if (error) return refuse(500, "database_error", error.message);
  const res = data as {
    outcome: string;
    data?: { spreadsheet_id: string; tab: string; enabled: boolean; rows: LedgerSheetRow[] };
    error?: { code: string; message: string; status?: number };
  };
  if (res.outcome !== "ok" || !res.data) {
    return refuse(res.error?.status ?? 403, res.error?.code ?? "refused", res.error?.message ?? "Ditolak.");
  }
  const { spreadsheet_id, tab, enabled, rows } = res.data;
  if (!enabled) return refuse(409, "disabled", "Sinkron sheet ledger sedang dimatikan (ledger_sheet_settings.enabled).");

  const grid = buildGrid(rows);
  const syncedAt = wibNow();
  const values = [summaryRow(grid, rows.length, syncedAt), ...grid.values];

  const record = (outcome: "ok" | "failed", message: string | null) =>
    sb.schema("ops_acct").rpc("record_ledger_sheet_run", { p_rows: rows.length, p_outcome: outcome, p_message: message });

  let created = false;
  try {
    const token = await ledgerSheetToken();
    ({ created } = await writeLedgerTab(token, spreadsheet_id, tab, values, serviceAccountEmail()));
  } catch (e) {
    const status = e instanceof LedgerSheetError ? e.status : 500;
    const message = `Sheet tidak bisa ditulis (${status}): ${String((e as Error).message)}. `
      + `Pastikan workbook di-share ke ${serviceAccountEmail()} sebagai Editor.`;
    await record("failed", message);
    return refuse(502, "sheet_unwritable", message);
  }
  await record("ok", null);

  const result: LedgerSheetResult = {
    tab,
    spreadsheet_url: `https://docs.google.com/spreadsheets/d/${spreadsheet_id}/edit`,
    rows: rows.length,
    created,
    synced_at: syncedAt,
  };
  return envelope(200, { data: result, outcome: "ok" });
}
