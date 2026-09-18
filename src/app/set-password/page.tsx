"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Factory, KeyRound, AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { Card, Badge, Button } from "@/components/ui/primitives";
import { useBrand } from "@/lib/brand";
import { identity } from "@/demo/api";
import { isLiveMode } from "@/lib/live";
import { supabaseBrowser } from "@/lib/supabase/client";

/** Set a password.
 *
 *  ## Why this route had to exist before anybody could sign in
 *
 *  A Supabase recovery mail is a link to GoTrue, which verifies the token and
 *  then redirects to **Site URL** with a session in the URL. On a project set
 *  up for local development that is `http://localhost:3000`, so the link opened
 *  a machine the reader was not sitting at — and even pointed at production it
 *  would have landed on a page that did nothing with what it carried. The first
 *  administrator account was created in August and still had no password anybody
 *  knew in September, because there was no page to arrive at.
 *
 *  This is that page. It is outside `(app)` on purpose: the shell redirects
 *  anybody without a profile to `/signin`, and somebody halfway through a
 *  recovery is exactly that person.
 *
 *  ## It does not read the token
 *
 *  `supabase-js` does, on its own, when the client is first used in a tab with
 *  `#access_token=…` in the URL — and then strips it from the address bar so it
 *  does not sit in history or in a shared screenshot. All this page does is wait
 *  for that to finish, which is what `onAuthStateChange` is for. Parsing the
 *  fragment by hand here would be a second implementation of something the SDK
 *  already does correctly, racing the first.
 *
 *  ## Two ways in, one form
 *
 *  Arriving from a mail and choosing *ganti kata sandi* while already signed in
 *  are the same request to GoTrue, so they are the same form here. The only
 *  difference is what happens when there is no session at all: a bookmark or an
 *  expired link, which needs to be said as *ask for a new one*, not as *Auth
 *  session missing*.
 */
export default function SetPasswordPage() {
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
          {live
            ? <Badge tone="green" className="ml-auto">Live</Badge>
            : <Badge tone="amber" className="ml-auto">Demo</Badge>}
        </div>

        {live ? <Form /> : <NotInDemo />}
      </div>
    </div>
  );
}

function NotInDemo() {
  return (
    <Card className="px-5 py-5">
      <h1 className="text-base font-semibold text-slate-800">Tidak ada kata sandi di sini</h1>
      <p className="mt-2 text-sm text-slate-500">
        Mode demo tidak memeriksa kata sandi — memilih orang di halaman masuk
        adalah masuknya. Halaman ini hanya berarti pada deployment yang
        tersambung ke database.
      </p>
    </Card>
  );
}

/* ── live ─────────────────────────────────────────────────────────────── */

type Phase = "checking" | "ready" | "no-session" | "done";

function Form() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("checking");
  const [linkError, setLinkError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    /* Read before touching the client: GoTrue reports a dead link in the
       fragment (`error_code=otp_expired`), and the client clears the fragment
       as part of handling it. Whatever is there now is the only chance. */
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const failed = hash.get("error_description") ?? hash.get("error");
    if (failed) setLinkError(failed.replace(/\+/g, " "));

    const sb = supabaseBrowser();
    let alive = true;

    /* The session may already be there — somebody changing a password they
       know — or it may be a moment away, still being read out of the URL. Both
       are covered: ask once, and listen. */
    sb.auth.getSession().then(({ data }) => {
      if (!alive) return;
      if (data.session) setPhase("ready");
      /* No session and no event within a beat means there was nothing in the
         URL to read. Long enough for the SDK to finish, short enough that
         nobody sits looking at a spinner. */
      else setTimeout(() => { if (alive) setPhase((p) => (p === "checking" ? "no-session" : p)); }, 1200);
    });

    const { data: sub } = sb.auth.onAuthStateChange((_event, session) => {
      if (alive && session) setPhase("ready");
    });
    return () => { alive = false; sub.subscription.unsubscribe(); };
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== again) { setError("Dua isian itu tidak sama."); return; }
    setBusy(true);
    setError(null);

    const res = await identity.setPassword(password);
    setBusy(false);
    if (res.error) { setError(res.error.message); return; }

    setPhase("done");
    /* Signed in already — the recovery session is a session. Straight to work
       rather than back to a form that would ask for the password just set. */
    setTimeout(() => router.push("/dashboard"), 1400);
  }

  if (phase === "checking") {
    return (
      <Card className="flex items-center gap-3 px-5 py-6 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        Memeriksa tautan…
      </Card>
    );
  }

  if (phase === "no-session") {
    return (
      <Card className="px-5 py-5">
        <div className="flex items-start gap-2 text-[13px] text-rose-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-medium">Tautan ini tidak bisa dipakai.</p>
            <p className="mt-1 text-slate-600">
              Tautan pemulihan hanya sekali pakai dan kedaluwarsa setelah satu
              jam. Minta yang baru dari halaman masuk, lalu buka dari email yang
              sama di perangkat ini.
            </p>
            {linkError && (
              <p className="mt-2 font-mono text-[11px] text-slate-400">{linkError}</p>
            )}
          </div>
        </div>
        <Button className="mt-4 w-full" onClick={() => router.push("/signin")}>
          Kembali ke halaman masuk
        </Button>
      </Card>
    );
  }

  if (phase === "done") {
    return (
      <Card className="flex items-center gap-3 px-5 py-6 text-sm text-slate-700">
        <CheckCircle2 className="h-5 w-5 text-emerald-600" />
        Kata sandi tersimpan. Mengalihkan…
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <div className="border-b border-slate-100 px-5 py-4">
        <h1 className="text-base font-semibold text-slate-800">Buat kata sandi</h1>
        <p className="mt-1 text-sm text-slate-500">
          Setelah tersimpan, Anda langsung masuk. Tautan pemulihannya hangus.
        </p>
      </div>

      <form onSubmit={submit} className="space-y-4 px-5 py-5">
        <div>
          <label htmlFor="pw" className="block text-[13px] font-medium text-slate-700">
            Kata sandi baru
          </label>
          <input
            id="pw" type="password" value={password} required autoFocus minLength={8}
            autoComplete="new-password"
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 outline-none transition-colors focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
          />
          <p className="mt-1 text-[11px] text-slate-400">Minimal 8 karakter.</p>
        </div>

        <div>
          <label htmlFor="pw2" className="block text-[13px] font-medium text-slate-700">
            Ulangi
          </label>
          <input
            id="pw2" type="password" value={again} required minLength={8}
            autoComplete="new-password"
            onChange={(e) => setAgain(e.target.value)}
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
          type="submit" icon={KeyRound} className="w-full"
          disabled={busy || password.length < 8 || again.length < 8}
        >
          {busy ? "Menyimpan…" : "Simpan kata sandi"}
        </Button>
      </form>
    </Card>
  );
}
