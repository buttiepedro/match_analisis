import { useState } from "react";
import { useEventRegistrar } from "../../lib/useEventRegistrar";
import { useSessionStore, EventData } from "../../store/sessionStore";
import EventLog from "../EventLog";

interface ActionConfig {
  label: string;
  eventType: string;
  color: string;
}

const ACTIONS: ActionConfig[] = [
  { label: "Line A Favor",     eventType: "lineout_favor",  color: "bg-blue-700 hover:bg-blue-600" },
  { label: "Line En Contra",   eventType: "lineout_against", color: "bg-red-700 hover:bg-red-600" },
  { label: "Scrum A Favor",    eventType: "scrum_favor",    color: "bg-blue-700 hover:bg-blue-600" },
  { label: "Scrum En Contra",  eventType: "scrum_against",  color: "bg-red-700 hover:bg-red-600" },
  { label: "Salida A Favor",   eventType: "exit_favor",     color: "bg-blue-700 hover:bg-blue-600" },
  { label: "Salida En Contra", eventType: "exit_against",   color: "bg-red-700 hover:bg-red-600" },
];

const LINE_SCRUM_TYPES = [
  "lineout_favor", "lineout_against",
  "scrum_favor", "scrum_against",
  "exit_favor", "exit_against",
];

interface Props {
  sessionId: string;
}

function countObtained(events: EventData[], type: string) {
  const evs = events.filter((e) => e.event_type === type);
  return {
    won:  evs.filter((e) => e.metadata?.obtained === true).length,
    lost: evs.filter((e) => e.metadata?.obtained === false).length,
  };
}

function SetpieceCounter({ label, won, lost }: { label: string; won: number; lost: number }) {
  return (
    <div className="flex items-center justify-between px-3 py-1.5">
      <span className="text-gray-400 text-xs w-20 shrink-0">{label}</span>
      <span className="text-xs text-green-400 font-semibold">Ganados: <span className="text-white">{won}</span></span>
      <span className="text-xs text-red-400 font-semibold ml-4">Perdidos: <span className="text-white">{lost}</span></span>
    </div>
  );
}

function ObtentionModal({
  action,
  sessionId,
  onClose,
}: {
  action: ActionConfig;
  sessionId: string;
  onClose: () => void;
}) {
  const { register: registerEvent, loading, error } = useEventRegistrar(sessionId);

  const register = async (obtained: boolean) => {
    const ok = await registerEvent(action.eventType, {
      team: "user",
      metadata: { obtained },
    });
    if (ok) onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/60 animate-overlay" onClick={onClose} />
      <div className="relative bg-gray-800 rounded-t-2xl p-5 space-y-4 animate-sheet">
        <p className="text-white font-bold text-lg">{action.label}</p>
        <p className="text-gray-400 text-sm">¿Con obtención del balón?</p>

        {error && <p className="text-red-400 text-sm">{error}</p>}

        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => register(true)}
            disabled={loading}
            className="pressable bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white font-bold rounded-xl py-5 text-base transition-colors duration-150"
          >
            ✓ Con obtención
          </button>
          <button
            onClick={() => register(false)}
            disabled={loading}
            className="pressable bg-red-800 hover:bg-red-700 disabled:opacity-50 text-white font-bold rounded-xl py-5 text-base transition-colors duration-150"
          >
            ✗ Sin obtención
          </button>
        </div>

        <button onClick={onClose} className="w-full text-gray-400 text-sm py-2">
          Cancelar
        </button>
      </div>
    </div>
  );
}

export default function LinesScrum({ sessionId }: Props) {
  const [active, setActive] = useState<ActionConfig | null>(null);
  const events = useSessionStore((s) => s.events);

  const lineFavor    = countObtained(events, "lineout_favor");
  const lineAgainst  = countObtained(events, "lineout_against");
  const scrumFavor   = countObtained(events, "scrum_favor");
  const scrumAgainst = countObtained(events, "scrum_against");
  const exitFavor    = countObtained(events, "exit_favor");
  const exitAgainst  = countObtained(events, "exit_against");

  return (
    <div className="p-4 space-y-3">
      {/* Line-outs */}
      <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Line-outs</p>
      <div className="bg-gray-800 rounded-xl mb-2 py-1">
        <SetpieceCounter label="A favor"   won={lineFavor.won}   lost={lineFavor.lost} />
        <SetpieceCounter label="En contra" won={lineAgainst.won} lost={lineAgainst.lost} />
      </div>
      {ACTIONS.slice(0, 2).map((a) => (
        <button key={a.eventType} onClick={() => setActive(a)}
          className={`${a.color} w-full text-white font-bold rounded-2xl py-6 text-base transition-colors`}
        >
          {a.label}
        </button>
      ))}

      {/* Scrums */}
      <p className="text-xs font-bold text-gray-500 uppercase tracking-wider pt-4">Scrums</p>
      <div className="bg-gray-800 rounded-xl mb-2 py-1">
        <SetpieceCounter label="A favor"   won={scrumFavor.won}   lost={scrumFavor.lost} />
        <SetpieceCounter label="En contra" won={scrumAgainst.won} lost={scrumAgainst.lost} />
      </div>
      {ACTIONS.slice(2, 4).map((a) => (
        <button key={a.eventType} onClick={() => setActive(a)}
          className={`${a.color} w-full text-white font-bold rounded-2xl py-6 text-base transition-colors`}
        >
          {a.label}
        </button>
      ))}

      {/* Salidas */}
      <p className="text-xs font-bold text-gray-500 uppercase tracking-wider pt-4">Salidas</p>
      <div className="bg-gray-800 rounded-xl mb-2 py-1">
        <SetpieceCounter label="A favor"   won={exitFavor.won}   lost={exitFavor.lost} />
        <SetpieceCounter label="En contra" won={exitAgainst.won} lost={exitAgainst.lost} />
      </div>
      {ACTIONS.slice(4).map((a) => (
        <button key={a.eventType} onClick={() => setActive(a)}
          className={`${a.color} w-full text-white font-bold rounded-2xl py-6 text-base transition-colors`}
        >
          {a.label}
        </button>
      ))}

      {active && (
        <ObtentionModal
          action={active}
          sessionId={sessionId}
          onClose={() => setActive(null)}
        />
      )}

      <EventLog sessionId={sessionId} types={LINE_SCRUM_TYPES} />
    </div>
  );
}
