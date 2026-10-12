/** A table on screen, downloaded as an Excel file.
 *
 *  Every table in ops gets the same button (owner, 2026-10-12): what the team
 *  reads on a screen is what they want to forward, filter and total in Excel.
 *  So the export reads the table **as it is rendered** — the headers the
 *  reader sees, the cells in the language and shape they see — rather than a
 *  second, hand-kept list of columns per screen that would drift from the
 *  screen the first time somebody renames a header.
 *
 *  Three things a rendered cell is not, and how they are handled:
 *   - *A page of a longer list.* Paged tables render every row for the one
 *     frame the export reads (`ExcelTable` / `DataTable` do that), so the file
 *     is the whole list, never page one.
 *   - *A number.* `Rp 1,250,000` is text on screen; in Excel it must be a
 *     number you can sum. Money and plain grouped numbers in the locale in
 *     force are turned back into numbers; anything else (ids, phone numbers
 *     with a leading zero, percentages, dates) stays text as shown.
 *   - *Just data.* An input exports its value, an icon exports nothing, and
 *     anything marked `data-no-export` (an action button) is left out. A
 *     column with no header and nothing in it is dropped.
 */

import { getActiveLocale } from "@/lib/format";

type Cell = string | number | null;
interface Merge { s: { r: number; c: number }; e: { r: number; c: number } }

/* A table inside a cell (an expanded row's own history) is its own table,
   with its own button — not text to flatten into the outer cell. */
const SKIP_TAGS = new Set(["SVG", "SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "TABLE"]);
function displayOf(el: Element): string {
  if (typeof window === "undefined") return "inline";
  return window.getComputedStyle(el).display;
}

/** The text a reader sees in a cell. Lines stacked inside a cell (a name over
 *  its code, an amount over its note) are joined with ` · ` rather than run
 *  together. A cell hidden as a whole (a column only shown on wider screens)
 *  still exports, read in full; inside a visible cell, the twin that only
 *  shows on another screen size is skipped, so a responsive label is not
 *  written twice. */
export function cellText(cell: Element): string {
  const respectHidden = displayOf(cell) !== "none";
  const parts: string[] = [];
  const BREAK = "\u0000";

  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      parts.push(node.nodeValue ?? "");
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    if (SKIP_TAGS.has(el.tagName.toUpperCase())) return;
    if (el.hasAttribute("data-no-export")) return;
    if (el.classList.contains("sr-only")) return;
    const display = displayOf(el);
    if (respectHidden && display === "none") return;

    if (el instanceof HTMLInputElement) {
      if (el.type === "checkbox" || el.type === "radio") parts.push(el.checked ? "✓" : "");
      else if (el.type !== "hidden" && el.type !== "file" && el.type !== "button" && el.type !== "submit") parts.push(el.value);
      return;
    }
    if (el instanceof HTMLTextAreaElement) { parts.push(el.value); return; }
    if (el instanceof HTMLSelectElement) {
      parts.push(el.selectedOptions[0]?.textContent ?? el.value);
      return;
    }
    if (el.tagName === "BR") { parts.push(BREAK); return; }

    const block = display !== "none" && display !== "contents" && !display.startsWith("inline");
    if (block) parts.push(BREAK);
    el.childNodes.forEach(walk);
    if (block) parts.push(BREAK);
  };

  cell.childNodes.forEach(walk);
  return parts
    .join("")
    .split(BREAK)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" · ")
    .replace(/(\s*·\s*){2,}/g, " · ")
    .replace(/^\s*·\s*|\s*·\s*$/g, "");
}

/** The grouping and decimal marks of the locale in force — `en-US` writes
 *  1,250.5 and `id-ID` writes 1.250,5, and the settings screen can switch
 *  between them (D216). */
