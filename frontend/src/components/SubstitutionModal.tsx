import { useState } from "react";
import api from "../lib/axios";
import { parseApiError } from "../lib/errors";
import { useSessionStore } from "../store/sessionStore";

interface Props {
  sessionId: string;
  onClose: () => void;
}

export default function SubstitutionModal({ sessionId, onClose }: Props) {
  const lineup = useSessionStore((s) => s.lineup);
  const applySubstitution = useSessionStore((s) => s.applySubstitution);

  const onField = lineup.filter((p) => p.team === "user" && p.status === "on_field");
  const bench = lineup.filter((p) => p.team === "user" && p.status === "bench");

  const [outId, setOutId] = useState("");
  const [inId, setInId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const confirm = async () => {
    if (!outId || !inId) {
      setError("Seleccioná ambos jugadores");
      return;
    }
    setLoading(true);
    setError("");
    try {
      await api.post(`/sessions/${sessionId}/lineup/substitute`, {
        lineup_out_id: outId,
        lineup_in_id: inId,
      });
      applySubstitution(outId, inId);
      onClose();
    } catch (err) {
      setError(parseApiError(err, "Error al registrar el cambio"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/60 animate-overlay" onClick={onClose} />
      <div className="relative bg-gray-800 rounded-t-2xl p-5 space-y-4 animate-sheet">
        <p className="text-white font-bold text-base">Registrar Cambio</p>

        <div>
          <label className="block text-sm text-gray-300 mb-1">Sale del campo</label>
          <select
            value={outId}
            onChange={(e) => setOutId(e.target.value)}
            className="w-full bg-gray-700 text-white rounded-xl px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-yellow-500"
          >
            <option value="">— Seleccionar —</option>
            {onField.map((p) => (
              <option key={p.id} value={p.id}>
                #{p.jersey_number} {p.player.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm text-gray-300 mb-1">Entra al campo</label>
          <select
            value={inId}
            onChange={(e) => setInId(e.target.value)}
            className="w-full bg-gray-700 text-white rounded-xl px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-green-500"
          >
            <option value="">— Seleccionar —</option>
            {bench.map((p) => (
              <option key={p.id} value={p.id}>
                #{p.jersey_number} {p.player.name}
              </option>
            ))}
          </select>
        </div>

        {error && <p className="text-red-400 text-sm">{error}</p>}

        {bench.length === 0 && (
          <p className="text-yellow-400 text-sm">No hay suplentes disponibles</p>
        )}

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="pressable flex-1 bg-gray-700 hover:bg-gray-600 text-gray-300 font-semibold rounded-xl py-3 transition-colors duration-150"
          >
            Cancelar
          </button>
          <button
            onClick={confirm}
            disabled={loading || !outId || !inId}
            className="pressable flex-1 bg-yellow-600 hover:bg-yellow-500 disabled:bg-gray-600 text-white font-semibold rounded-xl py-3 transition-colors duration-150"
          >
            {loading ? "..." : "Confirmar Cambio"}
          </button>
        </div>
      </div>
    </div>
  );
}
