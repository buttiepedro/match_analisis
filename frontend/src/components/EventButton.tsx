import { useState } from "react";
import api from "../lib/axios";

interface EventButtonProps {
  label: string;
  eventType: string;
  team: "home" | "away";
  sessionId: string;
  showPlayerInput?: boolean;
  reasons?: string[];
  onSuccess?: () => void;
}

export default function EventButton({
  label,
  eventType,
  team,
  sessionId,
  showPlayerInput = false,
  reasons,
  onSuccess,
}: EventButtonProps) {
  const [open, setOpen] = useState(false);
  const [player, setPlayer] = useState("");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);

  const confirm = async () => {
    setLoading(true);
    try {
      await api.post(`/sessions/${sessionId}/events`, {
        event_type: eventType,
        team,
        player_number: player ? parseInt(player, 10) : null,
        reason: reason || null,
      });
      onSuccess?.();
    } finally {
      setLoading(false);
      setOpen(false);
      setPlayer("");
      setReason("");
    }
  };

  const teamColor = team === "home" ? "bg-blue-700 active:bg-blue-600" : "bg-orange-700 active:bg-orange-600";

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={`${teamColor} text-white text-sm font-semibold rounded-xl px-3 py-4 w-full transition-colors text-left leading-tight`}
      >
        {label}
      </button>

      {/* Bottom-sheet modal */}
      {open && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end">
          {/* Overlay */}
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setOpen(false)}
          />

          {/* Sheet */}
          <div className="relative bg-gray-800 rounded-t-2xl p-5 space-y-4">
            <p className="text-white font-bold text-base">{label}</p>
            <p className="text-gray-400 text-xs">
              {team === "home" ? "Local" : "Visitante"}
            </p>

            {showPlayerInput && (
              <div>
                <label className="block text-sm text-gray-300 mb-1">
                  N° Jugador (opcional)
                </label>
                <input
                  type="number"
                  value={player}
                  onChange={(e) => setPlayer(e.target.value)}
                  placeholder="ej: 7"
                  className="w-full bg-gray-700 text-white rounded-xl px-4 py-2 text-base focus:outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>
            )}

            {reasons && reasons.length > 0 && (
              <div>
                <label className="block text-sm text-gray-300 mb-1">
                  Razón (opcional)
                </label>
                <select
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="w-full bg-gray-700 text-white rounded-xl px-4 py-2 text-base focus:outline-none focus:ring-2 focus:ring-green-500"
                >
                  <option value="">— Sin especificar —</option>
                  {reasons.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="flex gap-3 pt-1">
              <button
                onClick={() => setOpen(false)}
                className="flex-1 bg-gray-700 text-gray-300 font-semibold rounded-xl py-3"
              >
                Cancelar
              </button>
              <button
                onClick={confirm}
                disabled={loading}
                className="flex-1 bg-green-600 hover:bg-green-500 disabled:bg-green-800 text-white font-semibold rounded-xl py-3 transition-colors"
              >
                {loading ? "..." : "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
