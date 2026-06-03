import { useState } from "react";
import api from "../../lib/axios";
import { parseApiError } from "../../lib/errors";
import { useSessionStore, EventData } from "../../store/sessionStore";
import EventLog from "../EventLog";

interface ActionConfig {
  label: string;
  eventType: string;
  color: string;
}

const ACTIONS: ActionConfig[] = [
  { label: "Line A Favor", eventType: "lineout_favor", color: "bg-blue-700 hover:bg-blue-600" },
  { label: "Line En Contra", eventType: "lineout_against", color: "bg-red-700 hover:bg-red-600" },
  { label: "Scrum A Favor", eventType: "scrum_favor", color: "bg-blue-700 hover:bg-blue-600" },
  { label: "Scrum En Contra", eventType: "scrum_against", color: "bg-red-700 hover:bg-red-600" },
];

interface Props {
  sessionId: string;
  onEvent: () => void;
}

function countObtained(events: EventData[], type: string) {
  const evs = events.filter((e) => e.event_type === type);
  return {
    won: evs.filter((e) => e.metadata?.obtained === true).length,
    lost: evs.filter((e) => e.metadata?.obtained === false).length,
  };
}

function countExits(events: EventData[], type: string, teamSide: "own" | "rival") {
  const evs = events.filter((e) => e.event_type === type && e.metadata?.team === teamSide);
  return {
    withReception: evs.filter((e) => e.metadata?.reception === true).length,
    withoutReception: evs.filter((e) => e.metadata?.reception === false).length,
  };
}

function SetpieceCounter({
  label,
  won,
  lost,
}: {
  label: string;
  won: number;
  lost: number;
}) {
  return (
    <div className="flex items-center justify-between px-3 py-1.5">
      <span className="text-gray-400 text-xs w-20 shrink-0">{label}</span>
      <span className="text-xs text-green-400 font-semibold">Ganados: <span className="text-white">{won}</span></span>
      <span className="text-xs text-red-400 font-semibold ml-4">Perdidos: <span className="text-white">{lost}</span></span>
    </div>
  );
}

function ExitCounter({
  teamLabel,
  withReception,
  withoutReception,
}: {
  teamLabel: string;
  withReception: number;
  withoutReception: number;
}) {
  return (
    <div className="flex items-center justify-between px-3 py-1.5">
      <span className="text-gray-400 text-xs w-16 shrink-0">{teamLabel}</span>
      <span className="text-xs text-green-400 font-semibold">Con recep.: <span className="text-white">{withReception}</span></span>
      <span className="text-xs text-red-400 font-semibold ml-4">Sin recep.: <span className="text-white">{withoutReception}</span></span>
    </div>
  );
}

function ExitModal({
  exitConfig,
  sessionId,
  onClose,
  onEvent,
}: {
  exitConfig: { eventType: "line_exit" | "scrum_exit"; teamSide: "own" | "rival" };
  sessionId: string;
  onClose: () => void;
  onEvent: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const register = async (reception: boolean) => {
    setLoading(true);
    setError("");
    try {
      await api.post(`/sessions/${sessionId}/events`, {
        event_type: exitConfig.eventType,
        team: "home",
        metadata: { team: exitConfig.teamSide, reception },
      });
      onEvent();
      onClose();
    } catch (err) {
      setError(parseApiError(err, "Error al registrar el evento"));
    } finally {
      setLoading(false);
    }
  };

  const title = `Salida de ${exitConfig.eventType === "line_exit" ? "Line" : "Scrum"} — ${exitConfig.teamSide === "own" ? "Propia" : "Rival"}`;

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative bg-gray-800 rounded-t-2xl p-5 space-y-4">
        <p className="text-white font-bold text-lg">{title}</p>
        <p className="text-gray-400 text-sm">¿Con recepción?</p>

        {error && <p className="text-red-400 text-sm">{error}</p>}

        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => register(true)}
            disabled={loading}
            className="bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white font-bold rounded-xl py-5 text-base transition-colors"
          >
            ✓ Con recepción
          </button>
          <button
            onClick={() => register(false)}
            disabled={loading}
            className="bg-red-800 hover:bg-red-700 disabled:opacity-50 text-white font-bold rounded-xl py-5 text-base transition-colors"
          >
            ✗ Sin recepción
          </button>
        </div>

        <button onClick={onClose} className="w-full text-gray-400 text-sm py-2">
          Cancelar
        </button>
      </div>
    </div>
  );
}

