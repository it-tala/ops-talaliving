import "server-only";
import { googleAccessToken } from "@/lib/drive";
import { COLUMN_COUNT, LAST_COLUMN } from "@/services/accounting/ledger-sheet";

/** The Google side of the ledger mirror (D455): find or make the tab, lay its
 *  look once, then clear and write every value. Its own file rather than
 *  `src/lib/sheets.ts`, which another branch is reshaping. */

const SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const API = "https://sheets.googleapis.com/v4/spreadsheets";

export class LedgerSheetError extends Error {
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
    const body = await res.text();
    let message = body;
    try { message = (JSON.parse(body) as { error?: { message?: string } }).error?.message ?? body; } catch { /* text */ }
    throw new LedgerSheetError(stage, res.status, message);
  }
  return res.json() as Promise<T>;
}

export function ledgerSheetToken(): Promise<string> {
  return googleAccessToken(SCOPE);
}

interface SheetProps { sheetId: number; title: string; gridProperties?: { rowCount?: number; columnCount?: number } }

const quote = (tab: string) => `'${tab.replace(/'/g, "''")}'`;

const WHITE = { red: 1, green: 1, blue: 1 };
const BLACK = { red: 0, green: 0, blue: 0 };
/* The manual tab's balance header colours, J–M; N–O take the green of its last
   coloured column so the group reads as one. */
const BALANCE_FILL = [
  { red: 0.2196, green: 0.4627, blue: 0.1137 },
  { red: 1, green: 0.6, blue: 0 },
  { red: 0.2902, green: 0.5255, blue: 0.9098 },
  { red: 0.2902, green: 0.5255, blue: 0.9098 },
  { red: 0.5765, green: 0.7686, blue: 0.4902 },
  { red: 0.5765, green: 0.7686, blue: 0.4902 },
];
const WIDTHS = [150, 89, 304, 160, 202, 131, 133, 70, 141, 141, 141, 141, 141, 141, 141,
                170, 144, 138, 138, 91, 160, 140, 115, 140, 99, 140, 100, 140, 110, 100, 130];

function range(sheetId: number, r0: number, r1: number | undefined, c0: number, c1: number) {
  return { sheetId, startRowIndex: r0, ...(r1 === undefined ? {} : { endRowIndex: r1 }), startColumnIndex: c0, endColumnIndex: c1 };
}

/** The look of the tab, laid once when the tab is made. */
function formatRequests(sheetId: number, serviceEmail: string): unknown[] {
  const fmt = (r: object, f: object, fields: string) => ({ repeatCell: { range: r, cell: { userEnteredFormat: f }, fields } });
  const rp = { type: "CURRENCY", pattern: "[$Rp]#,##0" };
  return [
    { updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: 2, frozenColumnCount: 3 } },
                               fields: "gridProperties.frozenRowCount,gridProperties.frozenColumnCount" } },
    fmt(range(sheetId, 0, undefined, 0, COLUMN_COUNT),
        { textFormat: { fontFamily: "Tahoma", fontSize: 10 }, verticalAlignment: "MIDDLE", wrapStrategy: "CLIP" },
        "userEnteredFormat(textFormat,verticalAlignment,wrapStrategy)"),
    fmt(range(sheetId, 1, 2, 0, COLUMN_COUNT),
        { backgroundColor: BLACK, horizontalAlignment: "CENTER", wrapStrategy: "WRAP",
          textFormat: { fontFamily: "Tahoma", fontSize: 10, bold: true, foregroundColor: WHITE } },
        "userEnteredFormat(backgroundColor,horizontalAlignment,wrapStrategy,textFormat)"),
    ...BALANCE_FILL.map((c, i) => fmt(range(sheetId, 1, 2, 9 + i, 10 + i), { backgroundColor: c }, "userEnteredFormat.backgroundColor")),
    fmt(range(sheetId, 2, undefined, 1, 2), { numberFormat: { type: "DATE", pattern: "M/d/yyyy" }, horizontalAlignment: "CENTER" },
        "userEnteredFormat(numberFormat,horizontalAlignment)"),
    fmt(range(sheetId, 0, undefined, 8, 15), { numberFormat: rp, horizontalAlignment: "RIGHT" },
        "userEnteredFormat(numberFormat,horizontalAlignment)"),
    fmt(range(sheetId, 0, 1, 0, COLUMN_COUNT), { backgroundColor: { red: 1, green: 1, blue: 0.8 }, textFormat: { fontFamily: "Tahoma", fontSize: 10, italic: true } },
        "userEnteredFormat(backgroundColor,textFormat)"),
    ...WIDTHS.map((px, i) => ({ updateDimensionProperties: {
      range: { sheetId, dimension: "COLUMNS", startIndex: i, endIndex: i + 1 }, properties: { pixelSize: px }, fields: "pixelSize" } })),
    // A warning, not a lock: nobody loses access, and whoever edits is told
    // the next sync writes over it.
    { addProtectedRange: { protectedRange: {
      range: { sheetId }, warningOnly: true,
      description: `Ditulis ulang oleh ops.talaliving (${serviceEmail}) setiap sinkron. Edit di ops, bukan di sini.`,
    } } },
  ];
}

