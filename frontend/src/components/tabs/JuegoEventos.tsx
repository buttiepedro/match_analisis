import { useState } from "react";
import { useEventRegistrar } from "../../lib/useEventRegistrar";
import { useSessionStore } from "../../store/sessionStore";
import EventLog from "../EventLog";

interface Props {
  sessionId: string;
  homeTeam: string;
}

const MOTIVOS = [
  { value: "ruck",     label: "Ruck" },
  { value: "maul",     label: "Maul" },
  { value: "contacto", label: "Contacto" },
  { value: "pesca",    label: "Pesca" },
  { value: "patada",   label: "Patada" },
  { value: "knock_on", label: "Knock On" },
];

const PENAL_REASONS = [
  { value: "line",        label: "Line" },
  { value: "scrum",       label: "Scrum" },
  { value: "juega",       label: "Juega" },
  { value: "a_los_palos", label: "A los palos" },
];

const JUEGO_EVENT_TYPES = [
  "line_break", "offload", "possession_lost",
  "tackle_effective", "tackle_missed", "tackle_positive", "ball_won",
  "try", "penalty", "drop",
];

type Mode = "attack" | "defense";
type ModalFlow = "perdida" | "ball_won" | "penal" | "try" | null;

export default function JuegoEventos({ sessionId, homeTeam }: Props) {
  const [mode, setMode] = useState<Mode>("attack");
  const [modalFlow, setModalFlow] = useState<ModalFlow>(null);
  const [penalStep, setPenalStep] = useState<"reason" | "conversion">("reason");
  const [penalReason, setPenalReason] = useState<string | null>(null);
  const { register, loading, error } = useEventRegistrar(sessionId);

  const activeTeam: "user" | "rival" = mode === "attack" ? "user" : "rival";

  const events = useSessionStore((s) => s.events);
  const homeEvents = events.filter((e) => JUEGO_EVENT_TYPES.includes(e.event_type) && e.team === "user");
  const attackCount  = homeEvents.filter((e) => ["line_break", "offload"].includes(e.event_type)).length;
  const defenseCount = homeEvents.filter((e) => ["tackle_effective", "tackle_missed", "tackle_positive"].includes(e.event_type)).length;

  const registerEvent = (
    event_type: string,
    extra?: { reason?: string; metadata?: Record<string, unknown> }
  ) => register(event_type, { team: activeTeam, ...extra });

  const closeModal = () => {
    setModalFlow(null);
    setPenalStep("reason");
    setPenalReason(null);
  };

  const selectMotivo = async (value: string) => {
    const type = modalFlow === "perdida" ? "possession_lost" : "ball_won";
    await registerEvent(type, { reason: value });
    const prevFlow = modalFlow;
    closeModal();
    if (prevFlow === "perdida") setMode("defense");
    else if (prevFlow === "ball_won") setMode("attack");
  };

  const selectPenalReason = async (reason: string) => {
    if (reason === "a_los_palos") {
      setPenalReason(reason);
      setPenalStep("conversion");
    } else {
      await registerEvent("penalty", { reason });
      closeModal();
    }
  };

  const selectConversion = async (converted: boolean) => {
    if (modalFlow === "try") {
      await registerEvent("try", { metadata: { converted } });
    } else {
      await registerEvent("penalty", { reason: penalReason ?? undefined, metadata: { converted } });
    }
    closeModal();
  };

  const scoringButtons = (
    <div className="space-y-2 pt-2 border-t border-gray-700/50">
      <div className="grid grid-cols-3 gap-2">
        <button
          onClick={() => setModalFlow("penal")}
          disabled={loading}
          className="bg-blue-700 hover:bg-blue-600 disabled:opacity-50 text-white font-bold rounded-2xl py-6 text-sm transition-colors"
        >
          Penal
        </button>
        <button
          onClick={() => setModalFlow("try")}
          disabled={loading}
          className="bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white font-bold rounded-2xl py-6 text-sm transition-colors"
        >
          Try
        </button>
        <button
          onClick={() => registerEvent("drop")}
          disabled={loading}
          className="bg-purple-700 hover:bg-purple-600 disabled:opacity-50 text-white font-bold rounded-2xl py-6 text-sm transition-colors"
        >
          Drop
        </button>
      </div>
    </div>
  );

  return (
    <div className="p-4 space-y-4">
      {/* Mode toggle */}
      <div className="flex gap-1 bg-gray-800 rounded-xl p-1">
        <button
          onClick={() => setMode("attack")}
          className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors ${
            mode === "attack" ? "bg-green-700 text-white" : "text-gray-400 hover:text-white"
          }`}
        >
          Ataque
        </button>
        <button
          onClick={() => setMode("defense")}
          className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors ${
            mode === "defense" ? "bg-blue-700 text-white" : "text-gray-400 hover:text-white"
          }`}
        >
          Defensa
        </button>
      </div>

      <p className="text-xs text-gray-500 text-center">
        {homeTeam}
        {mode === "attack"
          ? <span className="text-green-400"> · Ataque — {attackCount} acciones</span>
          : <span className="text-blue-400"> · Defensa — {defenseCount} tackles</span>
        }
      </p>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      {/* Attack view */}
      {mode === "attack" && (
        <div className="space-y-2">
          <div className="grid grid-cols-3 gap-2">
            <button
              onClick={() => registerEvent("line_break")}
              disabled={loading}
              className="bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white font-bold rounded-2xl py-8 text-sm transition-colors"
            >
              Quiebre
            </button>
            <button
              onClick={() => registerEvent("offload")}
              disabled={loading}
              className="bg-blue-700 hover:bg-blue-600 disabled:opacity-50 text-white font-bold rounded-2xl py-8 text-sm transition-colors"
            >
              Offload
            </button>
            <button
              onClick={() => setModalFlow("perdida")}
              disabled={loading}
              className="bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white font-bold rounded-2xl py-8 text-sm transition-colors"
            >
              Perdida
            </button>
          </div>
          {scoringButtons}
        </div>
      )}

      {/* Defense view */}
      {mode === "defense" && (
        <div className="space-y-2">
          <div className="grid grid-cols-3 gap-2">
            <button
              onClick={() => registerEvent("tackle_effective")}
              disabled={loading}
              className="bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white font-bold rounded-2xl py-8 text-sm transition-colors"
            >
              Concretado
            </button>
            <button
              onClick={() => registerEvent("tackle_missed")}
              disabled={loading}
              className="bg-red-800 hover:bg-red-700 disabled:opacity-50 text-white font-bold rounded-2xl py-8 text-sm transition-colors"
            >
              Errado
            </button>
            <button
              onClick={() => registerEvent("tackle_positive")}
              disabled={loading}
              className="bg-blue-700 hover:bg-blue-600 disabled:opacity-50 text-white font-bold rounded-2xl py-8 text-sm transition-colors"
            >
              Positivo
            </button>
          </div>
          <button
            onClick={() => setModalFlow("ball_won")}
            disabled={loading}
            className="w-full bg-yellow-700 hover:bg-yellow-600 disabled:opacity-50 text-white font-bold rounded-2xl py-6 text-sm transition-colors"
          >
            Pelota Ganada
          </button>
          {scoringButtons}
        </div>
      )}

      <EventLog sessionId={sessionId} types={JUEGO_EVENT_TYPES} />

      {/* Modals */}
      {modalFlow !== null && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end">
          <div className="absolute inset-0 bg-black/60" onClick={closeModal} />
          <div className="relative bg-gray-800 rounded-t-2xl p-5 space-y-4">

            {/* Motivo modal — perdida / ball_won */}
            {(modalFlow === "perdida" || modalFlow === "ball_won") && (
              <>
                <p className="text-white font-bold text-lg">
                  {modalFlow === "perdida" ? "Perdida" : "Pelota Ganada"} — Motivo
                </p>
                <p className="text-gray-400 text-sm">¿Cómo ocurrió?</p>
                <div className="grid grid-cols-2 gap-3">
                  {MOTIVOS.map((m) => (
                    <button
                      key={m.value}
                      onClick={() => selectMotivo(m.value)}
                      disabled={loading}
                      className="bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-white font-bold rounded-xl py-4 text-sm transition-colors"
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
                <button onClick={closeModal} className="w-full text-gray-400 text-sm py-2">Cancelar</button>
              </>
            )}

            {/* Penal — reason step */}
            {modalFlow === "penal" && penalStep === "reason" && (
              <>
                <p className="text-white font-bold text-lg">Penal — Motivo</p>
                <div className="grid grid-cols-2 gap-3">
                  {PENAL_REASONS.map((r) => (
                    <button
                      key={r.value}
                      onClick={() => selectPenalReason(r.value)}
                      disabled={loading}
                      className="bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-white font-bold rounded-xl py-4 text-sm transition-colors"
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
                <button onClick={closeModal} className="w-full text-gray-400 text-sm py-2">Cancelar</button>
              </>
            )}

            {/* Penal — a los palos conversion step */}
            {modalFlow === "penal" && penalStep === "conversion" && (
              <>
                <p className="text-white font-bold text-lg">Penal — A los palos</p>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => selectConversion(true)}
                    disabled={loading}
                    className="bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white font-bold rounded-xl py-5 text-base transition-colors"
                  >
                    ✓ Convertido
                  </button>
                  <button
                    onClick={() => selectConversion(false)}
                    disabled={loading}
                    className="bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-white font-bold rounded-xl py-5 text-base transition-colors"
                  >
                    No
                  </button>
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={() => { setPenalStep("reason"); setPenalReason(null); }}
                    className="flex-1 bg-gray-700 text-gray-300 font-semibold rounded-xl py-3"
                  >
                    ← Volver
                  </button>
                  <button onClick={closeModal} className="flex-1 text-gray-400 text-sm py-2">Cancelar</button>
                </div>
              </>
            )}

            {/* Try — conversion */}
            {modalFlow === "try" && (
              <>
                <p className="text-white font-bold text-lg">Try — ¿Convertido?</p>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => selectConversion(true)}
                    disabled={loading}
                    className="bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white font-bold rounded-xl py-5 text-base transition-colors"
                  >
                    ✓ Convertido
                  </button>
                  <button
                    onClick={() => selectConversion(false)}
                    disabled={loading}
                    className="bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-white font-bold rounded-xl py-5 text-base transition-colors"
                  >
                    No
                  </button>
                </div>
                <button onClick={closeModal} className="w-full text-gray-400 text-sm py-2">Cancelar</button>
              </>
            )}

          </div>
        </div>
      )}
    </div>
  );
}
