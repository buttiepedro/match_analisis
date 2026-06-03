import { useState } from "react";
import api from "../../lib/axios";
import { parseApiError } from "../../lib/errors";
import { useSessionStore } from "../../store/sessionStore";
import SubstitutionModal from "../SubstitutionModal";
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

const JUEGO_EVENT_TYPES = [
  "line_break", "offload", "possession_lost",
  "tackle_effective", "tackle_missed", "tackle_positive",
  "ball_won", "substitution",
];

type ModalFlow = "perdida" | "ball_won" | null;

export default function JuegoEventos({ sessionId, homeTeam }: Props) {
  const [activeTeam, setActiveTeam] = useState<"home" | "away">("home");
  const [modalFlow, setModalFlow] = useState<ModalFlow>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showSub, setShowSub] = useState(false);

  const events = useSessionStore((s) => s.events);

  const juego = events.filter((e) => JUEGO_EVENT_TYPES.includes(e.event_type));
  const ataqueOwn   = juego.filter((e) => ["line_break", "offload"].includes(e.event_type) && e.team === "home").length;
  const ataqueRival = juego.filter((e) => ["line_break", "offload"].includes(e.event_type) && e.team === "away").length;

  const registerEvent = async (event_type: string, extra?: object) => {
    setLoading(true);
    setError("");
    try {
      await api.post(`/sessions/${sessionId}/events`, { event_type, team: activeTeam, ...extra });
    } catch (err) {
      setError(parseApiError(err, "Error al registrar"));
    } finally {
      setLoading(false);
    }
  };

  const selectMotivo = async (value: string) => {
    const type = modalFlow === "perdida" ? "possession_lost" : "ball_won";
    await registerEvent(type, { reason: value });
    const prevFlow = modalFlow;
    setModalFlow(null);
    if (prevFlow === "perdida") {
      setActiveTeam((prev) => (prev === "home" ? "away" : "home"));
    }
  };

  const teamLabel = activeTeam === "home" ? homeTeam : "Rival";

  return (
    <div className="p-4 space-y-4">
      {/* Team toggle */}
      <div className="flex gap-1 bg-gray-800 rounded-xl p-1">
        <button
          onClick={() => setActiveTeam("home")}
          className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors ${
            activeTeam === "home"
              ? "bg-blue-600 text-white"
              : "text-gray-400 hover:text-white"
          }`}
        >
          Propia
        </button>
        <button
          onClick={() => setActiveTeam("away")}
          className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors ${
            activeTeam === "away"
              ? "bg-orange-600 text-white"
              : "text-gray-400 hover:text-white"
          }`}
        >
          Rival
        </button>
      </div>

      <p className="text-xs text-gray-500 text-center">
        Registrando para: <span className="text-white font-semibold">{teamLabel}</span>
      </p>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      {/* Ataque */}
      <div>
        <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Ataque</p>
        <div className="grid grid-cols-3 gap-2">
          <button
            onClick={() => registerEvent("line_break")}
            disabled={loading}
            className="bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white font-bold rounded-2xl py-6 text-sm transition-colors"
          >
            Quiebre
          </button>
          <button
            onClick={() => registerEvent("offload")}
            disabled={loading}
            className="bg-blue-700 hover:bg-blue-600 disabled:opacity-50 text-white font-bold rounded-2xl py-6 text-sm transition-colors"
          >
            Offload
          </button>
          <button
            onClick={() => setModalFlow("perdida")}
            disabled={loading}
            className="bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white font-bold rounded-2xl py-6 text-sm transition-colors"
          >
            Perdida
          </button>
        </div>
        <div className="flex justify-between text-xs text-gray-500 mt-1 px-1">
          <span>Propia: {ataqueOwn}</span>
          <span>Rival: {ataqueRival}</span>
        </div>
      </div>

      {/* Defensa */}
      <div>
        <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Defensa</p>
        <p className="text-xs text-gray-400 mb-1">Tackle</p>
        <div className="grid grid-cols-3 gap-2">
          <button
            onClick={() => registerEvent("tackle_effective")}
            disabled={loading}
            className="bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white font-bold rounded-2xl py-5 text-sm transition-colors"
          >
            Concretado
          </button>
          <button
            onClick={() => registerEvent("tackle_missed")}
            disabled={loading}
            className="bg-red-800 hover:bg-red-700 disabled:opacity-50 text-white font-bold rounded-2xl py-5 text-sm transition-colors"
          >
            Errado
          </button>
          <button
            onClick={() => registerEvent("tackle_positive")}
            disabled={loading}
            className="bg-blue-700 hover:bg-blue-600 disabled:opacity-50 text-white font-bold rounded-2xl py-5 text-sm transition-colors"
          >
            Positivo
          </button>
        </div>
        <button
          onClick={() => setModalFlow("ball_won")}
          disabled={loading}
          className="w-full mt-2 bg-yellow-700 hover:bg-yellow-600 disabled:opacity-50 text-white font-bold rounded-2xl py-5 text-sm transition-colors"
        >
          Pelota Ganada
        </button>
      </div>

      {/* Substitution */}
      <button
        onClick={() => setShowSub(true)}
        className="w-full bg-gray-700 hover:bg-gray-600 text-white font-semibold rounded-xl py-3 text-sm transition-colors"
      >
        Registrar Cambio
      </button>

      <EventLog sessionId={sessionId} types={JUEGO_EVENT_TYPES} />

      {/* Motivo modal */}
      {modalFlow !== null && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end">
          <div className="absolute inset-0 bg-black/60" onClick={() => setModalFlow(null)} />
          <div className="relative bg-gray-800 rounded-t-2xl p-5 space-y-4">
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

            <button
              onClick={() => setModalFlow(null)}
              className="w-full text-gray-400 text-sm py-2"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {showSub && (
        <SubstitutionModal sessionId={sessionId} onClose={() => setShowSub(false)} />
      )}
    </div>
  );
}
