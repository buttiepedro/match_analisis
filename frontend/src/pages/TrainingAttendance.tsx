import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import api from "../lib/axios";
import { parseApiError } from "../lib/errors";
import { putQueued } from "../lib/offlineQueue";
import { useAuthStore } from "../store/authStore";
import {
  ATTENDANCE_STATUSES,
  ATTENDED,
  AttendanceStatus,
  DEFAULT_STATUS,
  STATUS_CLASS,
  STATUS_LABEL,
  STATUS_SHORT,
  TRAINING_TYPE_LABEL,
  TrainingType,
  formatLongDate,
} from "../lib/attendance";

interface Training {
  id: string;
  division_id: string;
  date: string;
  type: string;
  notes: string | null;
  location: string | null;
}

interface AttendanceRow {
  player_id: string;
  player_name: string;
  position: string | null;
  status: string | null;
  notes: string | null;
}

type SaveState = "idle" | "saving" | "saved" | "queued" | "error";

export default function TrainingAttendance() {
  const { id: trainingId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const canEditLocation = useAuthStore((s) =>
    s.user?.permissions?.includes("entrenamiento.gestionar")
  );

  const [training, setTraining] = useState<Training | null>(null);
  const [rows, setRows] = useState<AttendanceRow[]>([]);
  const [statuses, setStatuses] = useState<Record<string, AttendanceStatus>>({});
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [error, setError] = useState("");
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [editingLocation, setEditingLocation] = useState(false);
  const [locationDraft, setLocationDraft] = useState("");
  const [savingLocation, setSavingLocation] = useState(false);

  /** Se limpia al desmontar para no marcar "guardado" sobre una pantalla que ya no está. */
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!trainingId) return;
    Promise.all([
      api.get<Training>(`/trainings/${trainingId}`),
      api.get<AttendanceRow[]>(`/trainings/${trainingId}/attendance`),
    ])
      .then(([tRes, aRes]) => {
        setTraining(tRes.data);
        setRows(aRes.data);
        setStatuses(
          Object.fromEntries(
            aRes.data.map((r) => [r.player_id, (r.status as AttendanceStatus) ?? DEFAULT_STATUS])
          )
        );
      })
      .catch((err) => setError(parseApiError(err, "No se pudo cargar la planilla")))
      .finally(() => setLoading(false));
  }, [trainingId]);

  useEffect(() => () => {
    if (savedTimer.current) clearTimeout(savedTimer.current);
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? rows.filter((r) => r.player_name.toLowerCase().includes(q)) : rows;
  }, [rows, search]);

  const presentCount = useMemo(
    () => Object.values(statuses).filter((s) => ATTENDED.includes(s)).length,
    [statuses]
  );

  const setStatus = (playerId: string, status: AttendanceStatus) => {
    setStatuses((prev) => ({ ...prev, [playerId]: status }));
    setPickerFor(null);
    // Volver a "idle" avisa que lo guardado quedó viejo sin gritar un error.
    setSaveState("idle");
  };

  /** El 90% de los taps es este: vino o no vino. */
  const toggle = (playerId: string) => {
    const current = statuses[playerId] ?? DEFAULT_STATUS;
    setStatus(playerId, current === "ausente" ? "presente" : "ausente");
  };

  const markAll = (status: AttendanceStatus) => {
    setStatuses(Object.fromEntries(rows.map((r) => [r.player_id, status])));
    setSaveState("idle");
  };

  const save = async () => {
    if (!trainingId) return;
    setSaveState("saving");
    setError("");
    try {
      const { queued } = await putQueued(trainingId, `/trainings/${trainingId}/attendance`, {
        entries: rows.map((r) => ({
          player_id: r.player_id,
          status: statuses[r.player_id] ?? DEFAULT_STATUS,
        })),
      });
      setSaveState(queued ? "queued" : "saved");
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSaveState("idle"), 2500);
    } catch (err) {
      setSaveState("error");
      setError(parseApiError(err, "No se pudo guardar la asistencia"));
    }
  };

  const saveLocation = async () => {
    if (!trainingId) return;
    setSavingLocation(true);
    try {
      const { data } = await api.patch<Training>(`/trainings/${trainingId}`, {
        location: locationDraft.trim(),
      });
      setTraining(data);
      setEditingLocation(false);
    } catch (err) {
      setError(parseApiError(err, "No se pudo guardar el lugar"));
    } finally {
      setSavingLocation(false);
    }
  };

  if (loading) {
    return <div className="p-6"><p className="text-ink-muted text-sm">Cargando...</p></div>;
  }

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto pb-32">
      <div className="flex items-center gap-3 mb-1">
        <button
          onClick={() => navigate("/trainings")}
          className="pressable text-ink-muted hover:text-ink text-sm transition-colors duration-150"
        >
          ← Volver
        </button>
      </div>
      <h1 className="text-lg font-bold text-ink capitalize">
        {training ? formatLongDate(training.date) : ""}
      </h1>
      <p className="text-sm text-ink-muted mb-1">
        {training ? TRAINING_TYPE_LABEL[training.type as TrainingType] ?? training.type : ""} ·{" "}
        <span className="text-brand font-semibold tabular-nums">{presentCount}</span>
        <span className="text-ink-muted"> de {rows.length} presentes</span>
      </p>

      {training && (
        <div className="mb-4">
          {editingLocation ? (
            <div className="flex gap-2 items-center">
              <input
                type="text"
                autoFocus
                placeholder="Cancha 2, Gimnasio del club..."
                value={locationDraft}
                onChange={(e) => setLocationDraft(e.target.value)}
                className="flex-1 bg-surface text-ink text-sm rounded-lg px-3 py-1.5 placeholder-ink-faint outline-none focus:ring-1 focus:ring-brand-ring"
              />
              <button
                onClick={saveLocation}
                disabled={savingLocation}
                className="pressable text-xs font-semibold text-brand disabled:opacity-50"
              >
                Guardar
              </button>
              <button
                onClick={() => setEditingLocation(false)}
                className="pressable text-xs text-ink-muted"
              >
                Cancelar
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm">
              {training.location ? (
                <span className="text-ink-soft">📍 {training.location}</span>
              ) : (
                <span className="text-ink-faint">Sin lugar cargado</span>
              )}
              {canEditLocation && (
                <button
                  onClick={() => {
                    setLocationDraft(training.location ?? "");
                    setEditingLocation(true);
                  }}
                  className="pressable text-xs text-brand hover:text-brand-hover transition-colors duration-150"
                >
                  Editar
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {rows.length === 0 ? (
        <p className="text-ink-muted text-sm py-8 text-center">
          La división no tiene jugadores activos.
        </p>
      ) : (
        <>
          <div className="flex gap-2 mb-3">
            <input
              type="text"
              inputMode="search"
              placeholder="Buscar jugador..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 bg-surface text-ink text-sm rounded-xl px-3 py-2.5 placeholder-ink-faint outline-none focus:ring-2 focus:ring-brand-ring"
            />
            <button
              onClick={() => markAll("presente")}
              className="pressable text-xs font-semibold text-ink-soft bg-surface hover:bg-surface-strong px-3 rounded-xl transition-colors duration-150"
            >
              Todos
            </button>
          </div>

          <ul className="bg-surface/70 rounded-xl divide-y divide-line overflow-hidden">
            {filtered.map((row) => {
              const status = statuses[row.player_id] ?? DEFAULT_STATUS;
              const isOpen = pickerFor === row.player_id;
              return (
                <li key={row.player_id}>
                  <div className="flex items-stretch">
                    <button
                      onClick={() => toggle(row.player_id)}
                      className="flex-1 flex items-center gap-3 px-4 py-3 text-left min-w-0 active:bg-surface-hover transition-colors duration-100"
                    >
                      <span className="flex-1 text-sm text-ink truncate">{row.player_name}</span>
                      {row.position && (
                        <span className="text-[11px] text-ink-faint truncate hidden sm:block">
                          {row.position}
                        </span>
                      )}
                    </button>
                    <button
                      onClick={() => setPickerFor(isOpen ? null : row.player_id)}
                      aria-label={`Estado de ${row.player_name}: ${STATUS_LABEL[status]}`}
                      className={`pressable w-12 shrink-0 flex items-center justify-center text-sm font-bold transition-colors duration-150 ${STATUS_CLASS[status]}`}
                    >
                      {STATUS_SHORT[status]}
                    </button>
                  </div>

                  {isOpen && (
                    <div className="flex flex-wrap gap-1.5 px-4 py-2.5 bg-surface/60">
                      {ATTENDANCE_STATUSES.map((s) => (
                        <button
                          key={s}
                          onClick={() => setStatus(row.player_id, s)}
                          className={`pressable px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors duration-150 ${
                            s === status ? STATUS_CLASS[s] : "bg-surface-strong text-ink-soft"
                          }`}
                        >
                          {STATUS_LABEL[s]}
                        </button>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          {filtered.length === 0 && (
            <p className="text-ink-muted text-sm py-6 text-center">Sin resultados.</p>
          )}
        </>
      )}

      {error && (
        <p className="text-red-600 text-xs mt-3 bg-red-50 rounded-lg px-3 py-2">{error}</p>
      )}

      {/* Barra fija: guardar nunca queda fuera de alcance del pulgar. */}
      {rows.length > 0 && (
        <div className="fixed bottom-0 inset-x-0 md:left-56 bg-white/95 backdrop-blur border-t border-line px-4 py-3">
          <div className="max-w-2xl mx-auto flex items-center gap-3">
            <p className="text-xs text-ink-muted flex-1">
              {saveState === "queued"
                ? "Sin conexión — se envía al recuperar señal ⧗"
                : saveState === "saved"
                  ? "Asistencia guardada"
                  : `${presentCount} presentes · ${rows.length - presentCount} ausentes`}
            </p>
            <button
              onClick={save}
              disabled={saveState === "saving"}
              className="pressable bg-brand hover:bg-brand-hover disabled:opacity-60 text-white text-sm font-semibold px-6 py-2.5 rounded-xl transition-colors duration-150"
            >
              {saveState === "saving" ? "Guardando..." : "Guardar"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
