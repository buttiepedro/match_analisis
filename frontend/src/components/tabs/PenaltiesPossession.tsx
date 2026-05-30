import EventButton from "../EventButton";
import { countEvents, EventData } from "../../store/sessionStore";

const PENALTY_REASONS = [
  "offside",
  "obstruction",
  "high_tackle",
  "collapsed_scrum",
  "not_rolling_away",
  "other",
];

const PENALTY_TYPES = [
  { type: "penalty_conceded", label: "🔴 Penal Cometido", showPlayer: true, reasons: PENALTY_REASONS },
  { type: "penalty_won", label: "✓ Penal Ganado", showPlayer: false },
  { type: "yellow_card", label: "🟡 Amarilla", showPlayer: true },
  { type: "red_card", label: "🔴 Roja", showPlayer: true },
];

const POSSESSION_TYPES = [
  { type: "turnover_conceded", label: "↩ Turnover Perdido", showPlayer: false },
  { type: "turnover_won", label: "↪ Turnover Ganado", showPlayer: false },
  { type: "knock_on", label: "✋ Knock-on", showPlayer: true },
  { type: "forward_pass", label: "→✗ Pase Adelantado", showPlayer: true },
];

interface Props {
  sessionId: string;
  events: EventData[];
  homeTeam: string;
  awayTeam: string;
  onEvent: () => void;
}

export default function PenaltiesPossession({ sessionId, events, homeTeam, awayTeam, onEvent }: Props) {
  const penalties = countEvents(events, ["penalty_conceded"]);
  const turnovers = countEvents(events, ["turnover_conceded"]);

  return (
    <div className="p-4 space-y-4">
      {/* Penalty count */}
      <div className="flex justify-between text-sm font-semibold text-gray-300 bg-gray-800 rounded-xl px-4 py-2">
        <span>Penales: {homeTeam} <span className="text-white">{penalties.home}</span></span>
        <span>{awayTeam} <span className="text-white">{penalties.away}</span></span>
      </div>

      {/* Column headers */}
      <div className="grid grid-cols-2 gap-2 text-center text-xs font-bold text-gray-400 uppercase">
        <span>{homeTeam}</span>
        <span>{awayTeam}</span>
      </div>

      {/* Penalties */}
      <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">Penales</p>
      {PENALTY_TYPES.map(({ type, label, showPlayer, reasons }) => (
        <div key={type} className="grid grid-cols-2 gap-2">
          <EventButton
            label={label}
            eventType={type}
            team="home"
            sessionId={sessionId}
            showPlayerInput={showPlayer}
            reasons={reasons}
            onSuccess={onEvent}
          />
          <EventButton
            label={label}
            eventType={type}
            team="away"
            sessionId={sessionId}
            showPlayerInput={showPlayer}
            reasons={reasons}
            onSuccess={onEvent}
          />
        </div>
      ))}

      {/* Possession */}
      <div className="flex justify-between text-sm font-semibold text-gray-300 bg-gray-800 rounded-xl px-4 py-2 mt-2">
        <span>Turnovers: {homeTeam} <span className="text-white">{turnovers.home}</span></span>
        <span>{awayTeam} <span className="text-white">{turnovers.away}</span></span>
      </div>
      <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">Posesion</p>
      {POSSESSION_TYPES.map(({ type, label, showPlayer }) => (
        <div key={type} className="grid grid-cols-2 gap-2">
          <EventButton
            label={label}
            eventType={type}
            team="home"
            sessionId={sessionId}
            showPlayerInput={showPlayer}
            onSuccess={onEvent}
          />
          <EventButton
            label={label}
            eventType={type}
            team="away"
            sessionId={sessionId}
            showPlayerInput={showPlayer}
            onSuccess={onEvent}
          />
        </div>
      ))}
    </div>
  );
}
