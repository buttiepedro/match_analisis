import { useEffect, useState } from "react";
import api from "./api";

/**
 * División propia del jugador logueado, o `null` si no tiene ficha de
 * jugador (caso normal para un socio). Puerto de
 * `frontend/src/lib/useOwnDivision.ts`.
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