export interface WriteResult { sheetId: number; created: boolean; cells: number }

/** Clear the tab and write `values` from A1. Makes the tab when it is missing. */
export async function writeLedgerTab(
  token: string, spreadsheetId: string, tab: string, values: (string | number)[][], serviceEmail: string,
): Promise<WriteResult> {
  const id = encodeURIComponent(spreadsheetId);
  const meta = await call<{ sheets?: { properties: SheetProps }[] }>(
    "tabs", token, `${API}/${id}?fields=sheets.properties(sheetId,title,gridProperties)`);
  let props = (meta.sheets ?? []).map((s) => s.properties).find((p) => p.title === tab);
  let created = false;

  const rowsNeeded = values.length + 200;
  if (!props) {
    const out = await call<{ replies: { addSheet: { properties: SheetProps } }[] }>(
      "add_tab", token, `${API}/${id}:batchUpdate`, { method: "POST", body: JSON.stringify({ requests: [
        { addSheet: { properties: { title: tab, gridProperties: { rowCount: rowsNeeded, columnCount: COLUMN_COUNT } } } },
      ] }) });
    props = out.replies[0].addSheet.properties;
    created = true;
    await call("format", token, `${API}/${id}:batchUpdate`, {
      method: "POST", body: JSON.stringify({ requests: formatRequests(props.sheetId, serviceEmail) }) });
  } else if ((props.gridProperties?.rowCount ?? 0) < rowsNeeded || (props.gridProperties?.columnCount ?? 0) < COLUMN_COUNT) {
    await call("grow", token, `${API}/${id}:batchUpdate`, { method: "POST", body: JSON.stringify({ requests: [
      { updateSheetProperties: { properties: { sheetId: props.sheetId, gridProperties: {
        rowCount: Math.max(rowsNeeded, props.gridProperties?.rowCount ?? 0),
        columnCount: Math.max(COLUMN_COUNT, props.gridProperties?.columnCount ?? 0) } },
        fields: "gridProperties.rowCount,gridProperties.columnCount" } },
    ] }) });
  }

  await call("clear", token, `${API}/${id}/values/${encodeURIComponent(`${quote(tab)}!A1:${LAST_COLUMN}`)}:clear`,
             { method: "POST", body: "{}" });
  const out = await call<{ updatedCells?: number }>(
    "write", token,
    `${API}/${id}/values/${encodeURIComponent(`${quote(tab)}!A1:${LAST_COLUMN}${values.length}`)}?valueInputOption=USER_ENTERED`,
    { method: "PUT", body: JSON.stringify({ values }) });
  return { sheetId: props.sheetId, created, cells: out.updatedCells ?? 0 };
}

