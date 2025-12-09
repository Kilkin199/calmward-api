import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { API_BASE_URL } from "../config";

type Me = {
  email?: string;
  isSponsor?: boolean;
  isSponsorActive?: boolean;
  isPremium?: boolean;
  isPremiumActive?: boolean;
  subscriptionType?: string | null;
  premiumValidUntil?: string | null;
  sponsorValidUntil?: string | null;
};

type SessionCtx = {
  token: string | null;
  me: Me | null;
  setToken: (t: string | null) => Promise<void>;
  refreshMe: () => Promise<void>;
  isReady: boolean;
};

const Ctx = createContext<SessionCtx | null>(null);

const TOKEN_KEY = "calmward_token_v1";

async function fetchMe(token: string) {
  const res = await fetch(\/billing/subscription, {
    headers: { Authorization: Bearer \ },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || "No se pudo cargar la sesión");
  return data;
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [token, _setToken] = useState<string | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [isReady, setReady] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const t = await AsyncStorage.getItem(TOKEN_KEY);
        if (!mounted) return;
        if (t) {
          _setToken(t);
          try {
            const data = await fetchMe(t);
            setMe({
              email: data.email,
              isSponsor: data.isSponsor,
              isSponsorActive: data.isSponsorActive,
              isPremium: data.isPremium,
              isPremiumActive: data.isPremiumActive,
              subscriptionType: data.subscriptionType ?? null,
              premiumValidUntil: data.premiumValidUntil ?? null,
              sponsorValidUntil: data.sponsorValidUntil ?? null,
            });
          } catch {
            setMe(null);
          }
        }
      } finally {
        if (mounted) setReady(true);
      }
    })();
    return () => { mounted = false; };
  }, []);

  async function setToken(t: string | null) {
    if (t) {
      await AsyncStorage.setItem(TOKEN_KEY, t);
      _setToken(t);
    } else {
      await AsyncStorage.removeItem(TOKEN_KEY);
      _setToken(null);
      setMe(null);
    }
  }

  async function refreshMe() {
    if (!token) { setMe(null); return; }
    const data = await fetchMe(token);
    setMe({
      email: data.email,
      isSponsor: data.isSponsor,
      isSponsorActive: data.isSponsorActive,
      isPremium: data.isPremium,
      isPremiumActive: data.isPremiumActive,
      subscriptionType: data.subscriptionType ?? null,
      premiumValidUntil: data.premiumValidUntil ?? null,
      sponsorValidUntil: data.sponsorValidUntil ?? null,
    });
  }

  const value = useMemo(
    () => ({ token, me, setToken, refreshMe, isReady }),
    [token, me, isReady]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession() {
  const v = useContext(Ctx);
  if (!v) {
    return {
      token: null,
      me: null,
      setToken: async () => {},
      refreshMe: async () => {},
      isReady: true,
    } as SessionCtx;
  }
  return v;
}
