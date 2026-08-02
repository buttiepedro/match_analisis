import { useEffect, useState } from "react";
import api from "./axios";

/**
 * División propia del jugador logueado, o `null` si no tiene ficha de jugador.
 *
 * El 404 de `/me/player` es el caso normal para un socio, no un error — así lo
 * tratan también PlayerPortal y MemberPortal. Sirve para ordenar el portal
 * multidivisión: el jugador ve su división primero, el socio ve el orden del
 * club (que ya es el que devuelve la API).
 */
export function useOwnDivisionId(): string | null {
  const [divisionId, setDivisionId] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ division_id: string }>("/me/player")
      .then(({ data }) => setDivisionId(data.division_id))
      .catch(() => setDivisionId(null));
  }, []);

  return divisionId;
}

/** Reordena para que la propia división quede primera. `sort` es estable. */
export function withOwnFirst<T extends { division_id: string }>(
  items: T[],
  ownDivisionId: string | null
): T[] {
  if (!ownDivisionId) return items;
  return [...items].sort((a, b) => {
    if (a.division_id === ownDivisionId) return -1;
    if (b.division_id === ownDivisionId) return 1;
    return 0;
  });
}
