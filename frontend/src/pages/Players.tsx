import { useEffect, useRef, useState } from "react";
import api from "../lib/axios";
import { parseApiError } from "../lib/errors";
import { useAuthStore } from "../store/authStore";
import { RUGBY_POSITIONS } from "../lib/rugby";
import UnifyPlayersModal from "../components/UnifyPlayersModal";

interface Division {
  id: string;
  name: string;
}

interface Player {
  id: string;
  name: string;
  position: string | null;
  dni: string | null;
  profile_photo_url: string | null;
  is_active: boolean;
}

const EMPTY_FORM = { name: "", position: "" };

function photoSrc(url: string | null): string | null {
  return url ?? null;
}

function PlayerAvatar({ player, size = 40 }: { player: Player; size?: number }) {
  const src = photoSrc(player.profile_photo_url);
  return (
    <div
      className="rounded-full overflow-hidden bg-gray-700 flex items-center justify-center flex-shrink-0"
      style={{ width: size, height: size }}
    >
      {src ? (
        <img src={src} alt={player.name} className="w-full h-full object-cover" />
      ) : (
        <span className="text-gray-300 font-bold" style={{ fontSize: size * 0.4 }}>
          {player.name.trim()[0]?.toUpperCase() ?? "?"}
        </span>
      )}
    </div>
  );
}

