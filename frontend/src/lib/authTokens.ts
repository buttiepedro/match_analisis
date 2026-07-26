/**
 * Único dueño de los tokens en localStorage.
 *
 * Vive fuera del store de Zustand porque el interceptor de axios necesita
 * leerlos y rotarlos sin importar el store (que a su vez importa axios).
 */

const ACCESS_KEY = "access_token";
const REFRESH_KEY = "refresh_token";

type Listener = (accessToken: string | null) => void;
const listeners = new Set<Listener>();

export function getAccessToken(): string | null {
  return localStorage.getItem(ACCESS_KEY);
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_KEY);
}

export function setTokens(accessToken: string, refreshToken?: string | null): void {
  localStorage.setItem(ACCESS_KEY, accessToken);
  if (refreshToken) localStorage.setItem(REFRESH_KEY, refreshToken);
  listeners.forEach((l) => l(accessToken));
}

export function clearTokens(): void {
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
  listeners.forEach((l) => l(null));
}

export function onTokensChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
