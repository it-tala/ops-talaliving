"use client";

import { stripRefs } from "@/lib/refs";
import React from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "./primitives";
import { cn } from "@/lib/cn";
import type { ApiError, Page } from "@/services/_shared/envelope";
import type { CachedPromise } from "@/lib/api-cache";

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
  /* `refreshing` is a ready state being asked again: the rows on screen are
     the last answer, and the next one is on its way. */
  | { status: "ready"; data: T; page?: Page; refreshing?: boolean }
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
          <p className="mt-1 max-w-sm text-sm text-slate-500">{stripRefs(state.error.message)}</p>
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

  return (
    <>
      {children(state.data)}
      {state.refreshing && <RefreshBar />}
    </>
  );
}

/** A reload says so at the top of the window and leaves the table alone.
 *  Swapping forty rows for a skeleton because one of them changed makes every
 *  save feel like a page load, and takes the reader's place with it. */
function RefreshBar() {
  return (
    <div
      role="progressbar"
      aria-label="Refreshing"
      className="pointer-events-none fixed inset-x-0 top-0 z-[60] h-0.5 overflow-hidden bg-brand-100"
    >
      <div className="h-full w-1/3 animate-pulse bg-brand-500" />
    </div>
  );
}

/** Turns a service call into a `LoadState`. One line per screen, so no screen
 *  invents its own loading convention.
 *
 *  A `reload()` keeps what is on screen and refreshes it in the background:
 *  it is the same question asked again, so the old answer is the right thing
 *  to look at while the new one arrives.
 *
 *  A change of `deps` shows the skeleton by default, because most deps are an
 *  id — the drawer that moved from PO-12 to PO-13 must not show PO-12's lines
 *  while it waits. A list whose deps are its filters and search box passes
 *  `keepPrevious`, and keeps its rows while the narrower set loads. */
export function useLoad<T>(
  run: () => Promise<{ data?: T; error?: ApiError; meta?: { page?: Page } }>,
  deps: React.DependencyList,
  opts: { keepPrevious?: boolean } = {},
): [LoadState<T>, () => void] {
  const [state, setState] = React.useState<LoadState<T>>({ status: "loading" });
  const [tick, setTick] = React.useState(0);
  const lastTick = React.useRef(tick);
  const keepPrevious = opts.keepPrevious ?? false;

  /* Before paint, so a remembered answer replaces the skeleton in the same
     frame rather than flashing it first. */
  useIsoLayoutEffect(() => {
    let alive = true;
    const isReload = lastTick.current !== tick;
    lastTick.current = tick;
    const asked = run() as CachedPromise<{ data?: T; error?: ApiError; meta?: { page?: Page } }>;
    const cached = asked.cached;
    setState((prev) => {
      /* The last answer to this very question (`src/lib/api-cache.ts`): drawn
         at once — the reader coming back to a page sees it as they left it —
         and marked refreshing, because the database is asked again anyway. */
      if (cached && !cached.error) {
        return { status: "ready", data: cached.data as T, page: cached.meta?.page, refreshing: true };
      }
      return prev.status === "ready" && (isReload || keepPrevious)
        ? { ...prev, refreshing: true }
        : { status: "loading" };
    });
    void asked.then((res) => {
      if (!alive) return;
      if (res.error) setState({ status: "failed", error: res.error });
      /* The page meta rides along with the data: a screen that pages needs to
         know how many there are, and asking twice would be two answers. */
      else setState({ status: "ready", data: res.data as T, page: res.meta?.page });
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  return [state, React.useCallback(() => setTick((t) => t + 1), [])];
}

/* `useLayoutEffect` warns during the server render, where it cannot run;
   there `useEffect` is the same no-op without the warning. */
const useIsoLayoutEffect = typeof window === "undefined" ? React.useEffect : React.useLayoutEffect;

/** The value, once it has stopped changing for `ms`. A search box that asks
 *  the server wants the word, not every letter of it. */
export function useDebounced<T>(value: T, ms = 300): T {
  const [settled, setSettled] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return settled;
}
