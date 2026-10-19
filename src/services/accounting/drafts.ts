/** The grouping behind the ledger's drafts (D445, `0286`).
 *
 *  Owner, 2026-10-19: *setiap dokumen baru yang diupload diolah secara batch.
 *  1 transaksi biasanya memiliki beberapa dokumen sekaligus. sistem akan
 *  mengelompokannya berdasarkan nilai transaksi.*
 *
 *  One pure function, called by both API layers with the same four inputs:
 *  the inbox rows still PENDING, the rows decided in the last few days (to
 *  catch a document that arrives after its transaction was booked), the
 *  pairs a person said are apart, and the account codes we have. Nothing it
 *  answers is stored; the decision about it is.
 *
 *  ## The signals (review, D445)
 *
 *  **Amount is the main one and never the only one.** A goods photo has no
 *  amount. A transfer is often a bank fee bigger than its nota. Two notas of
 *  the same amount on the same day can be swapped. So a payment proof and a
 *  nota are paired on the amount (exact, a known transfer fee apart, or a
 *  nota bigger than the transfer — a down payment) *and* the vendor, the
 *  date, and who sent them when. A photo joins by who sent it when: the
 *  same chat message, or the same person within half an hour.
 *
 *  ## The levels
 *
 *  ≥ 85 *yakin*, ≥ 60 *periksa*, below that *ragu*; a document with no
 *  partner and nothing to book is *lepas*. A draft with no account read is
 *  *ragu* whatever else agrees, because it cannot be ticked until somebody
 *  picks one. A suspected duplicate is *ragu* and proposes the link road.
 */

import type {
  Direction, DraftAnchor, DraftApart, DraftDocRole, DraftDocument, DraftLevel, DraftLine,
  DraftReason, DraftRoad, EvidenceInboxRow, LedgerDraft,
} from "./contracts";
import { guessLineKind } from "./lines";

/** How far apart a nota and its payment may be dated and still be one
 *  transaction (Q2, D445). */
export const DRAFT_WINDOW_DAYS = 3;
/** How close in time a photo must be sent to belong to another document. */
export const DRAFT_PHOTO_MINUTES = 30;
/** Transfer fees seen between Indonesian banks: BI-FAST, online, SKN, RTGS. */
export const KNOWN_FEES = [2_500, 2_900, 6_500, 25_000] as const;

export function draftLevel(score: number | null): DraftLevel {
  if (score === null) return "loose";
  return score >= 85 ? "hi" : score >= 60 ? "mid" : "lo";
}

/* ── documents ─────────────────────────────────────────────────────────── */

/** The photo a chat ref belongs to: its event **and** its file — the same
 *  key Verification groups by and `book_evidence_group` accepts. */
export function docKey(r: Pick<EvidenceInboxRow, "ref_id" | "origin" | "file_key">): string {
  const i = r.ref_id.indexOf("~");
  return r.origin === "chat" && i > 0 ? `${r.ref_id.slice(0, i)}|${r.file_key}` : r.ref_id;
}

/** The chat message a row came in: rows of one message share it. */
function eventOf(r: Pick<EvidenceInboxRow, "ref_id" | "origin">): string | null {
  const i = r.ref_id.indexOf("~");
  return r.origin === "chat" && i > 0 ? r.ref_id.slice(0, i) : null;
}

/** The client's copy of `ops_core.doc_kind_from_reading` (0276), in the
 *  draft's own four words. */
