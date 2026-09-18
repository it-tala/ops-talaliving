"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { identity } from "@/demo/api";
import { labelFor } from "@/lib/activity-label";

/** Writes one `view` to the activity trail per screen somebody opens.
 *
 *  ## Why this exists at all
 *
 *  `/it/aktivitas` and the tables behind it shipped without anything writing to
 *  them. The screen was correct, the migration was correct, the retention rule
 *  was argued over twice — and the trail was empty, permanently, because the
 *  recorder was left for later. A log nobody writes to is worse than no log: it
 *  answers *nothing happened* to a question about a day that was busy.
 *
 *  ## Why it lives in the shell
 *
 *  One mount, one rule, every screen. The alternative is a call at the top of
 *  fifty-two pages, which is fifty-two chances to add a screen and forget — and
 *  the screens that get forgotten are the new ones, which are exactly the ones
 *  somebody is asking about.
 *
 *  ## What it deliberately does not do
 *
 *  **It does not block anything, and it ignores the answer.** A screen that
 *  could not log the fact it was opened must still open: refusing the page
 *  because the trail is unavailable turns an observability feature into an
 *  outage. The seam is built for this — `record_activity_event` writes no audit
 *  row and no outbox entry, because a trail of writing the trail is how a table
 *  grows without ever being read.
 *
 *  **It records the screen, not the person's movements inside it.** A view, a
 *  print, an export — coarse, on purpose. D188 answered *what did this person do
 *  today*, and keystroke-level watching is surveillance nobody asked for. It is
 *  also why this component has no scroll, focus or click handler.
 *
 *  **It does not record a reveal.** Opening an identity number is a write that
 *  `hr.revealEmployeeDocNo` already puts in the audit log, and the recap counts
 *  it from there. Sending it here as well is a second number free to disagree
 *  with the first — and did, briefly: counting reveals here while `changes`
 *  counted every `ok` audit row meant every reveal was counted twice (D197).
 */
export function ActivityRecorder() {
  const pathname = usePathname();
  /* React 18 mounts twice in development, and a navigation can re-render the
     shell more than once. Neither is a second visit, and a trail that says a
     person opened payroll twice when they opened it once is a trail that reads
     busier than the day was. */
  const last = useRef<string | null>(null);

  useEffect(() => {
    if (!pathname || last.current === pathname) return;
    last.current = pathname;

    void identity
      .recordActivity({ kind: "view", target: pathname, label: labelFor(pathname) })
      .catch(() => {
        /* Deliberately silent, and deliberately not a toast. Nothing the person
           is doing depends on this, and an error about the logging of their
           work would be noise in the middle of the work. */
      });
  }, [pathname]);

  return null;
}
