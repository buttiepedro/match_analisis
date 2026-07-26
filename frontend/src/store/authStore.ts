import { create } from "zustand";
import { persist } from "zustand/middleware";
import api from "../lib/axios";
import {
  clearTokens,
  getAccessToken,
  getRefreshToken,
  onTokensChanged,
  setTokens,
} from "../lib/authTokens";

interface User {
  id: string;
  email: string;
  full_name: string;
  role: "superadmin" | "club_admin" | "match_director" | "analyst" | "player";
  club_id: string | null;
}

interface AuthState {
  user: User | null;
  token: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      login: async (email, password) => {
        const { data } = await api.post("/auth/login", { email, password });
        setTokens(data.access_token, data.refresh_token);
        set({ token: data.access_token, user: data.user });
      },
      logout: async () => {
        const refreshToken = getRefreshToken();
        if (refreshToken) {
          // Revoca el refresh token del lado del servidor; si falla (sin red,
          // token ya vencido) igual limpiamos la sesión local.
          await api.post("/auth/logout", { refresh_token: refreshToken }).catch(() => {});
        }
        clearTokens();
        set({ user: null, token: null });
      },
    }),
    {
      name: "auth-storage",
      // El access token puede rotar por el interceptor mientras el store está
      // hidratado; localStorage es la fuente de verdad al rehidratar.
      onRehydrateStorage: () => (state) => {
        if (state) state.token = getAccessToken();
      },
    }
  )
);

// Mantiene el store en sincronía cuando el interceptor rota el access token.
onTokensChanged((accessToken) => {
  useAuthStore.setState((s) =>
    accessToken ? { token: accessToken } : { token: null, user: s.user }
  );
});
