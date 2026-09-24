"use client";

import React from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "./primitives";
import { cn } from "@/lib/cn";
import type { ApiError, Page } from "@/services/_shared/envelope";

/** A load, carried as a value.
 *
 *  Taken from the one thing the old system's own review said was worth keeping:
 *  a failure is a value with a visible badge, never a blank table pretending to
 *  be an empty one. The difference matters — "there are no vendors" and "we
 *  could not ask" look identical otherwise, and only one of them is a reason to
 *  stop working.
 */
export type LoadState<T> =
  | { status: "loading" }
  | { status: "ready"; data: T; page?: Page }
  | { status: "failed"; error: ApiError };

export function SourceBadge({ state }: { state: LoadState<unknown> }) {
  const map = {
    loading: { label: "loading", cls: "bg-slate-100 text-slate-500 ring-slate-200" },
    ready: { label: "live", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
    failed: { label: "failed", cls: "bg-rose-50 text-rose-700 ring-rose-200" },
  }[state.status];
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ring-1 ring-inset", map.cls)}>
      <span className="h-1 w-1 rounded-full bg-current opacity-70" />
      {map.label}
    </span>
  );
}

export function Loaded<T>({
  state,
  children,
  onRetry,
  skeletonRows = 5,
}: {
  state: LoadState<T>;
  children: (data: T) => React.ReactNode;
  onRetry?: () => void;
  skeletonRows?: number;
}) {
  if (state.status === "loading") {
    return (
      <div className="space-y-2 px-5 py-4" aria-busy="true">
        {Array.from({ length: skeletonRows }).map((_, i) => (
          <div key={i} className="h-9 animate-pulse rounded-lg bg-slate-100" />
        ))}
      </div>
    );
  }

  if (state.status === "failed") {
    return (
      <div className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-rose-50 text-rose-600">
          <AlertTriangle className="h-5 w-5" />
        </span>
        <div>
          <p className="text-sm font-semibold text-slate-700">Could not load this</p>
          {/* The message the service gave, verbatim. A refusal a person cannot
              read is a refusal they will report as a mystery. */}
          <p className="mt-1 max-w-sm text-sm text-slate-500">{state.error.message}</p>
          <p className="mt-1 font-mono text-[11px] text-slate-400">
            {state.error.status} {state.error.code}
          </p>
        </div>
        {onRetry && (
          <Button variant="outline" size="sm" icon={RefreshCw} onClick={onRetry}>
            Try again
          </Button>
        )}
      </div>
    );
  }

  return <>{children(state.data)}</>;
}

/** Turns a service call into a `LoadState`. One line per screen, so no screen
 *  invents its own loading convention.
 *
 *  Two ways to ask again, and the difference is the whole reason the second one
 *  exists. `reload()` starts over — skeleton first, because the person pressed
 *  something and deserves to see that it is happening. `refresh()` asks
 *  quietly: the current answer stays on screen until a better one arrives, and
 *  if the call fails the old answer stays rather than the screen going blank.
 *
 *  A polling screen has to use the second. `reload()` on a timer drops every
 *  list back to a skeleton every minute, which reads as the page breaking, and
 *  a failed poll would replace a working screen with an error — losing data
 *  that was fine, because of a request nobody asked for. `refresh()` answers
 *  false instead, and the screen can say "showing the last good read" without
 *  throwing it away.
 */
export function useLoad<T>(
  run: () => Promise<{ data?: T; error?: ApiError; meta?: { page?: Page } }>,
  deps: React.DependencyList,
): [LoadState<T>, () => void, () => Promise<boolean>] {
  const [state, setState] = React.useState<LoadState<T>>({ status: "loading" });
  const [tick, setTick] = React.useState(0);

  /* `run` is a fresh closure on every render, and `refresh` must call the
     current one without being a new function every render itself — otherwise it
     changes identity each pass and any effect depending on it restarts, which
     turns a one-minute poll into a poll on every keystroke. */
  const latest = React.useRef(run);
  latest.current = run;

  /* Whether anything is on screen right now, read inside `refresh` without
     making it depend on `state` — see above. A quiet failure may only be
     swallowed when there is a good answer left to show. */
  const hasData = React.useRef(false);
  hasData.current = state.status === "ready";

  React.useEffect(() => {
    let alive = true;
    setState({ status: "loading" });
    void run().then((res) => {
      if (!alive) return;
      if (res.error) setState({ status: "failed", error: res.error });
      /* The page meta rides along with the data: a screen that pages needs to
         know how many there are, and asking twice would be two answers. */
      else setState({ status: "ready", data: res.data as T, page: res.meta?.page });
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  const refresh = React.useCallback(async () => {
    const res = await latest.current();
    if (res.error) {
      // Nothing on screen yet: a failure is the news, so say it.
      if (!hasData.current) setState({ status: "failed", error: res.error });
      return false;
    }
    setState({ status: "ready", data: res.data as T, page: res.meta?.page });
    return true;
  }, []);

  return [state, () => setTick((t) => t + 1), refresh];
}

/** Ask again every `ms`, while the tab is in front and `enabled` is true.
 *
 *  Three conditions, and each one is a mistake this hook exists to not make:
 *
 *  **Paused when the tab is hidden.** A queue screen left open on a second
 *  monitor overnight is 480 needless round trips, and some of the reads behind
 *  these screens cost seconds under RLS. It also refreshes *immediately* on
 *  coming back, so the first thing somebody sees on returning is current
 *  rather than a minute old.
 *
 *  **Paused when the caller says so.** A list that reorders itself under an
 *  open form is worse than a list that is a minute stale — the row somebody is
 *  deciding about must not move while they decide.
 *
 *  **One in flight at a time.** A refresh slower than the interval would
 *  otherwise stack, and the answers can land out of order, so the screen
 *  settles on whichever reply was slowest rather than whichever was latest.
 */
export function usePoll(
  ms: number,
  refresh: () => Promise<unknown>,
  { enabled = true }: { enabled?: boolean } = {},
): void {
  const latest = React.useRef(refresh);
  latest.current = refresh;

  React.useEffect(() => {
    if (!enabled || ms <= 0) return;
    let stopped = false;
    let running = false;

    const ask = () => {
      if (stopped || running) return;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      running = true;
      void Promise.resolve(latest.current()).finally(() => { running = false; });
    };

    const timer = setInterval(ask, ms);
    const onVisible = () => { if (document.visibilityState === "visible") ask(); };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [ms, enabled]);
}
