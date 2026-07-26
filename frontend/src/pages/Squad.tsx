import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../store/authStore";
import {
  useSquadStore,
  Division,
  Player,
  ImportResult,
  AVAILABILITY_CLASS,
  AVAILABILITY_LABEL,
  clearanceState,
} from "../store/squadStore";
import { RUGBY_POSITIONS } from "../lib/rugby";
import api from "../lib/axios";

// ─── Icons ────────────────────────────────────────────────────────────────────

function IconSearch() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.35-4.35" />
    </svg>
  );
}

function IconChevron() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

function IconPlus() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function IconX() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

function IconUpload() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

// ─── Import xlsx modal ────────────────────────────────────────────────────────

function ImportModal({
  divisions,
  defaultDivisionId,
  onClose,
  onDone,
}: {
  divisions: Division[];
  defaultDivisionId: string;
  onClose: () => void;
  onDone: (result: ImportResult, divId: string) => void;
}) {
  const { importPlayersXlsx, fetchAllPlayers } = useSquadStore();
  const user = useAuthStore((s) => s.user);
  const [divisionId, setDivisionId] = useState(defaultDivisionId || divisions[0]?.id || "");
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    if (!file || !divisionId) return;
    setLoading(true);
    setError("");
    try {
      const result = await importPlayersXlsx(file, divisionId);
      if (user?.club_id) await fetchAllPlayers(user.club_id);
      onDone(result, divisionId);
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? "Error al importar el archivo");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-end md:items-center justify-center p-4 animate-overlay" onClick={onClose}>
      <div className="bg-gray-800 rounded-2xl w-full max-w-sm p-6 space-y-4 animate-sheet md:animate-modal" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-white">Importar jugadores</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white"><IconX /></button>
        </div>

        <p className="text-xs text-gray-400">
          Acepta archivos <strong>.xlsx</strong> o <strong>.xls</strong>. Columnas reconocidas:
          Documento, Apellido, Nombre, Fecha Nac., Sexo, Puesto, Peso, Estatura, O.Social, Email, Celular, Tel.Emergencia.
          Si el jugador ya existe por DNI, se actualiza; si no, se crea.
        </p>

        <div>
          <label className="text-xs text-gray-400 block mb-1">División destino</label>
          <select
            value={divisionId}
            onChange={(e) => setDivisionId(e.target.value)}
            className="w-full bg-gray-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-green-500"
          >
            {divisions.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-xs text-gray-400 block mb-1">Archivo Excel</label>
          <label className="flex items-center gap-3 bg-gray-700 hover:bg-gray-600 rounded-xl px-4 py-3 cursor-pointer transition-colors">
            <IconUpload />
            <span className="text-sm text-white truncate">
              {file ? file.name : "Seleccionar archivo..."}
            </span>
            <input
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>
        </div>

        {error && <p className="text-red-400 text-xs">{error}</p>}

        <button
          onClick={submit}
          disabled={loading || !file || !divisionId}
          className="pressable w-full bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white font-semibold py-2.5 rounded-xl text-sm transition-colors duration-150"
        >
          {loading ? "Importando..." : "Importar jugadores"}
        </button>
      </div>
    </div>
  );
}

// ─── Import result modal ──────────────────────────────────────────────────────

function ImportResultModal({
  result,
  onClose,
}: {
  result: ImportResult;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 animate-overlay">
      <div className="bg-gray-800 rounded-2xl w-full max-w-sm p-6 space-y-4 animate-sheet md:animate-modal">
        <h3 className="font-semibold text-white text-center">Importación completada</h3>

        <div className="grid grid-cols-3 gap-3 text-center">
          <div className="bg-green-900/40 rounded-xl p-3">
            <p className="text-2xl font-bold text-green-400">{result.created}</p>
            <p className="text-xs text-gray-400 mt-1">Creados</p>
          </div>
          <div className="bg-blue-900/40 rounded-xl p-3">
            <p className="text-2xl font-bold text-blue-400">{result.updated}</p>
            <p className="text-xs text-gray-400 mt-1">Actualizados</p>
          </div>
          <div className="bg-gray-700 rounded-xl p-3">
            <p className="text-2xl font-bold text-gray-300">{result.skipped}</p>
            <p className="text-xs text-gray-400 mt-1">Omitidos</p>
          </div>
        </div>

        {result.errors.length > 0 && (
          <div className="bg-red-900/30 rounded-xl p-3 space-y-1 max-h-40 overflow-y-auto">
            <p className="text-xs font-semibold text-red-400 mb-2">Errores ({result.errors.length})</p>
            {result.errors.map((e, i) => (
              <p key={i} className="text-xs text-red-300">Fila {e.row}: {e.reason}</p>
            ))}
          </div>
        )}

        <button
          onClick={onClose}
          className="pressable w-full bg-gray-700 hover:bg-gray-600 text-white font-semibold py-2.5 rounded-xl text-sm transition-colors duration-150"
        >
          Cerrar
        </button>
      </div>
    </div>
  );
}

