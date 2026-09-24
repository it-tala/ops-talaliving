"use client";

/** `@/demo/provider` in a live build.
 *
 *  Two hooks outside the demo read it: `useLang()` and `useBrand()` take the
 *  language and the brand from `app_settings`. In a live build those have
 *  always come from the fixture defaults — the store is never hydrated from
 *  the database — so this hands over exactly those defaults and nothing else,
 *  and the screens read the same values they did before the demo was cut out.
 */
import React from "react";
import { APP_SETTINGS } from "@/demo/fixtures/settings";
import type { DemoState } from "@/demo/state";

const SNAPSHOT = { app_settings: APP_SETTINGS, users: [], session_user_id: null } as unknown as DemoState;

export function DemoProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

export function useDemo(): DemoState {
  return SNAPSHOT;
}

export function useDemoReset(): () => void {
  return () => {};
}

export function useActingUser() {
  return undefined;
}