export function roleOf(ext: EvidenceInboxRow["extracted"]): DraftDocRole {
  const kind = ext.doc_kind ?? "";
  if (kind === "transfer_proof") return "payment";
  if (kind === "goods_photo") return "photo";
  if (kind === "nota") return "nota";
  if (kind === "other") return "other";
  const t = ext.doc_type ?? "";
  if (/(payment|transfer|bukti)/i.test(t)) return "payment";
  if (/(receiving|goods|barang|item)/i.test(t)) return "photo";
  if (/^\s*(others?|lain)/i.test(t)) return "other";
  return "nota";
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function toDocuments(rows: EvidenceInboxRow[]): DraftDocument[] {
  const by = new Map<string, EvidenceInboxRow[]>();
  for (const r of rows) {
    const k = docKey(r);
    by.set(k, [...(by.get(k) ?? []), r]);
  }
  return [...by.entries()].map(([key, rs]) => {
    /* The main row speaks for the photo: the largest amount, so the
       transfer and not its fee. */
    const sorted = [...rs].sort((a, b) => (num(b.extracted.amount_idr) ?? 0) - (num(a.extracted.amount_idr) ?? 0)
      || a.ref_id.localeCompare(b.ref_id));
    const main = sorted[0];
    const amounts = rs.map((r) => num(r.extracted.amount_idr)).filter((a): a is number => a !== null);
    const confs = rs.map((r) => num(r.extracted.confidence)).filter((c): c is number => c !== null);
    return {
      key,
      ref_ids: sorted.map((r) => r.ref_id),
      file_key: main.file_key,
      attachment_id: main.attachment_id,
      role: roleOf(main.extracted),
      amount: amounts.length ? amounts.reduce((n, a) => n + a, 0) : null,
      vendor_name: rs.find((r) => r.extracted.vendor_name)?.extracted.vendor_name ?? null,
      document_date: rs.find((r) => r.extracted.document_date)?.extracted.document_date ?? null,
      account: rs.find((r) => r.extracted.account)?.extracted.account ?? null,
      confidence: confs.length ? Math.min(...confs) : null,
      note: main.extracted.note ?? null,
      reported_by: main.reported_by,
      reported_by_name: main.reported_by_name,
      reported_at: main.reported_at,
      rows: sorted,
    };
  });
}

/* ── comparing two documents ───────────────────────────────────────────── */

/** CV, TB, PT, UD and punctuation are not the name. */
export function normVendor(v: string | null | undefined): string {
  return (v ?? "").toUpperCase()
    .replace(/\b(CV|PT|TB|UD|TK|TOKO|PD|KOPERASI)\b\.?/g, " ")
    .replace(/[^A-Z0-9]+/g, " ").trim();
}

export function vendorsAgree(a: string | null, b: string | null): boolean | null {
  const x = normVendor(a), y = normVendor(b);
  if (!x || !y) return null;
  return x === y || x.includes(y) || y.includes(x);
}

function dayOf(d: DraftDocument): string {
  return d.document_date ?? d.reported_at.slice(0, 10);
}

function daysApart(a: string, b: string): number {
  return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;
}

function minutesApart(a: string, b: string): number {
  return Math.abs(Date.parse(a) - Date.parse(b)) / 60_000;
}

function sameMessage(a: DraftDocument, b: DraftDocument): boolean {
  const ea = eventOf(a.rows[0]);
  return ea !== null && ea === eventOf(b.rows[0]);
}

function sentTogether(a: DraftDocument, b: DraftDocument): boolean {
  return sameMessage(a, b)
    || (a.reported_by === b.reported_by && minutesApart(a.reported_at, b.reported_at) <= DRAFT_PHOTO_MINUTES);
}

type ApartSet = Set<string>;
function apartKey(a: string, b: string): string {
  return a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
}
function isApart(apart: ApartSet, a: DraftDocument, b: DraftDocument): boolean {
  return apart.has(apartKey(a.file_key, b.file_key));
}

interface PairFit {
  score: number;
  /** Payment − nota, when it is a known fee. */
  fee: number | null;
  /** The nota's amount, when the payment is a part of it. */
  partial: number | null;
  reasons: DraftReason[];
}

const rp = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;

/** How well a payment proof and a nota fit as one transaction, or null when
 *  they do not fit at all. */
function fitPair(p: DraftDocument, n: DraftDocument): PairFit | null {
  if (p.amount === null || n.amount === null) return null;
  const days = daysApart(dayOf(p), dayOf(n));
  if (days > DRAFT_WINDOW_DAYS) return null;
  const vendor = vendorsAgree(p.vendor_name, n.vendor_name);
  if (vendor === false) return null;
  const reasons: DraftReason[] = [];
  let score = 0, fee: number | null = null, partial: number | null = null;
  const diff = p.amount - n.amount;
  if (Math.abs(diff) <= 1) {
    score += 50;
    reasons.push({ tone: "ok", en: `The nota and the payment are the same amount (${rp(p.amount)})`,
      id: `Nominal nota sama persis dengan bukti bayar (${rp(p.amount)})` });
  } else if ((KNOWN_FEES as readonly number[]).includes(diff)) {
    score += 40; fee = diff;
    reasons.push({ tone: "check", en: `The payment is ${rp(diff)} more than the nota: read as a transfer fee, made a fee line`,
      id: `Bukti bayar ${rp(diff)} lebih besar dari nota: dibaca sebagai biaya transfer, dibuat baris fee` });
  } else if (diff < 0 && vendor === true) {
    score += 25; partial = n.amount;
    reasons.push({ tone: "check", en: `The payment (${rp(p.amount)}) is part of the nota (${rp(n.amount)}) — a down payment?`,
      id: `Bukti bayar (${rp(p.amount)}) sebagian dari nota (${rp(n.amount)}) — DP atau cicilan?` });
  } else {
    return null;
  }
  if (vendor === true) {
    score += 25;
    reasons.push({ tone: "ok", en: "The payee is the vendor on the nota", id: "Nama penerima = vendor di nota" });
  } else {
    reasons.push({ tone: "check", en: "No vendor read on one of the two — check it is the same shop",
      id: "Vendor tidak terbaca di salah satu dokumen — pastikan tokonya sama" });
  }
  if (days === 0) score += 10;
  else if (days <= 1) score += 8;
  else score += 2;
  reasons.push(days <= 1
    ? { tone: "ok", en: days === 0 ? "Same date" : "Dated one day apart", id: days === 0 ? "Tanggal sama" : "Tanggal berjarak 1 hari" }
    : { tone: "check", en: `Dated ${days} days apart`, id: `Tanggal berjarak ${days} hari` });
  if (sameMessage(p, n)) {
    score += 15;
    reasons.push({ tone: "ok", en: "Sent in one message", id: "Dikirim dalam satu pesan" });
  } else if (sentTogether(p, n)) {
    score += 10;
    reasons.push({ tone: "ok", en: `Sent by ${p.reported_by_name ?? "the same person"} within ${DRAFT_PHOTO_MINUTES} minutes`,
      id: `Dikirim ${p.reported_by_name ?? "orang yang sama"} dalam ${DRAFT_PHOTO_MINUTES} menit` });
  } else if (p.reported_by !== n.reported_by) {
    reasons.push({ tone: "check", en: `Sent by two people (${n.reported_by_name ?? "?"}, ${p.reported_by_name ?? "?"})`,
      id: `Dikirim dua orang berbeda (${n.reported_by_name ?? "?"}, ${p.reported_by_name ?? "?"})` });
  }
  return { score, fee, partial, reasons };
}

/* ── the grouping ──────────────────────────────────────────────────────── */

interface Group {
  docs: DraftDocument[];
  fit: PairFit | null;
  /** Notas paid together by one transfer. */
  notas: DraftDocument[];
  ambiguous: string | null;
}

function shortHash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36).toUpperCase().padStart(4, "0").slice(-4);
}

