import { useState } from "react";
import api from "../lib/axios";
import { parseApiError } from "../lib/errors";

interface Player {
  id: string;
  name: string;
  position: string | null;
  dni?: string | null;
}

interface Props {
  isOpen: boolean;
  keepPlayer: Player;
  allPlayers: Player[];
  divisionId: string;
  onDone: (absorbedPlayerId: string) => void;
  onClose: () => void;
}

type Step = "select" | "preview";

function normalize(s: string): string {
  return s.toLowerCase().trim();
}

export default function UnifyPlayersModal({
  isOpen,
  keepPlayer,
  allPlayers,
  divisionId,
  onDone,
  onClose,
}: Props) {
  const [step, setStep] = useState<Step>("select");
  const [search, setSearch] = useState("");
  const [targetPlayer, setTargetPlayer] = useState<Player | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const candidates = allPlayers.filter(
    (p) =>
      p.id !== keepPlayer.id &&
      (search === "" || normalize(p.name).includes(normalize(search)))
  );

  const handleSelect = (p: Player) => {
    setTargetPlayer(p);
    setStep("preview");
  };

  const handleBack = () => {
    setStep("select");
    setTargetPlayer(null);
    setError(null);
  };

  const handleConfirm = async () => {
    if (!targetPlayer) return;
    setLoading(true);
    setError(null);
    try {
      await api.post(`/divisions/${divisionId}/players/${keepPlayer.id}/absorb`, {
        target_id: targetPlayer.id,
      });
      onDone(targetPlayer.id);
    } catch (err) {
      setError(parseApiError(err, "Error al unificar jugadores"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-gray-800 rounded-2xl w-full max-w-md max-h-[85vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 pt-5 pb-4 border-b border-gray-700 flex-shrink-0">
          <h2 className="text-white font-bold text-lg">Unificar jugadores</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Se mantiene: <span className="text-green-400 font-medium">{keepPlayer.name}</span>
          </p>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {/* ── STEP: select ── */}
          {step === "select" && (
            <>
              <p className="text-gray-400 text-sm">
                Seleccioná el jugador duplicado que será absorbido por{" "}
                <span className="text-white font-medium">{keepPlayer.name}</span>.
                Todos sus partidos y eventos quedarán asignados al jugador que se mantiene.
              </p>
              <input
                type="text"
                placeholder="Buscar jugador..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full bg-gray-700 text-white text-sm rounded-lg px-3 py-2.5 outline-none focus:ring-1 focus:ring-green-600 placeholder-gray-500"
              />
              <div className="space-y-1 max-h-64 overflow-y-auto">
                {candidates.length === 0 && (
                  <p className="text-gray-500 text-sm text-center py-4">Sin resultados</p>
                )}
                {candidates.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => handleSelect(p)}
                    className="w-full text-left flex items-center justify-between bg-gray-700/40 hover:bg-gray-700/70 rounded-lg px-4 py-2.5 transition-colors"
                  >
                    <div>
                      <p className="text-white text-sm font-medium">{p.name}</p>
                      {p.dni && <p className="text-xs text-gray-500">DNI {p.dni}</p>}
                    </div>
                    {p.position && (
                      <span className="text-xs text-gray-500">{p.position}</span>
                    )}
                  </button>
                ))}
              </div>
            </>
          )}

          {/* ── STEP: preview ── */}
          {step === "preview" && targetPlayer && (
            <div className="space-y-4">
              <div className="bg-gray-700/50 rounded-xl p-4 space-y-3">
                <div className="flex items-center gap-3">
                  <div className="flex-1 bg-green-900/30 border border-green-700/40 rounded-lg p-3 text-center">
                    <p className="text-xs text-gray-400 mb-0.5">Se mantiene</p>
                    <p className="text-white font-semibold text-sm">{keepPlayer.name}</p>
                    {keepPlayer.dni && <p className="text-xs text-green-400 mt-0.5">DNI {keepPlayer.dni}</p>}
                  </div>
                  <span className="text-gray-500 font-bold text-lg">←</span>
                  <div className="flex-1 bg-red-900/20 border border-red-700/30 rounded-lg p-3 text-center">
                    <p className="text-xs text-gray-400 mb-0.5">Se absorbe</p>
                    <p className="text-white font-semibold text-sm">{targetPlayer.name}</p>
                    {targetPlayer.dni && <p className="text-xs text-red-400 mt-0.5">DNI {targetPlayer.dni}</p>}
                  </div>
                </div>
              </div>

              <div className="text-gray-300 text-sm space-y-1">
                <p>• Todos los partidos y eventos de <span className="text-white font-medium">{targetPlayer.name}</span> quedarán asignados a <span className="text-white font-medium">{keepPlayer.name}</span>.</p>
                <p>• <span className="text-white font-medium">{targetPlayer.name}</span> quedará inactivo.</p>
                {!keepPlayer.dni && targetPlayer.dni && (
                  <p className="text-green-400">• Se copiará el DNI <span className="font-medium">{targetPlayer.dni}</span> a {keepPlayer.name}.</p>
                )}
              </div>

              {error && <p className="text-red-400 text-xs">{error}</p>}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 pb-5 pt-3 border-t border-gray-700 flex-shrink-0">
          {step === "select" && (
            <button
              onClick={onClose}
              className="w-full bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm font-medium py-2.5 rounded-lg transition-colors"
            >
              Cancelar
            </button>
          )}

          {step === "preview" && (
            <div className="flex gap-3">
              <button
                onClick={handleConfirm}
                disabled={loading}
                className="flex-1 bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white text-sm font-medium py-2.5 rounded-lg transition-colors"
              >
                {loading ? "Unificando..." : "Confirmar unificación"}
              </button>
              <button
                onClick={handleBack}
                disabled={loading}
                className="flex-1 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-gray-300 text-sm font-medium py-2.5 rounded-lg transition-colors"
              >
                Volver
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
