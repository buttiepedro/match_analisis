import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

/**
 * Único dueño de los tokens, en el Keychain/Keystore del dispositivo —
 * no `AsyncStorage`, que no cifra. Un refresh token es tan sensible en el
 * celular como en el navegador. Mismo rol que `frontend/src/lib/authTokens.ts`:
 * el interceptor de `api.ts` los lee y rota sin pasar por el store de Zustand.
 *
 * `expo-secure-store` **no soporta web** (no hay Keychain/Keystore en un
 * browser — es la documentación oficial de Expo, no un bug de esta app).
 * Acá importa poco: la v1 de esta app no se publica para web, `expo start
 * --web` es únicamente la herramienta de verificación de esta sesión (sin
 * macOS ni Android SDK a mano para un simulador — ver [[app-movil]], "Qué
 * se verificó y qué no"). El `localStorage` de la rama web es sólo para
 * que esa verificación funcione, no para producción.
 */

const ACCESS_KEY = "access_token";
const REFRESH_KEY = "refresh_token";

type Listener = (accessToken: string | null) => void;
const listeners = new Set<Listener>();

const isWeb = Platform.OS === "web";

async function readItem(key: string): Promise<string | null> {
  return isWeb ? localStorage.getItem(key) : SecureStore.getItemAsync(key);
}

async function writeItem(key: string, value: string): Promise<void> {
  if (isWeb) {
    localStorage.setItem(key, value);
  } else {
    await SecureStore.setItemAsync(key, value);
  }
}

async function removeItem(key: string): Promise<void> {
  if (isWeb) {
    localStorage.removeItem(key);
  } else {
    await SecureStore.deleteItemAsync(key);
  }
}

export function getAccessToken(): Promise<string | null> {
  return readItem(ACCESS_KEY);
}

export function getRefreshToken(): Promise<string | null> {
  return readItem(REFRESH_KEY);
}

export async function setTokens(accessToken: string, refreshToken?: string | null): Promise<void> {
  await writeItem(ACCESS_KEY, accessToken);
  if (refreshToken) await writeItem(REFRESH_KEY, refreshToken);
  listeners.forEach((l) => l(accessToken));
}

export async function clearTokens(): Promise<void> {
  await removeItem(ACCESS_KEY);
  await removeItem(REFRESH_KEY);
  listeners.forEach((l) => l(null));
}

export function onTokensChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
