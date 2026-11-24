import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";
import { sheetsToken, tabTitles, tabValues, writeCells, SheetsError } from "@/lib/sheets";
import { serviceAccountEmail } from "@/lib/drive";
import { pickTabs, parseTab, writeBacks, type SyncedRow } from "@/services/procurement/sheet-sync";
import type { SheetSyncResult, SheetSyncTab } from "@/services/procurement/contracts";

/** `POST /api/procurement/sheet-sync` — the PR recap sheet into the PR module (D454).
 *
 *  ## Why a route
 *
 *  Reading the sheet needs the Google service account key, and a key in a
 *  browser is a key in everybody's browser — the same reason as
 *  `/api/documents/upload`. Nothing is decided here: which row becomes which
 *  line, whether it is approved, which transaction paid it — all of that is
 *  `ops_procure.sync_pr_sheet`. This route reads the cells, hands them over,
 *  and writes back the two cells the seam answered.
 *
 *  ## Two callers
 *
 *  * **The daily job.** `pg_cron` → `ops_procure.kick_sheet_sync()` → this, with
 *    `x-ops-sync-key`. A scheduled import is the one place `supabaseAdmin()` is
 *    meant for (ADR-002); the seam then writes as the person named in
 *    `ops_procure.sheet_sync_settings.actor_id`, never as nobody.
 *  * **A person's "Sinkron sheet" button.** Their session; the seam checks
 *    `procurement.update` and writes as them.
 */

function envelope(status: number, body: { data?: unknown; error?: unknown; outcome: string }): Response {
  return Response.json(
    { ...body, meta: { request_id: "", service: "procurement", version: "1", outcome: body.outcome } },
    { status },
  );
}

function refuse(status: number, code: string, message: string): Response {
  return envelope(status, { error: { code, message, outcome: "refused", status }, outcome: "refused" });
}

/** Constant-time enough for a 32+ character secret compared once a day. */
function sameKey(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/** Today at the office (WIB), as a Date whose UTC fields are the office's. */
function officeToday(): Date {
  return new Date(Date.now() + 7 * 3600 * 1000);
}

export async function POST(request: Request): Promise<Response> {
  const key = request.headers.get("x-ops-sync-key");
  let sb: SupabaseClient;
  let trigger: "cron" | "manual";

  if (key !== null) {
    const expected = process.env.OPS_SHEET_SYNC_KEY;
    if (!expected || expected.length < 32) {
      return refuse(501, "sync_key_not_set", "OPS_SHEET_SYNC_KEY is not set on the Worker (32+ characters).");
    }
    if (!sameKey(key, expected)) return refuse(401, "bad_sync_key", "The sync key does not match.");
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

  /* A function, not the table: `service_role` gets functions, never tables (0038). */
  const { data: target, error: setErr } = await sb.schema("ops_procure").rpc("sheet_sync_target");
  if (setErr) return refuse(500, "database_error", setErr.message);
  const t = target as { outcome: string; data?: { spreadsheet_id: string; enabled: boolean };
                        error?: { code: string; message: string; status: number } };
  if (t.outcome !== "ok" || !t.data) {
    if (t.error?.code === "not_configured") {
      return refuse(409, "not_configured",
        "Sinkron sheet PR belum disiapkan: IT mengisi ops_procure.sheet_sync_settings (id sheet, akun pencatat, approver).");
    }
    return refuse(t.error?.status ?? 403, t.error?.code ?? "refused", t.error?.message ?? "Ditolak.");
  }
  const setting = t.data;

  let token: string;
  let titles: string[];
  try {
    token = await sheetsToken();
    titles = await tabTitles(token, setting.spreadsheet_id);
  } catch (e) {
    const status = e instanceof SheetsError ? e.status : 500;
    return refuse(502, "sheet_unreachable",
      `Sheet tidak bisa dibuka (${status}): ${String((e as Error).message)}. `
      + `Pastikan sheet di-share ke ${serviceAccountEmail()} sebagai Editor.`);
  }

  const tabs = pickTabs(titles, officeToday());
  if (tabs.length === 0) {
    return refuse(404, "no_recap_tab", "Tidak ada tab '<BULAN> PR RECAP' untuk bulan ini atau bulan lalu.");
  }

  const out: SheetSyncTab[] = [];
  for (const tab of tabs) {
    const parsed = parseTab(await tabValues(token, setting.spreadsheet_id, tab));
    if (!parsed) {
      out.push({ tab, outcome: "refused", message: "Baris judul dengan kolom LINE ID / TRX ID tidak ditemukan.",
                 counts: null, written: 0, rows: [] });
      continue;
    }

    const { data, error } = await sb.schema("ops_procure").rpc("sync_pr_sheet", {
      p_tab: tab, p_rows: parsed.rows, p_trigger: trigger,
    });
    if (error) return refuse(500, "database_error", error.message);
    const res = data as { outcome: string; data?: { counts: SheetSyncTab["counts"]; rows: SyncedRow[] };
                          error?: { code: string; message: string; status: number } };
    if (res.outcome !== "ok" || !res.data) {
      if (res.error) return refuse(res.error.status ?? 403, res.error.code, res.error.message);
      out.push({ tab, outcome: res.outcome, message: null, counts: null, written: 0, rows: [] });
      continue;
    }

    let written = 0;
    try {
      written = await writeCells(token, setting.spreadsheet_id, writeBacks(tab, parsed, res.data.rows));
    } catch (e) {
      /* The database has the lines; the next run finds them by fingerprint and
         writes again. Said, not thrown away. */
      out.push({ tab, outcome: "ok", message: `Tulis balik ke sheet gagal: ${String((e as Error).message)}`,
                 counts: res.data.counts, written: 0, rows: res.data.rows });
      continue;
    }
    out.push({ tab, outcome: "ok", message: null, counts: res.data.counts, written, rows: res.data.rows });
  }

  const result: SheetSyncResult = { trigger, tabs: out };
  return envelope(200, { data: result, outcome: "ok" });
}
