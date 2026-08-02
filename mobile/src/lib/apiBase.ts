/**
 * Base de la API. `EXPO_PUBLIC_*` es el prefijo que Expo embebe en el bundle
 * en tiempo de build — equivalente a `VITE_API_URL` en `frontend/`.
 *
 * Sin subdominios por club en producción (esta app es un solo binario para
 * todos los clubes, ver [[app-movil]]), así que a diferencia del frontend
 * web no hay "mismo origen": la app siempre habla con una URL absoluta.
 *
 * `10.0.2.2` es el alias que el emulador de Android usa para llegar al
 * `localhost` de la máquina que lo corre — `localhost` a secas apunta al
 * propio emulador. No aplica a iOS Simulator ni a `expo start --web`, que sí
 * resuelven `localhost` directo.
 */
export const apiBase = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:8000";
