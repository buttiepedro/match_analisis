import { useEffect, useState } from "react";
import api from "../lib/axios";
import { useAuthStore } from "../store/authStore";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Session {
  id: string;
  home_team: string;
  away_team: string;
  scheduled_at: string | null;
  status: string;
}

interface RawEvent {
  event_type: string;
  player_id: string | null;
}

interface LineupEntry {
  player_id: string;
  player: { name: string };
}

interface PlayerStats {
  player_id: string;
  name: string;
  tackle_effective: number;
  tackle_missed: number;
  yellow_card: number;
  red_card: number;
  errors: number;
}

interface SessionStats {
  id: string;
  home_team: string;
  away_team: string;
  scheduled_at: string | null;
  tackle_effective: number;
  tackle_missed: number;
  yellow_card: number;
  red_card: number;
  errors: number;
  scrum_favor: number;
  scrum_against: number;
  lineout_favor: number;
  lineout_against: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function count(events: RawEvent[], type: string) {
  return events.filter((e) => e.event_type === type).length;
}

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-AR", { day: "numeric", month: "short", year: "2-digit" });
}

// ── Component ─────────────────────────────────────────────────────────────────

type View = "players" | "sessions";

export default function Stats() {
  const user = useAuthStore((s) => s.user);
  const [loading, setLoading] = useState(true);
  const [playerStats, setPlayerStats] = useState<PlayerStats[]>([]);
  const [sessionStats, setSessionStats] = useState<SessionStats[]>([]);
  const [view, setView] = useState<View>("players");

  useEffect(() => {
    const clubId = user?.club_id;
    if (!clubId) { setLoading(false); return; }

    (async () => {
      try {
        // 1. Tournaments
        const { data: tournaments } = await api.get<{ id: string }[]>(`/clubs/${clubId}/tournaments`);

        // 2. Sessions for all tournaments
        const sessionGroups = await Promise.all(
          tournaments.map((t) =>
            api.get<Session[]>(`/tournaments/${t.id}/sessions`)
              .then(({ data }) => data)
              .catch(() => [] as Session[])
          )
        );
        const sessions = sessionGroups.flat();

        // 3. Events + lineup for all sessions in parallel
        const sessionData = await Promise.all(
          sessions.map((s) =>
            Promise.all([
              api.get<RawEvent[]>(`/sessions/${s.id}/events`).then(({ data }) => data).catch(() => []),
              api.get<LineupEntry[]>(`/sessions/${s.id}/lineup`).then(({ data }) => data).catch(() => []),
            ]).then(([events, lineup]) => ({ session: s, events, lineup }))
          )
        );

        // 4. Build player name map across all lineups
        const playerNames: Record<string, string> = {};
        sessionData.forEach(({ lineup }) => {
          lineup.forEach((e) => { playerNames[e.player_id] = e.player.name; });
        });

        // 5. Per-session stats
        const sStats: SessionStats[] = sessionData.map(({ session, events }) => ({
          id: session.id,
          home_team: session.home_team,
          away_team: session.away_team,
          scheduled_at: session.scheduled_at,
          tackle_effective: count(events, "tackle_effective"),
          tackle_missed: count(events, "tackle_missed"),
          yellow_card: count(events, "yellow_card"),
          red_card: count(events, "red_card"),
          errors: count(events, "knock_on") + count(events, "forward_pass"),
          scrum_favor: count(events, "scrum_favor"),
          scrum_against: count(events, "scrum_against"),
          lineout_favor: count(events, "lineout_favor"),
          lineout_against: count(events, "lineout_against"),
        }));
        sStats.sort((a, b) => (b.scheduled_at ?? "").localeCompare(a.scheduled_at ?? ""));

        // 6. Per-player stats across all sessions
        const pMap: Record<string, PlayerStats> = {};
        sessionData.forEach(({ events }) => {
          events.forEach((e) => {
            if (!e.player_id) return;
            if (!pMap[e.player_id]) {
              pMap[e.player_id] = {
                player_id: e.player_id,
                name: playerNames[e.player_id] ?? "Desconocido",
                tackle_effective: 0,
                tackle_missed: 0,
                yellow_card: 0,
                red_card: 0,
                errors: 0,
              };
            }
            const s = pMap[e.player_id];
            if (e.event_type === "tackle_effective") s.tackle_effective++;
            else if (e.event_type === "tackle_missed") s.tackle_missed++;
            else if (e.event_type === "yellow_card") s.yellow_card++;
            else if (e.event_type === "red_card") s.red_card++;
            else if (e.event_type === "knock_on" || e.event_type === "forward_pass") s.errors++;
          });
        });
        const pStats = Object.values(pMap).sort((a, b) =>
          (b.tackle_effective + b.tackle_missed) - (a.tackle_effective + a.tackle_missed)
        );

        setSessionStats(sStats);
        setPlayerStats(pStats);
      } finally {
        setLoading(false);
      }
    })();
  }, [user?.club_id]);

  return (
    <div className="p-6 max-w-4xl">
      <h1 className="text-xl font-bold text-white mb-5">Estadísticas</h1>

      {/* View toggle */}
      <div className="flex gap-2 mb-6">
        <button
          onClick={() => setView("players")}
          className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
            view === "players" ? "bg-green-700 text-white" : "bg-gray-700 text-gray-300"
          }`}
        >
          Por jugador
        </button>
        <button
          onClick={() => setView("sessions")}
          className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
            view === "sessions" ? "bg-green-700 text-white" : "bg-gray-700 text-gray-300"
          }`}
        >
          Por partido
        </button>
      </div>

      {loading ? (
        <p className="text-gray-400 text-sm">Cargando estadísticas...</p>
      ) : view === "players" ? (
        <PlayerView stats={playerStats} />
      ) : (
        <SessionView stats={sessionStats} />
      )}
    </div>
  );
}

