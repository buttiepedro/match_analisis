import { useEffect, useState } from "react";
import api from "../lib/axios";
import { parseApiError } from "../lib/errors";
import { useAuthStore } from "../store/authStore";
import { useOwnDivisionId, withOwnFirst } from "../lib/useOwnDivision";
import DivisionAccordion from "../components/DivisionAccordion";

interface StandingRow {
  team: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  points_for: number;
  points_against: number;
  difference: number;
  bonus: number;
  points: number;
}

interface DivisionStandings {
  division_id: string;
  division_name: string;
  tournament_id: string | null;
  rows: StandingRow[];
}

const COLUMNS: { key: keyof StandingRow; label: string }[] = [
  { key: "played", label: "PJ" },
  { key: "won", label: "G" },
  { key: "drawn", label: "E" },
  { key: "lost", label: "P" },
  { key: "difference", label: "Dif" },
  { key: "bonus", label: "B" },
  { key: "points", label: "Pts" },
];

/**
 * Tabla de posiciones de todas las divisiones del club.
 *
 * Una división sin torneo activo se muestra igual, con estado vacío: que no
 * tenga torneo cargado hoy es información, no un error que se oculta.
 * Ver [[add-portal-multidivision]].
 */
export default function Standings() {
  const user = useAuthStore((s) => s.user);
  const ownDivisionId = useOwnDivisionId();
  const [divisions, setDivisions] = useState<DivisionStandings[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user?.club_id) return;
    api
      .get<DivisionStandings[]>(`/clubs/${user.club_id}/standings`)
      .then(({ data }) => setDivisions(data))
      .catch((err) => setError(parseApiError(err, "No se pudo cargar la tabla")))
      .finally(() => setLoading(false));
  }, [user?.club_id]);

  const ordered = withOwnFirst(divisions, ownDivisionId);

  if (loading) {
    return <div className="p-6"><p className="text-ink-muted text-sm">Cargando...</p></div>;
  }

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto pb-10">
      <h1 className="text-lg font-bold text-ink mb-4">Tablas de posiciones</h1>

      {error && (
        <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2 mb-3">{error}</p>
      )}

      {ordered.length === 0 ? (
        <p className="text-ink-muted text-sm py-8 text-center">
          El club todavía no tiene divisiones cargadas.
        </p>
      ) : (
        ordered.map((d, i) => (
          <DivisionAccordion
            key={d.division_id}
            divisionId={d.division_id}
            title={d.division_name}
            defaultOpen={i === 0}
          >
            {!d.tournament_id ? (
              <p className="text-ink-muted text-sm px-4 py-4">
                Esta división no tiene torneo activo cargado.
              </p>
            ) : d.rows.length === 0 ? (
              <p className="text-ink-muted text-sm px-4 py-4">
                Todavía no hay partidos terminados en este torneo.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[11px] text-ink-faint uppercase tracking-wider">
                      <th className="text-left font-semibold px-4 py-2">Equipo</th>
                      {COLUMNS.map((c) => (
                        <th key={c.key} className="text-right font-semibold px-2 py-2 tabular-nums">
                          {c.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {d.rows.map((r, idx) => (
                      <tr key={r.team}>
                        <td className="px-4 py-2 text-ink truncate max-w-[9rem]">
                          <span className="text-ink-faint tabular-nums mr-1.5">{idx + 1}</span>
                          {r.team}
                        </td>
                        {COLUMNS.map((c) => (
                          <td
                            key={c.key}
                            className={`text-right px-2 py-2 tabular-nums ${
                              c.key === "points" ? "font-bold text-ink" : "text-ink-soft"
                            }`}
                          >
                            {r[c.key]}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </DivisionAccordion>
        ))
      )}
    </div>
  );
}
