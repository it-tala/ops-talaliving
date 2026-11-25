import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";
import { serviceAccountEmail } from "@/lib/drive";
import { checkSyncKey } from "@/lib/sync-key";
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
 *  ## Two callers (0302, D460)
 *
 *  * **The job, every 15 minutes 06:00–22:59 WIB.** `pg_cron` →
 *    `ops_acct.kick_ledger_sheet_sync()` → this, with `x-ops-sync-key`, as
 *    `service_role` (ADR-002's scheduled-import exception, as the PR sheet).
 *    It leaves the tab alone when the rows' md5 equals the last good write's
 *    and that write is under a day old, and records nothing then.
 *  * **A person's "Perbarui sheet" button.** Their session, `post_ledger`;
 *    always writes, since someone may have typed into the tab.
 */

/** A good write older than this is redone even when nothing changed, so a
 *  tab somebody typed into is put right at least once a day. */
const REWRITE_AFTER_MS = 24 * 3600 * 1000;

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
function wibAt(d: Date): string {
  return new Date(d.getTime() + 7 * 3600 * 1000).toISOString().slice(0, 16).replace("T", " ");
}

function wibNow(): string {
  return wibAt(new Date());
}

export async function POST(request: Request): Promise<Response> {
  const key = request.headers.get("x-ops-sync-key");
  let sb: SupabaseClient;
  let trigger: "cron" | "manual";

  if (key !== null) {
    const k = checkSyncKey(key);
    if (!k.ok) return refuse(k.status, k.code, k.message);
    try { sb = supabaseAdmin(); } catch (e) {
      return refuse(501, "service_role_not_set", String((e as Error).message));
    }
    trigger = "cron";
  } else {
    sb = supabaseServer(await cookies());
    const { data: auth } = await sb.auth.getSession();
    if (!auth.session) return refuse(401, "not_signed_in", "Silakan masuk dulu.");
    trigger = "manual";
  }

  const { data, error } = await sb.schema("ops_acct").rpc("ledger_sheet_rows");
  if (error) return refuse(500, "database_error", error.message);
  const res = data as {
    outcome: string;
    data?: { spreadsheet_id: string; tab: string; enabled: boolean; rows: LedgerSheetRow[];
             hash: string; last_hash: string | null; last_ok_at: string | null };
    error?: { code: string; message: string; status?: number };
  };
  if (res.outcome !== "ok" || !res.data) {
    return refuse(res.error?.status ?? 403, res.error?.code ?? "refused", res.error?.message ?? "Ditolak.");
  }
  const { spreadsheet_id, tab, enabled, rows, hash, last_hash, last_ok_at } = res.data;
  if (!enabled) return refuse(409, "disabled", "Sinkron sheet ledger sedang dimatikan (ledger_sheet_settings.enabled).");
  const spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheet_id}/edit`;

  if (trigger === "cron" && last_hash === hash && last_ok_at
      && Date.now() - new Date(last_ok_at).getTime() < REWRITE_AFTER_MS) {
    const unchanged: LedgerSheetResult = {
      tab, spreadsheet_url: spreadsheetUrl, rows: rows.length, created: false,
      synced_at: wibAt(new Date(last_ok_at)), trigger, skipped: true,
    };
    return envelope(200, { data: unchanged, outcome: "ok" });
  }

  const grid = buildGrid(rows);
  const syncedAt = wibNow();
  const values = [summaryRow(grid, rows.length, syncedAt), ...grid.values];

  const record = (outcome: "ok" | "failed", message: string | null) =>
    sb.schema("ops_acct").rpc("record_ledger_sheet_run", {
      p_rows: rows.length, p_outcome: outcome, p_message: message, p_hash: hash,
    });

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
    spreadsheet_url: spreadsheetUrl,
    rows: rows.length,
    created,
    synced_at: syncedAt,
    trigger,
    skipped: false,
  };
  return envelope(200, { data: result, outcome: "ok" });
}
