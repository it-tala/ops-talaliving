import type { Metadata } from "next";
import Link from "next/link";
import { Factory, Compass } from "lucide-react";
import { Button, Card } from "@/components/ui/primitives";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = {
  title: `Page not found — ${BRAND.documentTitle}`,
};

/** 404 — the route that does not exist.
 *
 *  Next renders this for any URL that matches nothing. It sits at the app root
 *  rather than inside `(app)`, so it comes up without the sidebar: a URL that
 *  matched no route also matched no module, and drawing the menu around it
 *  would claim a placement the address never earned. That puts it with
 *  `signin` and `no-access` — the three screens with no chrome — and it is
 *  written in their language for the same reason.
 *
 *  A server component on purpose. Every other screen here is a client
 *  component reading browser-held fixtures, but a 404 has nothing to read —
 *  no session, no demo state, no settings. So it uses the `BRAND` constant
 *  instead of the `useBrand` hook: the hook reaches into `DemoProvider` for a
 *  name the owner can change on the settings screen, and waking that provider
 *  to render a dead end would make the cheapest page in the application one of
 *  the few that needs JavaScript to say anything at all.
 *
 *  What it deliberately does not do is guess. There is no "did you mean…"
 *  here, because the menu is built per person from their module grants — a
 *  suggestion would either name a screen the visitor cannot open, or send them
 *  to one and let the layout refuse them on arrival. Two honest doors instead:
 *  the dashboard, and the account switch for the usual cause, which is being
 *  signed in as somebody who does not have that screen.
 */
export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-700 text-white shadow-sm">
            <Factory className="h-5 w-5" strokeWidth={2.5} />
          </div>
          <div>
            <p className="text-sm font-bold tracking-tight text-slate-800">{BRAND.name}</p>
            <p className="text-[11px] uppercase tracking-wider text-slate-400">{BRAND.tagline}</p>
          </div>
        </div>

        <Card className="p-8 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-500">
            <Compass className="h-6 w-6" />
          </span>

          {/* The number, once and plainly. `aria-hidden` because the heading
              below already says it in words, and a screen reader announcing
              "four zero four" ahead of the sentence helps nobody. */}
          <p aria-hidden className="mt-5 text-4xl font-bold tracking-tight text-slate-300">404</p>

          <h1 className="mt-2 text-lg font-semibold text-slate-800">Page not found</h1>
          <p className="mt-2 text-sm text-slate-500">
            This address matches no screen. Either it was mistyped, or the link was made
            before the screen behind it moved.
          </p>

          <div className="mt-6 flex flex-col gap-2">
            <Link href="/dashboard">
              <Button className="w-full">Back to the dashboard</Button>
            </Link>
            <Link href="/signin">
              <Button variant="outline" className="w-full">Sign in as someone else</Button>
            </Link>
          </div>
        </Card>
      </div>
    </div>
  );
}
