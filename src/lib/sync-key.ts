/** The scheduled jobs' key (`x-ops-sync-key`), shared by every route `pg_cron`
 *  kicks through Vault: `/api/procurement/sheet-sync` (0296) and
 *  `/api/accounting/ledger-sheet` (0302). One Worker secret,
 *  `OPS_SHEET_SYNC_KEY`, matching Vault's `ops_sheet_sync_key`. */

/** Constant-time enough for a 32+ character secret. */
function sameKey(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export type SyncKeyCheck = { ok: true } | { ok: false; status: number; code: string; message: string };

export function checkSyncKey(key: string): SyncKeyCheck {
  const expected = process.env.OPS_SHEET_SYNC_KEY;
  if (!expected || expected.length < 32) {
    return { ok: false, status: 501, code: "sync_key_not_set",
             message: "OPS_SHEET_SYNC_KEY is not set on the Worker (32+ characters)." };
  }
  if (!sameKey(key, expected)) return { ok: false, status: 401, code: "bad_sync_key", message: "The sync key does not match." };
  return { ok: true };
}
