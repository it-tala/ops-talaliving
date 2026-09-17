"use client";

import { useDemo } from "@/demo/provider";

/** Identity — ONE place.
 *
 *  The name here appears in the sidebar, the browser tab and the sign-in page.
 *  The colour lives in `tailwind.config.ts` (the `brand` scale). They are kept
 *  out of components deliberately, so changing the brand is not a hunt through
 *  fifty files.
 *
 *  The colour is still a placeholder. When the real one arrives, derive the
 *  WHOLE 50–950 scale from it rather than swapping `700` alone — a scale whose
 *  steps disagree shows up immediately on buttons and the sidebar — and update
 *  `BRAND` in `src/components/charts/charts.tsx` and `themeColor` in
 *  `src/app/layout.tsx` to match.
 */
export const BRAND = {
  name: "OPS TALALIVING",
  tagline: "PT TALAHOME",
  /** Used in <title>. Server-rendered, so it stays the constant — a document
   *  title that changed per visitor would have to be set on the client anyway,
   *  and nobody reads a tab title twice. */
  documentTitle: "Ops Talaliving",
} as const;

/** What the sidebar and the sign-in page actually show.
 *
 *  The constant above is the default; the settings screen can move it (D216),
 *  and a settings page whose values nothing reads is theatre. Print layouts
 *  read the same hook, so a renamed company reaches the vendor's PO too.
 */
export function useBrand() {
  const snapshot = useDemo();
  const get = (key: string, fallback: string) =>
    snapshot.app_settings?.find((s) => s.key === key)?.value || fallback;
  return {
    name: get("brand.name", BRAND.name),
    tagline: get("brand.tagline", BRAND.tagline),
    documentTitle: BRAND.documentTitle,
  };
}
