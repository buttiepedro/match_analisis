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
  document_id?: string | null;
  must_change_password?: boolean;
  /** Capacidades efectivas. El menú se arma con esto, no con `role`. */
  permissions?: string[];
  club_id: string | null;
}

interface AuthState {
  user: User | null;
  token: string | null;
  /** Identificador: email para el staff, DNI para el socio. */
  login: (identifier: string, password: string, clubSlug?: string) => Promise<void>;
  /** Baja el flag `must_change_password` sin obligar a volver a loguearse. */
  markPasswordChanged: () => void;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      login: async (identifier, password, clubSlug) => {
        // El socio entra con su DNI y el staff con su email. Distinguirlos por la
        // forma del texto evita preguntarle al usuario qué tipo de dato está por
        // escribir, que es una pregunta que no debería tener que contestar.
        const isEmail = identifier.includes("@");
        const { data } = await api.post("/auth/login", {
          ...(isEmail ? { email: identifier } : { document_id: identifier.trim() }),
          password,
          ...(clubSlug ? { club_slug: clubSlug } : {}),
        });
        setTokens(data.access_token, data.refresh_token);
        set({
          token: data.access_token,
          user: { ...data.user, must_change_password: data.must_change_password },
        });
      },
      markPasswordChanged: () =>
        set((state) => ({
          user: state.user ? { ...state.user, must_change_password: false } : null,
        })),
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
