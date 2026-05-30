import { useState } from "react";
import api from "../../lib/axios";
import { parseApiError } from "../../lib/errors";
import { LineupPlayer, useSessionStore } from "../../store/sessionStore";
import SubstitutionModal from "../SubstitutionModal";

interface Props {
  sessionId: string;
  homeTeam: string;
}

function TackleRow({
  entry,
  sessionId,
}: {
  entry: LineupPlayer;
  sessionId: string;
}) {
  const [loading, setLoading] = useState<"" | "missed" | "effective">("");
  const [error, setError] = useState("");

  const register = async (type: "tackle_missed" | "tackle_effective") => {
    setLoading(type === "tackle_missed" ? "missed" : "effective");
    setError("");
    try {
      await api.post(`/sessions/${sessionId}/events`, {
        event_type: type,
        team: entry.team,
        player_number: entry.jersey_number,
        metadata: { player_id: entry.player_id, player_name: entry.player.name },
      });
    } catch (err) {
      setError(parseApiError(err, "Error al registrar"));
    } finally {
      setLoading("");
    }
  };

  return (
    <div className="flex items-center gap-2 py-2 border-b border-gray-700/50">
      <span className="w-8 text-right text-sm font-bold text-gray-400">
        #{entry.jersey_number}
      </span>
      <span className="flex-1 text-sm text-white truncate">
        {entry.player.name}
        {error && <span className="block text-xs text-red-400">{error}</span>}
      </span>
      <button
        onClick={() => register("tackle_missed")}
        disabled={loading !== ""}
        className="bg-red-800 hover:bg-red-700 disabled:opacity-50 text-white text-xs font-bold px-3 py-2 rounded-lg transition-colors min-w-[64px]"
      >
        {loading === "missed" ? "..." : "Errado"}
      </button>
      <button
        onClick={() => register("tackle_effective")}
        disabled={loading !== ""}
        className="bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white text-xs font-bold px-3 py-2 rounded-lg transition-colors min-w-[64px]"
      >
        {loading === "effective" ? "..." : "Efectivo"}
      </button>
    </div>
  );
}

export default function Tackles({ sessionId, homeTeam }: Props) {
  const lineup = useSessionStore((s) => s.lineup);
  const [showSub, setShowSub] = useState(false);

  const onField = lineup.filter((p) => p.team === "home" && p.status === "on_field");
  const bench = lineup.filter((p) => p.team === "home" && p.status === "bench");

  if (lineup.length === 0) {
    return (
      <div className="p-6 text-center text-gray-500 text-sm">
        No hay lineup definido para este partido.
        <br />
        El club_admin debe cargar los jugadores.
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between bg-gray-800 rounded-xl px-4 py-2">
        <span className="text-sm font-semibold text-white">{homeTeam}</span>
        <span className="text-xs text-gray-400">{onField.length} en cancha</span>
      </div>

      {/* On-field players */}
      <div className="bg-gray-800/50 rounded-xl px-3">
        <p className="text-xs font-bold text-gray-500 uppercase tracking-wider pt-3 pb-1">
          En Cancha
        </p>
        {onField.length === 0 ? (
          <p className="text-gray-500 text-sm py-2">Sin jugadores en cancha</p>
        ) : (
          onField
            .sort((a, b) => a.jersey_number - b.jersey_number)
            .map((entry) => (
              <TackleRow key={entry.id} entry={entry} sessionId={sessionId} />
            ))
        )}
        <div className="py-2" />
      </div>

      {/* Substitution button */}
      <button
        onClick={() => setShowSub(true)}
        className="w-full bg-yellow-700 hover:bg-yellow-600 text-white font-semibold rounded-xl py-3 text-sm transition-colors"
      >
        🔄 Registrar Cambio
      </button>

      {/* Bench */}
      {bench.length > 0 && (
        <div className="bg-gray-800/50 rounded-xl px-3">
          <p className="text-xs font-bold text-gray-500 uppercase tracking-wider pt-3 pb-1">
            Suplentes
          </p>
          {bench
            .sort((a, b) => a.jersey_number - b.jersey_number)
            .map((entry) => (
              <div
                key={entry.id}
                className="flex items-center gap-2 py-2 border-b border-gray-700/50"
              >
                <span className="w-8 text-right text-sm font-bold text-gray-500">
                  #{entry.jersey_number}
                </span>
                <span className="text-sm text-gray-400">{entry.player.name}</span>
              </div>
            ))}
          <div className="py-2" />
        </div>
      )}

      {showSub && (
        <SubstitutionModal sessionId={sessionId} onClose={() => setShowSub(false)} />
      )}
    </div>
  );
}
