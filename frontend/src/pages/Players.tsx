import { useEffect, useState } from "react";
import api from "../lib/axios";
import { parseApiError } from "../lib/errors";
import { useAuthStore } from "../store/authStore";

interface Division {
  id: string;
  name: string;
}

interface Player {
  id: string;
  name: string;
  position: string | null;
  is_active: boolean;
}

const EMPTY_FORM = { name: "", position: "" };

export default function Players() {
  const clubId = useAuthStore((s) => s.user?.club_id);

  const [divisions, setDivisions] = useState<Division[]>([]);
  const [selectedDivisionId, setSelectedDivisionId] = useState<string>("");
  const [players, setPlayers] = useState<Player[]>([]);
  const [loadingDivisions, setLoadingDivisions] = useState(true);
  const [loadingPlayers, setLoadingPlayers] = useState(false);

  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!clubId) return;
    api.get<Division[]>(`/clubs/${clubId}/divisions`)
      .then(({ data }) => {
        setDivisions(data);
        if (data.length > 0) setSelectedDivisionId(data[0].id);
      })
      .finally(() => setLoadingDivisions(false));
  }, [clubId]);

  useEffect(() => {
    if (!selectedDivisionId) return;
    setLoadingPlayers(true);
    api.get<Player[]>(`/divisions/${selectedDivisionId}/players`)
      .then(({ data }) => setPlayers(data))
      .finally(() => setLoadingPlayers(false));
  }, [selectedDivisionId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDivisionId) return;
    setSubmitting(true);
    setError(null);
    try {
      const { data } = await api.post<Player>(`/divisions/${selectedDivisionId}/players`, {
        name: form.name,
        position: form.position || null,
      });
      setPlayers((prev) => [...prev, data]);
      setForm(EMPTY_FORM);
      setAdding(false);
    } catch (err) {
      setError(parseApiError(err, "Error al agregar jugador"));
    } finally {
      setSubmitting(false);
    }
  };

  if (loadingDivisions) {
    return <div className="p-6"><p className="text-gray-400 text-sm">Cargando...</p></div>;
  }

  if (divisions.length === 0) {
    return (
      <div className="p-6">
        <h1 className="text-xl font-bold text-white mb-2">Jugadores</h1>
        <p className="text-gray-500 text-sm">Primero creá una división para poder agregar jugadores.</p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-lg">
      <h1 className="text-xl font-bold text-white mb-4">Jugadores</h1>

      {/* Division selector */}
      <div className="flex gap-2 flex-wrap mb-5">
        {divisions.map((d) => (
          <button
            key={d.id}
            onClick={() => { setSelectedDivisionId(d.id); setAdding(false); }}
            className={`text-sm px-4 py-1.5 rounded-full transition-colors ${
              selectedDivisionId === d.id
                ? "bg-green-700 text-white"
                : "bg-gray-700 text-gray-300 hover:bg-gray-600"
            }`}
          >
            {d.name}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-gray-400 uppercase tracking-wide">
          {divisions.find((d) => d.id === selectedDivisionId)?.name}
        </p>
        {!adding && (
          <button
            onClick={() => { setAdding(true); setError(null); }}
            className="text-sm bg-green-700 hover:bg-green-600 text-white px-3 py-1.5 rounded-lg transition-colors"
          >
            + Agregar jugador
          </button>
        )}
      </div>

      {adding && (
        <form onSubmit={handleSubmit} className="bg-gray-800 rounded-xl p-4 mb-4 space-y-3">
          <input
            required
            autoFocus
            placeholder="Nombre del jugador"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            className="w-full bg-gray-700 text-white text-sm rounded-lg px-3 py-2.5 placeholder-gray-400 outline-none focus:ring-1 focus:ring-green-600"
          />
          <input
            placeholder="Posición (opcional)"
            value={form.position}
            onChange={(e) => setForm((f) => ({ ...f, position: e.target.value }))}
            className="w-full bg-gray-700 text-white text-sm rounded-lg px-3 py-2.5 placeholder-gray-400 outline-none focus:ring-1 focus:ring-green-600"
          />
          {error && <p className="text-red-400 text-xs">{error}</p>}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={submitting}
              className="text-sm bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white px-4 py-2 rounded-lg transition-colors"
            >
              {submitting ? "Guardando..." : "Guardar"}
            </button>
            <button
              type="button"
              onClick={() => { setAdding(false); setError(null); setForm(EMPTY_FORM); }}
              className="text-sm text-gray-400 hover:text-white px-4 py-2 rounded-lg transition-colors"
            >
              Cancelar
            </button>
          </div>
        </form>
      )}

      {loadingPlayers ? (
        <p className="text-gray-400 text-sm">Cargando jugadores...</p>
      ) : players.length === 0 ? (
        <p className="text-gray-500 text-sm">No hay jugadores en esta división.</p>
      ) : (
        <ul className="space-y-2">
          {players.map((p) => (
            <li key={p.id} className="bg-gray-800 rounded-xl px-4 py-3 flex items-center justify-between">
              <span className="text-white text-sm font-medium">{p.name}</span>
              {p.position && (
                <span className="text-xs text-gray-400">{p.position}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
