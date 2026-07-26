import { useState } from "react";
import { calcPoints } from "../../lib/stats";
import { useEventRegistrar } from "../../lib/useEventRegistrar";
import { useSessionStore, countEvents } from "../../store/sessionStore";
import SubstitutionModal from "../SubstitutionModal";
import EventLog from "../EventLog";

type Flow = "yellow_card" | "red_card" | null;

interface ModalState {
  flow: Flow;
  team: "user" | "rival" | null;
}

const CLOSED: ModalState = { flow: null, team: null };

interface Props {
  sessionId: string;
  homeTeam: string;
  awayTeam: string;
}

export default function Events({ sessionId, homeTeam, awayTeam }: Props) {
  const events = useSessionStore((s) => s.events);
  const [modal, setModal] = useState<ModalState>(CLOSED);
  const [showSub, setShowSub] = useState(false);
  const { register, loading, error, setError } = useEventRegistrar(sessionId);

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

  async function selectTeam(team: "user" | "rival") {
    const { flow } = modal;
    if (!flow) return;
    const ok = await register(flow, { team });
    if (ok) close();
  }

  const isOpen = modal.flow !== null;

  return (
    <div className="p-4 space-y-3">
      {/* Score card */}
      <div className="bg-surface rounded-xl overflow-hidden">
        <div className="grid grid-cols-2 divide-x divide-line">
          <div className="px-4 py-3 text-center">
            <p className="text-ink-muted text-xs truncate">{homeTeam}</p>
            <p className="text-ink text-2xl font-bold">{homePoints}</p>
            <p className="text-ink-muted text-xs">pts</p>
          </div>
          <div className="px-4 py-3 text-center">
            <p className="text-ink-muted text-xs truncate">{awayTeam}</p>
            <p className="text-ink text-2xl font-bold">{awayPoints}</p>
            <p className="text-ink-muted text-xs">pts</p>
          </div>
        </div>
        <div className="border-t border-line px-4 py-2 space-y-1">
          <div className="flex justify-between text-xs">
            <span className="text-yellow-600 font-semibold">Amarillas</span>
            <span className="text-ink-soft">{homeTeam} <span className="text-ink font-bold">{yellows.user}</span></span>
            <span className="text-ink-soft">{awayTeam} <span className="text-ink font-bold">{yellows.rival}</span></span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-red-600 font-semibold">Rojas</span>
            <span className="text-ink-soft">{homeTeam} <span className="text-ink font-bold">{reds.user}</span></span>
            <span className="text-ink-soft">{awayTeam} <span className="text-ink font-bold">{reds.rival}</span></span>
          </div>
        </div>
      </div>

      {/* Disciplina */}
      <p className="text-xs font-bold text-ink-muted uppercase tracking-wider pt-1">Disciplina</p>
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => open("yellow_card")}
          className="pressable bg-yellow-600 active:bg-yellow-500 text-white font-semibold rounded-xl px-4 py-4 text-base transition-colors duration-150"
        >
          Amarilla
        </button>
        <button
          onClick={() => open("red_card")}
          className="pressable bg-red-600 active:bg-red-500 text-white font-semibold rounded-xl px-4 py-4 text-base transition-colors duration-150"
        >
          Roja
        </button>
      </div>

      <button
        onClick={() => setShowSub(true)}
        className="pressable w-full bg-surface-strong hover:bg-surface-hover text-ink font-semibold rounded-xl py-3 text-sm transition-colors duration-150"
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
          <div className="absolute inset-0 bg-black/60 animate-overlay" onClick={close} />
          <div className="relative bg-surface rounded-t-2xl p-5 space-y-4 animate-sheet">
            <p className="text-ink font-bold text-base">
              {modal.flow === "yellow_card" ? "Tarjeta Amarilla" : "Tarjeta Roja"}
            </p>
            {error && <p className="text-red-600 text-sm">{error}</p>}
            <div className="space-y-2">
              <button
                onClick={() => selectTeam("user")}
                disabled={loading}
                className="pressable w-full bg-blue-700 active:bg-blue-600 disabled:opacity-50 text-white font-semibold rounded-xl py-4 text-base transition-colors duration-150"
              >
                De {homeTeam}
              </button>
              <button
                onClick={() => selectTeam("rival")}
                disabled={loading}
                className="pressable w-full bg-orange-700 active:bg-orange-600 disabled:opacity-50 text-white font-semibold rounded-xl py-4 text-base transition-colors duration-150"
              >
                De {awayTeam}
              </button>
            </div>
            <button
              onClick={close}
              disabled={loading}
              className="w-full bg-surface-strong text-ink-soft font-semibold rounded-xl py-3 disabled:opacity-50"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
