import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { setToken, setUnauthorizedHandler } from "../api/client";
import { endpoints } from "../api/endpoints";
import type { Me } from "../api/types";

/**
 * Session handling. The access token lives in sessionStorage (cleared when the tab closes) and in
 * the API client; it is never put in a URL or logged. Any 401 signs the user out.
 */
const STORAGE_KEY = "flightops.session";

interface Session {
  token: string;
  me: Me;
  expiresAt: number;
}

interface AuthState {
  me: Me | null;
  signIn: (username: string, password: string) => Promise<void>;
  signOut: (reason?: string) => void;
  notice: string | null;
}

const AuthContext = createContext<AuthState | null>(null);

function readSession(): Session | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Session;
    return s.expiresAt > Date.now() ? s : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Session | null>(() => {
    const s = readSession();
    setToken(s?.token ?? null);
    return s;
  });
  const [notice, setNotice] = useState<string | null>(null);

  const signOut = useCallback(
    (reason?: string) => {
      setToken(null);
      try {
        sessionStorage.removeItem(STORAGE_KEY);
      } catch {
        // storage unavailable
      }
      queryClient.clear();
      setSession(null);
      setNotice(reason ?? null);
    },
    [queryClient],
  );

  useEffect(() => {
    setUnauthorizedHandler(() => signOut("Your session has ended. Please sign in again."));
  }, [signOut]);

  useEffect(() => {
    if (!session) return;
    const ms = session.expiresAt - Date.now();
    const timer = window.setTimeout(() => signOut("Your session has expired. Please sign in again."), Math.max(ms, 0));
    return () => window.clearTimeout(timer);
  }, [session, signOut]);

  const signIn = useCallback(async (username: string, password: string) => {
    const t = await endpoints.login(username, password);
    setToken(t.access_token);
    try {
      const me = await endpoints.me();
      const s: Session = { token: t.access_token, me, expiresAt: Date.now() + (t.expires_in - 30) * 1000 };
      try {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(s));
      } catch {
        // storage unavailable: session lasts for this page only
      }
      setNotice(null);
      setSession(s);
    } catch (e) {
      setToken(null);
      throw e;
    }
  }, []);

  const value = useMemo(() => ({ me: session?.me ?? null, signIn, signOut, notice }), [session, signIn, signOut, notice]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