function ObtentionModal({
  action,
  sessionId,
  onClose,
  onEvent,
}: {
  action: ActionConfig;
  sessionId: string;
  onClose: () => void;
  onEvent: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const register = async (obtained: boolean) => {
    setLoading(true);
    setError("");
    try {
      await api.post(`/sessions/${sessionId}/events`, {
        event_type: action.eventType,
        team: "home",
        metadata: { obtained },
      });
      onEvent();
      onClose();
    } catch (err) {
      setError(parseApiError(err, "Error al registrar el evento"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative bg-gray-800 rounded-t-2xl p-5 space-y-4">
        <p className="text-white font-bold text-lg">{action.label}</p>
        <p className="text-gray-400 text-sm">¿Con obtención del balón?</p>

        {error && <p className="text-red-400 text-sm">{error}</p>}

        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => register(true)}
            disabled={loading}
            className="bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white font-bold rounded-xl py-5 text-base transition-colors"
          >
            ✓ Con obtención
          </button>
          <button
            onClick={() => register(false)}
            disabled={loading}
            className="bg-red-800 hover:bg-red-700 disabled:opacity-50 text-white font-bold rounded-xl py-5 text-base transition-colors"
          >
            ✗ Sin obtención
          </button>
        </div>

        <button
          onClick={onClose}
          className="w-full text-gray-400 text-sm py-2"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}

export default function LinesScrum({ sessionId, onEvent }: Props) {
  const [active, setActive] = useState<ActionConfig | null>(null);
  const [activeExit, setActiveExit] = useState<{
    eventType: "line_exit" | "scrum_exit";
    teamSide: "own" | "rival";
  } | null>(null);
  const events = useSessionStore((s) => s.events);
  const LINE_SCRUM_TYPES = ["lineout_favor", "lineout_against", "scrum_favor", "scrum_against", "line_exit", "scrum_exit"];

  const lineFavor  = countObtained(events, "lineout_favor");
  const lineAgainst = countObtained(events, "lineout_against");
  const scrumFavor  = countObtained(events, "scrum_favor");
  const scrumAgainst = countObtained(events, "scrum_against");

  const lineExitOwn   = countExits(events, "line_exit", "own");
  const lineExitRival = countExits(events, "line_exit", "rival");
  const scrumExitOwn   = countExits(events, "scrum_exit", "own");
  const scrumExitRival = countExits(events, "scrum_exit", "rival");

  return (
    <div className="p-4 space-y-3">
      {/* Lines counters */}
      <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">
        Line-outs
      </p>
      <div className="bg-gray-800 rounded-xl mb-2 py-1">
        <SetpieceCounter label="A favor"   won={lineFavor.won}   lost={lineFavor.lost} />
        <SetpieceCounter label="En contra" won={lineAgainst.won} lost={lineAgainst.lost} />
      </div>
      {ACTIONS.slice(0, 2).map((a) => (
        <button
          key={a.eventType}
          onClick={() => setActive(a)}
          className={`${a.color} w-full text-white font-bold rounded-2xl py-6 text-base transition-colors`}
        >
          {a.label}
        </button>
      ))}

      {/* Scrums counters */}
      <p className="text-xs font-bold text-gray-500 uppercase tracking-wider pt-4">
        Scrums
      </p>
      <div className="bg-gray-800 rounded-xl mb-2 py-1">
        <SetpieceCounter label="A favor"   won={scrumFavor.won}   lost={scrumFavor.lost} />
        <SetpieceCounter label="En contra" won={scrumAgainst.won} lost={scrumAgainst.lost} />
      </div>
      {ACTIONS.slice(2).map((a) => (
        <button
          key={a.eventType}
          onClick={() => setActive(a)}
          className={`${a.color} w-full text-white font-bold rounded-2xl py-6 text-base transition-colors`}
        >
          {a.label}
        </button>
      ))}

      {/* Salidas */}
      <p className="text-xs font-bold text-gray-500 uppercase tracking-wider pt-4">
        Salidas
      </p>

      <p className="text-xs text-gray-400 mb-1">Line</p>
      <div className="bg-gray-800 rounded-xl mb-2 py-1">
        <ExitCounter teamLabel="Propia" withReception={lineExitOwn.withReception} withoutReception={lineExitOwn.withoutReception} />
        <ExitCounter teamLabel="Rival"  withReception={lineExitRival.withReception} withoutReception={lineExitRival.withoutReception} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => setActiveExit({ eventType: "line_exit", teamSide: "own" })}
          className="bg-blue-700 hover:bg-blue-600 text-white font-bold rounded-2xl py-5 text-base transition-colors"
        >
          Propia
        </button>
        <button
          onClick={() => setActiveExit({ eventType: "line_exit", teamSide: "rival" })}
          className="bg-orange-700 hover:bg-orange-600 text-white font-bold rounded-2xl py-5 text-base transition-colors"
        >
          Rival
        </button>
      </div>

      <p className="text-xs text-gray-400 mb-1 pt-3">Scrum</p>
      <div className="bg-gray-800 rounded-xl mb-2 py-1">
        <ExitCounter teamLabel="Propia" withReception={scrumExitOwn.withReception} withoutReception={scrumExitOwn.withoutReception} />
        <ExitCounter teamLabel="Rival"  withReception={scrumExitRival.withReception} withoutReception={scrumExitRival.withoutReception} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => setActiveExit({ eventType: "scrum_exit", teamSide: "own" })}
          className="bg-blue-700 hover:bg-blue-600 text-white font-bold rounded-2xl py-5 text-base transition-colors"
        >
          Propia
        </button>
        <button
          onClick={() => setActiveExit({ eventType: "scrum_exit", teamSide: "rival" })}
          className="bg-orange-700 hover:bg-orange-600 text-white font-bold rounded-2xl py-5 text-base transition-colors"
        >
          Rival
        </button>
      </div>

      {active && (
        <ObtentionModal
          action={active}
          sessionId={sessionId}
          onClose={() => setActive(null)}
          onEvent={onEvent}
        />
      )}

      {activeExit && (
        <ExitModal
          exitConfig={activeExit}
          sessionId={sessionId}
          onClose={() => setActiveExit(null)}
          onEvent={onEvent}
        />
      )}

      <EventLog sessionId={sessionId} types={LINE_SCRUM_TYPES} />
    </div>
  );
}
