import { useEffect, useState } from "react";
import api from "../lib/axios";
import { parseApiError } from "../lib/errors";
import { useAuthStore } from "../store/authStore";

interface ClubUser {
  id: string;
  email: string;
  full_name: string;
  role: string;
  is_active: boolean;
}

const ROLE_LABEL: Record<string, string> = {
  club_admin: "Admin de club",
  match_director: "Director de partido",
  analyst: "Analista",
};

const EMPTY_FORM = {
  full_name: "",
  email: "",
  password: "",
  role: "match_director" as "match_director" | "analyst",
};

export default function Users() {
  const clubId = useAuthStore((s) => s.user?.club_id);

  const [users, setUsers] = useState<ClubUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchUsers = async () => {
    if (!clubId) return;
    try {
      const { data } = await api.get<ClubUser[]>(`/clubs/${clubId}/users`);
      setUsers(data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchUsers(); }, [clubId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clubId) return;
    setSubmitting(true);
    setError(null);
    try {
      const { data } = await api.post<ClubUser>(`/clubs/${clubId}/users`, form);
      setUsers((prev) => [...prev, data]);
      setShowModal(false);
      setForm(EMPTY_FORM);
    } catch (err) {
      setError(parseApiError(err, "Error al crear el usuario"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-6 max-w-lg">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-white">Usuarios</h1>
        <button
          onClick={() => { setShowModal(true); setError(null); }}
          className="text-sm bg-green-700 hover:bg-green-600 text-white px-4 py-2 rounded-lg transition-colors"
        >
          + Nuevo usuario
        </button>
      </div>

      {loading ? (
        <p className="text-gray-400 text-sm">Cargando...</p>
      ) : users.length === 0 ? (
        <p className="text-gray-500 text-sm">No hay usuarios todavía.</p>
      ) : (
        <ul className="space-y-2">
          {users.map((u) => (
            <li key={u.id} className="bg-gray-800 rounded-xl px-4 py-3 flex items-center justify-between">
              <div>
                <p className="text-white text-sm font-medium">{u.full_name}</p>
                <p className="text-gray-400 text-xs">{u.email}</p>
              </div>
              <span className="text-xs text-gray-400">{ROLE_LABEL[u.role] ?? u.role}</span>
            </li>
          ))}
        </ul>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-gray-800 rounded-2xl w-full max-w-md p-6">
            <h2 className="text-white font-bold text-lg mb-4">Nuevo usuario</h2>
            <form onSubmit={handleSubmit} className="space-y-3">
              <input
                required
                placeholder="Nombre completo"
                value={form.full_name}
                onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
                className="w-full bg-gray-700 text-white text-sm rounded-lg px-3 py-2.5 placeholder-gray-400 outline-none focus:ring-1 focus:ring-green-600"
              />
              <input
                required
                type="email"
                placeholder="Email"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                className="w-full bg-gray-700 text-white text-sm rounded-lg px-3 py-2.5 placeholder-gray-400 outline-none focus:ring-1 focus:ring-green-600"
              />
              <input
                required
                type="password"
                placeholder="Contraseña"
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                className="w-full bg-gray-700 text-white text-sm rounded-lg px-3 py-2.5 placeholder-gray-400 outline-none focus:ring-1 focus:ring-green-600"
              />
              <select
                value={form.role}
                onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as typeof form.role }))}
                className="w-full bg-gray-700 text-white text-sm rounded-lg px-3 py-2.5 outline-none focus:ring-1 focus:ring-green-600"
              >
                <option value="match_director">Director de partido</option>
                <option value="analyst">Analista</option>
              </select>
              {error && <p className="text-red-400 text-xs">{error}</p>}
              <div className="flex gap-3 pt-2">
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white text-sm font-medium py-2.5 rounded-lg transition-colors"
                >
                  {submitting ? "Guardando..." : "Crear usuario"}
                </button>
                <button
                  type="button"
                  onClick={() => { setShowModal(false); setError(null); setForm(EMPTY_FORM); }}
                  className="flex-1 bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm font-medium py-2.5 rounded-lg transition-colors"
                >
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
