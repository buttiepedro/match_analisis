import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import api from "../lib/axios";
import { parseApiError } from "../lib/errors";

interface LineupEntry {
  jersey_number: number;
  position: string | null;
  player_name: string;
  is_me: boolean;
}

interface MyLineup {
  session_id: string;
  home_team: string;
  away_team: string;
  scheduled_at: string | null;
  entries: LineupEntry[];
}

function formatMatchDate(iso: string | null): string {
  if (!iso) return "Sin fecha";
  return new Date(iso).toLocaleDateString("es-AR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * "Fijate si estás" — el destino del link de la notificación de formación.
 *
 * De sólo lectura, a propósito: es lo que un jugador necesita ver, no el
 * editor del cuerpo técnico (que exige `partido.lineup`, capacidad que
 * ningún jugador tiene).
 */
export default function MiFormacion() {
  const { id: sessionId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<MyLineup | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!sessionId) return;
    api
      .get<MyLineup>(`/me/player/sessions/${sessionId}/lineup`)
      .then(({ data }) => setData(data))
      .catch((err) => setError(parseApiError(err, "No se pudo cargar la formación")))
      .finally(() => setLoading(false));
  }, [sessionId]);

  if (loading) {
    return <div className="p-6"><p className="text-ink-muted text-sm">Cargando...</p></div>;
  }

  if (error || !data) {
    return (
      <div className="p-4 md:p-6 max-w-md mx-auto">
        <button
          onClick={() => navigate("/notificaciones")}
          className="pressable text-ink-muted hover:text-ink text-sm mb-3 transition-colors duration-150"
        >
          ← Volver
        </button>
        <p className="text-sm text-ink-soft bg-surface rounded-xl px-4 py-3">
          {error || "No encontramos esa formación."}
        </p>
      </div>
    );
  }

  const me = data.entries.find((e) => e.is_me);
  const titulares = data.entries.filter((e) => e.jersey_number <= 15);
  const suplentes = data.entries.filter((e) => e.jersey_number > 15);

  return (
    <div className="p-4 md:p-6 max-w-md mx-auto pb-10">
      <button
        onClick={() => navigate("/notificaciones")}
        className="pressable text-ink-muted hover:text-ink text-sm mb-3 transition-colors duration-150"
      >
        ← Volver
      </button>

      <h1 className="text-lg font-bold text-ink">
        {data.home_team} vs {data.away_team}
      </h1>
      <p className="text-sm text-ink-muted mb-4 capitalize">{formatMatchDate(data.scheduled_at)}</p>

      {me ? (
        <div className="bg-brand-soft border border-brand-ring rounded-xl px-4 py-3 mb-4">
          <p className="text-sm text-ink">
            Estás citado — <span className="font-bold">#{me.jersey_number}</span>
            {me.position && <> · {me.position}</>}
          </p>
        </div>
      ) : (
        <div className="bg-surface rounded-xl px-4 py-3 mb-4">
          <p className="text-sm text-ink-soft">No estás en esta formación.</p>
        </div>
      )}

      <p className="text-xs font-bold text-ink-muted uppercase tracking-wider mb-2">Titulares</p>
      <ul className="bg-surface rounded-xl divide-y divide-line overflow-hidden mb-4">
        {titulares.map((e) => (
          <li
            key={e.jersey_number}
            className={`flex items-center gap-3 px-4 py-2.5 ${e.is_me ? "bg-brand-soft/60" : ""}`}
          >
            <span className="w-6 text-sm font-bold text-ink-muted tabular-nums">{e.jersey_number}</span>
            <span className="flex-1 text-sm text-ink truncate">{e.player_name}</span>
            {e.position && <span className="text-xs text-ink-faint">{e.position}</span>}
          </li>
        ))}
      </ul>

      {suplentes.length > 0 && (
        <>
          <p className="text-xs font-bold text-ink-muted uppercase tracking-wider mb-2">Suplentes</p>
          <ul className="bg-surface rounded-xl divide-y divide-line overflow-hidden">
            {suplentes.map((e) => (
              <li
                key={e.jersey_number}
                className={`flex items-center gap-3 px-4 py-2.5 ${e.is_me ? "bg-brand-soft/60" : ""}`}
              >
                <span className="w-6 text-sm font-bold text-ink-muted tabular-nums">{e.jersey_number}</span>
                <span className="flex-1 text-sm text-ink truncate">{e.player_name}</span>
                {e.position && <span className="text-xs text-ink-faint">{e.position}</span>}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
