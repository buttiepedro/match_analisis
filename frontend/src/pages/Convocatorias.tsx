import { useEffect, useState } from "react";
import api from "../lib/axios";
import { parseApiError } from "../lib/errors";
import { useAuthStore } from "../store/authStore";
import { useOwnDivisionId, withOwnFirst } from "../lib/useOwnDivision";
import DivisionAccordion from "../components/DivisionAccordion";

interface SquadMember {
  player_id: string;
  player_name: string;
  position: string | null;
  status: string;
}

interface DivisionConvocatoria {
  division_id: string;
  division_name: string;
  session_id: string | null;
  home_team: string | null;
  away_team: string | null;
  scheduled_at: string | null;
  members: SquadMember[];
  reason: "sin_convocatoria" | null;
}

const STATUS_LABEL: Record<string, string> = {
  convocado: "Convocado",
  confirmado: "Confirmado",
  baja: "Baja",
};

const STATUS_CLASS: Record<string, string> = {
  convocado: "bg-sky-100 text-sky-700",
  confirmado: "bg-brand-soft text-brand",
  baja: "bg-red-50 text-red-600",
};

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
 * Citados de todas las divisiones para el próximo partido con convocatoria
 * cargada. Una división sin convocatoria se marca como tal, no se oculta ni
 * rompe la pantalla — a diferencia del mensaje de convocatoria de un partido
 * puntual, acá el pedido es "mostrame lo que haya". Ver [[add-portal-multidivision]].
 */
export default function Convocatorias() {
  const user = useAuthStore((s) => s.user);
  const ownDivisionId = useOwnDivisionId();
  const [divisions, setDivisions] = useState<DivisionConvocatoria[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user?.club_id) return;
    api
      .get<DivisionConvocatoria[]>(`/clubs/${user.club_id}/convocatorias`)
      .then(({ data }) => setDivisions(data))
      .catch((err) => setError(parseApiError(err, "No se pudieron cargar los citados")))
      .finally(() => setLoading(false));
  }, [user?.club_id]);

  const ordered = withOwnFirst(divisions, ownDivisionId);

  if (loading) {
    return <div className="p-6"><p className="text-ink-muted text-sm">Cargando...</p></div>;
  }

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto pb-10">
      <h1 className="text-lg font-bold text-ink mb-4">Citados</h1>

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
            badge={
              d.reason ? (
                <span className="text-[11px] text-ink-faint mr-1">Sin convocatoria</span>
              ) : (
                <span className="text-[11px] text-ink-faint mr-1">{d.members.length} citados</span>
              )
            }
          >
            {d.reason ? (
              <p className="text-ink-muted text-sm px-4 py-4">
                Todavía no hay convocatoria cargada para el próximo partido.
              </p>
            ) : (
              <>
                <p className="text-xs text-ink-muted px-4 pt-3">
                  {d.home_team} vs {d.away_team} · {formatMatchDate(d.scheduled_at)}
                </p>
                <ul className="divide-y divide-line mt-1">
                  {d.members.map((m) => (
                    <li key={m.player_id} className="flex items-center gap-3 px-4 py-2.5">
                      <span className="flex-1 text-sm text-ink truncate">{m.player_name}</span>
                      {m.position && (
                        <span className="text-[11px] text-ink-faint hidden sm:block">
                          {m.position}
                        </span>
                      )}
                      <span
                        className={`text-[11px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${
                          STATUS_CLASS[m.status] ?? "bg-surface-strong text-ink-soft"
                        }`}
                      >
                        {STATUS_LABEL[m.status] ?? m.status}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </DivisionAccordion>
        ))
      )}
    </div>
  );
}
