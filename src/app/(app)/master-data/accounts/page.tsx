"use client";

import { useState } from "react";
import { Landmark, Plus, Pencil, Trash2, Lock } from "lucide-react";
import { Badge, Button, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Modal } from "@/components/ui/drawer";
import { Loaded, SourceBadge, useLoad } from "@/components/ui/loaded";
import { MoneyInput } from "@/components/ui/money-input";
import { formatIDR } from "@/lib/format";
import { accounting } from "@/demo/api";
import type { AccountBalance, AccountCustody } from "@/services/accounting/contracts";
import { useToast } from "@/store/toast";
import { useSession } from "@/store/session";

/** The money accounts — bank accounts and petty cash (`0105`).
 *
 *  The code is what every ledger row is written against, so it is fixed at
 *  creation; the currency is fixed once a transaction is booked on the
 *  account. An opening balance moves every balance after it, so changing it
 *  needs a reason, which the audit log keeps with the old and new figures.
 *
 *  Leadership accounts (D87) never pay a vendor directly, and are changed
 *  only by someone who approves funds. An account in use is deactivated, not
 *  deleted: it leaves the pickers and keeps its history.
 */
const inputClass =
  "mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none";

type Form = {
  mode: "create" | "edit";
  code: string; name: string; custody: AccountCustody; is_paying: boolean;
  currency: string; opening_balance: number; opened_on: string; is_active: boolean;
  original_balance: number; reason: string;
};

type Row = AccountBalance & { balance_locked?: boolean };