// ── Per-player table ──────────────────────────────────────────────────────────

function PlayerView({ stats }: { stats: PlayerStats[] }) {
  if (stats.length === 0) {
    return <p className="text-gray-500 text-sm">Sin datos. Registrá eventos con jugadores asociados.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-xl">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-gray-800 text-gray-400 text-xs uppercase tracking-wide">
            <th className="text-left px-4 py-3">Jugador</th>
            <th className="px-3 py-3 text-center">Tk. Ef.</th>
            <th className="px-3 py-3 text-center">Tk. Err.</th>
            <th className="px-3 py-3 text-center">Amarillas</th>
            <th className="px-3 py-3 text-center">Rojas</th>
            <th className="px-3 py-3 text-center">Errores</th>
          </tr>
        </thead>
        <tbody>
          {stats.map((p, i) => (
            <tr
              key={p.player_id}
              className={`border-t border-gray-700 ${i % 2 === 0 ? "bg-gray-800/40" : ""}`}
            >
              <td className="px-4 py-3 text-white font-medium">{p.name}</td>
              <td className="px-3 py-3 text-center text-green-400 font-bold">{p.tackle_effective}</td>
              <td className="px-3 py-3 text-center text-red-400 font-bold">{p.tackle_missed}</td>
              <td className="px-3 py-3 text-center text-yellow-400 font-bold">{p.yellow_card}</td>
              <td className="px-3 py-3 text-center text-red-600 font-bold">{p.red_card}</td>
              <td className="px-3 py-3 text-center text-orange-400 font-bold">{p.errors}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Per-session table ─────────────────────────────────────────────────────────

function SessionView({ stats }: { stats: SessionStats[] }) {
  if (stats.length === 0) {
    return <p className="text-gray-500 text-sm">Sin partidos registrados.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-xl">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-gray-800 text-gray-400 text-xs uppercase tracking-wide">
            <th className="text-left px-4 py-3">Partido</th>
            <th className="px-3 py-3 text-center whitespace-nowrap">Fecha</th>
            <th className="px-3 py-3 text-center">Tk. Ef.</th>
            <th className="px-3 py-3 text-center">Tk. Err.</th>
            <th className="px-3 py-3 text-center">Amarillas</th>
            <th className="px-3 py-3 text-center">Rojas</th>
            <th className="px-3 py-3 text-center">Errores</th>
            <th className="px-3 py-3 text-center whitespace-nowrap">Scrum +</th>
            <th className="px-3 py-3 text-center whitespace-nowrap">Scrum −</th>
            <th className="px-3 py-3 text-center whitespace-nowrap">Line +</th>
            <th className="px-3 py-3 text-center whitespace-nowrap">Line −</th>
          </tr>
        </thead>
        <tbody>
          {stats.map((s, i) => (
            <tr
              key={s.id}
              className={`border-t border-gray-700 ${i % 2 === 0 ? "bg-gray-800/40" : ""}`}
            >
              <td className="px-4 py-3 text-white font-medium whitespace-nowrap">
                {s.home_team} vs {s.away_team}
              </td>
              <td className="px-3 py-3 text-center text-gray-400 whitespace-nowrap">
                {fmtDate(s.scheduled_at)}
              </td>
              <td className="px-3 py-3 text-center text-green-400 font-bold">{s.tackle_effective}</td>
              <td className="px-3 py-3 text-center text-red-400 font-bold">{s.tackle_missed}</td>
              <td className="px-3 py-3 text-center text-yellow-400 font-bold">{s.yellow_card}</td>
              <td className="px-3 py-3 text-center text-red-600 font-bold">{s.red_card}</td>
              <td className="px-3 py-3 text-center text-orange-400 font-bold">{s.errors}</td>
              <td className="px-3 py-3 text-center text-blue-400 font-bold">{s.scrum_favor}</td>
              <td className="px-3 py-3 text-center text-gray-400 font-bold">{s.scrum_against}</td>
              <td className="px-3 py-3 text-center text-blue-400 font-bold">{s.lineout_favor}</td>
              <td className="px-3 py-3 text-center text-gray-400 font-bold">{s.lineout_against}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
