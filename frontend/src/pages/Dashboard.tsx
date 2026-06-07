import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../lib/axios";
import { parseApiError } from "../lib/errors";
import { useAuthStore } from "../store/authStore";

interface Tournament {
  id: string;
  name: string;
  season: string | null;
  division: { id: string; name: string };
}

interface Session {
  id: string;
  home_team: string;
  away_team: string;
  scheduled_at: string | null;
  status: string;
  tournament?: Tournament;
}

const STATUS_LABEL: Record<string, string> = {
  scheduled: "Programado",
  active: "En curso",
  halftime: "Entretiempo",
  finished: "Finalizado",
};

const STATUS_COLOR: Record<string, string> = {
  scheduled: "text-gray-400",
  active: "text-green-400",
  halftime: "text-blue-400",
  finished: "text-red-400",
};

const EMPTY_FORM = {
  tournament_id: "",
  away_team: "",
  scheduled_at: "",
  half_duration_minutes: "40",
};

export default function Dashboard() {
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const canCreate = user?.role === "club_admin" || user?.role === "superadmin";

  const [clubName, setClubName] = useState("");
  const [sessions, setSessions] = useState<Session[]>([]);
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [loading, setLoading] = useState(true);

  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const handleDelete = async (sessionId: string) => {
    setDeleting(sessionId);
    try {
      await api.delete(`/sessions/${sessionId}`);
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      setConfirmDelete(null);
    } catch (err) {
      alert(parseApiError(err, "Error al eliminar el partido"));
    } finally {
      setDeleting(null);
    }
  };

  const load = async () => {
    const clubId = user?.club_id;
    if (!clubId) { setLoading(false); return; }

    try {
      const [{ data: club }, { data: tours }] = await Promise.all([
        api.get<{ id: string; name: string }>(`/clubs/${clubId}`),
        api.get<Tournament[]>(`/clubs/${clubId}/tournaments`),
      ]);
      setClubName(club.name);
      setTournaments(tours);

      const groups = await Promise.all(
        tours.map((t) =>
          api.get<Session[]>(`/tournaments/${t.id}/sessions`)
            .then(({ data }) => data.map((s) => ({ ...s, tournament: t })))
            .catch(() => [] as Session[])
        )
      );

      const flat = groups.flat().sort((a, b) => {
        const order = { active: 0, halftime: 1, scheduled: 2, finished: 3 };
        return (order[a.status as keyof typeof order] ?? 9) - (order[b.status as keyof typeof order] ?? 9);
      });

      setSessions(flat);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [user?.club_id]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const { data } = await api.post<Session>(
        `/tournaments/${form.tournament_id}/sessions`,
        {
          home_team: clubName,
          away_team: form.away_team,
          scheduled_at: form.scheduled_at || null,
          half_duration_minutes: parseInt(form.half_duration_minutes, 10),
        }
      );
      const tournament = tournaments.find((t) => t.id === form.tournament_id);
      setSessions((prev) => [{ ...data, tournament }, ...prev]);
      setShowModal(false);
      setForm(EMPTY_FORM);
    } catch (err) {
      setError(parseApiError(err, "Error al crear el partido"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-6 max-w-2xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-white">Partidos</h1>
        {canCreate && (
          <button
            onClick={() => {
              setShowModal(true);
              setError(null);
              setForm((f) => ({ ...f, tournament_id: tournaments[0]?.id ?? "" }));
            }}
            className="text-sm bg-green-700 hover:bg-green-600 text-white px-4 py-2 rounded-lg transition-colors"
          >
            + Nuevo partido
          </button>
        )}
      </div>

      {loading ? (
        <p className="text-gray-400 text-sm">Cargando...</p>
      ) : sessions.length === 0 ? (
        <div className="text-center mt-12">
          <p className="text-gray-500 text-sm">No hay partidos todavía.</p>
          {canCreate && tournaments.length === 0 && (
            <p className="text-gray-600 text-xs mt-2">
              Primero creá una división y un torneo desde el menú lateral.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {sessions.map((s) => (
            <div key={s.id} className="bg-gray-800 rounded-xl overflow-hidden">
              <button
                onClick={() => navigate(`/sessions/${s.id}`)}
                className="w-full px-4 py-4 text-left hover:bg-gray-700/50 transition-colors"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-white font-semibold text-sm">
                    {s.home_team} vs {s.away_team}
                  </span>
                  <span className={`text-xs font-medium ${STATUS_COLOR[s.status] ?? "text-gray-400"}`}>
                    {STATUS_LABEL[s.status] ?? s.status}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-400">
                  {s.tournament && (
                    <span>{s.tournament.name}{s.tournament.season ? ` · ${s.tournament.season}` : ""}</span>
                  )}
                  {s.scheduled_at && (
                    <span>· {new Date(s.scheduled_at).toLocaleDateString("es-AR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                  )}
                </div>
              </button>
              {canCreate && (
                <div className="border-t border-gray-700 px-4 py-2 flex items-center justify-between">
                  <button
                    onClick={() => navigate(`/sessions/${s.id}/lineup`)}
                    className="text-xs text-green-400 hover:text-green-300 transition-colors"
                  >
                    Alineación →
                  </button>
                  {confirmDelete === s.id ? (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-400">¿Eliminar partido y todos sus datos?</span>
                      <button
                        onClick={() => handleDelete(s.id)}
                        disabled={deleting === s.id}
                        className="text-xs bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white px-2 py-1 rounded transition-colors"
                      >
                        {deleting === s.id ? "..." : "Sí, eliminar"}
                      </button>
                      <button
                        onClick={() => setConfirmDelete(null)}
                        className="text-xs text-gray-400 hover:text-white transition-colors"
                      >
                        Cancelar
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmDelete(s.id)}
                      className="text-xs text-gray-600 hover:text-red-400 transition-colors"
                    >
                      Eliminar
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-gray-800 rounded-2xl w-full max-w-md p-6">
            <h2 className="text-white font-bold text-lg mb-4">Nuevo partido</h2>
            {tournaments.length === 0 ? (
              <>
                <p className="text-yellow-400 text-sm mb-4">
                  Necesitás crear al menos un torneo antes de crear un partido.
                </p>
                <button
                  onClick={() => setShowModal(false)}
                  className="w-full bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm font-medium py-2.5 rounded-lg transition-colors"
                >
                  Cerrar
                </button>
              </>
            ) : (
              <form onSubmit={handleCreate} className="space-y-3">
                <select
                  required
                  value={form.tournament_id}
                  onChange={(e) => setForm((f) => ({ ...f, tournament_id: e.target.value }))}
                  className="w-full bg-gray-700 text-white text-sm rounded-lg px-3 py-2.5 outline-none focus:ring-1 focus:ring-green-600"
                >
                  <option value="">— Seleccionar torneo —</option>
                  {tournaments.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}{t.season ? ` (${t.season})` : ""}
                    </option>
                  ))}
                </select>
                <div className="w-full bg-gray-700/50 rounded-lg px-3 py-2.5 flex items-center gap-2">
                  <span className="text-xs text-gray-400">Tu equipo:</span>
                  <span className="text-white text-sm font-medium">{clubName}</span>
                </div>
                <input
                  required
                  placeholder="Rival"
                  value={form.away_team}
                  onChange={(e) => setForm((f) => ({ ...f, away_team: e.target.value }))}
                  className="w-full bg-gray-700 text-white text-sm rounded-lg px-3 py-2.5 placeholder-gray-400 outline-none focus:ring-1 focus:ring-green-600"
                />
                <div className="flex gap-2">
                  <input
                    type="datetime-local"
                    value={form.scheduled_at}
                    onChange={(e) => setForm((f) => ({ ...f, scheduled_at: e.target.value }))}
                    className="flex-1 bg-gray-700 text-white text-sm rounded-lg px-3 py-2.5 outline-none focus:ring-1 focus:ring-green-600"
                  />
                  <div className="flex items-center gap-2 bg-gray-700 rounded-lg px-3">
                    <input
                      type="number"
                      min="1"
                      value={form.half_duration_minutes}
                      onChange={(e) => setForm((f) => ({ ...f, half_duration_minutes: e.target.value }))}
                      className="w-12 bg-transparent text-white text-sm outline-none"
                    />
                    <span className="text-xs text-gray-400 whitespace-nowrap">min/tiempo</span>
                  </div>
                </div>
                {error && <p className="text-red-400 text-xs">{error}</p>}
                <div className="flex gap-3 pt-2">
                  <button
                    type="submit"
                    disabled={submitting}
                    className="flex-1 bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white text-sm font-medium py-2.5 rounded-lg transition-colors"
                  >
                    {submitting ? "Creando..." : "Crear partido"}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowModal(false); setError(null); }}
                    className="flex-1 bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm font-medium py-2.5 rounded-lg transition-colors"
                  >
                    Cancelar
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