export default function AccountsPage() {
  const { can, hasAuthority } = useSession();
  const { toast } = useToast();
  const [state, reload] = useLoad(() => accounting.listAccounts(), []);
  const [form, setForm] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);

  const mayEdit = can("accounting.update") && hasAuthority("post_ledger");
  const mayLeadership = hasAuthority("approve_funds");
  const mayTouch = (custody: AccountCustody) => mayEdit && (custody !== "leadership" || mayLeadership);

  async function save() {
    if (!form) return;
    setSaving(true);
    const res = form.mode === "create"
      ? await accounting.createAccount({
        code: form.code, name: form.name, custody: form.custody, is_paying: form.is_paying,
        currency: form.currency, opening_balance: form.opening_balance, opened_on: form.opened_on || undefined,
      })
      : await accounting.updateAccount(form.code, {
        name: form.name, custody: form.custody, is_paying: form.is_paying, currency: form.currency,
        opening_balance: form.opening_balance, opened_on: form.opened_on || undefined,
        is_active: form.is_active,
        ...(form.reason.trim() ? { reason: form.reason.trim() } : {}),
      });
    setSaving(false);
    if (res.error) {
      toast(res.error.status === 403 ? "critical" : "warning", "Not saved", res.error.message);
      return;
    }
    toast("success", form.mode === "create" ? "Account added" : "Account saved", `${res.data.code} — ${res.data.name}`);
    setForm(null);
    reload();
  }

  async function remove() {
    if (!form) return;
    setSaving(true);
    const res = await accounting.deleteAccount(form.code);
    setSaving(false);
    if (res.error) {
      toast(res.error.status === 403 ? "critical" : "warning", "Not deleted", res.error.message);
      return;
    }
    toast("success", "Account deleted", `${form.code} is gone. Nothing was booked on it.`);
    setForm(null);
    reload();
  }

  function openEdit(a: Row) {
    setForm({
      mode: "edit", code: a.code, name: a.name, custody: a.custody, is_paying: a.is_paying,
      currency: a.currency, opening_balance: Number(a.opening_balance), opened_on: a.opened_on ?? "",
      is_active: a.is_active !== false, original_balance: Number(a.opening_balance), reason: "",
    });
  }

  const columns: Column<Row>[] = [
    {
      key: "code",
      header: "Account",
      render: (a) => (
        <div>
          <p className="font-medium text-slate-800">
            {a.code}
            {a.is_active === false && <Badge tone="slate" className="ml-2">Inactive</Badge>}
          </p>
          <p className="text-[11px] text-slate-500">{a.name}</p>
        </div>
      ),
    },
    {
      key: "custody",
      header: "Held by",
      render: (a) => a.custody === "leadership"
        ? <Badge tone="violet">Leadership</Badge>
        : <Badge tone="slate">Accounting</Badge>,
    },
    {
      key: "paying",
      header: "Pays vendors",
      render: (a) => (a.is_paying ? <Badge tone="green" dot>Yes</Badge> : <span className="text-slate-400">No</span>),
    },
    { key: "cur", header: "Currency", render: (a) => <span className="font-mono text-[12px] text-slate-600">{a.currency}</span> },
    {
      key: "open",
      header: "Opening balance",
      align: "right",
      render: (a) => a.balance_locked
        ? <span className="text-slate-300">&mdash;</span>
        : <span className="tabular-nums text-slate-600">{formatIDR(Number(a.opening_balance))}</span>,
    },
    {
      key: "bal",
      header: "Balance now",
      align: "right",
      render: (a) => a.balance_locked
        ? <span className="inline-flex items-center gap-1 text-slate-400"><Lock className="h-3 w-3" /> locked</span>
        : <span className="tabular-nums font-medium text-slate-800">{formatIDR(Number(a.balance))}</span>,
    },
    {
      key: "edit",
      header: "",
      render: (a) => mayTouch(a.custody) ? (
        <Button variant="ghost" size="sm" icon={Pencil} aria-label={`Edit ${a.code}`} onClick={() => openEdit(a)}>
          <span className="sr-only">Edit</span>
        </Button>
      ) : null,
    },
  ];

  const balanceChanged = !!form && form.mode === "edit" && form.opening_balance !== form.original_balance;

  return (
    <div>
      <PageHeader
        breadcrumb="Master Data"
        title="Accounts"
        description="Bank accounts and petty cash. The code is fixed once created; an opening balance change needs a reason."
        actions={mayEdit && (
          <Button icon={Plus} onClick={() => setForm({
            mode: "create", code: "", name: "", custody: "accounting", is_paying: true, currency: "IDR",
            opening_balance: 0, opened_on: "", is_active: true, original_balance: 0, reason: "",
          })}>
            Add account
          </Button>
        )}
      />

      <Card>
        <CardHeader
          title="All accounts"
          subtitle="Leadership accounts never pay a vendor directly and are changed only by someone who approves funds."
          icon={Landmark}
          action={<SourceBadge state={state} />}
        />
        <Loaded state={state} onRetry={reload}>
          {(rows) => (
            <DataTable columns={columns} rows={rows as Row[]} rowKey={(a) => a.account_id} dense empty="No accounts." />
          )}
        </Loaded>
        {!mayEdit && (
          <p className="border-t border-slate-100 px-4 py-3 text-[12px] text-slate-500">
            Editing accounts needs accounting write access and the post_ledger authority.
          </p>
        )}
      </Card>

      <Modal open={!!form} onClose={() => setForm(null)} title={form?.mode === "create" ? "Add account" : `Edit ${form?.code ?? ""}`}>
        {form && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="acc-code" className="block text-sm text-slate-600">Code</label>
                <input
                  id="acc-code"
                  value={form.code}
                  disabled={form.mode === "edit"}
                  onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                  placeholder="e.g. MANDIRI 123"
                  className={inputClass + " font-mono disabled:bg-slate-50 disabled:text-slate-500"}
                />
              </div>
              <div>
                <label htmlFor="acc-currency" className="block text-sm text-slate-600">Currency</label>
                <input
                  id="acc-currency"
                  value={form.currency}
                  maxLength={3}
                  onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })}
                  className={inputClass + " font-mono"}
                />
              </div>
            </div>
            <div>
              <label htmlFor="acc-name" className="block text-sm text-slate-600">Name</label>
              <input
                id="acc-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Mandiri ...123 (operations)"
                className={inputClass}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="acc-custody" className="block text-sm text-slate-600">Held by</label>
                <select
                  id="acc-custody"
                  value={form.custody}
                  onChange={(e) => {
                    const custody = e.target.value as AccountCustody;
                    setForm({ ...form, custody, is_paying: custody === "leadership" ? false : form.is_paying });
                  }}
                  className={inputClass + " bg-white"}
                >
                  <option value="accounting">Accounting</option>
                  {(mayLeadership || form.custody === "leadership") && <option value="leadership">Leadership</option>}
                </select>
              </div>
              <label className="mt-6 flex items-center gap-2 text-sm text-slate-700">
                <input
                  id="acc-paying" type="checkbox"
                  checked={form.is_paying}
                  disabled={form.custody === "leadership"}
                  onChange={(e) => setForm({ ...form, is_paying: e.target.checked })}
                />
                Pays vendors
              </label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="acc-opening" className="block text-sm text-slate-600">Opening balance</label>
                <MoneyInput
                  id="acc-opening"
                  value={form.opening_balance}
                  onChange={(v) => setForm({ ...form, opening_balance: v })}
                  className="mt-1"
                />
              </div>
              <div>
                <label htmlFor="acc-opened" className="block text-sm text-slate-600">As of</label>
                <input
                  id="acc-opened" type="date"
                  value={form.opened_on}
                  onChange={(e) => setForm({ ...form, opened_on: e.target.value })}
                  className={inputClass}
                />
              </div>
            </div>
            {balanceChanged && (
              <div>
                <label htmlFor="acc-reason" className="block text-sm text-slate-600">
                  Why the opening balance changes <span className="text-rose-700">— required</span>
                </label>
                <textarea
                  id="acc-reason"
                  rows={2}
                  value={form.reason}
                  onChange={(e) => setForm({ ...form, reason: e.target.value })}
                  placeholder="e.g. balance per bank statement on 1 January"
                  className={inputClass}
                />
                <p className="mt-1 text-xs text-slate-500">
                  Every balance after it moves by {formatIDR(form.opening_balance - form.original_balance)}. The old and new figures go to the audit log.
                </p>
              </div>
            )}
            {form.mode === "edit" && (
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  id="acc-active" type="checkbox"
                  checked={form.is_active}
                  onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                />
                Active — shown in the pickers
              </label>
            )}
            <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
              {form.mode === "edit" && (
                <Button variant="ghost" icon={Trash2} className="mr-auto text-rose-700" disabled={saving} onClick={remove}>
                  Delete
                </Button>
              )}
              <Button variant="outline" onClick={() => setForm(null)}>Cancel</Button>
              <Button
                onClick={save}
                disabled={saving || !form.code.trim() || !form.name.trim() || (balanceChanged && !form.reason.trim())}
              >
                {saving ? "Saving…" : "Save"}
              </Button>
            </div>
            {form.mode === "edit" && (
              <p className="text-[11px] text-slate-500">
                Delete works only for an account nothing is booked on. Otherwise untick Active.
              </p>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
