import { useEffect, useState } from "react";
import api from "../lib/axios";
import { parseApiError } from "../lib/errors";
import { useAuthStore } from "../store/authStore";
import { useOwnDivisionId, withOwnFirst } from "../lib/useOwnDivision";
import DivisionAccordion from "../components/DivisionAccordion";

interface FixtureMatch {
  session_id: string;
  home_team: string;
  away_team: string;
  scheduled_at: string | null;
  status: string;
  home_score: number | null;
  away_score: number | null;
}

interface DivisionFixture {
  division_id: string;
  division_name: string;
  matches: FixtureMatch[];
}

function formatMatchDate(iso: string | null): string {
  if (!iso) return "Sin fecha";
  return new Date(iso).toLocaleDateString("es-AR", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Fixture del club entero: todas las divisiones, no sólo la del jugador.
 *
 * Mismo endpoint para socio y jugador — lo único que cambia es el orden de
 * las secciones. Ver [[add-portal-multidivision]].
 */
export default function Fixture() {
  const user = useAuthStore((s) => s.user);
  const ownDivisionId = useOwnDivisionId();
  const [divisions, setDivisions] = useState<DivisionFixture[]>([]);
  const [upcomingOnly, setUpcomingOnly] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user?.club_id) return;
    setLoading(true);
    api
      .get<DivisionFixture[]>(`/clubs/${user.club_id}/fixture`, {
        params: { upcoming: upcomingOnly },
      })
      .then(({ data }) => setDivisions(data))
      .catch((err) => setError(parseApiError(err, "No se pudo cargar el fixture")))
      .finally(() => setLoading(false));
  }, [user?.club_id, upcomingOnly]);

  const ordered = withOwnFirst(divisions, ownDivisionId);

  if (loading) {
    return <div className="p-6"><p className="text-ink-muted text-sm">Cargando...</p></div>;
  }

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto pb-10">
      <h1 className="text-lg font-bold text-ink mb-4">Fixture</h1>

      {error && (
        <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2 mb-3">{error}</p>
      )}

      <div className="flex gap-1 bg-surface/70 p-1 rounded-xl mb-4">
        {([
          [true, "Próximos"],
          [false, "Todos"],
        ] as const).map(([value, label]) => (
          <button
            key={label}
            onClick={() => setUpcomingOnly(value)}
            className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors duration-150 ${
              upcomingOnly === value ? "bg-brand text-white" : "text-ink-muted hover:text-ink"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

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
            {d.matches.length === 0 ? (
              <p className="text-ink-muted text-sm px-4 py-4">
                {upcomingOnly ? "Sin partidos próximos." : "Sin partidos cargados."}
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {d.matches.map((m) => (
                  <li key={m.session_id} className="flex items-center gap-3 px-4 py-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-ink truncate">
                        {m.home_team} vs {m.away_team}
                      </p>
                      <p className="text-xs text-ink-muted">{formatMatchDate(m.scheduled_at)}</p>
                    </div>
                    {m.status === "finished" ? (
                      <span className="text-sm font-bold text-ink tabular-nums shrink-0">
                        {m.home_score} - {m.away_score}
                      </span>
                    ) : m.status !== "scheduled" ? (
                      <span className="text-[11px] text-brand shrink-0">en juego</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </DivisionAccordion>
        ))
      )}
    </div>
  );
}