export interface BuildDraftsInput {
  pending: EvidenceInboxRow[];
  anchors: DraftAnchor[];
  apart: DraftApart[];
  accountCodes: string[];
  /** `YYYY-MM-DD`, for a document with no date read. */
  today: string;
}

export function buildDrafts(input: BuildDraftsInput): LedgerDraft[] {
  const apart: ApartSet = new Set(input.apart.map((a) => apartKey(a.file_a, a.file_b)));
  const accounts = new Map(input.accountCodes.map((c) => [c.toLowerCase(), c]));
  const knownAccount = (c: string | null | undefined) => (c ? accounts.get(c.toLowerCase()) ?? null : null);
  const docs = toDocuments(input.pending);
  const payments = docs.filter((d) => d.role === "payment");
  const notas = docs.filter((d) => d.role === "nota" || (d.role === "other" && d.amount !== null));
  const used = new Set<string>();
  const groups: Group[] = [];

  /* 1 · each payment with its best nota, best pairs first. */
  const pairs = payments.flatMap((p) => notas.flatMap((n) => {
    if (isApart(apart, p, n)) return [];
    const fit = fitPair(p, n);
    return fit ? [{ p, n, fit }] : [];
  })).sort((a, b) => b.fit.score - a.fit.score || a.p.key.localeCompare(b.p.key));
  for (const pr of pairs) {
    if (used.has(pr.p.key) || used.has(pr.n.key)) continue;
    /* Another nota that fits this payment as well, or another payment this
       nota as well: the grouping cannot tell them apart — say so. */
    const rival = pairs.find((o) => o !== pr && !used.has(o.p.key) && !used.has(o.n.key)
      && (o.p.key === pr.p.key || o.n.key === pr.n.key) && o.fit.score >= pr.fit.score - 5);
    used.add(pr.p.key); used.add(pr.n.key);
    const other = rival ? (rival.p.key === pr.p.key ? rival.n : rival.p) : null;
    groups.push({
      docs: [pr.p, pr.n], fit: pr.fit, notas: [pr.n],
      ambiguous: other ? `${other.vendor_name ?? other.role} ${other.amount !== null ? rp(other.amount) : ""}`.trim() : null,
    });
  }

  /* 2 · a payment left over that is exactly two or three notas of one
     vendor, within the window. */
  for (const p of payments) {
    if (used.has(p.key) || p.amount === null) continue;
    const pool = notas.filter((n) => !used.has(n.key) && n.amount !== null && !isApart(apart, p, n)
      && daysApart(dayOf(p), dayOf(n)) <= DRAFT_WINDOW_DAYS && vendorsAgree(p.vendor_name, n.vendor_name) !== false);
    let found: DraftDocument[] | null = null;
    for (let i = 0; i < pool.length && !found; i++) {
      for (let j = i + 1; j < pool.length && !found; j++) {
        const two = [pool[i], pool[j]];
        if (vendorsAgree(two[0].vendor_name, two[1].vendor_name) === false || isApart(apart, two[0], two[1])) continue;
        if (two[0].amount! + two[1].amount! === p.amount) found = two;
        for (let k = j + 1; k < pool.length && !found; k++) {
          const three = [...two, pool[k]];
          if (three.reduce((n, d) => n + d.amount!, 0) === p.amount
              && three.every((d) => vendorsAgree(d.vendor_name, three[0].vendor_name) !== false)) found = three;
        }
      }
    }
    if (!found) continue;
    used.add(p.key); found.forEach((n) => used.add(n.key));
    groups.push({
      docs: [p, ...found], notas: found, ambiguous: null,
      fit: { score: 70, fee: null, partial: null, reasons: [{ tone: "check",
        en: `One payment of ${rp(p.amount)} is ${found.length} notas together`,
        id: `Satu bukti bayar ${rp(p.amount)} = ${found.length} nota sekaligus` }] },
    });
  }

  /* 3 · whatever is left with an amount is a draft of its own. */
  for (const d of [...payments, ...notas]) {
    if (used.has(d.key)) continue;
    used.add(d.key);
    groups.push({ docs: [d], fit: null, notas: d.role === "payment" ? [] : [d], ambiguous: null });
  }

  /* 4 · photos and papers with no amount join the document sent with them. */
  const loose: DraftDocument[] = [];
  for (const d of docs) {
    if (used.has(d.key)) continue;
    let best: { g: Group; m: number } | null = null;
    for (const g of groups) {
      if (g.docs.some((x) => isApart(apart, x, d))) continue;
      const near = g.docs.filter((x) => sentTogether(x, d));
      if (near.length === 0) continue;
      const m = Math.min(...near.map((x) => (sameMessage(x, d) ? -1 : minutesApart(x.reported_at, d.reported_at))));
      if (!best || m < best.m) best = { g, m };
    }
    if (best) { best.g.docs.push(d); used.add(d.key); } else loose.push(d);
  }

  const drafts = groups.map((g) => toDraft(g, input, knownAccount));

  /* 5 · a loose document sent with one already booked is its late proof. */
  for (const d of loose) {
    const anchor = input.anchors.find((a) => !apart.has(apartKey(a.row.file_key, d.file_key))
      && a.row.reported_by === d.reported_by
      && (eventOf(a.row) !== null && eventOf(a.row) === eventOf(d.rows[0])
          || minutesApart(a.row.reported_at, d.reported_at) <= DRAFT_PHOTO_MINUTES));
    drafts.push(looseDraft(d, input.today, anchor?.trx_no ?? null));
  }

  const order: Record<DraftLevel, number> = { lo: 0, mid: 1, hi: 2, loose: 3 };
  return drafts.sort((a, b) => order[a.level] - order[b.level] || b.trx_date.localeCompare(a.trx_date)
    || a.key.localeCompare(b.key));
}

