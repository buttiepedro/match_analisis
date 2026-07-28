/**
 * De dónde cuelga la API.
 *
 * Cuatro formas válidas para `VITE_API_URL`, y las cuatro tienen un caso real:
 *
 * | Valor                    | Significa                                       |
 * |--------------------------|-------------------------------------------------|
 * | `""`                     | Mismo origen, en la raíz — el dev server         |
 * | `"/api"`                 | Mismo origen bajo un prefijo — producción        |
 * | `"https://api.club.com"` | Otro origen — CORS tiene que permitirlo          |
 * | `"api.club.com"`         | Otro origen, sin scheme — se asume https         |
 *
 * La última es lo que escribe alguien que copió el host de un panel de hosting,
 * y asumir http ahí sería mandar contraseñas en claro.
 *
 * Vive en su propio módulo porque lo necesitan **dos** clientes —axios y el
 * WebSocket— y si cada uno lo deduce por su cuenta terminan discrepando el día
 * que cambia el despliegue. Ya pasó: el WebSocket caía a `window.location` y
 * axios no.
 */
const raw = (import.meta.env.VITE_API_URL || "").trim().replace(/\/+$/, "");

export const apiBase = !raw || raw.startsWith("http") || raw.startsWith("/")
  ? raw
  : `https://${raw}`;

/** `true` si la API se sirve desde el mismo origen que la página. */
export const isSameOrigin = !apiBase.startsWith("http");

/**
 * Base para WebSocket, derivada de la misma configuración.
 *
 * En mismo origen hereda el scheme de la página: si la página es https el socket
 * tiene que ser wss, o el browser lo bloquea por contenido mixto.
 */
export function wsBase(): string {
  if (isSameOrigin) {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${window.location.host}${apiBase}`;
  }
  const url = new URL(apiBase);
  const proto = url.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${url.host}${url.pathname.replace(/\/+$/, "")}`;
}
