"use client";

import { useEffect, useState } from "react";
import { Menu, RotateCcw, LogOut } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { GrantPicker, GrantPickerButton } from "./grant-picker";
import { useSession } from "@/store/session";
import { useDemoReset } from "@/demo/provider";
import { consumeResetNotice } from "@/demo/store";
import { useToast } from "@/store/toast";
import { isLiveMode } from "@/lib/live";

export function Topbar({ onMenuClick }: { onMenuClick: () => void }) {
  const { session, signOut } = useSession();
  const live = isLiveMode();
  const reset = useDemoReset();
  const { toast } = useToast();
  const [pickerOpen, setPickerOpen] = useState(false);

  /* Said once, because otherwise somebody's demo edits vanish with no
     explanation and the app looks broken rather than updated (F24). */
  useEffect(() => {
    if (consumeResetNotice()) {
      toast(
        "info",
        "Demo data refreshed",
        "The fixtures changed since your last visit, so the sandbox started over.",
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
      <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur-md md:px-6">
        <button
          onClick={onMenuClick}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 lg:hidden"
          aria-label="Open menu"
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
          <span className="rounded-md bg-amber-50 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-amber-700 ring-1 ring-inset ring-amber-200">
            Demo · data is not real
          </span>
        )}

        <div className="ml-auto flex items-center gap-2">
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
                  toast("info", "Demo data reset", "The sandbox is back to its starting state.");
                }}
              >
                <span className="hidden md:inline">Reset</span>
              </Button>

              <GrantPickerButton onOpen={() => setPickerOpen(true)} />
            </>
          )}

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
              <span className="hidden md:inline">Keluar</span>
            </Button>
          )}

          <div
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-700"
            title={session?.user.email}
          >
            {session?.user.full_name.charAt(0) ?? "?"}
          </div>
        </div>

      </header>

      {!live && <GrantPicker open={pickerOpen} onClose={() => setPickerOpen(false)} />}
    </>
  );
}
