import { useState } from "react";
import api from "../lib/axios";
import { parseApiError } from "../lib/errors";
import { EventData, LineupPlayer, useSessionStore } from "../store/sessionStore";

const EVENT_LABELS: Record<string, string> = {
  tackle_effective: "Tackle efectivo",
  tackle_missed: "Tackle errado",
  yellow_card: "Tarjeta amarilla",
  red_card: "Tarjeta roja",
  knock_on: "Knock-on",
  forward_pass: "Pase adelantado",
  penalty_conceded: "Penal cometido",
  penalty_won: "Penal ganado",
  turnover_conceded: "Turnover perdido",
  turnover_won: "Turnover ganado",
  lineout_favor: "Line a favor",
  lineout_against: "Line en contra",
  scrum_favor: "Scrum a favor",
  scrum_against: "Scrum en contra",
  substitution: "Cambio",
};

const REASON_LABELS: Record<string, string> = {
  offside: "Offside",
  obstruction: "Obstrucción",
  high_tackle: "Tackle alto",
  collapsed_scrum: "Scrum derrumbado",
  not_rolling_away: "No se retira",
  other: "Otro",
};

const SETPIECE_TYPES = ["lineout_favor", "lineout_against", "scrum_favor", "scrum_against"];

function fmt(half: number, seconds: number) {
  const m = Math.floor(seconds / 60).toString().padStart(2, "0");
  const s = (seconds % 60).toString().padStart(2, "0");
  return `T${half} ${m}:${s}`;
}

function playerName(event: EventData, lineup: LineupPlayer[]): string | null {
  if (!event.player_id) return null;
  const entry = lineup.find((p) => p.player_id === event.player_id);
  return entry ? `#${entry.jersey_number} ${entry.player.name}` : null;
}

function EventDescription({ e, lineup }: { e: EventData; lineup: LineupPlayer[] }) {
  // Substitution: names come from metadata
  if (e.event_type === "substitution") {
    const outN = e.metadata?.player_out_number as number | undefined;
    const outName = e.metadata?.player_out_name as string | undefined;
    const inN = e.metadata?.player_in_number as number | undefined;
    const inName = e.metadata?.player_in_name as string | undefined;
    if (outName && inName) {
      return (
        <>
          <span className="text-white">Cambio</span>
          <span className="text-gray-400"> #{outN} {outName}</span>
          <span className="text-gray-500"> → </span>
          <span className="text-gray-400">#{inN} {inName}</span>
        </>
      );
    }
    return <span className="text-white">Cambio</span>;
  }

  const base = EVENT_LABELS[e.event_type] ?? e.event_type;
  const name = playerName(e, lineup);
  const isSetpiece = SETPIECE_TYPES.includes(e.event_type);
  const obtained = e.metadata?.obtained;
  const reason = e.reason ? (REASON_LABELS[e.reason] ?? e.reason) : null;

  return (
    <>
      <span className="text-white">{base}</span>
      {name && <span className="text-gray-400"> · {name}</span>}
      {isSetpiece && obtained !== undefined && (
        <span className={obtained ? "text-green-400" : "text-red-400"}>
          {" · "}{obtained ? "Con obtención" : "Sin obtención"}
        </span>
      )}
      {reason && <span className="text-gray-500"> · {reason}</span>}
    </>
  );
}

interface Props {
  sessionId: string;
  types: string[];
}

export default function EventLog({ sessionId, types }: Props) {
  const events = useSessionStore((s) => s.events);
  const lineup = useSessionStore((s) => s.lineup);
  const removeEvent = useSessionStore((s) => s.removeEvent);

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const filtered = events
    .filter((e) => types.includes(e.event_type))
    .slice()
    .sort((a, b) => b.half - a.half || b.timer_seconds - a.timer_seconds);

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    setError(null);
    try {
      await api.delete(`/sessions/${sessionId}/events/${id}`);
      removeEvent(id);
    } catch (err) {
      setError(parseApiError(err, "Error al eliminar el evento"));
    } finally {
      setDeletingId(null);
    }
  };

  if (filtered.length === 0) return null;

  return (
    <div className="mt-4 px-4 pb-4">
      <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
        Registro de eventos
      </p>
      {error && <p className="text-red-400 text-xs mb-2">{error}</p>}
      <ul className="space-y-1">
        {filtered.map((e) => (
          <li
            key={e.id}
            className="flex items-center justify-between bg-gray-800/60 rounded-lg px-3 py-2 gap-2"
          >
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-xs text-gray-500 shrink-0 font-mono">
                {fmt(e.half, e.timer_seconds)}
              </span>
              <span className={`text-xs shrink-0 font-semibold px-1.5 py-0.5 rounded ${
                e.team === "home" ? "bg-blue-900/60 text-blue-300" : "bg-orange-900/60 text-orange-300"
              }`}>
                {e.team === "home" ? "L" : "V"}
              </span>
              <span className="text-xs truncate">
                <EventDescription e={e} lineup={lineup} />
              </span>
            </div>
            <button
              onClick={() => handleDelete(e.id)}
              disabled={deletingId === e.id}
              className="text-gray-600 hover:text-red-400 disabled:opacity-50 transition-colors shrink-0 text-base leading-none"
              aria-label="Eliminar evento"
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
