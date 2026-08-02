import { create } from "zustand";
import api from "../lib/api";
import { clearTokens, getAccessToken, getRefreshToken, onTokensChanged, setTokens } from "../lib/authTokens";

export interface User {
  id: string;
  email: string;
  full_name: string;
  role: "superadmin" | "club_admin" | "match_director" | "analyst" | "player";
  document_id?: string | null;
  must_change_password?: boolean;
  permissions?: string[];
  club_id: string | null;
}

interface AuthState {
  user: User | null;
  token: string | null;
  /** `loading` mientras `bootstrap()` todavía no resolvió si había sesión. */
  status: "loading" | "authenticated" | "unauthenticated";
  /** Identificador: email para el staff, DNI para el socio — igual que la web. */
  login: (identifier: string, password: string, clubSlug?: string) => Promise<void>;
  markPasswordChanged: () => void;
  logout: () => Promise<void>;
  /**
   * Corre una vez al abrir la app. A diferencia de la web (que persiste
   * `user` en `localStorage`), acá se re-pide `GET /auth/me` con el token
   * que haya en el Keychain/Keystore — no hay una segunda copia de los
   * datos del usuario para mantener sincronizada, y de paso los permisos
   * quedan siempre al día apenas se abre la app.
   */
  bootstrap: () => Promise<void>;
}

export const useAuthStore = create<AuthState>()((set) => ({
  user: null,
  token: null,
  status: "loading",

  bootstrap: async () => {
    const [access, refresh] = await Promise.all([getAccessToken(), getRefreshToken()]);
    if (!access && !refresh) {
      set({ status: "unauthenticated" });
      return;
    }
    try {
      const { data } = await api.get<User>("/auth/me");
      set({ user: data, token: await getAccessToken(), status: "authenticated" });
    } catch {
      await clearTokens();
      set({ user: null, token: null, status: "unauthenticated" });
    }
  },

  login: async (identifier, password, clubSlug) => {
    const isEmail = identifier.includes("@");
    const { data } = await api.post("/auth/login", {
      ...(isEmail ? { email: identifier } : { document_id: identifier.trim() }),
      password,
      ...(clubSlug ? { club_slug: clubSlug } : {}),
    });
    await setTokens(data.access_token, data.refresh_token);
    set({
      token: data.access_token,
      user: { ...data.user, must_change_password: data.must_change_password },
      status: "authenticated",
    });
  },

  markPasswordChanged: () =>
    set((state) => ({
      user: state.user ? { ...state.user, must_change_password: false } : null,
    })),

  logout: async () => {
    const refreshToken = await getRefreshToken();
    if (refreshToken) {
      await api.post("/auth/logout", { refresh_token: refreshToken }).catch(() => {});
    }
    await clearTokens();
    set({ user: null, token: null, status: "unauthenticated" });
  },
}));

// Mantiene el store en sincronía cuando el interceptor rota el access token,
// o lo desloguea si el refresh terminó fallando.
onTokensChanged((accessToken) => {
  useAuthStore.setState((s) =>
    accessToken
      ? { token: accessToken }
      : { token: null, user: null, status: "unauthenticated" }
  );
});
