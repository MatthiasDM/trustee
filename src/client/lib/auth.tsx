import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "./api";
import type { Building, User } from "../../shared/types";

interface Org { id: string; name: string; plan: string; role: string }
interface Me { user: User | null; orgs: Org[]; buildings: Building[]; unread: number; vapidPublicKey: string | null; consents_required?: string[]; security?: { totp_enabled: boolean; sessions: number }; demo_enabled?: boolean; demo?: { group: string; ttl_hours: number; users: { id: string; name: string; role: string; building_id: string }[] } | null }
interface AuthCtx extends Me { loading: boolean; refresh: () => Promise<void>; logout: () => Promise<void>; setUnread: (n: number) => void }

const Ctx = createContext<AuthCtx>(null!);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me>({ user: null, orgs: [], buildings: [], unread: 0, vapidPublicKey: null });
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    try { setMe(await api.get<Me>("/api/auth/me")); } finally { setLoading(false); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    if (!me.user) return;
    const t = setInterval(() => api.get<Me>("/api/auth/me").then((m) => setMe((p) => ({ ...p, unread: m.unread }))).catch(() => {}), 30_000);
    return () => clearInterval(t);
  }, [me.user?.id]);
  const logout = async () => { await api.post("/api/auth/logout"); setMe({ user: null, orgs: [], buildings: [], unread: 0, vapidPublicKey: null }); };
  return <Ctx.Provider value={{ ...me, loading, refresh, logout, setUnread: (n) => setMe((p) => ({ ...p, unread: n })) }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
