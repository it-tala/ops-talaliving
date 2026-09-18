"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Factory, ArrowRight, LogIn, AlertTriangle } from "lucide-react";
import { Card, Badge, Button } from "@/components/ui/primitives";
import { useBrand } from "@/lib/brand";
import { useSession } from "@/store/session";
import { useDemo } from "@/demo/provider";
import { isLiveMode } from "@/lib/live";
import { AUTHORITY_LABEL, MODULE_LABEL } from "@/lib/roles";

/** Sign in.
 *
 *  ## One route, two doors, and the second one was missing
 *
 *  This page listed the demo's people and called `actAs` — picking a person
 *  *was* the sign-in, which is honest in a sandbox with no password to check.
 *  It was also the only way in, and `actAs` does not exist against a real
 *  database: impersonation there is not a feature with a guard missing, it is
 *  the absence of authentication, so the real client refuses it.
 *
 *  So the day the deployment got its Supabase keys, the application had no
 *  front door at all. Every screen behind it worked and nobody could reach one.
 *
 *  `isLiveMode()` decides which door is drawn. Not a prop, not a route: the same
 *  question `isRouteLive()` asks, answered in the same place, so a deployment
 *  cannot end up offering a password box with no database or a persona list
 *  against real accounts.
 *
 *  ## What the live form does not do
 *
 *  **It does not check anything itself.** Supabase Auth decides, and the refusal
 *  comes back worded by the client — the same sentence for a wrong password and
 *  for an address nobody has registered, deliberately. Telling those apart tells
 *  somebody probing which addresses are real and helps nobody who mistyped.
 *
 *  **It does not offer a way to create an account.** Provisioning is not
 *  self-service here: somebody in IT grants what a person may open (D24), and a
 *  sign-up form would be a door into a workspace nobody invited them to.
 */
export default function SignInPage() {
  const brand = useBrand();
  const live = isLiveMode();

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
          {/* The badge is the one thing on this page that must never be wrong:
              it is how somebody knows whether what they are about to do is real. */}
          {live
            ? <Badge tone="green" className="ml-auto">Live</Badge>
            : <Badge tone="amber" className="ml-auto">Demo</Badge>}
        </div>

        {live ? <PasswordForm /> : <PersonaList />}
      </div>
    </div>
  );
}

/* ── live ─────────────────────────────────────────────────────────────── */

function PasswordForm() {
  const { signIn } = useSession();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const res = await signIn(email, password);
    setBusy(false);

    if (res.error) {
      /* The service's own wording, verbatim. A message this page invented would
         be a second description of a rule it does not own (A7), and the one
         case that matters most — signed in, but this workspace has no profile
         for you — needs the sentence that names who to ask. */
      setError(res.error.message);
      return;
    }
    router.push("/dashboard");
  }

  return (
    <Card className="overflow-hidden">
      <div className="border-b border-slate-100 px-5 py-4">
        <h1 className="text-base font-semibold text-slate-800">Masuk</h1>
        <p className="mt-1 text-sm text-slate-500">
          Pakai alamat email kantor Anda. Akun dibuatkan oleh IT — halaman ini
          tidak mendaftarkan siapa pun.
        </p>
      </div>

      <form onSubmit={submit} className="space-y-4 px-5 py-5">
        <div>
          <label htmlFor="email" className="block text-[13px] font-medium text-slate-700">
            Email
          </label>
          <input
            id="email" type="email" value={email} required autoFocus
            autoComplete="username"
            onChange={(e) => setEmail(e.target.value)}
            placeholder="nama@talaliving.com"
            className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 outline-none transition-colors placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
          />
        </div>

        <div>
          <label htmlFor="password" className="block text-[13px] font-medium text-slate-700">
            Kata sandi
          </label>
          <input
            id="password" type="password" value={password} required
            autoComplete="current-password"
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 outline-none transition-colors focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
          />
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50/70 px-3 py-2.5 text-[13px] text-rose-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <Button
          type="submit" icon={LogIn} className="w-full"
          disabled={busy || !email || !password}
        >
          {busy ? "Memeriksa…" : "Masuk"}
        </Button>
      </form>

      <p className="border-t border-slate-100 px-5 py-3 text-[12px] text-slate-500">
        Lupa kata sandi, atau belum punya akun? Hubungi IT. Akses ke tiap modul
        diberikan per orang, bukan diminta sendiri.
      </p>
    </Card>
  );
}

/* ── demo ─────────────────────────────────────────────────────────────── */

/** Unchanged, and kept on purpose. Picking a persona is how this application is
 *  reviewed without a database: five people see five different applications, and
 *  a password box in front of a sandbox with no password would be theatre. */
function PersonaList() {
  const { actAs } = useSession();
  const state = useDemo();
  const router = useRouter();

  return (
    <>
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
    </>
  );
}
