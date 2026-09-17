"use client";

import { useState } from "react";
import { Settings, Lock, ExternalLink, AlertTriangle, RotateCcw } from "lucide-react";
import Link from "next/link";
import { Badge, Button, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { Loaded, SourceBadge, useLoad } from "@/components/ui/loaded";
import { cn } from "@/lib/cn";
import { identity } from "@/demo/api";
import {
  SETTING_GROUP_LABEL, SETTING_REACH_LABEL,
  type AppSetting, type SettingGroup, type SettingReach,
} from "@/services/identity/contracts";
import { useToast } from "@/store/toast";
import { useSession } from "@/store/session";

const REACH_TONE: Record<SettingReach, "slate" | "brand" | "amber"> = {
  display: "slate", forward: "brand", retroactive: "amber",
};

const GROUPS: SettingGroup[] = ["identity", "format", "operations", "retention"];

/** Settings, sorted by what they do to the past.
 *
 *  A settings screen is usually a drawer of knobs, and the knobs all look
 *  alike. The interesting question about a setting is not what it does — it is
 *  **what it does to figures that already exist** (D214), and that question
 *  separates three kinds of entry that a normal settings page renders
 *  identically:
 *
 *  - the ones that only change how something is displayed;
 *  - the ones that only change what happens next;
 *  - and the ones where a payslip from March quietly becomes a different
 *    payslip from March.
 *
 *  The third kind is shown here with what it would move, and changed
 *  somewhere that can hold a dated version — or not changed at all, with the
 *  reason said out loud. Every one is listed, including the locked ones,
 *  because **a number that exists in the code and not on this page is a number
 *  nobody knows they are living with.**
 */
export default function SettingsPage() {
  const { can } = useSession();
  const [rows, reload] = useLoad(() => identity.listSettings(), []);
  const mayEdit = can("settings.update");

  return (
    <div>
      <PageHeader
        breadcrumb="Settings"
        title="Pengaturan"
        description="Setiap angka dan nama di sistem ini yang mungkin Anda kira boleh diubah — beserta jawaban lurus tentang masing-masing. Yang mengubah angka lama tidak diubah dari sini, dan alasannya ditulis."
        actions={<SourceBadge state={rows} />}
      />

      <Loaded state={rows} onRetry={reload}>
        {(all) => {
          const retro = all.filter((s) => s.reach === "retroactive");
          return (
            <div className="space-y-4">
              <div className="flex flex-wrap items-start gap-2 rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-[13px] text-amber-900">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  <strong>{retro.length} dari {all.length} pengaturan mengubah angka yang sudah ada</strong>, bukan
                  cuma yang akan datang. Itu semua dikunci di sini. Bukan karena tidak boleh diubah —
                  sebagian memang berubah, di tempat yang bisa menyimpan versi bertanggal — tapi karena
                  kotak isian yang terlihat sama untuk keduanya adalah cara sebuah slip gaji bulan Maret
                  diam-diam berubah.
                </span>
              </div>

              {GROUPS.map((g) => {
                const inGroup = all.filter((s) => s.group === g);
                if (inGroup.length === 0) return null;
                return (
                  <Card key={g}>
                    <CardHeader title={SETTING_GROUP_LABEL[g]} icon={Settings} />
                    <ul className="divide-y divide-slate-100">
                      {inGroup.map((s) => (
                        <SettingRow key={s.key} setting={s} mayEdit={mayEdit} onSaved={reload} />
                      ))}
                    </ul>
                  </Card>
                );
              })}

              {!mayEdit && (
                <p className="text-[12px] text-slate-500">
                  Anda membaca saja — mengubah pengaturan butuh akses <span className="font-mono">settings</span> tingkat
                  edit.
                </p>
              )}
            </div>
          );
        }}
      </Loaded>
    </div>
  );
}

function SettingRow({ setting, mayEdit, onSaved }: {
  setting: AppSetting; mayEdit: boolean; onSaved: () => void;
}) {
  const { toast } = useToast();
  const [draft, setDraft] = useState(setting.value);
  const [busy, setBusy] = useState(false);
  const locked = setting.locked_reason != null;
  const dirty = draft !== setting.value;

  async function save(next: string) {
    setBusy(true);
    const res = await identity.updateSetting({ key: setting.key, value: next });
    setBusy(false);
    if (res.error) {
      toast(res.error.status === 403 ? "critical" : "warning", "Tidak diubah", res.error.message);
      setDraft(setting.value);
      return;
    }
    toast("success", setting.label, `${setting.value} → ${next}`);
    onSaved();
  }

  return (
    <li className="px-5 py-3">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <span className="min-w-[220px] flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-medium text-slate-800">{setting.label}</span>
            <Badge tone={REACH_TONE[setting.reach]}>{SETTING_REACH_LABEL[setting.reach]}</Badge>
            {locked && <Lock className="h-3 w-3 text-slate-400" />}
          </span>
          <span className="mt-0.5 block text-[12px] text-slate-600">{setting.help}</span>
          <span className="block font-mono text-[10px] text-slate-400">{setting.key}</span>
        </span>

        <span className="flex items-center gap-2">
          {locked ? (
            <span className="rounded-lg bg-slate-100 px-3 py-1.5 font-mono text-[12px] text-slate-600">
              {setting.value}{setting.unit ? ` ${setting.unit}` : ""}
            </span>
          ) : setting.kind === "choice" && setting.choices ? (
            <select
              value={draft} disabled={!mayEdit || busy}
              onChange={(e) => { setDraft(e.target.value); save(e.target.value); }}
              className="h-9 rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none disabled:bg-slate-50"
            >
              {setting.choices.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          ) : (
            <>
              <input
                value={draft} disabled={!mayEdit || busy}
                onChange={(e) => setDraft(e.target.value)}
                inputMode={setting.kind === "number" ? "numeric" : undefined}
                aria-label={setting.label}
                className={cn(
                  "h-9 rounded-lg border px-2 text-sm focus:outline-none disabled:bg-slate-50",
                  setting.kind === "number" ? "w-24 text-right tabular-nums" : "w-56",
                  dirty ? "border-brand-400" : "border-slate-200",
                )}
              />
              {setting.unit && <span className="text-[12px] text-slate-500">{setting.unit}</span>}
              {dirty && (
                <>
                  <Button size="sm" disabled={busy} onClick={() => save(draft)}>Simpan</Button>
                  <Button size="sm" variant="ghost" onClick={() => setDraft(setting.value)}>Batal</Button>
                </>
              )}
              {!dirty && mayEdit && setting.value !== setting.default_value && (
                <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => save(setting.default_value)}>
                  Bawaan
                </Button>
              )}
            </>
          )}
        </span>
      </div>

      {locked && (
        <p className="mt-1.5 rounded-lg bg-slate-50 px-3 py-2 text-[12px] text-slate-600">
          {setting.locked_reason}
          {setting.managed_at && (
            <>
              {" "}
              <Link href={setting.managed_at} className="inline-flex items-center gap-1 font-medium text-brand-700 hover:underline">
                Diubah di sini <ExternalLink className="h-3 w-3" />
              </Link>
            </>
          )}
          {setting.affects.length > 0 && (
            <span className="mt-1 block text-[11px] text-slate-500">
              Yang ikut berubah kalau angkanya digeser: {setting.affects.join(" · ")}.
            </span>
          )}
        </p>
      )}

      {setting.updated_at && (
        <p className="mt-1 text-[11px] text-slate-400">
          diubah {setting.updated_by}, {setting.updated_at.slice(0, 10)} · bawaan {setting.default_value}
        </p>
      )}
    </li>
  );
}
