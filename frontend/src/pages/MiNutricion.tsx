import { useEffect, useMemo, useState } from "react";
import api from "../lib/axios";
import { parseApiError } from "../lib/errors";
import { useAuthStore } from "../store/authStore";

interface NutritionSlot {
  id: string;
  starts_at: string;
  ends_at: string;
  status: "libre" | "reservado" | "cancelado";
  notes: string | null;
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleDateString("es-AR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Portal del jugador para reservar turno con la nutricionista.
 *
 * De sólo lectura salvo reservar/cancelar: no hay lista de espera ni
 * recurrencia — si no hay horarios libres, se espera a que se publiquen más.
 */
export default function MiNutricion() {
  const user = useAuthStore((s) => s.user);
  const [free, setFree] = useState<NutritionSlot[]>([]);
  const [mine, setMine] = useState<NutritionSlot[]>([]);
  const [notesFor, setNotesFor] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = () => {
    if (!user?.club_id) return;
    Promise.all([
      api.get<NutritionSlot[]>(`/clubs/${user.club_id}/nutrition-slots`),
      api.get<NutritionSlot[]>("/me/nutrition-appointments"),
    ])
      .then(([freeRes, mineRes]) => {
        setFree(freeRes.data);
        setMine(mineRes.data);
      })
      .catch((err) => setError(parseApiError(err, "No se pudo cargar la agenda")))
      .finally(() => setLoading(false));
  };

  useEffect(load, [user?.club_id]);

  const nextAppointment = useMemo(
    () =>
      mine
        .filter((s) => s.status === "reservado" && new Date(s.starts_at) > new Date())
        .sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0] ?? null,
    [mine]
  );

  const book = async (slotId: string) => {
    setBusy(slotId);
    setError("");
    try {
      await api.post(`/nutrition-slots/${slotId}/book`, { notes: notes.trim() || undefined });
      setNotesFor(null);
      setNotes("");
      load();
    } catch (err) {
      setError(parseApiError(err, "No se pudo reservar — puede que alguien se haya adelantado"));
      load();
    } finally {
      setBusy(null);
    }
  };

  const cancel = async (slotId: string) => {
    setBusy(slotId);
    setError("");
    try {
      await api.post(`/nutrition-slots/${slotId}/cancel`);
      load();
    } catch (err) {
      setError(parseApiError(err, "No se pudo cancelar"));
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return <div className="p-6"><p className="text-ink-muted text-sm">Cargando...</p></div>;
  }

  return (
    <div className="p-4 md:p-6 max-w-md mx-auto pb-10">
      <h1 className="text-lg font-bold text-ink mb-4">Turno con la nutricionista</h1>

      {error && (
        <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2 mb-3">{error}</p>
      )}

      {nextAppointment ? (
        <section className="bg-brand-soft border border-brand-ring rounded-xl px-4 py-3 mb-5">
          <p className="text-xs font-bold text-brand uppercase tracking-wider mb-1">Tu turno</p>
          <p className="text-sm text-ink capitalize">{formatWhen(nextAppointment.starts_at)}</p>
          {nextAppointment.notes && (
            <p className="text-xs text-ink-muted mt-1">"{nextAppointment.notes}"</p>
          )}
          <button
            onClick={() => cancel(nextAppointment.id)}
            disabled={busy === nextAppointment.id}
            className="pressable text-xs font-semibold text-red-600 hover:text-red-700 disabled:opacity-50 mt-2"
          >
            {busy === nextAppointment.id ? "Cancelando..." : "Cancelar turno"}
          </button>
        </section>
      ) : (
        <p className="text-ink-muted text-sm bg-surface rounded-xl px-4 py-3 mb-5">
          No tenés ningún turno reservado.
        </p>
      )}

      <p className="text-xs font-bold text-ink-muted uppercase tracking-wider mb-2">
        Horarios disponibles
      </p>
      {free.length === 0 ? (
        <p className="text-ink-muted text-sm bg-surface rounded-xl px-4 py-6 text-center">
          No hay horarios libres por ahora. Volvé a mirar más tarde.
        </p>
      ) : (
        <ul className="bg-surface rounded-xl divide-y divide-line overflow-hidden">
          {free.map((s) => (
            <li key={s.id} className="px-4 py-3">
              <div className="flex items-center gap-3">
                <span className="flex-1 text-sm text-ink capitalize">{formatWhen(s.starts_at)}</span>
                {notesFor !== s.id && (
                  <button
                    onClick={() => { setNotesFor(s.id); setNotes(""); }}
                    disabled={busy !== null}
                    className="pressable text-xs font-semibold text-brand hover:text-brand-hover disabled:opacity-50 shrink-0"
                  >
                    Reservar
                  </button>
                )}
              </div>
              {notesFor === s.id && (
                <div className="mt-2 space-y-2">
                  <input
                    type="text"
                    placeholder="Motivo de la consulta (opcional)"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="w-full bg-surface-strong text-ink text-sm rounded-lg px-3 py-2 placeholder-ink-faint outline-none focus:ring-1 focus:ring-brand-ring"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => book(s.id)}
                      disabled={busy === s.id}
                      className="pressable text-sm bg-brand hover:bg-brand-hover disabled:opacity-50 text-white px-4 py-1.5 rounded-lg font-medium"
                    >
                      {busy === s.id ? "Reservando..." : "Confirmar"}
                    </button>
                    <button
                      onClick={() => setNotesFor(null)}
                      className="pressable text-sm text-ink-muted hover:text-ink px-4 py-1.5 rounded-lg"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