function toDraft(
  g: Group, input: BuildDraftsInput, knownAccount: (c: string | null | undefined) => string | null,
): LedgerDraft {
  const payment = g.docs.find((d) => d.role === "payment") ?? null;
  /* Head first: the payment proof, then the notas, then the photos. */
  const rank: Record<DraftDocRole, number> = { payment: 0, nota: 1, other: 2, photo: 3 };
  const docs = [...g.docs].sort((a, b) => rank[a.role] - rank[b.role] || a.reported_at.localeCompare(b.reported_at));
  const head = docs[0];
  const reasons: DraftReason[] = [...(g.fit?.reasons ?? [])];
  const notaSum = g.notas.reduce((n, d) => n + (d.amount ?? 0), 0);
  const amount = payment?.amount ?? (g.notas.length ? notaSum : null);
  const vendor = g.notas.find((n) => n.vendor_name)?.vendor_name ?? payment?.vendor_name ?? null;
  const date = (payment ?? head).document_date ?? head.document_date ?? head.reported_at.slice(0, 10) ?? input.today;
  const direction: Direction = head.rows.find((r) => r.money_direction)?.money_direction ?? "OUT";

  /* The reading of a transfer proof names its legs (john-lau J1). Two legs
     on two accounts we have: a transfer between our own accounts. */
  const readLines = (payment?.rows ?? []).flatMap((r) => (r.extracted.lines ?? []) as {
    money_direction?: string | null; account?: string | null; amount_idr?: number | null; transaction_type?: string | null }[]);
  const outLeg = readLines.find((l) => l.money_direction === "OUT" && l.transaction_type !== "BANK CHARGES");
  const inLeg = readLines.find((l) => l.money_direction === "IN");
  const feeLeg = readLines.find((l) => l.transaction_type === "BANK CHARGES");
  const fromAcct = knownAccount(outLeg?.account) ?? knownAccount(payment?.account) ?? knownAccount(docs.find((d) => d.account)?.account);
  const toAcct = knownAccount(inLeg?.account);
  /* A request line named in the message (0281): `pr-…-Lxx`. */
  const text = docs.flatMap((d) => d.rows.map((r) => `${r.extracted.caption ?? ""} ${r.extracted.note ?? ""}`)).join(" ");
  const m = /(pr-\d{2}-\d{2}-\d{2}_\d+-L\d{2})/i.exec(text);
  const payLine = m ? m[1].toLowerCase().replace(/-l(\d{2})$/, "-L$1") : null;

  let road: DraftRoad = "transaction";
  let score: number;
  let toAccount: string | null = null;
  let fee: number | null = g.fit?.fee ?? null;

  if (payment && g.notas.length === 0 && fromAcct && toAcct && fromAcct !== toAcct) {
    road = "transfer"; toAccount = toAcct; fee = num(feeLeg?.amount_idr) ?? null;
    score = 90;
    reasons.push({ tone: "ok", en: `The payee is our own account (${toAcct}): booked as a move between accounts, both legs at once`,
      id: `Penerima adalah rekening kita sendiri (${toAcct}): dibukukan sebagai pindah dana, dua kaki sekaligus` });
  } else if (payment && payLine) {
    road = "pay_line"; score = g.notas.length ? Math.max(85, 20 + (g.fit?.score ?? 0)) : 85;
    reasons.push({ tone: "ok", en: `The message names the approved request ${payLine}`, id: `Pesannya menyebut permintaan ${payLine}` });
  } else if (payment && g.notas.length) {
    score = Math.min(100, 20 + (g.fit?.score ?? 0));
    if (g.fit?.fee) score = Math.min(score, 80);
    if (g.fit?.partial) score = Math.min(score, 65);
  } else if (payment) {
    score = 62;
    reasons.push({ tone: "check", en: `No nota within ${DRAFT_WINDOW_DAYS} days — booked on the payment alone`,
      id: `Tidak ada nota dalam ${DRAFT_WINDOW_DAYS} hari — dibukukan dari bukti bayar saja` });
  } else {
    score = 50;
    reasons.push({ tone: "bad", en: "No payment proof — paid in cash? Pick the account it was paid from",
      id: "Tidak ada bukti bayar — dibayar tunai? Pilih rekening pembayarnya" });
  }

  const photos = docs.filter((d) => d.role === "photo" || (d.role === "other" && d.amount === null));
  for (const ph of photos) {
    reasons.push({ tone: "ok", en: `A ${ph.role === "photo" ? "goods photo" : "document"} sent with it by ${ph.reported_by_name ?? "the same person"}`,
      id: `${ph.role === "photo" ? "Foto barang" : "Dokumen"} dikirim bersamanya oleh ${ph.reported_by_name ?? "orang yang sama"}` });
  }
  if (g.ambiguous) {
    score = Math.min(score, 55);
    reasons.push({ tone: "bad", en: `Another document fits as well (${g.ambiguous}) — the pairing may be swapped`,
      id: `Ada dokumen lain yang sama cocoknya (${g.ambiguous}) — pasangannya bisa tertukar` });
  }
  const lowConf = docs.filter((d) => d.confidence !== null && d.confidence < 70);
  if (lowConf.length) {
    score -= 15;
    reasons.push({ tone: "check", en: `Read with low confidence (${Math.min(...lowConf.map((d) => d.confidence!))}%) — check the figures`,
      id: `Terbaca dengan keyakinan rendah (${Math.min(...lowConf.map((d) => d.confidence!))}%) — cek angkanya` });
  }
  if (amount === null) {
    score = Math.min(score, 40);
    reasons.push({ tone: "bad", en: "No amount read — type it", id: "Nominal tidak terbaca — isi nilainya" });
  }
  if (!fromAcct) {
    score = Math.min(score, 55);
    reasons.push({ tone: "bad", en: "The paying account was not read — pick it before ticking",
      id: "Rekening pembayar tidak terbaca — pilih dulu sebelum mencentang" });
  } else {
    reasons.push({ tone: "ok", en: `Paid from ${fromAcct}`, id: `Rekening terbaca: ${fromAcct}` });
  }

  /* A suspected duplicate proposes the link road instead (review §4). */
  let linkTrx: string | null = null;
  const dupFlag = docs.some((d) => d.rows.some((r) => r.extracted.duplicate_suspect));
  const similar = [...new Set(docs.flatMap((d) => d.rows.flatMap((r) => r.similar_trx_nos)))];
  const twin = input.anchors.find((a) => {
    const ad = num(a.row.extracted.amount_idr);
    const sameAmount = ad !== null && amount !== null && Math.abs(ad - amount) <= 1;
    const v = vendorsAgree(a.row.extracted.vendor_name ?? null, vendor);
    const aDay = a.row.extracted.document_date ?? a.row.reported_at.slice(0, 10);
    return sameAmount && v === true && daysApart(aDay, date) <= DRAFT_WINDOW_DAYS;
  });
  if (similar.length || twin) {
    linkTrx = similar[0] ?? twin!.trx_no;
    const sameRole = twin && roleOf(twin.row.extracted) === head.role;
    road = "link";
    score = Math.min(score, sameRole || similar.length ? 35 : 70);
    reasons.unshift(sameRole || similar.length
      ? { tone: "bad", en: `Looks like ${linkTrx}, already in the ledger — link it as proof instead of booking it again`,
          id: `Mirip ${linkTrx} yang sudah tercatat — tautkan sebagai bukti, jangan dibukukan lagi` }
      : { tone: "check", en: `Same amount and vendor as ${linkTrx}, booked already — this is likely its other document`,
          id: `Nominal dan vendor sama dengan ${linkTrx} yang sudah dibukukan — kemungkinan dokumen pasangannya` });
  } else if (dupFlag) {
    score = Math.min(score, 45);
    reasons.unshift({ tone: "bad", en: "Capture marked this file as a possible duplicate", id: "Bot menandai file ini mungkin kembar" });
  }

  /* The lines: the nota's rows, a fee line for a known fee, nothing when
     the payment is only part of the nota (it would not add up). */
  const lines: DraftLine[] = [];
  if (road === "transaction" && !g.fit?.partial) {
    /* The nota's rows; for a payment alone only when it was read as more
       than one slot (the transfer and its fee) — one line repeating the
       amount says nothing the row does not. */
    const source = g.notas.length ? g.notas : payment && payment.rows.length > 1 ? [payment] : [];
    for (const n of source) {
      const di = docs.indexOf(n);
      for (const r of [...n.rows].sort((a, b) => a.ref_id.localeCompare(b.ref_id))) {
        const a = num(r.extracted.amount_idr);
        if (a === null) continue;
        const desc = (r.extracted.note ?? n.vendor_name ?? "").trim().toUpperCase() || "BARANG";
        const kind = guessLineKind(desc);
        lines.push({ kind, description: desc, qty: kind === "item" ? 1 : null, uom: kind === "item" ? "pcs" : null,
          unit_price: kind === "item" ? a : null, amount: a, doc: di });
      }
    }
    if (fee) lines.push({ kind: "fee", description: "BIAYA TRANSFER", qty: null, uom: null, unit_price: null, amount: fee, doc: 0 });
    if (lines.length && amount !== null && lines.reduce((n, l) => n + (l.kind === "discount" ? -l.amount : l.amount), 0) !== amount) {
      lines.length = 0;
    }
  }

  const s = Math.max(0, Math.min(100, Math.round(score)));
  const refs = docs.flatMap((d) => d.ref_ids);
  const first = g.notas[0]?.note ?? payment?.note ?? null;
  return {
    key: head.ref_ids[0],
    label: `DRF-${shortHash(refs.slice().sort().join("|"))}`,
    level: draftLevel(s),
    score: s,
    reasons,
    docs,
    road,
    direction,
    amount,
    account_code: fromAcct,
    to_account_code: toAccount,
    fee: road === "transfer" ? fee : null,
    trx_date: date,
    vendor_name: vendor,
    description: [vendor, first].filter(Boolean).join(" — ").toUpperCase().slice(0, 200)
      || (road === "transfer" ? `PINDAH DANA ${fromAcct ?? ""} KE ${toAccount ?? ""}`.trim() : "TRANSAKSI DARI CHAT"),
    type_code: head.rows.find((r) => r.extracted.transaction_type)?.extracted.transaction_type ?? null,
    lines,
    link_trx_no: linkTrx,
    pay_line_no: road === "pay_line" ? payLine : null,
    partial_of: g.fit?.partial ?? null,
  };
}

