import { useEffect, useState } from "react";
import api from "../../lib/axios";
import { parseApiError } from "../../lib/errors";
import { LineupPlayer, useSessionStore } from "../../store/sessionStore";
import { useAuthStore } from "../../store/authStore";

interface AvailablePlayer {
  id: string;
  name: string;
  position: string | null;
}

const EMPTY_FORM = {
  player_id: "",
  jersey_number: "",
  position: "",
  team: "home" as "home" | "away",
  status: "on_field" as "on_field" | "bench",
};

export default function LineupTab({ sessionId }: { sessionId: string }) {
  const user = useAuthStore((s) => s.user);
  const session = useSessionStore((s) => s.session);
  const lineup = useSessionStore((s) => s.lineup);
  const setLineup = useSessionStore((s) => s.setLineup);
  const canEdit = user?.role === "club_admin" || user?.role === "superadmin";

  const [teamView, setTeamView] = useState<"home" | "away">("home");
  const [availablePlayers, setAvailablePlayers] = useState<AvailablePlayer[]>([]);
  const [loadingPlayers, setLoadingPlayers] = useState(false);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load division players for the add form
  useEffect(() => {
    if (!canEdit || !session?.tournament_id || !user?.club_id) return;
    setLoadingPlayers(true);
    api.get(`/clubs/${user.club_id}/tournaments/${session.tournament_id}`)
      .then(({ data: tournament }) =>
        api.get<AvailablePlayer[]>(`/divisions/${tournament.division_id}/players`)
      )
      .then(({ data }) => setAvailablePlayers(data))
      .finally(() => setLoadingPlayers(false));
  }, [session?.tournament_id, user?.club_id]);

  const currentIds = new Set(lineup.map((p) => p.player_id));
  const available = availablePlayers.filter((p) => !currentIds.has(p.id));

  const onField = lineup.filter((p) => p.team === teamView && p.status === "on_field")
    .sort((a, b) => a.jersey_number - b.jersey_number);
  const bench = lineup.filter((p) => p.team === teamView && p.status === "bench")
    .sort((a, b) => a.jersey_number - b.jersey_number);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.post(`/sessions/${sessionId}/lineup`, {
        player_id: form.player_id,
        jersey_number: parseInt(form.jersey_number, 10),
        position: form.position || null,
        team: form.team,
        status: form.status,
      });
      const { data } = await api.get<LineupPlayer[]>(`/sessions/${sessionId}/lineup`);
      setLineup(data);
      setForm(EMPTY_FORM);
      setAdding(false);
    } catch (err) {
      setError(parseApiError(err, "Error al agregar jugador"));
    } finally {
      setSubmitting(false);
    }
  };

  const PlayerRow = ({ p }: { p: LineupPlayer }) => (
    <div className="flex items-center gap-2 py-2 border-b border-gray-700/50">
      <span className="w-8 text-right text-sm font-bold text-gray-400">#{p.jersey_number}</span>
      <span className="flex-1 text-sm text-white">{p.player.name}</span>
      {p.player.position && (
        <span className="text-xs text-gray-500">{p.player.position}</span>
      )}
    </div>
  );

  return (
    <div className="p-4 space-y-4">
      {/* Team toggle */}
      <div className="flex gap-2">
        {(["home", "away"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTeamView(t)}
            className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors ${
              teamView === t ? "bg-green-700 text-white" : "bg-gray-700 text-gray-300"
            }`}
          >
            {t === "home" ? session?.home_team ?? "Local" : session?.away_team ?? "Visitante"}
          </button>
        ))}
      </div>

      {/* On field */}
      <div className="bg-gray-800/50 rounded-xl px-3">
        <p className="text-xs font-bold text-gray-500 uppercase tracking-wider pt-3 pb-1">
          En cancha ({onField.length})
        </p>
        {onField.length === 0 ? (
          <p className="text-gray-600 text-sm py-2">Sin jugadores.</p>
        ) : (
          onField.map((p) => <PlayerRow key={p.id} p={p} />)
        )}
        <div className="py-1" />
      </div>

      {/* Bench */}
      <div className="bg-gray-800/50 rounded-xl px-3">
        <p className="text-xs font-bold text-gray-500 uppercase tracking-wider pt-3 pb-1">
          Suplentes ({bench.length})
        </p>
        {bench.length === 0 ? (
          <p className="text-gray-600 text-sm py-2">Sin suplentes.</p>
        ) : (
          bench.map((p) => <PlayerRow key={p.id} p={p} />)
        )}
        <div className="py-1" />
      </div>

      {/* Add player (club_admin only) */}
      {canEdit && (
        adding ? (
          <form onSubmit={handleAdd} className="bg-gray-800 rounded-xl p-4 space-y-3">
            <p className="text-sm font-semibold text-white">Agregar jugador</p>

            {loadingPlayers ? (
              <p className="text-gray-400 text-sm">Cargando jugadores...</p>
            ) : available.length === 0 ? (
              <p className="text-gray-400 text-sm">
                {availablePlayers.length === 0
                  ? "No hay jugadores en la división."
                  : "Todos los jugadores ya están en el lineup."}
              </p>
            ) : (
              <>
                <select
                  required
                  value={form.player_id}
                  onChange={(e) => {
                    const p = availablePlayers.find((p) => p.id === e.target.value);
                    setForm((f) => ({
                      ...f,
                      player_id: e.target.value,
                      position: p?.position ?? f.position,
                    }));
                  }}
                  className="w-full bg-gray-700 text-white text-sm rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-green-600"
                >
                  <option value="">— Seleccionar jugador —</option>
                  {available.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}{p.position ? ` · ${p.position}` : ""}
                    </option>
                  ))}
                </select>

                <div className="grid grid-cols-2 gap-2">
                  <input
                    required
                    type="number"
                    min="1"
                    max="99"
                    placeholder="N° camiseta"
                    value={form.jersey_number}
                    onChange={(e) => setForm((f) => ({ ...f, jersey_number: e.target.value }))}
                    className="bg-gray-700 text-white text-sm rounded-lg px-3 py-2 placeholder-gray-400 outline-none focus:ring-1 focus:ring-green-600"
                  />
                  <input
                    placeholder="Posición (opcional)"
                    value={form.position}
                    onChange={(e) => setForm((f) => ({ ...f, position: e.target.value }))}
                    className="bg-gray-700 text-white text-sm rounded-lg px-3 py-2 placeholder-gray-400 outline-none focus:ring-1 focus:ring-green-600"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={form.team}
                    onChange={(e) => setForm((f) => ({ ...f, team: e.target.value as "home" | "away" }))}
                    className="bg-gray-700 text-white text-sm rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-green-600"
                  >
                    <option value="home">{session?.home_team ?? "Local"}</option>
                    <option value="away">{session?.away_team ?? "Visitante"}</option>
                  </select>
                  <select
                    value={form.status}
                    onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as "on_field" | "bench" }))}
                    className="bg-gray-700 text-white text-sm rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-green-600"
                  >
                    <option value="on_field">Titular</option>
                    <option value="bench">Suplente</option>
                  </select>
                </div>
              </>
            )}

            {error && <p className="text-red-400 text-xs">{error}</p>}

            <div className="flex gap-2">
              <button
                type="submit"
                disabled={submitting || available.length === 0}
                className="text-sm bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white px-4 py-2 rounded-lg transition-colors"
              >
                {submitting ? "Guardando..." : "Agregar"}
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
        ) : (
          <button
            onClick={() => setAdding(true)}
            className="w-full bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm font-semibold rounded-xl py-3 transition-colors"
          >
            + Agregar jugador al lineup
          </button>
        )
      )}
    </div>
  );
}