export default function Players() {
  const clubId = useAuthStore((s) => s.user?.club_id);

  const [divisions, setDivisions] = useState<Division[]>([]);
  const [selectedDivisionId, setSelectedDivisionId] = useState<string>("");
  const [players, setPlayers] = useState<Player[]>([]);
  const [loadingDivisions, setLoadingDivisions] = useState(true);
  const [loadingPlayers, setLoadingPlayers] = useState(false);

  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [unifyKeepPlayer, setUnifyKeepPlayer] = useState<Player | null>(null);
  const [uploadingPlayerId, setUploadingPlayerId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadTargetId = useRef<string | null>(null);

  useEffect(() => {
    if (!clubId) return;
    api.get<Division[]>(`/clubs/${clubId}/divisions`)
      .then(({ data }) => {
        setDivisions(data);
        if (data.length > 0) setSelectedDivisionId(data[0].id);
      })
      .finally(() => setLoadingDivisions(false));
  }, [clubId]);

  useEffect(() => {
    if (!selectedDivisionId) return;
    setLoadingPlayers(true);
    api.get<Player[]>(`/divisions/${selectedDivisionId}/players`)
      .then(({ data }) => setPlayers(data))
      .finally(() => setLoadingPlayers(false));
  }, [selectedDivisionId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDivisionId) return;
    setSubmitting(true);
    setError(null);
    try {
      const { data } = await api.post<Player>(`/divisions/${selectedDivisionId}/players`, {
        name: form.name,
        position: form.position || null,
      });
      setPlayers((prev) => [...prev, data]);
      setForm(EMPTY_FORM);
      setAdding(false);
    } catch (err) {
      setError(parseApiError(err, "Error al agregar jugador"));
    } finally {
      setSubmitting(false);
    }
  };

  function triggerPhotoUpload(playerId: string) {
    uploadTargetId.current = playerId;
    fileInputRef.current?.click();
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    const playerId = uploadTargetId.current;
    if (!file || !playerId || !selectedDivisionId) return;

    e.target.value = "";
    setUploadingPlayerId(playerId);
    try {
      const form = new FormData();
      form.append("file", file);
      const { data } = await api.post<Player>(
        `/divisions/${selectedDivisionId}/players/${playerId}/photo`,
        form,
        { headers: { "Content-Type": "multipart/form-data" } }
      );
      setPlayers((prev) => prev.map((p) => (p.id === playerId ? data : p)));
    } catch (err) {
      alert(parseApiError(err, "Error al subir la foto"));
    } finally {
      setUploadingPlayerId(null);
    }
  }

  if (loadingDivisions) {
    return <div className="p-6"><p className="text-gray-400 text-sm">Cargando...</p></div>;
  }

  if (divisions.length === 0) {
    return (
      <div className="p-6">
        <h1 className="text-xl font-bold text-white mb-2">Jugadores</h1>
        <p className="text-gray-500 text-sm">Primero creá una división para poder agregar jugadores.</p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-lg">
      <h1 className="text-xl font-bold text-white mb-4">Jugadores</h1>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* Division selector */}
      <div className="flex gap-2 flex-wrap mb-5">
        {divisions.map((d) => (
          <button
            key={d.id}
            onClick={() => { setSelectedDivisionId(d.id); setAdding(false); }}
            className={`text-sm px-4 py-1.5 rounded-full transition-colors ${
              selectedDivisionId === d.id
                ? "bg-green-700 text-white"
                : "bg-gray-700 text-gray-300 hover:bg-gray-600"
            }`}
          >
            {d.name}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-gray-400 uppercase tracking-wide">
          {divisions.find((d) => d.id === selectedDivisionId)?.name}
        </p>
        {!adding && (
          <button
            onClick={() => { setAdding(true); setError(null); }}
            className="text-sm bg-green-700 hover:bg-green-600 text-white px-3 py-1.5 rounded-lg transition-colors"
          >
            + Agregar jugador
          </button>
        )}
      </div>

      {adding && (
        <form onSubmit={handleSubmit} className="bg-gray-800 rounded-xl p-4 mb-4 space-y-3">
          <input
            required
            autoFocus
            placeholder="Nombre del jugador"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            className="w-full bg-gray-700 text-white text-sm rounded-lg px-3 py-2.5 placeholder-gray-400 outline-none focus:ring-1 focus:ring-green-600"
          />
          <select
            value={form.position}
            onChange={(e) => setForm((f) => ({ ...f, position: e.target.value }))}
            className="w-full bg-gray-700 text-white text-sm rounded-lg px-3 py-2.5 outline-none focus:ring-1 focus:ring-green-600"
          >
            <option value="">— Posición (opcional) —</option>
            {RUGBY_POSITIONS.map((pos) => (
              <option key={pos.number} value={pos.name}>
                {pos.number} - {pos.name}
              </option>
            ))}
          </select>
          {error && <p className="text-red-400 text-xs">{error}</p>}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={submitting}
              className="text-sm bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white px-4 py-2 rounded-lg transition-colors"
            >
              {submitting ? "Guardando..." : "Guardar"}
            </button>
            <button
              type="button"
              onClick={() => { setAdding(false); setError(null); setForm(EMPTY_FORM); }}
              className="text-sm text-gray-400 hover:text-white px-4 py-2 rounded-lg transition-colors"
            >
              Cancelar
            </button>
          </div>
        </form>
      )}

      {loadingPlayers ? (
        <p className="text-gray-400 text-sm">Cargando jugadores...</p>
      ) : players.length === 0 ? (
        <p className="text-gray-500 text-sm">No hay jugadores en esta división.</p>
      ) : (
        <ul className="space-y-2">
          {players.map((p) => (
            <li key={p.id} className="bg-gray-800 rounded-xl px-4 py-3 flex items-center gap-3">

              {/* Avatar / photo */}
              <div className="relative group flex-shrink-0">
                <PlayerAvatar player={p} size={44} />
                <button
                  onClick={() => triggerPhotoUpload(p.id)}
                  disabled={uploadingPlayerId === p.id}
                  className="absolute inset-0 rounded-full bg-black/0 group-hover:bg-black/50 flex items-center justify-center transition-all disabled:opacity-50"
                  title="Subir foto"
                >
                  {uploadingPlayerId === p.id ? (
                    <span className="text-white text-xs">...</span>
                  ) : (
                    <span className="text-white text-lg opacity-0 group-hover:opacity-100 transition-opacity">📷</span>
                  )}
                </button>
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <span className="text-white text-sm font-medium block truncate">{p.name}</span>
                {p.dni && <span className="text-xs text-gray-500">DNI {p.dni}</span>}
              </div>

              {/* Actions */}
              <div className="flex items-center gap-3 flex-shrink-0">
                {p.position && (
                  <span className="text-xs text-gray-400">{p.position}</span>
                )}
                {players.length >= 2 && (
                  <button
                    onClick={() => setUnifyKeepPlayer(p)}
                    className="text-xs text-gray-500 hover:text-yellow-400 transition-colors"
                    title="Unificar con otro jugador"
                  >
                    Unificar →
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {unifyKeepPlayer && (
        <UnifyPlayersModal
          isOpen={true}
          keepPlayer={unifyKeepPlayer}
          allPlayers={players}
          divisionId={selectedDivisionId}
          onDone={(absorbedId) => {
            setPlayers((prev) => prev.filter((p) => p.id !== absorbedId));
            setUnifyKeepPlayer(null);
          }}
          onClose={() => setUnifyKeepPlayer(null)}
        />
      )}
    </div>
  );
}
