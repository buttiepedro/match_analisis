import { useEffect, useState } from "react";
import api from "../lib/axios";
import { parseApiError } from "../lib/errors";
import { useAuthStore } from "../store/authStore";

interface Division {
  id: string;
  name: string;
  is_active: boolean;
}

export default function Divisions() {
  const clubId = useAuthStore((s) => s.user?.club_id);

  const [divisions, setDivisions] = useState<Division[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [adding, setAdding] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchDivisions = async () => {
    if (!clubId) return;
    try {
      const { data } = await api.get<Division[]>(`/clubs/${clubId}/divisions`);
      setDivisions(data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchDivisions(); }, [clubId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clubId) return;
    setSubmitting(true);
    setError(null);
    try {
      const { data } = await api.post<Division>(`/clubs/${clubId}/divisions`, { name });
      setDivisions((prev) => [...prev, data]);
      setName("");
      setAdding(false);
    } catch (err) {
      setError(parseApiError(err, "Error al crear la división"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-6 max-w-lg">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-white">Divisiones</h1>
        {!adding && (
          <button
            onClick={() => { setAdding(true); setError(null); }}
            className="text-sm bg-green-700 hover:bg-green-600 text-white px-4 py-2 rounded-lg transition-colors"
          >
            + Nueva división
          </button>
        )}
      </div>

      {adding && (
        <form onSubmit={handleSubmit} className="bg-gray-800 rounded-xl p-4 mb-4 space-y-3">
          <input
            required
            autoFocus
            placeholder="Nombre de la división"
            value={name}
            onChange={(e) => setName(e.target.value)}
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
              onClick={() => { setAdding(false); setError(null); setName(""); }}
              className="text-sm text-gray-400 hover:text-white px-4 py-2 rounded-lg transition-colors"
            >
              Cancelar
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <p className="text-gray-400 text-sm">Cargando...</p>
      ) : divisions.length === 0 ? (
        <p className="text-gray-500 text-sm">No hay divisiones todavía.</p>
      ) : (
        <ul className="space-y-2">
          {divisions.map((d) => (
            <li key={d.id} className="bg-gray-800 rounded-xl px-4 py-3">
              <span className="text-white text-sm font-medium">{d.name}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
