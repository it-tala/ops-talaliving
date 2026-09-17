"use client";

import { useRouter } from "next/navigation";
import { Factory, ArrowRight } from "lucide-react";
import { Card, Badge } from "@/components/ui/primitives";
import { useBrand } from "@/lib/brand";
import { useSession } from "@/store/session";
import { useDemo } from "@/demo/provider";
import { DATA_MODE } from "@/demo/api";
import { AUTHORITY_LABEL, MODULE_LABEL } from "@/lib/roles";

/** Sign in.
 *
 *  In Phase 1 there is no password to check — picking a person IS the sign-in,
 *  and the page says so rather than staging a login that verifies nothing.
 *  Phase 2 replaces the list with Supabase Auth and everything downstream of
 *  `useSession` stays as it is.
 *
 *  Until it does, this page is guarded (F95). The account picker calls `actAs`,
 *  and a front door that hands out any identity for no password is the whole of
 *  authentication missing, not a rough edge. It was rendered unconditionally.
 *  In live mode it now says what is true — there is no sign-in yet — because a
 *  door that refuses is recoverable and a door that opens for anybody is not.
 */
export default function SignInPage() {
  const brand = useBrand();
  const { actAs } = useSession();
  const state = useDemo();
  const router = useRouter();

  if (DATA_MODE === "live") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-10">
        <Card className="w-full max-w-md p-6">
          <h1 className="text-base font-semibold text-slate-800">Sign-in is not built yet</h1>
          <p className="mt-2 text-sm text-slate-600">
            This deployment is reading a real database, and real sign-in (Supabase Auth)
            has not been connected to this screen. The demo account picker is deliberately
            not shown here: it checks no password, and over live data that is not a
            shortcut, it is the absence of authentication.
          </p>
          <p className="mt-3 text-sm text-slate-500">
            Backlog S3. Until it lands, use this deployment in demo mode.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-10">
      <div className="w-full max-w-lg">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-700 text-white shadow-sm">
            <Factory className="h-5 w-5" strokeWidth={2.5} />
          </div>
          <div>
            <p className="text-sm font-bold tracking-tight text-slate-800">{brand.name}</p>
            <p className="text-[11px] uppercase tracking-wider text-slate-400">{brand.tagline}</p>
          </div>
          <Badge tone="amber" className="ml-auto">Demo</Badge>
        </div>

        <Card className="overflow-hidden">
          <div className="border-b border-slate-100 px-5 py-4">
            <h1 className="text-base font-semibold text-slate-800">Choose an account</h1>
            <p className="mt-1 text-sm text-slate-500">
              No password is checked. This is a demonstration of the workflow, and every
              account below sees a different part of it — which is the point.
            </p>
          </div>

          <div className="divide-y divide-slate-100">
            {state.users.map((u) => (
              <button
                key={u.id}
                onClick={async () => {
                  await actAs(u.id);
                  router.push("/dashboard");
                }}
                className="group flex w-full items-center gap-4 px-5 py-4 text-left transition-colors hover:bg-brand-50/40"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-700">
                  {u.full_name.charAt(0)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-slate-800">{u.full_name}</span>
                  <span className="block font-mono text-[11px] text-slate-400">{u.email}</span>
                  <span className="mt-1.5 flex flex-wrap gap-1">
                    {u.modules.slice(0, 4).map((m) => (
                      <span key={m.module} className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">
                        {MODULE_LABEL[m.module]}
                      </span>
                    ))}
                    {u.modules.length > 4 && (
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
                        +{u.modules.length - 4}
                      </span>
                    )}
                    {u.authorities.map((a) => (
                      <span key={a} className="rounded bg-brand-50 px-1.5 py-0.5 text-[10px] font-medium text-brand-700 ring-1 ring-inset ring-brand-200">
                        {AUTHORITY_LABEL[a]}
                      </span>
                    ))}
                  </span>
                </span>
                <ArrowRight className="h-4 w-4 shrink-0 text-slate-300 transition-colors group-hover:text-brand-600" />
              </button>
            ))}
          </div>
        </Card>

        <p className="mt-4 text-center text-xs text-slate-400">
          Data lives in this browser only. Nothing here reaches a real system.
        </p>
      </div>
    </div>
  );
}
