import { useState } from "react";
import api from "../../lib/axios";
import { parseApiError } from "../../lib/errors";
import { useSessionStore, countEvents, EventData } from "../../store/sessionStore";
import SubstitutionModal from "../SubstitutionModal";
import EventLog from "../EventLog";

type Flow = "yellow_card" | "red_card" | null;

interface ModalState {
  flow: Flow;
  team: "user" | "rival" | null;
}

const CLOSED: ModalState = { flow: null, team: null };

function calcPoints(events: EventData[], team: "user" | "rival"): number {
  return events.filter((e) => e.team === team).reduce((pts, e) => {
    if (e.event_type === "try") {
      pts += 5;
      if (e.metadata?.converted === true) pts += 2;
    }
    if (e.event_type === "penalty" && e.reason === "a_los_palos" && e.metadata?.converted === true) {
      pts += 3;
    }
    if (e.event_type === "drop") pts += 3;
    return pts;
  }, 0);
}

interface Props {
  sessionId: string;
  homeTeam: string;
  awayTeam: string;
  onEvent: () => void;
}

export default function Events({ sessionId, homeTeam, awayTeam, onEvent }: Props) {
  const events = useSessionStore((s) => s.events);
  const [modal, setModal] = useState<ModalState>(CLOSED);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showSub, setShowSub] = useState(false);

  const yellows = countEvents(events, ["yellow_card"]);
  const reds    = countEvents(events, ["red_card"]);
  const homePoints = calcPoints(events, "user");
  const awayPoints = calcPoints(events, "rival");

  function open(flow: Flow) {
    setError("");
    setModal({ flow, team: null });
  }

  function close() {
    setModal(CLOSED);
    setError("");
  }

  function selectTeam(team: "user" | "rival") {
    const { flow } = modal;
    if (!flow) return;
    setLoading(true);
    setError("");
    api.post(`/sessions/${sessionId}/events`, { event_type: flow, team })
      .then(() => { onEvent(); close(); })
      .catch((err) => setError(parseApiError(err, "Error al registrar el evento")))
      .finally(() => setLoading(false));
  }

  const isOpen = modal.flow !== null;

  return (
    <div className="p-4 space-y-3">
      {/* Score card */}
      <div className="bg-gray-800 rounded-xl overflow-hidden">
        <div className="grid grid-cols-2 divide-x divide-gray-700">
          <div className="px-4 py-3 text-center">
            <p className="text-gray-400 text-xs truncate">{homeTeam}</p>
            <p className="text-white text-2xl font-bold">{homePoints}</p>
            <p className="text-gray-500 text-xs">pts</p>
          </div>
          <div className="px-4 py-3 text-center">
            <p className="text-gray-400 text-xs truncate">{awayTeam}</p>
            <p className="text-white text-2xl font-bold">{awayPoints}</p>
            <p className="text-gray-500 text-xs">pts</p>
          </div>
        </div>
        <div className="border-t border-gray-700 px-4 py-2 space-y-1">
          <div className="flex justify-between text-xs">
            <span className="text-yellow-400 font-semibold">Amarillas</span>
            <span className="text-gray-300">{homeTeam} <span className="text-white font-bold">{yellows.user}</span></span>
            <span className="text-gray-300">{awayTeam} <span className="text-white font-bold">{yellows.rival}</span></span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-red-400 font-semibold">Rojas</span>
            <span className="text-gray-300">{homeTeam} <span className="text-white font-bold">{reds.user}</span></span>
            <span className="text-gray-300">{awayTeam} <span className="text-white font-bold">{reds.rival}</span></span>
          </div>
        </div>
      </div>

      {/* Disciplina */}
      <p className="text-xs font-bold text-gray-500 uppercase tracking-wider pt-1">Disciplina</p>
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => open("yellow_card")}
          className="bg-yellow-600 active:bg-yellow-500 text-white font-semibold rounded-xl px-4 py-4 text-base transition-colors"
        >
          Amarilla
        </button>
        <button
          onClick={() => open("red_card")}
          className="bg-red-600 active:bg-red-500 text-white font-semibold rounded-xl px-4 py-4 text-base transition-colors"
        >
          Roja
        </button>
      </div>

      <button
        onClick={() => setShowSub(true)}
        className="w-full bg-gray-700 hover:bg-gray-600 text-white font-semibold rounded-xl py-3 text-sm transition-colors"
      >
        Registrar Cambio
      </button>

      <EventLog
        sessionId={sessionId}
        types={["yellow_card", "red_card", "substitution"]}
      />

      {showSub && (
        <SubstitutionModal sessionId={sessionId} onClose={() => setShowSub(false)} />
      )}

      {/* Team selector modal */}
      {isOpen && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end">
          <div className="absolute inset-0 bg-black/60" onClick={close} />
          <div className="relative bg-gray-800 rounded-t-2xl p-5 space-y-4">
            <p className="text-white font-bold text-base">
              {modal.flow === "yellow_card" ? "Tarjeta Amarilla" : "Tarjeta Roja"}
            </p>
            {error && <p className="text-red-400 text-sm">{error}</p>}
            <div className="space-y-2">
              <button
                onClick={() => selectTeam("user")}
                disabled={loading}
                className="w-full bg-blue-700 active:bg-blue-600 disabled:opacity-50 text-white font-semibold rounded-xl py-4 text-base transition-colors"
              >
                De {homeTeam}
              </button>
              <button
                onClick={() => selectTeam("rival")}
                disabled={loading}
                className="w-full bg-orange-700 active:bg-orange-600 disabled:opacity-50 text-white font-semibold rounded-xl py-4 text-base transition-colors"
              >
                De {awayTeam}
              </button>
            </div>
            <button
              onClick={close}
              disabled={loading}
              className="w-full bg-gray-700 text-gray-300 font-semibold rounded-xl py-3 disabled:opacity-50"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
