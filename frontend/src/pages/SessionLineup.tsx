import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import api from "../lib/axios";
import { parseApiError } from "../lib/errors";
import { useAuthStore } from "../store/authStore";
import { RUGBY_POSITIONS, positionByJersey } from "../lib/rugby";

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
  team: "user" as "user" | "rival",
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

  const [teamView, setTeamView] = useState<"user" | "rival">("user");
  const [search, setSearch] = useState("");

  const [addingFor, setAddingFor] = useState<string | null>(null);
  const [addForm, setAddForm] = useState(EMPTY_ADD_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editJersey, setEditJersey] = useState("");
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId || !user?.club_id) return;

    Promise.all([
      api.get<SessionInfo>(`/sessions/${sessionId}`),
      api.get<LineupEntry[]>(`/sessions/${sessionId}/lineup`),
      api.get<AvailablePlayer[]>(`/clubs/${user.club_id}/players`),
    ]).then(([sRes, lRes, pRes]) => {
      setSession(sRes.data);
      setLineup(lRes.data);
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
      const { data: newEntry } = await api.post<LineupEntry>(`/sessions/${sessionId}/lineup`, {
        player_id: playerId,
        jersey_number: parseInt(addForm.jersey_number, 10),
        position: addForm.position || null,
        team: addForm.team,
        status: addForm.status,
      });
      setLineup((prev) => [...prev, newEntry]);
      setAddingFor(null);
      setAddForm(EMPTY_ADD_FORM);
    } catch (err) {
      setError(parseApiError(err, "Error al agregar jugador"));
    } finally {
      setSubmitting(false);
    }
  };

  const handleEditJersey = async (entryId: string) => {
    setEditSubmitting(true);
    setEditError(null);
    try {
      const { data: updated } = await api.patch<LineupEntry>(`/sessions/${sessionId}/lineup/${entryId}`, {
        jersey_number: parseInt(editJersey, 10),
      });
      setLineup((prev) => prev.map((e) => (e.id === entryId ? updated : e)));
      setEditingId(null);
    } catch (err) {
      setEditError(parseApiError(err, "Error al actualizar"));
    } finally {
      setEditSubmitting(false);
    }
  };

  const handleDelete = async (entryId: string) => {
    setDeletingId(entryId);
    setEditError(null);
    try {
      await api.delete(`/sessions/${sessionId}/lineup/${entryId}`);
      setLineup((prev) => prev.filter((e) => e.id !== entryId));
    } catch (err) {
      setEditError(parseApiError(err, "Error al eliminar"));
    } finally {
      setDeletingId(null);
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
        {(["user", "rival"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTeamView(t)}
            className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors ${
              teamView === t ? "bg-green-700 text-white" : "bg-gray-700 text-gray-300"
            }`}
          >
            {t === "user" ? session?.home_team : session?.away_team}
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
                        <select
                          value={addForm.position}
                          onChange={(e) => setAddForm((f) => ({ ...f, position: e.target.value }))}
                          className="bg-gray-600 text-white text-sm rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-green-600"
                        >
                          <option value="">— Posición —</option>
                          {RUGBY_POSITIONS.map((pos) => (
                            <option key={pos.number} value={pos.name}>
                              {pos.number} - {pos.name}
                            </option>
                          ))}
                        </select>
                        <select
                          value={addForm.team}
                          onChange={(e) => setAddForm((f) => ({ ...f, team: e.target.value as "user" | "rival" }))}
                          className="bg-gray-600 text-white text-sm rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-green-600"
                        >
                          <option value="user">{session?.home_team}</option>
                          <option value="rival">{session?.away_team}</option>
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
                      onClick={() => {
                        const count = lineup.filter((e) => e.team === teamView && e.status !== "substituted_out").length;
                        const next = count + 1;
                        setAddingFor(p.id);
                        setAddForm((f) => ({
                          ...f,
                          position: next <= 15 ? positionByJersey(next) : (p.position ?? ""),
                          jersey_number: String(next),
                          status: next <= 15 ? "on_field" : "bench",
                          team: teamView,
                        }));
                        setError(null);
                      }}
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
      {editError && <p className="text-red-400 text-xs">{editError}</p>}
      <div className="space-y-3">
        {[
          { label: "En cancha", entries: onField },
          { label: "Suplentes", entries: bench },
        ].map(({ label, entries }) => (
          <div key={label} className="bg-gray-800/50 rounded-xl px-4">
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wider pt-3 pb-1">
              {label} ({entries.length})
            </p>
            {entries.length === 0 ? (
              <p className="text-gray-600 text-sm py-2">Sin jugadores.</p>
            ) : (
              entries.map((e) => (
                <div key={e.id} className="py-2 border-b border-gray-700/50">
                  {editingId === e.id ? (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-400">#</span>
                      <input
                        autoFocus
                        type="number"
                        min="1"
                        max="99"
                        value={editJersey}
                        onChange={(ev) => setEditJersey(ev.target.value)}
                        className="w-14 bg-gray-700 text-white text-sm text-center rounded px-2 py-1 outline-none focus:ring-1 focus:ring-green-600"
                      />
                      <span className="flex-1 text-sm text-white truncate">{e.player.name}</span>
                      <button
                        onClick={() => handleEditJersey(e.id)}
                        disabled={editSubmitting}
                        className="text-xs bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white px-2 py-1 rounded transition-colors"
                      >
                        OK
                      </button>
                      <button
                        onClick={() => { setEditingId(null); setEditError(null); }}
                        className="text-xs text-gray-400 hover:text-white px-2 py-1 rounded transition-colors"
                      >
                        ✕
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="w-8 text-right text-sm font-bold text-gray-400">
                        #{e.jersey_number}
                      </span>
                      <span className="flex-1 text-sm text-white truncate">{e.player.name}</span>
                      <span className="text-xs text-gray-500">{e.position ?? e.player.position ?? "—"}</span>
                      {canEdit && (
                        <>
                          <button
                            onClick={() => { setEditingId(e.id); setEditJersey(String(e.jersey_number)); setEditError(null); }}
                            className="text-xs text-gray-500 hover:text-white px-1 transition-colors"
                            title="Editar camiseta"
                          >
                            ✎
                          </button>
                          <button
                            onClick={() => handleDelete(e.id)}
                            disabled={deletingId === e.id}
                            className="text-xs text-gray-600 hover:text-red-400 disabled:opacity-50 px-1 transition-colors"
                            title="Eliminar del lineup"
                          >
                            ×
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              ))
            )}
            <div className="py-1" />
          </div>
        ))}
      </div>
    </div>
  );
}
