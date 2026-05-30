import { useState } from "react";
import api from "../../lib/axios";

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

  const register = async (obtained: boolean) => {
    setLoading(true);
    try {
      await api.post(`/sessions/${sessionId}/events`, {
        event_type: action.eventType,
        team: "home",
        metadata: { obtained },
      });
      onEvent();
    } finally {
      setLoading(false);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative bg-gray-800 rounded-t-2xl p-5 space-y-4">
        <p className="text-white font-bold text-lg">{action.label}</p>
        <p className="text-gray-400 text-sm">¿Con obtención del balón?</p>

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

  return (
    <div className="p-4 space-y-3">
      <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-4">
        Line-outs
      </p>
      {ACTIONS.slice(0, 2).map((a) => (
        <button
          key={a.eventType}
          onClick={() => setActive(a)}
          className={`${a.color} w-full text-white font-bold rounded-2xl py-6 text-base transition-colors`}
        >
          {a.label}
        </button>
      ))}

      <p className="text-xs font-bold text-gray-500 uppercase tracking-wider pt-4">
        Scrums
      </p>
      {ACTIONS.slice(2).map((a) => (
        <button
          key={a.eventType}
          onClick={() => setActive(a)}
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
          onEvent={onEvent}
        />
      )}
    </div>
  );
}
