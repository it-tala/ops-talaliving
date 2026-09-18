import { defineCloudflareConfig } from "@opennextjs/cloudflare";

/** How the Next build is adapted into a Cloudflare Worker.
 *
 *  No overrides. The adapter's defaults are right for this application: the
 *  only overrides worth setting are caches — `incrementalCache`, `tagCache`,
 *  `queue` — and they exist to make ISR and `revalidate` work across
 *  isolates. Nothing here revalidates. Every screen is a client component
 *  (`"use client"`), the three server components render the same markup on
 *  every request, and there are no route handlers at all, so an R2 cache
 *  bucket would be a binding to keep alive, pay for and forget to create,
 *  holding nothing.
 *
 *  The day a page is actually served from the server with revalidation, this
 *  is the file that gains an `incrementalCache`, together with the matching
 *  `r2_buckets` entry in `wrangler.jsonc`. Not before.
 */
export default defineCloudflareConfig();
