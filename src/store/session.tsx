"use client";

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { identity } from "@/demo/api";
import type { Result } from "@/services/_shared/envelope";
import { hasPermission, type ModuleGrant, type ModuleName, type ModuleLevel } from "@/lib/roles";
import type { Session, Authority } from "@/services/identity/contracts";

/** The session.
 *
 *  Reads from the identity service — `identity.me()` today, `GET
 *  /api/v1/identity/me` in Phase 2 — and exposes the two halves of access
 *  separately, because they are separate (D24):
 *
 *    can(code)          — may I open this screen, do this ordinary thing?
 *    hasAuthority(a)    — may I take this decision?
 *
 *  `can()` hides menus and controls. It is NOT the guard: in Phase 2 the guard
 *  is RLS in Postgres, and a request that should be refused is refused even if
 *  every layer above it has a bug. Hiding a control the caller may not use is
 *  courtesy; refusing the call is safety.
 */
interface SessionValue {
  session: Session | null;
  /** False until the browser's own sandbox has loaded. The shell waits rather
   *  than rendering a menu it is about to change (see `AppLayout`). */
  ready: boolean;
  can: (permission?: string) => boolean;
  hasAuthority: (authority: Authority) => boolean;
  hasAnyModule: boolean;
  /** Nobody is signed in, and the deployment has a database to sign in to.
   *
   *  Kept apart from `hasAnyModule` because the two are different problems with
   *  different answers: a person with no session needs the sign-in screen, a
   *  person with no grants needs somebody in IT. Folding them together sends
   *  one of them somewhere useless — and in demo mode there is nothing to sign
   *  in to at all, so it is always false there. */
  needsSignIn: boolean;
  refresh: () => Promise<void>;
  /** Real sign-in. In demo mode the password is ignored and the screen says so;
   *  against the database it is Supabase Auth, and `record_sign_in()` writes the
   *  trail in the same act. */
  signIn: (email: string, password: string) => Promise<Result<Session>>;
  signOut: () => Promise<void>;
  /** Demo controls. Both disappear in Phase 2 with the rest of the demo layer. */
  actAs: (userId: string) => Promise<void>;
  setModules: (grants: ModuleGrant[]) => Promise<void>;
  setAuthorities: (authorities: Authority[]) => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [needsSignIn, setNeedsSignIn] = useState(false);

  const refresh = useCallback(async () => {
    const res = await identity.me();
    if (res.data) {
      setSession(res.data);
      setNeedsSignIn(false);
    } else {
      /* Only `not_signed_in` means *go and sign in*. Every other refusal —
         `no_profile`, a network failure, a schema PostgREST cannot see — leaves
         the flag alone, because bouncing somebody to a login form they have
         already completed is the least helpful thing a broken deployment can
         do. The screen they land on should describe what is actually wrong. */
      setSession(null);
      setNeedsSignIn(res.error?.code === "not_signed_in");
    }
    setReady(true);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value: SessionValue = {
    session,
    ready,
    can: (permission) => hasPermission(session?.permissions ?? [], permission),
    hasAuthority: (authority) => (session?.authorities ?? []).includes(authority),
    hasAnyModule: (session?.modules.length ?? 0) > 0,
    needsSignIn,
    refresh,
    signIn: async (email, password) => {
      const res = await identity.signIn(email, password);
      if (res.data) {
        setSession(res.data);
        setNeedsSignIn(false);
      }
      return res;
    },
    signOut: async () => {
      await identity.signOut();
      /* Asked again rather than assumed: demo mode has no session to end and
         says so, so clearing `session` here would blank the sandbox for a door
         that does not exist. Whatever `me()` answers next is the truth. */
      await refresh();
    },
    actAs: async (userId) => {
      const res = await identity.actAs(userId);
      if (res.data) setSession(res.data);
    },
    setModules: async (grants) => {
      if (!session) return;
      const res = await identity.setModules(session.user.id, grants as { module: ModuleName; level: ModuleLevel }[]);
      if (res.data) setSession(res.data);
    },
    setAuthorities: async (authorities) => {
      if (!session) return;
      const res = await identity.setAuthorities(session.user.id, authorities);
      if (res.data) setSession(res.data);
    },
  };

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside a SessionProvider.");
  return ctx;
}
