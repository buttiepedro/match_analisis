import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../lib/axios";
import { parseApiError } from "../lib/errors";
import { useAuthStore } from "../store/authStore";
import { TRAINING_TYPE_LABEL, TrainingType } from "../lib/attendance";

interface TodayTraining {
  id: string;
  division_id: string;
  division_name: string;
  type: string;
  location: string | null;
  attendance_loaded: boolean;
}

interface UpcomingMatch {
  id: string;
  home_team: string;
  away_team: string;
  scheduled_at: string | null;
  status: string;
  division_name: string;
}

interface TodayAlert {
  kind: string;
  label: string;
  detail: string;
  count: number;
}

interface Today {
  date: string;
  trainings: TodayTraining[];
  upcoming_matches: UpcomingMatch[];
  alerts: TodayAlert[];
}

/** Ámbar para lo que hay que mirar, rojo para lo que ya venció. */
const ALERT_CLASS: Record<string, string> = {
  no_disponibles: "bg-orange-50 border-orange-200 text-orange-700",
  apto_vencido: "bg-red-50 border-red-200 text-red-700",
  apto_por_vencer: "bg-amber-50 border-amber-200 text-amber-700",
  roja_sin_sancion: "bg-amber-50 border-amber-200 text-amber-700",
  en_riesgo: "bg-red-50 border-red-200 text-red-700",
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

export default function Hoy() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const [data, setData] = useState<Today | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user?.club_id) return;
    api
      .get<Today>(`/clubs/${user.club_id}/today`)
      .then(({ data }) => setData(data))
      .catch((err) => setError(parseApiError(err, "No se pudo cargar el día")))
      .finally(() => setLoading(false));
  }, [user?.club_id]);

  if (loading) {
    return <div className="p-6"><p className="text-ink-muted text-sm">Cargando...</p></div>;
  }

  const today = new Date().toLocaleDateString("es-AR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  const nothing =
    data && !data.trainings.length && !data.upcoming_matches.length && !data.alerts.length;

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto pb-10">
      <p className="text-xs text-ink-muted uppercase tracking-wider">Hoy</p>
      <h1 className="text-lg font-bold text-ink capitalize mb-5">{today}</h1>

      {error && (
        <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2 mb-4">{error}</p>
      )}

      {nothing && (
        <div className="bg-surface/70 rounded-xl px-4 py-8 text-center">
          <p className="text-ink-muted text-sm">Sin entrenamientos ni partidos próximos.</p>
          <p className="text-ink-faint text-xs mt-1">
            Un día tranquilo también es información.
          </p>
        </div>
      )}

      {data && data.trainings.length > 0 && (
        <section className="mb-5">
          <p className="text-xs font-bold text-ink-muted uppercase tracking-wider mb-2">
            Entrenamientos de hoy
          </p>
          <ul className="space-y-2">
            {data.trainings.map((t) => (
              <li key={t.id}>
                <button
                  onClick={() => navigate(`/trainings/${t.id}`)}
                  className="pressable w-full flex items-center gap-3 bg-surface hover:bg-surface-hover rounded-xl px-4 py-3 text-left transition-colors duration-150"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-ink truncate">{t.division_name}</p>
                    <p className="text-xs text-ink-muted">
                      {TRAINING_TYPE_LABEL[t.type as TrainingType] ?? t.type}
                      {t.location && ` · ${t.location}`}
                    </p>
                  </div>
                  <span
                    className={`text-[11px] font-semibold px-2 py-1 rounded-lg shrink-0 ${
                      t.attendance_loaded
                        ? "bg-brand-soft text-brand"
                        : "bg-amber-100 text-amber-700"
                    }`}
                  >
                    {t.attendance_loaded ? "Asistencia lista" : "Tomar asistencia"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {data && data.upcoming_matches.length > 0 && (
        <section className="mb-5">
          <p className="text-xs font-bold text-ink-muted uppercase tracking-wider mb-2">
            Próximos partidos
          </p>
          <ul className="space-y-2">
            {data.upcoming_matches.map((m) => (
              <li key={m.id}>
                <button
                  onClick={() => navigate(`/sessions/${m.id}/lineup`)}
                  className="pressable w-full flex items-center gap-3 bg-surface hover:bg-surface-hover rounded-xl px-4 py-3 text-left transition-colors duration-150"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-ink truncate">
                      {m.home_team} vs {m.away_team}
                    </p>
                    <p className="text-xs text-ink-muted">
                      {m.division_name} · {formatMatchDate(m.scheduled_at)}
                    </p>
                  </div>
                  {m.status !== "scheduled" && (
                    <span className="text-[11px] text-brand shrink-0">en juego</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {data && data.alerts.length > 0 && (
        <section>
          <p className="text-xs font-bold text-ink-muted uppercase tracking-wider mb-2">
            Para mirar
          </p>
          <ul className="space-y-2">
            {data.alerts.map((a) => (
              <li
                key={a.kind}
                className={`border rounded-xl px-4 py-3 ${ALERT_CLASS[a.kind] ?? "bg-surface border-line text-ink-soft"}`}
              >
                <p className="text-sm font-semibold">{a.label}</p>
                {a.detail && <p className="text-xs opacity-80 mt-0.5">{a.detail}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
