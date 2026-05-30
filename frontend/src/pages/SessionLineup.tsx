import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import api from "../lib/axios";
import { parseApiError } from "../lib/errors";
import { useAuthStore } from "../store/authStore";

interface SessionInfo {
  id: string;
  home_team: string;
  away_team: string;
  tournament_id: string;
}

interface AvailablePlayer {
  id: string;
  name: string;
  position: string | null;
}

interface LineupEntry {
  id: string;
  player_id: string;
  jersey_number: number;
  position: string | null;
  team: string;
  status: string;
  player: { id: string; name: string; position: string | null };
}

const EMPTY_ADD_FORM = {
  jersey_number: "",
  position: "",
  team: "home" as "home" | "away",
  status: "on_field" as "on_field" | "bench",
};

export default function SessionLineup() {
  const { id: sessionId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const canEdit = user?.role === "club_admin" || user?.role === "superadmin";

  const [session, setSession] = useState<SessionInfo | null>(null);
  const [allPlayers, setAllPlayers] = useState<AvailablePlayer[]>([]);
  const [lineup, setLineup] = useState<LineupEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const [teamView, setTeamView] = useState<"home" | "away">("home");
  const [search, setSearch] = useState("");

  const [addingFor, setAddingFor] = useState<string | null>(null);
  const [addForm, setAddForm] = useState(EMPTY_ADD_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId || !user?.club_id) return;

    Promise.all([
      api.get<SessionInfo>(`/sessions/${sessionId}`),
      api.get<LineupEntry[]>(`/sessions/${sessionId}/lineup`),
    ]).then(async ([sRes, lRes]) => {
      setSession(sRes.data);
      setLineup(lRes.data);
      const tRes = await api.get(`/clubs/${user.club_id}/tournaments/${sRes.data.tournament_id}`);
      const pRes = await api.get<AvailablePlayer[]>(`/divisions/${tRes.data.division_id}/players`);
      setAllPlayers(pRes.data);
    }).finally(() => setLoading(false));
  }, [sessionId, user?.club_id]);

  const inLineupIds = new Set(lineup.map((e) => e.player_id));

  const filteredAvailable = allPlayers
    .filter((p) => !inLineupIds.has(p.id))
    .filter((p) => p.name.toLowerCase().includes(search.toLowerCase()));

  const onField = lineup
    .filter((e) => e.team === teamView && e.status === "on_field")
    .sort((a, b) => a.jersey_number - b.jersey_number);

  const bench = lineup
    .filter((e) => e.team === teamView && e.status === "bench")
    .sort((a, b) => a.jersey_number - b.jersey_number);

  const handleAdd = async (playerId: string) => {
    if (!sessionId) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.post(`/sessions/${sessionId}/lineup`, {
        player_id: playerId,
        jersey_number: parseInt(addForm.jersey_number, 10),
        position: addForm.position || null,
        team: addForm.team,
        status: addForm.status,
      });
      const { data } = await api.get<LineupEntry[]>(`/sessions/${sessionId}/lineup`);
      setLineup(data);
      setAddingFor(null);
      setAddForm(EMPTY_ADD_FORM);
    } catch (err) {
      setError(parseApiError(err, "Error al agregar jugador"));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6"><p className="text-gray-400 text-sm">Cargando...</p></div>
    );
  }

  return (
    <div className="p-6 max-w-xl">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => navigate(-1)}
          className="text-gray-400 hover:text-white text-sm transition-colors"
        >
          ← Volver
        </button>
        <h1 className="text-lg font-bold text-white">
          {session?.home_team} vs {session?.away_team}
        </h1>
      </div>

      {/* Team toggle */}
      <div className="flex gap-2 mb-5">
        {(["home", "away"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTeamView(t)}
            className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors ${
              teamView === t ? "bg-green-700 text-white" : "bg-gray-700 text-gray-300"
            }`}
          >
            {t === "home" ? session?.home_team : session?.away_team}
          </button>
        ))}
      </div>

      {/* Add player section (club_admin only) */}
      {canEdit && (
        <div className="bg-gray-800 rounded-xl p-4 mb-5">
          <p className="text-sm font-semibold text-white mb-3">Agregar jugador</p>
          <input
            type="text"
            placeholder="Buscar jugador por nombre..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setAddingFor(null); setError(null); }}
            className="w-full bg-gray-700 text-white text-sm rounded-lg px-3 py-2.5 placeholder-gray-400 outline-none focus:ring-1 focus:ring-green-600 mb-3"
          />

          {allPlayers.length === 0 ? (
            <p className="text-gray-500 text-sm">No hay jugadores en la división.</p>
          ) : filteredAvailable.length === 0 ? (
            <p className="text-gray-500 text-sm">
              {search ? "Sin resultados." : "Todos los jugadores ya están en el lineup."}
            </p>
          ) : (
            <ul className="space-y-1 max-h-48 overflow-y-auto">
              {filteredAvailable.map((p) => (
                <li key={p.id}>
                  {addingFor === p.id ? (
                    <div className="bg-gray-700 rounded-lg p-3 space-y-2">
                      <p className="text-sm text-white font-medium">{p.name}</p>
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          required
                          type="number"
                          min="1"
                          max="99"
                          placeholder="N° camiseta"
                          value={addForm.jersey_number}
                          onChange={(e) => setAddForm((f) => ({ ...f, jersey_number: e.target.value }))}
                          className="bg-gray-600 text-white text-sm rounded-lg px-3 py-2 placeholder-gray-400 outline-none focus:ring-1 focus:ring-green-600"
                        />
                        <input
                          placeholder="Posición"
                          value={addForm.position}
                          onChange={(e) => setAddForm((f) => ({ ...f, position: e.target.value }))}
                          className="bg-gray-600 text-white text-sm rounded-lg px-3 py-2 placeholder-gray-400 outline-none focus:ring-1 focus:ring-green-600"
                        />
                        <select
                          value={addForm.team}
                          onChange={(e) => setAddForm((f) => ({ ...f, team: e.target.value as "home" | "away" }))}
                          className="bg-gray-600 text-white text-sm rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-green-600"
                        >
                          <option value="home">{session?.home_team}</option>
                          <option value="away">{session?.away_team}</option>
                        </select>
                        <select
                          value={addForm.status}
                          onChange={(e) => setAddForm((f) => ({ ...f, status: e.target.value as "on_field" | "bench" }))}
                          className="bg-gray-600 text-white text-sm rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-green-600"
                        >
                          <option value="on_field">Titular</option>
                          <option value="bench">Suplente</option>
                        </select>
                      </div>
                      {error && <p className="text-red-400 text-xs">{error}</p>}
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleAdd(p.id)}
                          disabled={submitting || !addForm.jersey_number}
                          className="text-sm bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white px-4 py-1.5 rounded-lg transition-colors"
                        >
                          {submitting ? "..." : "Confirmar"}
                        </button>
                        <button
                          onClick={() => { setAddingFor(null); setError(null); setAddForm(EMPTY_ADD_FORM); }}
                          className="text-sm text-gray-400 hover:text-white px-4 py-1.5 rounded-lg transition-colors"
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => { setAddingFor(p.id); setAddForm((f) => ({ ...f, position: p.position ?? "" })); setError(null); }}
                      className="w-full flex items-center justify-between bg-gray-700 hover:bg-gray-600 rounded-lg px-3 py-2 transition-colors"
                    >
                      <span className="text-sm text-white">{p.name}</span>
                      <span className="text-xs text-gray-400">{p.position ?? "—"}</span>
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Current lineup */}
      <div className="space-y-3">
        <div className="bg-gray-800/50 rounded-xl px-4">
          <p className="text-xs font-bold text-gray-500 uppercase tracking-wider pt-3 pb-1">
            En cancha ({onField.length})
          </p>
          {onField.length === 0 ? (
            <p className="text-gray-600 text-sm py-2">Sin jugadores.</p>
          ) : (
            onField.map((e) => (
              <div key={e.id} className="flex items-center gap-2 py-2 border-b border-gray-700/50">
                <span className="w-8 text-right text-sm font-bold text-gray-400">#{e.jersey_number}</span>
                <span className="flex-1 text-sm text-white">{e.player.name}</span>
                <span className="text-xs text-gray-500">{e.position ?? e.player.position ?? "—"}</span>
              </div>
            ))
          )}
          <div className="py-1" />
        </div>

        <div className="bg-gray-800/50 rounded-xl px-4">
          <p className="text-xs font-bold text-gray-500 uppercase tracking-wider pt-3 pb-1">
            Suplentes ({bench.length})
          </p>
          {bench.length === 0 ? (
            <p className="text-gray-600 text-sm py-2">Sin suplentes.</p>
          ) : (
            bench.map((e) => (
              <div key={e.id} className="flex items-center gap-2 py-2 border-b border-gray-700/50">
                <span className="w-8 text-right text-sm font-bold text-gray-400">#{e.jersey_number}</span>
                <span className="flex-1 text-sm text-white">{e.player.name}</span>
                <span className="text-xs text-gray-500">{e.position ?? e.player.position ?? "—"}</span>
              </div>
            ))
          )}
          <div className="py-1" />
        </div>
      </div>
    </div>
  );
}
