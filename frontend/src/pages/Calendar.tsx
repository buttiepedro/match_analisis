import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../lib/axios";
import { parseApiError } from "../lib/errors";
import { useAuthStore } from "../store/authStore";
import { TRAINING_TYPE_LABEL, TrainingType } from "../lib/attendance";

interface Division {
  id: string;
  name: string;
}

interface CalendarEntry {
  id: string;
  kind: "entrenamiento" | "partido";
  date: string;
  label: string;
  status: string | null;
}

const WEEKDAYS = ["L", "M", "M", "J", "V", "S", "D"];

function isoDay(d: Date): string {
  const offset = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - offset).toISOString().slice(0, 10);
}

/** Celdas del mes, alineadas a lunes. `null` = relleno antes del día 1. */
function monthGrid(year: number, month: number): (Date | null)[] {
  const first = new Date(year, month, 1);
  // getDay(): 0 = domingo. Se corre para que la semana arranque el lunes.
  const lead = (first.getDay() + 6) % 7;
  const days = new Date(year, month + 1, 0).getDate();

  const cells: (Date | null)[] = Array(lead).fill(null);
  for (let d = 1; d <= days; d++) cells.push(new Date(year, month, d));
  return cells;
}

export default function Calendar() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);

  const [divisions, setDivisions] = useState<Division[]>([]);
  const [divisionId, setDivisionId] = useState("");
  const [entries, setEntries] = useState<CalendarEntry[]>([]);
  const [cursor, setCursor] = useState(() => new Date());
  const [selected, setSelected] = useState<string>(() => isoDay(new Date()));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user?.club_id) return;
    api
      .get<Division[]>(`/clubs/${user.club_id}/divisions`)
      .then(({ data }) => {
        setDivisions(data);
        setDivisionId((c) => c || data[0]?.id || "");
      })
      .catch((err) => setError(parseApiError(err, "No se pudieron cargar las divisiones")))
      .finally(() => setLoading(false));
  }, [user?.club_id]);

  useEffect(() => {
    if (!divisionId) return;
    const from = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const to = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    api
      .get<CalendarEntry[]>(`/divisions/${divisionId}/calendar`, {
        params: { from: isoDay(from), to: isoDay(to) },
      })
      .then(({ data }) => setEntries(data))
      .catch(() => setEntries([]));
  }, [divisionId, cursor]);

  const byDay = useMemo(() => {
    const map: Record<string, CalendarEntry[]> = {};
    entries.forEach((e) => {
      (map[e.date] ??= []).push(e);
    });
    return map;
  }, [entries]);

  const cells = useMemo(
    () => monthGrid(cursor.getFullYear(), cursor.getMonth()),
    [cursor]
  );

  const monthLabel = cursor.toLocaleDateString("es-AR", { month: "long", year: "numeric" });
  const todayIso = isoDay(new Date());
  const selectedEntries = byDay[selected] ?? [];

  const openEntry = (entry: CalendarEntry) => {
    navigate(
      entry.kind === "entrenamiento" ? `/trainings/${entry.id}` : `/sessions/${entry.id}/lineup`
    );
  };

  if (loading) {
    return <div className="p-6"><p className="text-ink-muted text-sm">Cargando...</p></div>;
  }

  if (divisions.length === 0) {
    return (
      <div className="p-6">
        <h1 className="text-lg font-bold text-ink mb-2">Calendario</h1>
        <p className="text-ink-muted text-sm">No hay divisiones cargadas todavía.</p>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto pb-24">
      <h1 className="text-lg font-bold text-ink mb-4">Calendario</h1>

      <select
        value={divisionId}
        onChange={(e) => setDivisionId(e.target.value)}
        className="w-full bg-surface text-ink text-sm rounded-xl px-3 py-2.5 mb-4 outline-none focus:ring-2 focus:ring-brand-ring"
      >
        {divisions.map((d) => (
          <option key={d.id} value={d.id}>{d.name}</option>
        ))}
      </select>

      {error && (
        <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2 mb-3">{error}</p>
      )}

      <div className="flex items-center justify-between mb-3">
        <button
          onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
          className="pressable text-ink-muted hover:text-ink px-3 py-1.5 rounded-lg transition-colors duration-150"
          aria-label="Mes anterior"
        >
          ←
        </button>
        <span className="text-sm font-semibold text-ink capitalize">{monthLabel}</span>
        <button
          onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
          className="pressable text-ink-muted hover:text-ink px-3 py-1.5 rounded-lg transition-colors duration-150"
          aria-label="Mes siguiente"
        >
          →
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 mb-1">
        {WEEKDAYS.map((d, i) => (
          <span key={i} className="text-center text-[11px] text-ink-faint font-semibold">
            {d}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1 mb-5">
        {cells.map((day, i) => {
          if (!day) return <span key={`pad-${i}`} />;
          const iso = isoDay(day);
          const dayEntries = byDay[iso] ?? [];
          const isSelected = iso === selected;
          const isToday = iso === todayIso;

          return (
            <button
              key={iso}
              onClick={() => setSelected(iso)}
              className={`pressable-strong aspect-square rounded-lg flex flex-col items-center justify-center gap-0.5 transition-colors duration-150 ${
                isSelected
                  ? "bg-brand text-white"
                  : isToday
                    ? "bg-surface-strong text-ink"
                    : "bg-surface/70 text-ink-muted hover:bg-surface-hover"
              }`}
            >
              <span className="text-xs tabular-nums">{day.getDate()}</span>
              {dayEntries.length > 0 && (
                <span className="flex gap-0.5">
                  {dayEntries.slice(0, 3).map((e, j) => (
                    <span
                      key={j}
                      className={`w-1 h-1 rounded-full ${
                        e.kind === "partido" ? "bg-green-400" : "bg-sky-400"
                      }`}
                    />
                  ))}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-4 mb-3 text-[11px] text-ink-muted">
        <span className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-green-400" /> Partido
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-sky-400" /> Entrenamiento
        </span>
      </div>

      {selectedEntries.length === 0 ? (
        <p className="text-ink-muted text-sm py-4 text-center">Nada agendado ese día.</p>
      ) : (
        <ul className="space-y-2">
          {selectedEntries.map((e) => (
            <li key={`${e.kind}-${e.id}`}>
              <button
                onClick={() => openEntry(e)}
                className="pressable w-full flex items-center gap-3 bg-surface hover:bg-surface-hover rounded-xl px-4 py-3 text-left transition-colors duration-150"
              >
                <span
                  className={`w-1.5 h-8 rounded-full shrink-0 ${
                    e.kind === "partido" ? "bg-brand" : "bg-sky-500"
                  }`}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-ink truncate">
                    {e.kind === "entrenamiento"
                      ? TRAINING_TYPE_LABEL[e.label as TrainingType] ?? e.label
                      : e.label}
                  </p>
                  <p className="text-xs text-ink-muted capitalize">{e.kind}</p>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
