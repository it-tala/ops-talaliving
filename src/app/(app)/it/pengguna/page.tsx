"use client";

import { useState } from "react";
import { UserCog, KeyRound, Check } from "lucide-react";
import { Badge, Button, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { Loaded, SourceBadge, useLoad } from "@/components/ui/loaded";
import { Paged } from "@/components/ui/pager";
import { cn } from "@/lib/cn";
import { identity } from "@/demo/api";
import {
  MODULES, MODULE_LABEL, LEVELS, LEVEL_LABEL, AUTHORITIES, AUTHORITY_LABEL,
  describeGrant, IT_ACCESS_RULE, type ModuleName, type ModuleLevel, type Authority,
} from "@/lib/roles";
import { useSession } from "@/store/session";
import { useToast } from "@/store/toast";

/** Who may open what, and who may decide what — two questions, one screen.
 *
 *  The split is the point (D24). A module grant opens screens; an authority is
 *  a named decision, granted on its own and never implied by a level. The
 *  failure this prevents is the one `john-lau` had: a confirm button that
 *  showed for anyone with `finance` and a backend that then refused it, so the
 *  screen and the guard disagreed in front of the user.
 */
export default function UsersPage() {
  const { can } = useSession();
  const { toast } = useToast();
  const [users, reload] = useLoad(() => identity.listUsers(), []);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mayManage = can("it.manage_users");
  const mayRoles = can("it.manage_roles");

  async function setLevel(userId: string, module: ModuleName, level: ModuleLevel | null, current: { module: ModuleName; level: ModuleLevel }[]) {
    const next = current.filter((g) => g.module !== module);
    if (level) next.push({ module, level });
    setBusy(true);
    const res = await identity.setModules(userId, next);
    setBusy(false);
    if (res.error) { toast("critical", "Tidak tersimpan", res.error.message); return; }
    toast("success", "Akses diubah", `${MODULE_LABEL[module]} — ${level ? LEVEL_LABEL[level] : "dicabut"}`);
    reload();
  }

  async function toggleAuthority(userId: string, authority: Authority, held: Authority[]) {
    const next = held.includes(authority) ? held.filter((a) => a !== authority) : [...held, authority];
    setBusy(true);
    const res = await identity.setAuthorities(userId, next);
    setBusy(false);
    if (res.error) { toast("critical", "Tidak tersimpan", res.error.message); return; }
    toast("success", held.includes(authority) ? "Wewenang dicabut" : "Wewenang diberikan", AUTHORITY_LABEL[authority]);
    reload();
  }

  return (
    <div>
      <PageHeader
        breadcrumb="IT"
        title="Pengguna & akses"
        description="Grant modul membuka layar; wewenang memberi keputusan. Keduanya terpisah, dan yang kedua tidak pernah tersirat dari yang pertama."
        actions={<SourceBadge state={users} />}
      />

      <Loaded state={users} onRetry={reload}>
        {(all) => (
          <>
            <div className="mb-4 rounded-xl border border-slate-200 bg-white px-4 py-3 text-[12px] text-slate-600 shadow-card">
              {AUTHORITIES.map((a) => {
                const holders = all.filter((u) => u.authorities.includes(a));
                return (
                  <p key={a} className="py-0.5">
                    <span className="font-medium text-slate-800">{AUTHORITY_LABEL[a]}</span>
                    {" — "}
                    {holders.length === 0
                      ? <span className="text-rose-700">tidak ada yang memegang</span>
                      : holders.map((u) => u.user.full_name).join(", ")}
                  </p>
                );
              })}
            </div>

            <Card>
              <CardHeader
                title={`${all.length} pengguna`}
                subtitle="Klik satu orang untuk mengubah aksesnya. Setiap perubahan tercatat di audit log."
                icon={UserCog}
              />
              <Paged rows={all} pageSize={12} unit="pengguna">
                {(page) => (
                  <ul className="divide-y divide-slate-100">
                    {page.map((u) => {
                      const expanded = open === u.user.id;
                      return (
                        <li key={u.user.id} className="px-5 py-3">
                          <button
                            onClick={() => setOpen(expanded ? null : u.user.id)}
                            className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 text-left"
                          >
                            <span className="min-w-[170px] flex-1">
                              <span className="block text-[13px] font-medium text-slate-800">{u.user.full_name}</span>
                              <span className="block font-mono text-[10px] text-slate-400">{u.user.email}</span>
                            </span>
                            <span className="text-[12px] text-slate-500">
                              {u.modules.length} modul · {u.permissions.length} izin
                            </span>
                            {u.authorities.map((a) => (
                              <Badge key={a} tone="brand">{AUTHORITY_LABEL[a]}</Badge>
                            ))}
                            {!u.user.is_active && <Badge tone="slate">nonaktif</Badge>}
                          </button>

                          {expanded && (
                            <div className="mt-3 space-y-3">
                              <div>
                                <p className="mb-1 text-[11px] uppercase tracking-wide text-slate-400">Akses modul</p>
                                <ul className="space-y-1">
                                  {MODULES.map((m) => {
                                    const grant = u.modules.find((g) => g.module === m);
                                    return (
                                      <li key={m} className="flex flex-wrap items-center gap-2 text-[12px]">
                                        <span className="w-[110px] text-slate-700">{MODULE_LABEL[m]}</span>
                                        {LEVELS.map((l) => (
                                          <Button
                                            key={l} size="sm"
                                            variant={grant?.level === l ? "primary" : "outline"}
                                            disabled={busy || !mayManage}
                                            onClick={() => setLevel(u.user.id, m, grant?.level === l ? null : l, u.modules)}
                                          >
                                            {LEVEL_LABEL[l]}
                                          </Button>
                                        ))}
                                        <span className="text-[11px] text-slate-400">
                                          {grant ? describeGrant(m, grant.level) : "tidak punya akses"}
                                        </span>
                                        {m === "it" && (
                                          <span className="basis-full pl-[118px] text-[11px] text-amber-700">
                                            {IT_ACCESS_RULE}
                                          </span>
                                        )}
                                      </li>
                                    );
                                  })}
                                </ul>
                              </div>

                              <div>
                                <p className="mb-1 flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-slate-400">
                                  <KeyRound className="h-3 w-3" /> Wewenang
                                </p>
                                <div className="flex flex-wrap gap-1.5">
                                  {AUTHORITIES.map((a) => (
                                    <Button
                                      key={a} size="sm"
                                      variant={u.authorities.includes(a) ? "primary" : "outline"}
                                      icon={u.authorities.includes(a) ? Check : undefined}
                                      disabled={busy || !mayRoles}
                                      onClick={() => toggleAuthority(u.user.id, a, u.authorities)}
                                    >
                                      {AUTHORITY_LABEL[a]}
                                    </Button>
                                  ))}
                                </div>
                                <p className="mt-1 text-[11px] text-slate-500">
                                  Wewenang diberikan sendiri-sendiri. Level <em>Full</em> pada sebuah modul
                                  tidak pernah membuat orang bisa menyetujui uang.
                                </p>
                              </div>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Paged>
            </Card>
          </>
        )}
      </Loaded>
    </div>
  );
}
