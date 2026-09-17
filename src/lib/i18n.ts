/** Two languages, and an honest boundary between what is translated and what
 *  is not.
 *
 *  ## What was actually wrong
 *
 *  The app was not English. It was not Indonesian either. The menu said
 *  *Payroll* and *Delivery*, the page beside it said *Serah terima* and
 *  *Berkas 201*, and the helper text under both was Indonesian prose. That is
 *  the worst of the three states: a reader of either language hits the other
 *  one every few lines, and neither can tell whether a word is a translation
 *  or a term of art (F66).
 *
 *  ## What is translated, and what is not
 *
 *  **Translated**: the shell — every menu label, the topbar, the shared words
 *  the whole app is navigated by — and **all of John Lau**, including his
 *  guidance, his refusals and the reasons behind them.
 *
 *  **Not translated**: the bodies of the screens. Forty-five screens of prose
 *  is a different order of work, and half of it would still be Indonesian on
 *  the day it shipped.
 *
 *  **Never translated**: the business's own vocabulary. `MSG SENT`, `SP NORTH`,
 *  `PKWT`, `kubikasi`, account codes, status strings. Those are not English or
 *  Indonesian words, they are the names of things, and translating a name is
 *  how two systems stop agreeing (D224).
 *
 *  The settings row says all of this in place of implying full coverage,
 *  because a language switch that changes a third of the screen and claims to
 *  change the language is the same shape of lie as a figure that looks
 *  computed and was typed.
 */
import { useDemo } from "@/demo/provider";

export type Lang = "en" | "id";

export const LANGS: { code: Lang; label: string }[] = [
  { code: "en", label: "English" },
  { code: "id", label: "Bahasa Indonesia" },
];

export const DEFAULT_LANG: Lang = "en";

/** Two strings, always both. A message with only one language is a message
 *  that silently falls back, and a silent fallback is how half a screen stays
 *  in the wrong language for a year without anybody filing it. */
export type Message = { en: string; id: string };

export function pick(m: Message, lang: Lang): string {
  return m[lang];
}

/** The language in force, from the setting (D216). */
export function useLang(): Lang {
  const state = useDemo();
  const raw = state.app_settings?.find((s) => s.key === "format.language")?.value;
  return raw === "id" ? "id" : "en";
}

/** `t(MESSAGES.nav.dashboard)` — a lookup that cannot miss, because the
 *  catalogue is typed and every entry carries both languages. */
export function useT(): (m: Message) => string {
  const lang = useLang();
  return (m: Message) => m[lang];
}
