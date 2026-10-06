import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { api, clearTokens, setTokens } from "./../api/client";
import type { Health, User } from "../types";

interface AuthState {
  user: User | null;
  health: Health | null;
  loading: boolean;
  login: (username: string, password: string, method: string) => Promise<void>;
  register: (username: string, email: string, password: string, displayName: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshMe: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [loading, setLoading] = useState(true);

  async function refreshMe() {
    try {
      const me = await api<User>("/api/auth/me");
      setUser(me);
    } catch {
      clearTokens();
      setUser(null);
    }
  }

  useEffect(() => {
    (async () => {
      try {
        setHealth(await api<Health>("/api/health"));
      } catch {
        setHealth(null);
      }
      if (localStorage.getItem("basdrive_access")) {
        await refreshMe();
      }
      setLoading(false);
    })();
  }, []);

  async function login(username: string, password: string, method: string) {
    const data = await api<{ access_token: string; refresh_token: string; user: User }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password, method }),
    });
    setTokens(data.access_token, data.refresh_token);
    setUser(data.user);
  }

  async function register(username: string, email: string, password: string, displayName: string) {
    const data = await api<{ access_token: string; refresh_token: string; user: User }>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ username, email, password, display_name: displayName }),
    });
    setTokens(data.access_token, data.refresh_token);
    setUser(data.user);
  }

  async function logout() {
    try {
      const refresh = localStorage.getItem("basdrive_refresh");
      if (refresh) {
        await api("/api/auth/logout", { method: "POST", body: JSON.stringify({ refresh_token: refresh }) });
      }
    } catch {
      /* ignore */
    }
    clearTokens();
    setUser(null);
  }

  const value = useMemo(
    () => ({ user, health, loading, login, register, logout, refreshMe }),
    [user, health, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("AuthProvider missing");
  return ctx;
}
