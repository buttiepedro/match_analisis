import axios, { AxiosError, InternalAxiosRequestConfig } from "axios";
import { apiBase } from "./apiBase";
import { clearTokens, getAccessToken, getRefreshToken, setTokens } from "./authTokens";

export const baseURL = apiBase;

const api = axios.create({ baseURL });

api.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// ── Refresh de sesión ─────────────────────────────────────────────────────────

type RetriableConfig = InternalAxiosRequestConfig & { _retried?: boolean };

/**
 * Un único refresh en vuelo: si diez requests fallan a la vez con 401 (algo
 * habitual en el tablero, que dispara varias en paralelo) todas esperan al
 * mismo refresh en lugar de quemar el refresh token diez veces.
 */
let refreshInFlight: Promise<string> | null = null;

function redirectToLogin(): void {
  clearTokens();
  if (window.location.pathname !== "/login") {
    window.location.href = "/login";
  }
}

async function refreshAccessToken(): Promise<string> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) throw new Error("no refresh token");

  // Instancia limpia: usar `api` acá reentraría en este mismo interceptor.
  const { data } = await axios.post(`${baseURL}/auth/refresh`, {
    refresh_token: refreshToken,
  });
  setTokens(data.access_token);
  return data.access_token as string;
}

api.interceptors.response.use(
  (res) => res,
  async (error: AxiosError) => {
    const original = error.config as RetriableConfig | undefined;
    const status = error.response?.status;

    const isAuthCall =
      original?.url?.includes("/auth/refresh") || original?.url?.includes("/auth/login");

    if (status !== 401 || !original || original._retried || isAuthCall) {
      // Un 401 del propio refresh significa sesión terminada de verdad.
      if (status === 401 && original?.url?.includes("/auth/refresh")) redirectToLogin();
      return Promise.reject(error);
    }

    original._retried = true;

    try {
      if (!refreshInFlight) {
        refreshInFlight = refreshAccessToken().finally(() => {
          refreshInFlight = null;
        });
      }
      const newToken = await refreshInFlight;
      original.headers.Authorization = `Bearer ${newToken}`;
      return api(original);
    } catch {
      redirectToLogin();
      return Promise.reject(error);
    }
  }
);

export default api;
