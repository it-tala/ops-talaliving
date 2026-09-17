"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { useSession } from "@/store/session";
import { TourBar } from "@/components/tour-bar";
import { JohnLauDock } from "@/components/john-lau/dock";

/** The application shell.
 *
 *  The sidebar and topbar do not scroll; only `<main>` does. That is what makes
 *  this feel like desktop software rather than a long web page — the menu is
 *  always where you left it.
 *
 *  The shell WAITS for the session before rendering anything. Drawing a menu
 *  and then taking half of it away is worse than a moment of nothing, and it is
 *  the specific failure the original skeleton left a note about.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { ready, hasAnyModule } = useSession();
  const router = useRouter();

  useEffect(() => {
    /* An account with no modules lands somewhere that says so, rather than
     * bouncing between pages it may not open. */
    if (ready && !hasAnyModule) router.replace("/no-access");
  }, [ready, hasAnyModule, router]);

  if (!ready) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-100">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-300 border-t-brand-600" />
      </div>
    );
  }

  return (
    /* Printing is for the document on the page, never for the furniture around
       it: a purchase order going to a supplier must not carry our menu (D133). */
    <div className="flex h-screen overflow-hidden bg-slate-100 print:block print:h-auto print:overflow-visible print:bg-white">
      <div className="contents print:hidden">
        <Sidebar mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} />
      </div>
      <div className="flex flex-1 flex-col overflow-hidden print:block print:overflow-visible">
        <div className="print:hidden">
          <Topbar onMenuClick={() => setMobileOpen(true)} />
        </div>
        <main className="flex-1 overflow-y-auto print:overflow-visible">
          {/* Extra room at the bottom on small screens: the John Lau launcher floats
              over the corner, and without this it sits permanently on top of the
              last row of every list (F65). */}
          <div className="mx-auto max-w-[1400px] px-4 pb-24 pt-6 sm:pb-6 md:px-6 lg:px-8 print:max-w-none print:p-0">{children}</div>
        </main>
      </div>
      {/* useSearchParams needs a boundary; the bar is absent until it resolves,
          which is the right absence — nothing on the page depends on it. */}
      <Suspense fallback={null}>
        <TourBar />
      </Suspense>
      {/* In the shell, not on a page: the point of it is to keep reading the
          steps while you move to the screen they describe (D223). */}
      <JohnLauDock />
    </div>
  );
}
