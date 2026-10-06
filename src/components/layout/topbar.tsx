"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Menu, RotateCcw, LogOut, Fingerprint } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { GrantPicker, GrantPickerButton } from "./grant-picker";
import { useSession } from "@/store/session";
import { useDemoReset } from "@/demo/provider";
import { consumeResetNotice } from "@/demo/store";
import { useToast } from "@/store/toast";
import { isLiveMode } from "@/lib/live";
import { LANGS, setLang, useLang, useTr } from "@/lib/i18n";
import { InstallApp } from "@/components/pwa/install-app";
import { NotificationBell } from "./notification-bell";

export function Topbar({ onMenuClick }: { onMenuClick: () => void }) {
  const { session, signOut } = useSession();
  const live = isLiveMode();
  const reset = useDemoReset();
  const { toast } = useToast();
  const [pickerOpen, setPickerOpen] = useState(false);
  const lang = useLang();
  const tr = useTr();

  /* Said once, because otherwise somebody's demo edits vanish with no
     explanation and the app looks broken rather than updated (F24). */
  useEffect(() => {
    if (consumeResetNotice()) {
      toast(
        "info",
        tr("Demo data refreshed", "Data demo diperbarui"),
        tr("The fixtures changed since your last visit, so the sandbox started over.", "Data contoh berubah sejak kunjungan terakhir Anda, jadi sandbox dimulai dari awal."),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    /* The drawer is a SIBLING of the header, never a child of it.
     *
     * `backdrop-blur-md` on the header makes it a containing block for
     * `position: fixed` descendants, so a fixed overlay rendered inside it gets
     * clipped to the header's 64px box instead of covering the viewport. The
     * symptom is a drawer that renders its header and nothing else. */
    <>
      <header className="sticky top-0 z-30 flex h-16 items-center gap-2 border-b border-slate-200 bg-white/90 px-4 backdrop-blur-md md:px-6">
        <button
          onClick={onMenuClick}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 lg:hidden"
          aria-label={tr("Open menu", "Buka menu")}
        >
          <Menu className="h-5 w-5" />
        </button>

        {/* Says what this is, once, where it cannot be missed and cannot be
            mistaken for production. Watermarking every card would only make the
            workflow harder to judge, which defeats the point of building it.

            **It used to say this unconditionally**, which was true for as long
            as there was no database and became a lie the moment there was one.
            Of everything on this screen, this is the label that must never be
            wrong: it is how somebody decides whether the number they are about
            to change is real. So it is asked, not assumed. */}
        {!live && (
          <span className="shrink-0 whitespace-nowrap rounded-md bg-amber-50 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-amber-700 ring-1 ring-inset ring-amber-200">
            {/* On a phone the bar is full (D331 added *Saya* to it): one word
                still says it, and the full sentence returns from `sm` up. */}
            <span className="sm:hidden">Demo</span>
            <span className="hidden sm:inline">{tr("Demo · data is not real", "Demo · data tidak nyata")}</span>
          </span>
        )}

        <div className="ml-auto flex min-w-0 items-center gap-1 sm:gap-2">
          {/* The viewer's own language, one click, remembered in this browser
              (D318). English is the default (D247). */}
          <div
            role="group"
            aria-label={tr("Language", "Bahasa")}
            className="flex shrink-0 overflow-hidden rounded-lg ring-1 ring-inset ring-slate-200"
          >
            {LANGS.map((l) => (
              <button
                key={l.code}
                type="button"
                onClick={() => setLang(l.code)}
                aria-pressed={lang === l.code}
                title={l.label}
                className={
                  lang === l.code
                    ? "bg-brand-600 px-2 py-1 text-[11px] font-semibold uppercase text-white"
                    : "px-2 py-1 text-[11px] font-semibold uppercase text-slate-500 hover:bg-slate-100"
                }
              >
                {l.code}
              </button>
            ))}
          </div>

          {/* Both of these are the sandbox's own controls and neither belongs in
              front of a database. `Reset` restores fixtures nothing is reading,
              which is merely confusing; the persona picker offers to become
              somebody else, which against real accounts is not a feature with a
              guard missing — it is the absence of authentication, and the real
              client refuses it. Hidden here so nobody is offered a button whose
              only possible answer is a refusal. */}
          {!live && (
            <>
              <Button
                variant="ghost"
                size="sm"
                icon={RotateCcw}
                onClick={() => {
                  reset();
                  toast("info", tr("Demo data reset", "Data demo direset"), tr("The sandbox is back to its starting state.", "Sandbox kembali ke keadaan awal."));
                }}
              >
                <span className="hidden md:inline">Reset</span>
              </Button>

              <GrantPickerButton onOpen={() => setPickerOpen(true)} />
            </>
          )}

          {/* Only where the browser can install and the app is not already
              running installed; otherwise nothing (D328). On a phone the
              sandbox's own two controls leave no room for it in the demo, and
              the demo is not what anybody installs; live, it is always there. */}
          <InstallApp className={live ? undefined : "hidden sm:block"} />

          {/* The way out, and it only exists where there is something to leave.
              A session somebody cannot end is one that ends only when the token
              expires — on a shared workshop machine that is the whole afternoon. */}
          {live && (
            <Button
              variant="ghost"
              size="sm"
              icon={LogOut}
              onClick={() => void signOut()}
              title={session?.user.email}
            >
              <span className="hidden md:inline">{tr("Sign out", "Keluar")}</span>
            </Button>
          )}

          {/* What reached this person — a task given to them, a task handed
              over to HRD (D374). Every account has one, like the profile. */}
          <NotificationBell />

          {/* Staff clock in from the same page the floor does (D331): one
              `/saya` for everybody on the payroll, whatever else they hold. */}
          <Link
            href="/saya"
            title={tr("Attendance, requests and pay — my own", "Presensi, pengajuan dan gaji — milik saya")}
            className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-2 text-[13px] font-medium text-slate-600 ring-1 ring-inset ring-slate-200 hover:bg-slate-100"
          >
            <Fingerprint className="h-4 w-4" />
            <span className="hidden sm:inline">{tr("Me", "Saya")}</span>
          </Link>

          {/* Every account owns this page (W7) — self reset, self history,
              self presensi/lembur/cuti, own tasks and own payslip. The avatar
              is the one thing on this bar that already belongs to "you"
              rather than to a module, which is why the link lives here and
              not in the sidebar: the sidebar is menu-as-data filtered by
              module grant (`src/lib/nav.ts`), and a profile is not a module
              anybody may be granted or refused. */}
          <Link
            href="/profil"
            title={session ? `${session.user.full_name} — ${tr("my profile", "profil saya")}` : tr("My profile", "Profil saya")}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-700 transition-colors hover:bg-brand-200"
          >
            {session?.user.full_name.charAt(0) ?? "?"}
          </Link>
        </div>

      </header>

      {!live && <GrantPicker open={pickerOpen} onClose={() => setPickerOpen(false)} />}
    </>
  );
}
