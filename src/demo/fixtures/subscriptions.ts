import type { Subscription, SubscriptionPayment } from "@/services/accounting/contracts";

/** The rate the plan converts dollars at. Leadership's to change (D233). */
export const SUBSCRIPTION_FX = 19_000;

const base = { provider: null, ends_on: null, note: null, created_by: "usr_anggun", created_at: "2026-10-02T09:00:00+07:00" };

/** A handful of the services the company really pays for in dollars and
 *  rupiah, across all three cycles and both price kinds — sample data for the
 *  sandbox, not the production register. The prices carry the vendor's
 *  11% VAT where the vendor charges it (a $24 plan is billed $26,64). */
export const SUBSCRIPTIONS: Subscription[] = [
  { ...base, id: "sub_01", sub_no: "SUB-0001", name: "n8n Cloud", provider: "n8n", login_email: "ops@talaliving.com",
    cycle: "monthly", amount_kind: "fixed", currency: "USD", amount: 26.64, start_on: "2026-09-01",
    account_id: "acc_bca271", status: "active" },
  { ...base, id: "sub_02", sub_no: "SUB-0002", name: "Supabase", provider: "Supabase", login_email: "it@talaliving.com",
    cycle: "monthly", amount_kind: "fixed", currency: "USD", amount: 25, start_on: "2026-09-03",
    account_id: "acc_bca271", status: "active" },
  { ...base, id: "sub_03", sub_no: "SUB-0003", name: "Claude Max 20x — shared", provider: "Anthropic", login_email: "shared@talaliving.com",
    cycle: "monthly", amount_kind: "fixed", currency: "USD", amount: 224, start_on: "2026-09-25",
    account_id: "acc_bca271", status: "active", note: "Upgraded from Max; the first charge was prorated." },
  { ...base, id: "sub_04", sub_no: "SUB-0004", name: "Google Cloud Platform", provider: "Google", login_email: "shared@talaliving.com",
    cycle: "monthly", amount_kind: "payg", currency: "IDR", amount: 1_900_000, start_on: "2026-09-02",
    account_id: "acc_bca271", status: "active", note: "Billed on use; the amount is what is expected." },
  { ...base, id: "sub_05", sub_no: "SUB-0005", name: "Starlink Residential Lite", provider: "Starlink", login_email: null,
    cycle: "monthly", amount_kind: "fixed", currency: "IDR", amount: 509_999, start_on: "2026-09-08",
    account_id: "acc_bni325", status: "active" },
  { ...base, id: "sub_06", sub_no: "SUB-0006", name: "Domain talaliving.com", provider: "Registrar", login_email: "it@talaliving.com",
    cycle: "yearly", amount_kind: "fixed", currency: "IDR", amount: 250_000, start_on: "2026-11-15",
    account_id: "acc_bca271", status: "active", note: "Sample of a yearly subscription." },
  { ...base, id: "sub_07", sub_no: "SUB-0007", name: "Design software licence", provider: "Vendor", login_email: "shared@talaliving.com",
    cycle: "biennial", amount_kind: "fixed", currency: "USD", amount: 240, start_on: "2027-02-10",
    account_id: "acc_bca271", status: "active", note: "Sample of a two-year subscription." },
];

const pay = (n: number, sub: string, period: string, paid_on: string, idr: number, usd: number | null): SubscriptionPayment => ({
  id: `subpay_${n}`, subscription_id: sub, period, paid_on, amount_idr: idr, amount_usd: usd,
  fx_rate: usd == null ? null : Math.round((idr / usd) * 100) / 100, trx_no: null, note: null,
  recorded_by: "usr_anggun", recorded_at: `${paid_on}T09:00:00+07:00`,
});

/** September, as the spreadsheet had it. */
export const SUBSCRIPTION_PAYMENTS: SubscriptionPayment[] = [
  pay(1, "sub_01", "2026-09", "2026-09-02", 491_531, 26.64),
  pay(2, "sub_02", "2026-09", "2026-09-03", 461_790, 25),
  pay(3, "sub_04", "2026-09", "2026-09-02", 741_038, null),
  pay(4, "sub_05", "2026-09", "2026-09-08", 509_999, null),
];
