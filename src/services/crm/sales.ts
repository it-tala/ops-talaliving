/** The sales summary, from a list of quotations — one function for the demo
 *  and the live screens alike, so the two cannot count differently. */
import type { QuotationView } from "@/services/quotation/contracts";
import type { SalesSummary } from "./contracts";

export function salesSummary(rows: QuotationView[]): SalesSummary {
  const value = (xs: QuotationView[]) => xs.reduce((a, q) => a + (q.grand_total ?? 0), 0);
  const open = rows.filter((q) => q.status === "SENT" && q.is_current);
  const accepted = rows.filter((q) => q.status === "ACCEPTED");
  const rejected = rows.filter((q) => q.status === "REJECTED");
  const decided = accepted.length + rejected.length;

  /* Reasons are free text; the same words in a different case are the same
     reason. The first spelling seen is the one shown. */
  const byKey = new Map<string, { reason: string; count: number }>();
  for (const q of rejected) {
    const text = q.decision_reason?.trim();
    if (!text) continue;
    const key = text.toLowerCase().replace(/\s+/g, " ");
    const hit = byKey.get(key);
    if (hit) hit.count++;
    else byKey.set(key, { reason: text, count: 1 });
  }

  return {
    drafts: rows.filter((q) => q.status === "DRAFT").length,
    open_count: open.length,
    open_value: value(open),
    accepted_count: accepted.length,
    accepted_value: value(accepted),
    rejected_count: rejected.length,
    rejected_value: value(rejected),
    win_rate: decided === 0 ? null : accepted.length / decided,
    reasons: [...byKey.values()].sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason)),
  };
}