// ─── Inline player form ────────────────────────────────────────────────────────

function AddPlayerModal({
  divisions,
  defaultDivisionId,
  onClose,
  onCreated,
}: {
  divisions: Division[];
  defaultDivisionId: string;
  onClose: () => void;
  onCreated: (p: Player) => void;
}) {
  const [name, setName] = useState("");
  const [position, setPosition] = useState("");
  const [dni, setDni] = useState("");
  const [divisionId, setDivisionId] = useState(defaultDivisionId || divisions[0]?.id || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !divisionId) return;
    setSaving(true);
    setError("");
    try {
      const { data } = await api.post(`/divisions/${divisionId}/players`, {
        name: name.trim(),
        position: position || null,
        dni: dni.trim() || null,
      });
      onCreated(data);
      onClose();
    } catch {
      setError("Error al crear jugador");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-end md:items-center justify-center p-4 animate-overlay" onClick={onClose}>
      <div className="bg-gray-800 rounded-2xl w-full max-w-sm p-6 space-y-4 animate-sheet md:animate-modal" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-white">Nuevo jugador</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white"><IconX /></button>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="text-xs text-gray-400 block mb-1">Nombre *</label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-gray-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-green-500"
              placeholder="Nombre completo"
            />
          </div>
          <div>
            <label className="text-xs text-gray-400 block mb-1">División *</label>
            <select
              required
              value={divisionId}
              onChange={(e) => setDivisionId(e.target.value)}
              className="w-full bg-gray-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-green-500"
            >
              <option value="">— Seleccionar división —</option>
              {divisions.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-400 block mb-1">Posición</label>
            <select
              value={position}
              onChange={(e) => setPosition(e.target.value)}
              className="w-full bg-gray-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-green-500"
            >
              <option value="">— Posición (opcional) —</option>
              {RUGBY_POSITIONS.map((pos) => (
                <option key={pos} value={pos}>{pos}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-400 block mb-1">DNI</label>
            <input
              value={dni}
              onChange={(e) => setDni(e.target.value)}
              className="w-full bg-gray-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-green-500"
              placeholder="Opcional"
            />
          </div>
          {error && <p className="text-red-400 text-xs">{error}</p>}
          <button
            type="submit"
            disabled={saving || !name.trim() || !divisionId}
            className="pressable w-full bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white font-semibold py-2.5 rounded-xl text-sm transition-colors duration-150"
          >
            {saving ? "Guardando..." : "Crear jugador"}
          </button>
        </form>
      </div>
    </div>
  );
}

// ─── Move players bottom sheet ─────────────────────────────────────────────────

function MoveSheet({
  divisions,
  currentDivisionId,
  count,
  onMove,
  onClose,
}: {
  divisions: Division[];
  currentDivisionId: string | null;
  count: number;
  onMove: (divId: string) => void;
  onClose: () => void;
}) {
  const available = divisions.filter((d) => d.id !== currentDivisionId);
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-end justify-center animate-overlay" onClick={onClose}>
      <div className="bg-gray-800 rounded-t-2xl w-full max-w-sm p-5 space-y-3 animate-sheet md:animate-modal" onClick={(e) => e.stopPropagation()}>
        <div className="w-10 h-1 bg-gray-600 rounded-full mx-auto" />
        <p className="text-sm text-gray-400 text-center">
          Mover <span className="text-white font-semibold">{count}</span> jugador{count !== 1 ? "es" : ""} a...
        </p>
        <div className="space-y-2">
          {available.length === 0 && (
            <p className="text-gray-500 text-sm text-center py-4">No hay otras divisiones disponibles</p>
          )}
          {available.map((d) => (
            <button
              key={d.id}
              onClick={() => onMove(d.id)}
              className="w-full text-left bg-gray-700 hover:bg-gray-600 text-white rounded-xl px-4 py-3 text-sm font-medium transition-colors"
            >
              {d.name}
            </button>
          ))}
        </div>
        <button onClick={onClose} className="w-full text-gray-400 text-sm py-2">
          Cancelar
        </button>
      </div>
    </div>
  );
}

// ─── Confirm dialog ────────────────────────────────────────────────────────────

function ConfirmMove({
  count,
  divisionName,
  onConfirm,
  onCancel,
}: {
  count: number;
  divisionName: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 animate-overlay">
      <div className="bg-gray-800 rounded-2xl w-full max-w-xs p-6 space-y-4 animate-sheet md:animate-modal">
        <p className="text-white text-center">
          ¿Mover <strong>{count}</strong> jugador{count !== 1 ? "es" : ""} a{" "}
          <strong>{divisionName}</strong>?
        </p>
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 bg-gray-700 hover:bg-gray-600 text-white rounded-xl py-2.5 text-sm font-medium"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 bg-green-600 hover:bg-green-500 text-white rounded-xl py-2.5 text-sm font-medium"
          >
            Confirmar
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────────

export default function Squad() {
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const {
    players, divisions, loading,
    fetchDivisions, fetchAllPlayers,
    batchMovePlayers,
  } = useSquadStore();

  const [activeDivId, setActiveDivId] = useState<string | "all">("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [multiMode, setMultiMode] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [showMoveSheet, setShowMoveSheet] = useState(false);
  const [confirmMove, setConfirmMove] = useState<{ divId: string; divName: string } | null>(null);
  const [toast, setToast] = useState("");
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const canEdit = user?.role === "club_admin" || user?.role === "match_director";

  useEffect(() => {
    if (!user?.club_id) return;
    fetchDivisions(user.club_id);
    fetchAllPlayers(user.club_id);
  }, [user?.club_id]);

  const visiblePlayers = players.filter((p) => {
    const matchDiv = activeDivId === "all" || p.division_id === activeDivId;
    const matchSearch = !search || p.name.toLowerCase().includes(search.toLowerCase()) ||
      (p.position ?? "").toLowerCase().includes(search.toLowerCase());
    return matchDiv && matchSearch;
  });

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === visiblePlayers.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(visiblePlayers.map((p) => p.id)));
    }
  };

  const enterMultiMode = () => {
    setMultiMode(true);
  };

  const exitMultiMode = () => {
    setMultiMode(false);
    setSelected(new Set());
  };

  const handleLongPressStart = (id: string) => {
    longPressTimer.current = setTimeout(() => {
      enterMultiMode();
      setSelected(new Set([id]));
    }, 500);
  };

  const handleLongPressEnd = () => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
  };

  const handleRowTap = (player: Player) => {
    if (multiMode) {
      toggleSelect(player.id);
    } else {
      navigate(`/squad/${player.id}`);
    }
  };

  const handleMove = (divId: string) => {
    const div = divisions.find((d) => d.id === divId);
    setShowMoveSheet(false);
    setConfirmMove({ divId, divName: div?.name ?? "" });
  };

  const handleConfirmMove = async () => {
    if (!confirmMove) return;
    const ids = Array.from(selected);
    try {
      await batchMovePlayers(ids, confirmMove.divId);
      showToast(`${ids.length} jugador${ids.length !== 1 ? "es" : ""} movido${ids.length !== 1 ? "s" : ""} a ${confirmMove.divName}`);
      exitMultiMode();
    } catch {
      showToast("Error al mover jugadores");
    }
    setConfirmMove(null);
  };

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2500);
  };

  const handlePlayerCreated = (p: Player) => {
    useSquadStore.setState((s) => ({ players: [...s.players, p] }));
  };

  const activeDivName = activeDivId === "all"
    ? "Todos"
    : divisions.find((d) => d.id === activeDivId)?.name ?? "";

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Header */}
      <div
        className={`px-4 pt-4 pb-3 transition-colors ${
          multiMode ? "bg-green-900/40" : "bg-gray-900"
        }`}
      >
        {multiMode ? (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button onClick={exitMultiMode} className="text-gray-400 hover:text-white">
                <IconX />
              </button>
              <span className="font-semibold">{selected.size} seleccionado{selected.size !== 1 ? "s" : ""}</span>
            </div>
            <button
              onClick={() => setShowMoveSheet(true)}
              disabled={selected.size === 0}
              className="pressable bg-green-600 hover:bg-green-500 disabled:opacity-40 text-white text-sm font-semibold px-4 py-2 rounded-xl transition-colors duration-150"
            >
              Mover a...
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-bold">Plantel</h1>
            {canEdit && (
              <div className="flex gap-2">
                <button
                  onClick={() => setShowImportModal(true)}
                  className="pressable bg-gray-700 hover:bg-gray-600 text-gray-300 hover:text-white rounded-xl p-2 transition-colors duration-150"
                  title="Importar desde Excel"
                >
                  <IconUpload />
                </button>
                <button
                  onClick={() => setShowAddModal(true)}
                  className="pressable bg-green-600 hover:bg-green-500 text-white rounded-xl p-2 transition-colors duration-150"
                >
                  <IconPlus />
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Division pills */}
      <div className="flex gap-2 px-4 pb-3 overflow-x-auto scrollbar-none">
        <button
          onClick={() => setActiveDivId("all")}
          className={`shrink-0 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
            activeDivId === "all"
              ? "bg-green-600 text-white"
              : "bg-gray-700 text-gray-300 hover:bg-gray-600"
          }`}
        >
          Todos
        </button>
        {divisions.map((d) => (
          <button
            key={d.id}
            onClick={() => setActiveDivId(d.id)}
            className={`shrink-0 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              activeDivId === d.id
                ? "bg-green-600 text-white"
                : "bg-gray-700 text-gray-300 hover:bg-gray-600"
            }`}
          >
            {d.name}
          </button>
        ))}
      </div>

      {/* Search + select all */}
      <div className="px-4 pb-3 space-y-2">
        <div className="flex items-center gap-2 bg-gray-800 rounded-xl px-3 py-2">
          <span className="text-gray-500"><IconSearch /></span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar jugador..."
            className="flex-1 bg-transparent text-sm text-white placeholder-gray-500 outline-none"
          />
        </div>
        {multiMode && (
          <button
            onClick={toggleAll}
            className="text-sm text-green-400 hover:text-green-300 transition-colors"
          >
            {selected.size === visiblePlayers.length ? "Deseleccionar todos" : "Seleccionar todos"}
          </button>
        )}
      </div>

      {/* Player list */}
      <div className="px-4 space-y-1.5">
        {loading && (
          <div className="text-center py-12 text-gray-500">Cargando jugadores...</div>
        )}
        {!loading && visiblePlayers.length === 0 && (
          <div className="text-center py-12 space-y-3">
            <p className="text-gray-500">No hay jugadores{search ? ` que coincidan con "${search}"` : " en esta división"}</p>
            {canEdit && !search && (
              <button
                onClick={() => setShowAddModal(true)}
                className="text-green-400 hover:text-green-300 text-sm font-medium"
              >
                + Agregar primer jugador
              </button>
            )}
          </div>
        )}
        {visiblePlayers.map((player) => {
          const isSelected = selected.has(player.id);
          const divName = divisions.find((d) => d.id === player.division_id)?.name;
          return (
            <div
              key={player.id}
              onClick={() => handleRowTap(player)}
              onMouseDown={() => !multiMode && handleLongPressStart(player.id)}
              onMouseUp={handleLongPressEnd}
              onMouseLeave={handleLongPressEnd}
              onTouchStart={() => !multiMode && handleLongPressStart(player.id)}
              onTouchEnd={handleLongPressEnd}
              className={`flex items-center gap-3 px-4 py-3.5 rounded-xl cursor-pointer transition-colors ${
                isSelected
                  ? "bg-green-900/50 border border-green-600/50"
                  : "bg-gray-800 hover:bg-gray-700/70 active:bg-gray-700"
              }`}
            >
              {/* Checkbox */}
              {multiMode && (
                <div
                  className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                    isSelected ? "bg-green-500 border-green-500" : "border-gray-500"
                  }`}
                >
                  {isSelected && (
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                      <path d="M2 5l2.5 2.5L8 3" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                  )}
                </div>
              )}

              {/* Avatar */}
              {player.profile_photo_url ? (
                <img
                  src={player.profile_photo_url}
                  alt={player.name}
                  className="w-10 h-10 rounded-full object-cover shrink-0"
                />
              ) : (
                <div className="w-10 h-10 rounded-full bg-gray-700 flex items-center justify-center text-gray-400 text-sm font-bold shrink-0">
                  {player.name.charAt(0).toUpperCase()}
                </div>
              )}

              {/* Info */}
              <div className="flex-1 min-w-0">
                <p className="text-white font-medium text-sm truncate">{player.name}</p>
                <p className="text-gray-400 text-xs truncate">
                  {player.position ?? "Sin posición"}
                  {activeDivId === "all" && divName && (
                    <span className="ml-2 text-gray-500">· {divName}</span>
                  )}
                </p>
              </div>

              {/* Disponibilidad: sin esto, armar el equipo se hace de memoria. */}
              {player.availability && player.availability !== "disponible" && (
                <span
                  className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${AVAILABILITY_CLASS[player.availability]}`}
                >
                  {AVAILABILITY_LABEL[player.availability]}
                </span>
              )}
              {clearanceState(player.medical_clearance_expires) === "expired" && (
                <span
                  className="text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 bg-red-900/60 text-red-300"
                  title="Apto médico vencido"
                >
                  sin apto
                </span>
              )}

              {/* Chevron */}
              {!multiMode && (
                <span className="text-gray-600 shrink-0"><IconChevron /></span>
              )}
            </div>
          );
        })}
      </div>

      {/* Count footer */}
      {visiblePlayers.length > 0 && (
        <p className="text-center text-xs text-gray-600 py-4">
          {visiblePlayers.length} jugador{visiblePlayers.length !== 1 ? "es" : ""}
          {activeDivId !== "all" && ` en ${activeDivName}`}
        </p>
      )}

      {/* Modals */}
      {showImportModal && (
        <ImportModal
          divisions={divisions}
          defaultDivisionId={activeDivId !== "all" ? activeDivId : (divisions[0]?.id ?? "")}
          onClose={() => setShowImportModal(false)}
          onDone={(result, divId) => {
            setShowImportModal(false);
            setImportResult(result);
            if (activeDivId === "all" || activeDivId === divId) {
              // players already refreshed inside importPlayersXlsx
            }
          }}
        />
      )}
      {importResult && (
        <ImportResultModal
          result={importResult}
          onClose={() => setImportResult(null)}
        />
      )}
      {showAddModal && (
        <AddPlayerModal
          divisions={divisions}
          defaultDivisionId={activeDivId !== "all" ? activeDivId : (divisions[0]?.id ?? "")}
          onClose={() => setShowAddModal(false)}
          onCreated={handlePlayerCreated}
        />
      )}
      {showMoveSheet && (
        <MoveSheet
          divisions={divisions}
          currentDivisionId={activeDivId !== "all" ? activeDivId : null}
          count={selected.size}
          onMove={handleMove}
          onClose={() => setShowMoveSheet(false)}
        />
      )}
      {confirmMove && (
        <ConfirmMove
          count={selected.size}
          divisionName={confirmMove.divName}
          onConfirm={handleConfirmMove}
          onCancel={() => setConfirmMove(null)}
        />
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-24 inset-x-0 flex justify-center z-50 pointer-events-none">
          <div className="bg-gray-700 text-white text-sm px-5 py-2.5 rounded-full shadow-lg">
            {toast}
          </div>
        </div>
      )}
    </div>
  );
}
