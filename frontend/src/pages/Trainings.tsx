import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../lib/axios";
import { parseApiError } from "../lib/errors";
import { useAuthStore } from "../store/authStore";
import {
  TRAINING_TYPES,
  TRAINING_TYPE_LABEL,
  TrainingType,
  formatShortDate,
  percentColor,
} from "../lib/attendance";

interface Division {
  id: string;
  name: string;
}

interface Training {
  id: string;
  division_id: string;
  date: string;
  type: string;
  notes: string | null;
  present_count: number;
  total_count: number;
}

interface PlayerSummary {
  player_id: string;
  player_name: string;
  attended: number;
  total: number;
  percent: number;
  current_absence_streak: number;
  at_risk: boolean;
}

interface Summary {
  division_id: string;
  days: number;
  trainings_count: number;
  average_percent: number;
  players: PlayerSummary[];
}

const WINDOWS = [30, 90] as const;

function todayISO(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

export default function Trainings() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const canEdit =
    user?.role === "club_admin" || user?.role === "superadmin" || user?.role === "match_director";

  const [divisions, setDivisions] = useState<Division[]>([]);
  const [divisionId, setDivisionId] = useState("");
  const [trainings, setTrainings] = useState<Training[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [days, setDays] = useState<number>(30);
  const [tab, setTab] = useState<"lista" | "asistencia">("lista");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ date: todayISO(), type: "entrenamiento" as TrainingType });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!user?.club_id) return;
    api
      .get<Division[]>(`/clubs/${user.club_id}/divisions`)
      .then(({ data }) => {
        setDivisions(data);
        setDivisionId((current) => current || data[0]?.id || "");
      })
      .catch((err) => setError(parseApiError(err, "No se pudieron cargar las divisiones")))
      .finally(() => setLoading(false));
  }, [user?.club_id]);

  useEffect(() => {
    if (!divisionId) return;
    setError("");
    api
      .get<Training[]>(`/divisions/${divisionId}/trainings`)
      .then(({ data }) => setTrainings(data))
      .catch((err) => setError(parseApiError(err, "No se pudieron cargar los entrenamientos")));
  }, [divisionId]);

  useEffect(() => {
    if (!divisionId) return;
    api
      .get<Summary>(`/divisions/${divisionId}/attendance/summary`, { params: { days } })
      .then(({ data }) => setSummary(data))
      .catch(() => setSummary(null));
  }, [divisionId, days]);

  const atRisk = useMemo(
    () => (summary?.players ?? []).filter((p) => p.at_risk),
    [summary]
  );

  const createTraining = async () => {
    if (!divisionId) return;
    setSubmitting(true);
    setError("");
    try {
      const { data } = await api.post<Training>(`/divisions/${divisionId}/trainings`, form);
      setCreating(false);
      setForm({ date: todayISO(), type: "entrenamiento" });
      navigate(`/trainings/${data.id}`);
    } catch (err) {
      setError(parseApiError(err, "No se pudo crear el entrenamiento"));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <div className="p-6"><p className="text-gray-400 text-sm">Cargando...</p></div>;
  }

  if (divisions.length === 0) {
    return (
      <div className="p-6">
        <h1 className="text-lg font-bold text-white mb-2">Entrenamientos</h1>
        <p className="text-gray-400 text-sm">
          No hay divisiones cargadas todavía. Creá una desde Config para empezar a tomar asistencia.
        </p>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto pb-24">
      <h1 className="text-lg font-bold text-white mb-4">Entrenamientos</h1>

      <select
        value={divisionId}
        onChange={(e) => setDivisionId(e.target.value)}
        className="w-full bg-gray-800 text-white text-sm rounded-xl px-3 py-2.5 mb-4 outline-none focus:ring-2 focus:ring-green-600"
      >
        {divisions.map((d) => (
          <option key={d.id} value={d.id}>{d.name}</option>
        ))}
      </select>

      <div className="flex gap-1 bg-gray-800/60 p-1 rounded-xl mb-4">
        {(["lista", "asistencia"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors duration-150 ${
              tab === t ? "bg-green-700 text-white" : "text-gray-400 hover:text-white"
            }`}
          >
            {t === "lista" ? "Entrenamientos" : "Asistencia"}
          </button>
        ))}
      </div>

      {error && (
        <p className="text-red-400 text-xs mb-3 bg-red-950/40 rounded-lg px-3 py-2">{error}</p>
      )}

      {tab === "lista" ? (
        <>
          {canEdit && (
            <div className="mb-4">
              {creating ? (
                <div className="bg-gray-800 rounded-xl p-4 space-y-3">
                  <p className="text-sm font-semibold text-white">Nuevo entrenamiento</p>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="date"
                      value={form.date}
                      onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                      className="bg-gray-700 text-white text-sm rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-green-600"
                    />
                    <select
                      value={form.type}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, type: e.target.value as TrainingType }))
                      }
                      className="bg-gray-700 text-white text-sm rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-green-600"
                    >
                      {TRAINING_TYPES.map((t) => (
                        <option key={t} value={t}>{TRAINING_TYPE_LABEL[t]}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={createTraining}
                      disabled={submitting}
                      className="pressable text-sm bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white px-4 py-2 rounded-lg font-medium"
                    >
                      {submitting ? "Creando..." : "Crear y tomar asistencia"}
                    </button>
                    <button
                      onClick={() => setCreating(false)}
                      className="pressable text-sm text-gray-400 hover:text-white px-4 py-2 rounded-lg"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setCreating(true)}
                  className="pressable w-full bg-green-700 hover:bg-green-600 text-white text-sm font-semibold py-3 rounded-xl"
                >
                  + Nuevo entrenamiento
                </button>
              )}
            </div>
          )}

          {trainings.length === 0 ? (
            <p className="text-gray-500 text-sm py-8 text-center">
              Todavía no hay entrenamientos en esta división.
            </p>
          ) : (
            <ul className="space-y-2">
              {trainings.map((t) => {
                const percent = t.total_count
                  ? Math.round((t.present_count / t.total_count) * 100)
                  : null;
                return (
                  <li key={t.id}>
                    <button
                      onClick={() => navigate(`/trainings/${t.id}`)}
                      className="pressable w-full flex items-center gap-3 bg-gray-800 hover:bg-gray-700/70 rounded-xl px-4 py-3 text-left transition-colors duration-150"
                    >
                      <div className="w-11 shrink-0">
                        <p className="text-sm font-bold text-white tabular-nums">
                          {formatShortDate(t.date)}
                        </p>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-white truncate">
                          {TRAINING_TYPE_LABEL[t.type as TrainingType] ?? t.type}
                        </p>
                        <p className="text-xs text-gray-500">
                          {t.total_count === 0
                            ? "Sin asistencia cargada"
                            : `${t.present_count} de ${t.total_count} presentes`}
                        </p>
                      </div>
                      {percent !== null && (
                        <span className={`text-sm font-bold tabular-nums ${percentColor(percent)}`}>
                          {percent}%
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      ) : (
        <>
          <div className="flex gap-2 mb-4">
            {WINDOWS.map((w) => (
              <button
                key={w}
                onClick={() => setDays(w)}
                className={`pressable px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors duration-150 ${
                  days === w ? "bg-gray-700 text-white" : "bg-gray-800 text-gray-400"
                }`}
              >
                {w} días
              </button>
            ))}
            <span className="ml-auto self-center text-xs text-gray-500">
              {summary?.trainings_count ?? 0} entrenamientos · promedio{" "}
              <span className={percentColor(summary?.average_percent ?? 0)}>
                {summary?.average_percent ?? 0}%
              </span>
            </span>
          </div>

          {atRisk.length > 0 && (
            <div className="bg-red-950/40 border border-red-900/60 rounded-xl px-4 py-3 mb-4">
              <p className="text-xs font-bold text-red-300 uppercase tracking-wider mb-1">
                En riesgo ({atRisk.length})
              </p>
              <p className="text-xs text-red-200/80">
                {atRisk.map((p) => p.player_name).join(" · ")}
              </p>
              <p className="text-[11px] text-red-200/50 mt-1">
                3 ausencias seguidas o menos de 50% de asistencia.
              </p>
            </div>
          )}

          {!summary || summary.players.length === 0 ? (
            <p className="text-gray-500 text-sm py-8 text-center">
              Sin datos de asistencia en esta ventana.
            </p>
          ) : (
            <ul className="bg-gray-800/50 rounded-xl divide-y divide-gray-700/50">
              {summary.players.map((p, i) => (
                <li key={p.player_id}>
                  <button
                    onClick={() => navigate(`/squad/${p.player_id}`)}
                    className="pressable w-full flex items-center gap-3 px-4 py-2.5 text-left"
                  >
                    <span className="w-5 text-xs text-gray-600 tabular-nums">{i + 1}</span>
                    <span className="flex-1 text-sm text-white truncate">
                      {p.player_name}
                      {p.at_risk && <span className="ml-2 text-xs text-red-400">en riesgo</span>}
                    </span>
                    <span className="text-xs text-gray-500 tabular-nums">
                      {p.attended}/{p.total}
                    </span>
                    <span
                      className={`w-11 text-right text-sm font-bold tabular-nums ${percentColor(p.percent)}`}
                    >
                      {p.total ? `${p.percent}%` : "—"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