function looseDraft(d: DraftDocument, today: string, anchorTrx: string | null): LedgerDraft {
  const what = d.role === "photo" ? { en: "goods photo", id: "Foto barang" } : { en: "document", id: "Dokumen" };
  const reasons: DraftReason[] = anchorTrx
    ? [{ tone: "check", en: `Sent with the documents of ${anchorTrx}, already booked — add it as its proof`,
         id: `Dikirim bersama dokumen ${anchorTrx} yang sudah dibukukan — tambahkan sebagai buktinya` }]
    : [{ tone: "check", en: `A ${what.en} with no amount: waiting ${DRAFT_WINDOW_DAYS} days for a nota or payment from ${d.reported_by_name ?? "the same person"}`,
         id: `${what.id} tanpa nominal: menunggu ${DRAFT_WINDOW_DAYS} hari untuk nota atau bukti bayar dari ${d.reported_by_name ?? "pengirim yang sama"}` }];
  return {
    key: d.ref_ids[0],
    label: `DOC-${shortHash(d.ref_ids.slice().sort().join("|"))}`,
    level: anchorTrx ? "mid" : "loose",
    score: anchorTrx ? 70 : null,
    reasons,
    docs: [d],
    road: "link",
    direction: "OUT",
    amount: null,
    account_code: null,
    to_account_code: null,
    fee: null,
    trx_date: d.document_date ?? d.reported_at.slice(0, 10) ?? today,
    vendor_name: d.vendor_name,
    description: (d.note ?? what.id).toUpperCase(),
    type_code: null,
    lines: [],
    link_trx_no: anchorTrx,
    pay_line_no: null,
    partial_of: null,
  };
}

/** What the person saw, kept with the decision (`draft_decisions`). */
export function shownOf(d: LedgerDraft): { level: DraftLevel; score: number | null; reasons: string[];
  proposed: { amount: number | null; account: string | null; road: DraftRoad } } {
  return {
    level: d.level, score: d.score,
    reasons: d.reasons.map((r) => `${r.tone}: ${r.id}`),
    proposed: { amount: d.amount, account: d.account_code, road: d.road },
  };
}