function separators(): { group: string; decimal: string } {
  const parts = new Intl.NumberFormat(getActiveLocale()).formatToParts(12345.6);
  return {
    group: parts.find((p) => p.type === "group")?.value ?? ",",
    decimal: parts.find((p) => p.type === "decimal")?.value ?? ".",
  };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** `Rp 1,250,000` → 1250000; `−3` → −3; `PO-0012`, `0812…`, `12%` stay text. */
export function parseShownNumber(text: string): { value: number; money: boolean } | null {
  let t = text.replace(/ /g, " ").trim();
  if (!t) return null;
  let money = false;
  let negative = false;
  if (/^[-−–]/.test(t)) { negative = true; t = t.slice(1).trim(); }
  const prefix = /^(Rp|IDR|USD)\s*/i.exec(t);
  if (prefix) { money = true; t = t.slice(prefix[0].length); }
  if (/^[-−–]/.test(t)) { negative = !negative; t = t.slice(1).trim(); }
  if (/^\(.*\)$/.test(t)) { negative = !negative; t = t.slice(1, -1).trim(); }

  const { group, decimal } = separators();
  const g = escapeRe(group);
  const d = escapeRe(decimal);
  const grouped = new RegExp(`^\\d{1,3}(${g}\\d{3})+(${d}\\d+)?$`);
  const plain = new RegExp(`^\\d+(${d}\\d+)?$`);
  if (!grouped.test(t) && !plain.test(t)) return null;
  /* A leading zero is an identifier (a phone number, a code), not a number —
     Excel would drop the zero. `0`, and `0.5`, are numbers. */
  if (/^0\d/.test(t)) return null;

  const normal = t.split(group).join("").replace(decimal, ".");
  const value = Number(normal);
  if (!Number.isFinite(value)) return null;
  return { value: negative ? -value : value, money };
}

/** The table as rows of cells, colspans and rowspans kept as merges. */
export function readTable(table: HTMLTableElement): { rows: Cell[][]; merges: Merge[]; headerRows: number; money: Set<string> } {
  const grid: Cell[][] = [];
  const taken: boolean[][] = [];
  const merges: Merge[] = [];
  const money = new Set<string>();

  const sections: HTMLTableSectionElement[] = [];
  if (table.tHead) sections.push(table.tHead);
  sections.push(...Array.from(table.tBodies));
  if (table.tFoot) sections.push(table.tFoot);
  const headerRows = table.tHead ? table.tHead.rows.length : 0;

  let r = 0;
  for (const section of sections) {
    for (const tr of Array.from(section.rows)) {
      if (tr.hasAttribute("data-no-export")) continue;
      grid[r] ??= [];
      taken[r] ??= [];
      let c = 0;
      for (const td of Array.from(tr.cells)) {
        while (taken[r][c]) c += 1;
        const colSpan = Math.max(td.colSpan || 1, 1);
        const rowSpan = Math.max(td.rowSpan || 1, 1);
        const skip = td.hasAttribute("data-no-export");
        const text = skip ? "" : cellText(td);
        const num = section === table.tHead ? null : parseShownNumber(text);
        grid[r][c] = num ? num.value : text;
        if (num?.money) money.add(`${r}:${c}`);
        for (let dr = 0; dr < rowSpan; dr += 1) {
          taken[r + dr] ??= [];
          grid[r + dr] ??= [];
          for (let dc = 0; dc < colSpan; dc += 1) {
            taken[r + dr][c + dc] = true;
            if (dr || dc) grid[r + dr][c + dc] = null;
          }
        }
        if (colSpan > 1 || rowSpan > 1) {
          merges.push({ s: { r, c }, e: { r: r + rowSpan - 1, c: c + colSpan - 1 } });
        }
        c += colSpan;
      }
      r += 1;
    }
  }

  const width = Math.max(0, ...grid.map((row) => row.length));
  const rows = grid.map((row) => Array.from({ length: width }, (_, i) => row[i] ?? null));

  /* A column with nothing in it — a chevron, an icon-only action — or a
     selection column: no header, and nothing but ticks. */
  const blank = (v: Cell) => v === null || v === "";
  const empty = (c: number) =>
    rows.slice(0, headerRows).every((row) => blank(row[c]))
    && rows.slice(headerRows).every((row) => blank(row[c]) || row[c] === "✓");
  const keep = Array.from({ length: width }, (_, c) => !empty(c));
  /* remap[c] = where column c lands once the empty ones are gone. */
  const remap: number[] = [];
  let next = 0;
  for (let c = 0; c < width; c += 1) { remap[c] = next; if (keep[c]) next += 1; }

  const outRows = rows.map((row) => row.filter((_, c) => keep[c]));
  const outMerges: Merge[] = [];
  for (const m of merges) {
    const cols = [];
    for (let c = m.s.c; c <= m.e.c; c += 1) if (keep[c]) cols.push(remap[c]);
    if (!cols.length) continue;
    const s = { r: m.s.r, c: cols[0] };
    const e = { r: m.e.r, c: cols[cols.length - 1] };
    if (s.r === e.r && s.c === e.c) continue;
    outMerges.push({ s, e });
  }
  const outMoney = new Set<string>();
  for (const key of money) {
    const [mr, mc] = key.split(":").map(Number);
    if (keep[mc]) outMoney.add(`${mr}:${remap[mc]}`);
  }

  return { rows: outRows, merges: outMerges, headerRows, money: outMoney };
}

/** `Tagihan vendor` + today → `tagihan-vendor-2026-10-12.xlsx`. */
export function exportFileName(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "tabel";
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${slug}-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.xlsx`;
}

/** The name a table is known by, when its screen did not give one: the
 *  heading of the card it sits in, after the page's own title. */
export function guessTableName(table: HTMLElement): string {
  const pageTitle = document.querySelector("main h1, h1")?.textContent?.trim() ?? "";
  let section = "";
  let el: HTMLElement | null = table.parentElement;
  while (el && el.tagName !== "MAIN" && el !== document.body) {
    const heading = Array.from(el.querySelectorAll("h1, h2, h3, h4"))
      .find((h) => !table.contains(h) && (h.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING));
    if (heading?.textContent?.trim()) { section = heading.textContent.trim(); break; }
    el = el.parentElement;
  }
  const parts = [pageTitle, section].filter(Boolean);
  if (parts.length === 2 && parts[0] === parts[1]) parts.pop();
  return parts.join(" ") || document.title || "tabel";
}

/** Writes what `readTable` read into an .xlsx and hands it to the browser. */
export async function downloadTable(
  data: ReturnType<typeof readTable>,
  name: string,
): Promise<void> {
  const XLSX = await import("xlsx");
  const sheet = XLSX.utils.aoa_to_sheet(data.rows);
  if (data.merges.length) sheet["!merges"] = data.merges;

  for (const key of data.money) {
    const [r, c] = key.split(":").map(Number);
    const cell = sheet[XLSX.utils.encode_cell({ r, c })];
    if (cell && cell.t === "n") cell.z = "#,##0";
  }

  /* Columns as wide as what is in them, within reason. */
  const width = data.rows[0]?.length ?? 0;
  sheet["!cols"] = Array.from({ length: width }, (_, c) => {
    const longest = Math.max(4, ...data.rows.map((row) => String(row[c] ?? "").length));
    return { wch: Math.min(longest + 2, 60) };
  });
  if (data.headerRows) {
    sheet["!autofilter"] = {
      ref: XLSX.utils.encode_range({ s: { r: data.headerRows - 1, c: 0 }, e: { r: data.rows.length - 1, c: Math.max(width - 1, 0) } }),
    };
  }

  const book = XLSX.utils.book_new();
  const sheetName = name.replace(/[\[\]:*?/\\]/g, " ").trim().slice(0, 31) || "Sheet1";
  XLSX.utils.book_append_sheet(book, sheet, sheetName);
  XLSX.writeFile(book, exportFileName(name), { compression: true });
}

/** Every row of a list the service pages, for a download of the whole list:
 *  asked for in chunks the database will hand over (PostgREST caps a read at
 *  a thousand), until the total the first answer gave is reached. A refusal
 *  stops the download rather than handing over a file with a hole in it. */
export async function allPages<T>(
  read: (limit: number, offset: number) => Promise<{ data?: T[]; error?: { message: string }; meta: { page?: { total: number } } }>,
  chunk = 500,
): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; ; offset += chunk) {
    const r = await read(chunk, offset);
    if (r.error || !r.data) throw new Error(r.error?.message ?? "read failed");
    out.push(...r.data);
    const total = r.meta.page?.total;
    if (r.data.length < chunk || (total != null && out.length >= total)) return out;
  }
}
