"use client";

import { useEffect, useState } from "react";
import { Menu, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { GrantPicker, GrantPickerButton } from "./grant-picker";
import { useSession } from "@/store/session";
import { useDemoReset } from "@/demo/provider";
import { DATA_MODE, DEMO_AFFORDANCES } from "@/demo/api";
import { consumeResetNotice } from "@/demo/store";
import { useToast } from "@/store/toast";

export function Topbar({ onMenuClick }: { onMenuClick: () => void }) {
  const { session } = useSession();
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

            Read from `DATA_MODE` rather than written here (F95). This badge was
            a hardcoded string for sixty-two milestones and right by coincidence,
            because the demo is the only client that has ever answered. Over a
            live database it would have gone on saying *data is not real* — and a
            production system wearing that label teaches everyone to ignore it,
            which costs most on the day it is the only warning anybody gets.

            Live mode shows nothing rather than a green *Live* badge: a chrome
            that decorates the ordinary case is a chrome people stop reading, and
            the exceptional state is the one worth the pixels. */}
        {DATA_MODE === "demo" && (
          <span className="rounded-md bg-amber-50 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-amber-700 ring-1 ring-inset ring-amber-200">
            Demo · data is not real
          </span>
        )}

        <div className="ml-auto flex items-center gap-2">
          {/* Both of these belong to the sandbox and to nothing else.

              Reset throws the fixtures away and starts over, which against a real
              database is either meaningless or a very bad afternoon. The grant
              picker is impersonation — it is how the demo *shows* that permissions
              work, and it is the absence of authentication anywhere else. Neither
              had a condition on it; both were one environment variable away from
              being rendered over live data. */}
          {DEMO_AFFORDANCES && (
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

          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-700">
            {session?.user.full_name.charAt(0) ?? "?"}
          </div>
        </div>

      </header>

      {DEMO_AFFORDANCES && (
        <GrantPicker open={pickerOpen} onClose={() => setPickerOpen(false)} />
      )}
    </>
  );
}
