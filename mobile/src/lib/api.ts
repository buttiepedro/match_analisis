import axios, { AxiosError, InternalAxiosRequestConfig } from "axios";
import { router } from "expo-router";
import { apiBase } from "./apiBase";
import { clearTokens, getAccessToken, getRefreshToken, setTokens } from "./authTokens";

/**
 * Mismo patrón que `frontend/src/lib/axios.ts` — se **porta**, no se
 * reinventa: [[offline-resilience]] ya resolvió el refresh-único-en-vuelo
 * ahí. Ver [[app-movil]].
 */
export const baseURL = apiBase;

const api = axios.create({ baseURL });

api.interceptors.request.use(async (config) => {
  const token = await getAccessToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

type RetriableConfig = InternalAxiosRequestConfig & { _retried?: boolean };

/**
 * Un único refresh en vuelo: si varios requests fallan a la vez con 401,
 * todas esperan al mismo refresh en lugar de quemar el refresh token varias
 * veces.
 */
let refreshInFlight: Promise<string> | null = null;

function redirectToLogin(): void {
  clearTokens().finally(() => router.replace("/login"));
}

async function refreshAccessToken(): Promise<string> {
  const refreshToken = await getRefreshToken();
  if (!refreshToken) throw new Error("no refresh token");

  // Instancia limpia: usar `api` acá reentraría en este mismo interceptor.
  const { data } = await axios.post(`${baseURL}/auth/refresh`, {
    refresh_token: refreshToken,
  });
  await setTokens(data.access_token);
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
