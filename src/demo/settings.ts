/** Reading a setting from the sandbox.
 *
 *  Every caller passes a fallback, and the fallback is the **documented
 *  default** rather than a convenient zero: a setting that has gone missing
 *  should behave the way the system behaved before anybody touched it, not
 *  the way an empty variable happens to behave (F60 in a different costume).
 */
import type { DemoState } from "./state";

export function settingNumber(state: DemoState, key: string, fallback: number): number {
  const raw = state.app_settings?.find((s) => s.key === key)?.value;
  const n = raw == null ? NaN : Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export function settingText(state: DemoState, key: string, fallback: string): string {
  return state.app_settings?.find((s) => s.key === key)?.value || fallback;
}
