import { useEffect, useMemo, useState } from "react";
import api from "../lib/axios";
import { parseApiError } from "../lib/errors";
import { useAuthStore } from "../store/authStore";

interface Division {
  id: string;
  name: string;
}

interface NutritionSlot {
  id: string;
  starts_at: string;
  ends_at: string;
  status: "libre" | "reservado" | "cancelado";
  nutritionist_id: string;
  division_id: string | null;
  division_name: string | null;
  player_id: string | null;
  player_name: string | null;
  notes: string | null;
}

interface DraftSlot {
  key: string;
  starts_at: string;
  duration_minutes: number;
}

const DURATIONS = [30, 45, 60];

const STATUS_LABEL: Record<string, string> = {
  libre: "Libre",
  reservado: "Reservado",
  cancelado: "Cancelado",
};

const STATUS_CLASS: Record<string, string> = {
  libre: "bg-brand-soft text-brand",
  reservado: "bg-sky-100 text-sky-700",
  cancelado: "bg-surface-strong text-ink-faint",
};

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString("es-AR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

function formatTimeRange(startsAt: string, endsAt: string): string {
  const opts: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit" };
  return `${new Date(startsAt).toLocaleTimeString("es-AR", opts)} – ${new Date(endsAt).toLocaleTimeString("es-AR", opts)}`;
}

function addMinutes(iso: string, minutes: number): string {
  return new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();
}

/**
 * Agenda de la nutricionista: publica horarios en lote, ve quién reservó,
 * cancela. Sin recurrencia automática a propósito — la agenda real cambia
 * semana a semana. Ver [[add-turnos-nutricion]].
 */
export default function Nutricion() {
  const user = useAuthStore((s) => s.user);
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [divisionId, setDivisionId] = useState("");
  const [slots, setSlots] = useState<NutritionSlot[]>([]);
  const [draft, setDraft] = useState<DraftSlot[]>([]);
  const [newStart, setNewStart] = useState("");
  const [duration, setDuration] = useState(30);
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState("");

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

  const load = () => {
    if (!user?.club_id || !divisionId) return;
    api
      .get<NutritionSlot[]>(`/clubs/${user.club_id}/nutrition-slots`, { params: { division_id: divisionId } })
      .then(({ data }) => setSlots(data))
      .catch((err) => setError(parseApiError(err, "No se pudo cargar la agenda")));
  };

  useEffect(load, [user?.club_id, divisionId]);

  const addToDraft = () => {
    if (!newStart) return;
    setDraft((d) => [...d, { key: `${newStart}-${duration}-${d.length}`, starts_at: newStart, duration_minutes: duration }]);
    setNewStart("");
  };

  const removeFromDraft = (key: string) => setDraft((d) => d.filter((s) => s.key !== key));

  const publish = async () => {
    if (draft.length === 0 || !divisionId) return;
    setPublishing(true);
    setError("");
    try {
      await api.post(`/divisions/${divisionId}/nutrition-slots`, {
        slots: draft.map((d) => ({
          starts_at: new Date(d.starts_at).toISOString(),
          ends_at: addMinutes(new Date(d.starts_at).toISOString(), d.duration_minutes),
        })),
      });
      setDraft([]);
      load();
    } catch (err) {
      setError(parseApiError(err, "No se pudieron publicar los horarios"));
    } finally {
      setPublishing(false);
    }
  };

  const cancel = async (slotId: string) => {
    setError("");
    try {
      await api.post(`/nutrition-slots/${slotId}/cancel`);
      load();
    } catch (err) {
      setError(parseApiError(err, "No se pudo cancelar el turno"));
    }
  };

  const byDay = useMemo(() => {
    const groups: Record<string, NutritionSlot[]> = {};
    const sorted = [...slots]
      .filter((s) => s.status !== "cancelado")
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    for (const s of sorted) {
      const day = new Date(s.starts_at).toDateString();
      (groups[day] ??= []).push(s);
    }
    return groups;
  }, [slots]);

  if (loading) {
    return <div className="p-6"><p className="text-ink-muted text-sm">Cargando...</p></div>;
  }

  if (divisions.length === 0) {
    return (
      <div className="p-6">
        <h1 className="text-lg font-bold text-ink mb-2">Turnos de nutrición</h1>
        <p className="text-ink-muted text-sm">
          No hay divisiones cargadas todavía. Creá una desde Config para empezar a publicar horarios.
        </p>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto pb-10">
      <h1 className="text-lg font-bold text-ink mb-4">Turnos de nutrición</h1>

      {divisions.length > 1 && (
        <select
          value={divisionId}
          onChange={(e) => setDivisionId(e.target.value)}
          className="w-full bg-surface text-ink text-sm rounded-xl px-3 py-2.5 mb-4 outline-none focus:ring-2 focus:ring-brand-ring"
        >
          {divisions.map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
      )}

      {error && (
        <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2 mb-3">{error}</p>
      )}

      <section className="bg-surface rounded-xl p-4 mb-5">
        <p className="text-sm font-semibold text-ink mb-3">Publicar horarios</p>
        <div className="flex flex-wrap gap-2 mb-3">
          <input
            type="datetime-local"
            value={newStart}
            onChange={(e) => setNewStart(e.target.value)}
            className="flex-1 min-w-[180px] bg-surface-strong text-ink text-sm rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-brand-ring"
          />
          <select
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
            className="bg-surface-strong text-ink text-sm rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-brand-ring"
          >
            {DURATIONS.map((d) => (
              <option key={d} value={d}>{d} min</option>
            ))}
          </select>
          <button
            onClick={addToDraft}
            disabled={!newStart}
            className="pressable text-sm font-semibold text-brand hover:text-brand-hover disabled:opacity-40 px-3"
          >
            + Agregar
          </button>
        </div>

        {draft.length > 0 && (
          <ul className="space-y-1.5 mb-3">
            {draft.map((d) => (
              <li key={d.key} className="flex items-center gap-2 text-sm bg-surface-strong rounded-lg px-3 py-2">
                <span className="flex-1 text-ink">
                  {new Date(d.starts_at).toLocaleString("es-AR", {
                    weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
                  })}
                  {" · "}{d.duration_minutes} min
                </span>
                <button
                  onClick={() => removeFromDraft(d.key)}
                  aria-label="Quitar"
                  className="pressable text-ink-faint hover:text-red-600 transition-colors duration-150"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}

        <button
          onClick={publish}
          disabled={draft.length === 0 || publishing}
          className="pressable w-full bg-brand hover:bg-brand-hover disabled:opacity-50 text-white text-sm font-semibold py-2.5 rounded-lg"
        >
          {publishing ? "Publicando..." : `Publicar ${draft.length || ""} horario${draft.length === 1 ? "" : "s"}`.trim()}
        </button>
      </section>

      <p className="text-xs font-bold text-ink-muted uppercase tracking-wider mb-2">Agenda</p>
      {Object.keys(byDay).length === 0 ? (
        <p className="text-ink-muted text-sm bg-surface rounded-xl px-4 py-6 text-center">
          Todavía no hay horarios publicados.
        </p>
      ) : (
        Object.entries(byDay).map(([day, daySlots]) => (
          <section key={day} className="mb-4">
            <p className="text-xs text-ink-muted capitalize mb-1.5">{formatDay(daySlots[0].starts_at)}</p>
            <ul className="bg-surface rounded-xl divide-y divide-line overflow-hidden">
              {daySlots.map((s) => (
                <li key={s.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="text-sm text-ink tabular-nums shrink-0 w-32">
                    {formatTimeRange(s.starts_at, s.ends_at)}
                  </span>
                  <span className="flex-1 min-w-0 text-sm text-ink-soft truncate">
                    {s.player_name ?? "—"}
                  </span>
                  <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${STATUS_CLASS[s.status]}`}>
                    {STATUS_LABEL[s.status]}
                  </span>
                  <button
                    onClick={() => cancel(s.id)}
                    className="pressable text-xs text-ink-faint hover:text-red-600 transition-colors duration-150 shrink-0"
                  >
                    {s.status === "libre" ? "Quitar" : "Cancelar"}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
