import "server-only";
import { googleAccessToken } from "@/lib/drive";

/** Google Sheets, as the Drive service account (D454).
 *
 *  Only what the PR recap sync needs: the tab titles, one tab's values as the
 *  office sees them, and a batch of single-cell writes. The workbook must be
 *  shared with the service account (`GOOGLE_SERVICE_ACCOUNT_EMAIL`) as an
 *  editor — `drive.file` does not reach a file the app did not make, which is
 *  why this asks for the `spreadsheets` scope instead.
 */

const SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const API = "https://sheets.googleapis.com/v4/spreadsheets";

export class SheetsError extends Error {
  constructor(public stage: string, public status: number, message: string) {
    super(message);
  }
}

async function call<T>(stage: string, token: string, url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const text = await res.text();
    let message = text;
    try { message = (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? text; } catch { /* text */ }
    throw new SheetsError(stage, res.status, message);
  }
  return res.json() as Promise<T>;
}

export async function sheetsToken(): Promise<string> {
  return googleAccessToken(SCOPE);
}

export async function tabTitles(token: string, spreadsheetId: string): Promise<string[]> {
  const out = await call<{ sheets?: { properties: { title: string } }[] }>(
    "titles", token, `${API}/${encodeURIComponent(spreadsheetId)}?fields=sheets.properties.title`);
  return (out.sheets ?? []).map((s) => s.properties.title);
}

/** Formatted values (`Rp1,535,430`, `11/02/2026`, `TRUE`), as the office reads them. */
export async function tabValues(token: string, spreadsheetId: string, tab: string): Promise<string[][]> {
  const range = encodeURIComponent(`'${tab.replace(/'/g, "''")}'!A1:AZ2000`);
  const out = await call<{ values?: string[][] }>(
    "values", token, `${API}/${encodeURIComponent(spreadsheetId)}/values/${range}?valueRenderOption=FORMATTED_VALUE`);
  return out.values ?? [];
}

export interface CellWrite { tab: string; a1: string; value: string }

export async function writeCells(token: string, spreadsheetId: string, writes: CellWrite[]): Promise<number> {
  if (writes.length === 0) return 0;
  const out = await call<{ totalUpdatedCells?: number }>(
    "write", token, `${API}/${encodeURIComponent(spreadsheetId)}/values:batchUpdate`, {
      method: "POST",
      body: JSON.stringify({
        valueInputOption: "RAW",
        data: writes.map((w) => ({ range: `'${w.tab.replace(/'/g, "''")}'!${w.a1}`, values: [[w.value]] })),
      }),
    });
  return out.totalUpdatedCells ?? 0;
}
