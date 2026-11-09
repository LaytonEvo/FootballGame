import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, setApiToken } from './api';
import { tokenStore } from './storage';

export interface Me {
  id: string;
  displayName: string | null;
  favouriteClubId: string | null;
  inviteCode: string;
  profileComplete: boolean;
  notificationPrefs: Record<string, boolean>;
}

interface AuthState {
  ready: boolean;
  me: Me | null;
  signIn: (token: string) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [me, setMe] = useState<Me | null>(null);

  const refresh = useCallback(async () => {
    try {
      setMe(await api<Me>('/me'));
    } catch {
      setMe(null);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      const t = await tokenStore.get();
      setApiToken(t);
      if (t) await refresh();
      setReady(true);
    })();
  }, [refresh]);

  const signIn = useCallback(
    async (token: string) => {
      await tokenStore.set(token);
      setApiToken(token);
      await refresh();
    },
    [refresh],
  );
  const signOut = useCallback(async () => {
    await tokenStore.set(null);
    setApiToken(null);
    setMe(null);
  }, []);

  return <Ctx.Provider value={{ ready, me, signIn, signOut, refresh }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}
