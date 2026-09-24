/** Remembering what the database last said, for the screens that ask again.
 *
 *  Going back to a page the reader just left used to mean the skeleton and a
 *  fresh round trip to the database, every time. This keeps the last answer to
 *  each read so a screen can draw it at once and ask again in the background —
 *  stale-while-revalidate. `useLoad` does the drawing; this does the keeping.
 *
 *  **What counts as a read is decided by name**, because every service in
 *  `src/lib/api` follows it: `list…`, `get…` and the handful below only read.
 *  Anything else — save, post, approve, link, sign in — is treated as a write,
 *  and a write forgets **everything**. That is deliberately blunt: one ledger
 *  post changes balances, the calendar, a vendor's journey and the inbox, and
 *  working out which cached answers a write touched is exactly the kind of
 *  cleverness that shows somebody a number that is no longer true. A cache
 *  that is emptied too often costs a round trip; one emptied too rarely costs
 *  trust.
 *
 *  Only successful answers are kept, never a refusal. Nothing is served older
 *  than `MAX_AGE_MS`, and a served answer is always refreshed straight after.
 */
import type { Result } from "@/services/_shared/envelope";

const READ = /^(list|get|coverage|preview|search|find|count|payments|unmatched|item|lookup|me$)/;
const MAX_AGE_MS = 10 * 60 * 1000;
const MAX_ENTRIES = 300;

type Entry = { value: Result<unknown>; at: number };

const kept = new Map<string, Entry>();
const inFlight = new Map<string, Promise<Result<unknown>>>();
/* Bumped by every write, so an answer that was asked for before the write
   and arrives after it is not kept. */
let generation = 0;

/** A read's promise, carrying the last answer to the same question when there
 *  is one — `useLoad` draws `cached` before the fresh answer arrives. */
export type CachedPromise<T> = Promise<T> & { cached?: T };

export function isRead(fn: string): boolean {
  return READ.test(fn);
}

function keyOf(service: string, fn: string, args: unknown[]): string | null {
  try {
    return `${service}.${fn}:${JSON.stringify(args)}`;
  } catch {
    return null; // a File, a cycle: not something a read is asked with
  }
}

function keep(key: string, value: Result<unknown>) {
  kept.delete(key);
  kept.set(key, { value, at: Date.now() });
  if (kept.size > MAX_ENTRIES) {
    const oldest = kept.keys().next().value;
    if (oldest !== undefined) kept.delete(oldest);
  }
}

/** Wrap one service function so its reads are remembered and its writes
 *  forget. The wrapper is what the screens call; the real function runs
 *  exactly as before. */
export function withCache<F extends (...args: never[]) => Promise<Result<unknown>>>(
  service: string, fn: string, impl: F,
): F {
  if (!isRead(fn)) {
    return (async (...args: Parameters<F>) => {
      generation++;
      kept.clear();
      inFlight.clear();
      try {
        return await impl(...args);
      } finally {
        /* Once more after: a read that started while the write was running
           may have kept the world from before it. */
        generation++;
        kept.clear();
      }
    }) as F;
  }

  return ((...args: Parameters<F>) => {
    const key = keyOf(service, fn, args);
    if (key === null) return impl(...args);

    const hit = kept.get(key);
    const cached = hit && Date.now() - hit.at <= MAX_AGE_MS ? hit.value : undefined;

    let run = inFlight.get(key);
    if (!run) {
      const asked = generation;
      run = impl(...args).then((value) => {
        if (!value.error && asked === generation) keep(key, value);
        return value;
      }).finally(() => {
        if (inFlight.get(key) === run) inFlight.delete(key);
      });
      inFlight.set(key, run);
    }

    const out = run.then((v) => v) as CachedPromise<Result<unknown>>;
    if (cached) out.cached = cached;
    return out;
  }) as unknown as F;
}

/** Forget everything — on sign-out and on a change of who is signed in, where
 *  the last person's answers must never be drawn for the next. */
export function forgetAll() {
  generation++;
  kept.clear();
  inFlight.clear();
}
