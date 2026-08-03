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
  tournament_id: string;
  tournament_name: string;
  season: string | null;
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

function inRange(iso: string | null, from: string, to: string): boolean {
  if (!iso) return false;
  const day = iso.slice(0, 10);
  if (from && day < from) return false;
  if (to && day > to) return false;
  return true;
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
  const [divisionFilter, setDivisionFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [showHistorical, setShowHistorical] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Un rango de fechas puede pedir partidos ya jugados, así que mientras esté
  // activo pisa el toggle Próximos/Todos en vez de convivir con él — filtrar
  // por marzo y que "Próximos" igual tape los partidos de marzo ya jugados
  // sería un filtro que contradice al otro.
  const dateActive = Boolean(dateFrom || dateTo);
  const effectiveUpcoming = dateActive ? false : upcomingOnly;

  useEffect(() => {
    if (!user?.club_id) return;
    setLoading(true);
    api
      .get<DivisionFixture[]>(`/clubs/${user.club_id}/fixture`, {
        params: { upcoming: effectiveUpcoming },
      })
      .then(({ data }) => setDivisions(data))
      .catch((err) => setError(parseApiError(err, "No se pudo cargar el fixture")))
      .finally(() => setLoading(false));
  }, [user?.club_id, effectiveUpcoming]);

  // En modo "Todos" (sin filtro de fecha) el historial completo del club
  // queda mezclado en una sola lista — por defecto sólo mostramos la
  // temporada más reciente, con un toggle para ver años anteriores.
  const latestSeason = divisions
    .flatMap((d) => d.matches)
    .reduce<string | null>((max, m) => (m.season && (!max || m.season > max) ? m.season : max), null);
  const seasonSplitActive = !dateActive && !upcomingOnly && Boolean(latestSeason) && !showHistorical;

  const ordered = withOwnFirst(divisions, ownDivisionId)
    .filter((d) => !divisionFilter || d.division_id === divisionFilter)
    .map((d) => ({
      ...d,
      matches: dateActive
        ? d.matches.filter((m) => inRange(m.scheduled_at, dateFrom, dateTo))
        : seasonSplitActive
        ? d.matches.filter((m) => m.season === latestSeason)
        : d.matches,
    }));

  if (loading) {
    return <div className="p-6"><p className="text-ink-muted text-sm">Cargando...</p></div>;
  }

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto pb-10">
      <h1 className="text-lg font-bold text-ink mb-4">Fixture</h1>

      {error && (
        <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2 mb-3">{error}</p>
      )}

      {!dateActive && (
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
      )}

      {!dateActive && !upcomingOnly && latestSeason && (
        <button
          onClick={() => setShowHistorical((v) => !v)}
          className="w-full text-left text-xs text-ink-muted hover:text-ink bg-surface-strong/50 hover:bg-surface-strong rounded-lg px-3 py-2 mb-3 transition-colors"
        >
          {showHistorical
            ? `▲ Mostrar sólo temporada ${latestSeason}`
            : `▼ Ver también temporadas anteriores a ${latestSeason}`}
        </button>
      )}

      {divisions.length > 1 && (
        <div className="flex gap-2 mb-3 flex-wrap">
          <button
            onClick={() => setDivisionFilter("")}
            className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
              divisionFilter === "" ? "bg-brand text-white" : "bg-surface-strong text-ink-soft hover:bg-surface-hover"
            }`}
          >
            Todas
          </button>
          {divisions.map((d) => (
            <button
              key={d.division_id}
              onClick={() => setDivisionFilter(d.division_id)}
              className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
                divisionFilter === d.division_id ? "bg-brand text-white" : "bg-surface-strong text-ink-soft hover:bg-surface-hover"
              }`}
            >
              {d.division_name}
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-end gap-2 mb-4">
        <div>
          <label className="block text-[11px] text-ink-muted mb-1">Desde</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="bg-surface-strong text-ink text-sm rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-brand-ring"
          />
        </div>
        <div>
          <label className="block text-[11px] text-ink-muted mb-1">Hasta</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="bg-surface-strong text-ink text-sm rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-brand-ring"
          />
        </div>
        {dateActive && (
          <button
            onClick={() => { setDateFrom(""); setDateTo(""); }}
            className="pressable text-xs text-ink-muted hover:text-ink px-2 py-2"
          >
            Limpiar fechas
          </button>
        )}
      </div>

      {divisions.length === 0 ? (
        <p className="text-ink-muted text-sm py-8 text-center">
          El club todavía no tiene divisiones cargadas.
        </p>
      ) : ordered.length === 0 ? (
        <p className="text-ink-muted text-sm py-8 text-center">
          Ninguna división coincide con este filtro.
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
                {dateActive
                  ? "Sin partidos en ese rango de fechas."
                  : upcomingOnly
                  ? "Sin partidos próximos."
                  : seasonSplitActive
                  ? `Sin partidos en la temporada ${latestSeason}.`
                  : "Sin partidos cargados."}
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {d.matches.map((m) => (
                  <li key={m.session_id} className="flex items-center gap-3 px-4 py-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-ink truncate">
                        {m.home_team} vs {m.away_team}
                      </p>
                      <p className="text-xs text-ink-muted truncate">
                        {formatMatchDate(m.scheduled_at)}
                        <span className="ml-1.5">
                          · {m.tournament_name}{m.season ? ` ${m.season}` : ""}
                        </span>
                      </p>
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
