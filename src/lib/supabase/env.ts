/** Where the keys come from, and the one that must never reach a browser.
 *
 *  Rule 9 of the Phase 2 brief: secrets come from the environment, never the
 *  repo, and `service_role` never appears in a `NEXT_PUBLIC_*` name. That rule
 *  is easy to agree with and easy to break by accident — somebody adds the
 *  prefix to make an import work, the build succeeds, and a key that bypasses
 *  every row-level policy in the database ships inside a JavaScript bundle that
 *  anybody can read.
 *
 *  So it is checked here, at the one place the keys are read, and the check
 *  throws rather than warns. A build that fails is a bad afternoon; a service
 *  key in a bundle is a bad year.
 */

/** Publishable. Safe in the browser by design — every request it makes is still
 *  subject to the policies in `supabase/migrations/0002_core_identity.sql`. */
export function publicConfig(): { url: string; anonKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set. "
      + "See .env.example; values live in the deployment's secret store, never here.",
    );
  }
  return { url, anonKey };
}

/** Server only, and only for work no user triggered — the outbox delivery loop,
 *  a scheduled import. It bypasses RLS entirely, which is precisely why it must
 *  never answer a request somebody made: the database would stop being the
 *  thing that decides, and ADR-002 would be a comment rather than a control.
 */
export function serviceRoleKey(): string {
  if (typeof window !== "undefined") {
    throw new Error("The service role key is server-only and was read in a browser.");
  }
  /* The guard that earns this file. `NEXT_PUBLIC_` is not a naming convention
     in Next.js — it is an instruction to inline the value into the client
     bundle. A service key under that prefix is already public by the time
     anybody notices the name. */
  if (process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY is set. The service role key must never "
      + "carry the NEXT_PUBLIC_ prefix — that prefix ships the value to every browser. "
      + "Rename it to SUPABASE_SERVICE_ROLE_KEY and rotate the key, because it has been "
      + "in a client bundle.",
    );
  }
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set.");
  return key;
}

/** Is there a database to talk to at all?
 *
 *  Read by `src/lib/api/index.ts` to choose a client. Demo mode is not a
 *  fallback for a misconfigured deployment — it is a mode somebody chooses —
 *  so this asks only whether the configuration exists, and never swallows an
 *  error from a database that does exist and is unhappy.
 */
export function isConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

/** Which client should answer.
 *
 *  Two conditions, and both have to hold. `NEXT_PUBLIC_USE_SUPABASE` is somebody
 *  choosing; the keys are there being something to choose. The order matters:
 *  demo mode is a **mode**, never a fallback for a misconfigured deployment.
 *  Falling back silently would mean a production app quietly serving fixtures,
 *  with every screen looking entirely correct.
 *
 *  It lives here rather than in `src/lib/api/index.ts` because `src/lib/live.ts`
 *  has to ask the same question to decide which menu items to draw, and reaching
 *  it through the api barrel pulled `supabase-js` into the bundle of every
 *  screen — including the demo deployment, which has no database to talk to.
 *  One definition, in the file that already owns the keys.
 */
export function isRealApi(): boolean {
  return process.env.NEXT_PUBLIC_USE_SUPABASE === "1" && isConfigured();
}
