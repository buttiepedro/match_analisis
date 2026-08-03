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
  const { importPlayersXlsx, exportPlayersXlsx, fetchAllPlayers } = useSquadStore();
  const user = useAuthStore((s) => s.user);
  const [divisionId, setDivisionId] = useState(defaultDivisionId || divisions[0]?.id || "");
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");

  const descargar = async () => {
    setDownloading(true);
    setError("");
    try {
      await exportPlayersXlsx();
    } catch {
      setError("No se pudo descargar el plantel");
    } finally {
      setDownloading(false);
    }
  };

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
      <div className="bg-surface rounded-2xl w-full max-w-sm p-6 space-y-4 animate-sheet md:animate-modal" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-ink">Importar jugadores</h3>
          <button onClick={onClose} className="text-ink-muted hover:text-ink"><IconX /></button>
        </div>

        <div className="bg-surface-strong rounded-xl p-3 space-y-2">
          <p className="text-xs text-ink-soft">
            <strong className="font-semibold text-ink">Editar el plantel en Excel.</strong>{" "}
            Descargá la planilla, corregí lo que haga falta y volvé a subirla acá. Trae
            todas las divisiones y las filas vuelven a su lugar.
          </p>
          <button
            onClick={descargar}
            disabled={downloading}
            className="pressable w-full bg-surface hover:bg-surface-hover disabled:opacity-50 text-ink text-sm font-semibold py-2 rounded-lg transition-colors duration-150"
          >
            {downloading ? "Preparando..." : "Descargar plantel actual"}
          </button>
          <p className="text-[11px] text-ink-faint">
            No toques las columnas <strong>ID</strong> ni <strong>División</strong>: con
            ellas cada fila vuelve al jugador correcto, incluso si le corregís el DNI.
          </p>
        </div>

        <p className="text-xs text-ink-muted">
          También acepta una planilla propia, <strong>.xlsx</strong> o <strong>.xls</strong>.
          Columnas reconocidas: Documento, Apellido, Nombre, Fecha Nac., Sexo, Puesto, Peso,
          Estatura, O.Social, Email, Celular, Tel.Emergencia. Sin columna ID, los jugadores
          se buscan por DNI: los que ya existen se actualizan y el resto se crea en la
          división elegida.
        </p>

        <div>
          <label className="text-xs text-ink-muted block mb-1">División destino</label>
          <select
            value={divisionId}
            onChange={(e) => setDivisionId(e.target.value)}
            className="w-full bg-surface-strong rounded-lg px-3 py-2 text-sm text-ink outline-none focus:ring-2 focus:ring-brand-ring"
          >
            {divisions.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-xs text-ink-muted block mb-1">Archivo Excel</label>
          <label className="flex items-center gap-3 bg-surface-strong hover:bg-surface-hover rounded-xl px-4 py-3 cursor-pointer transition-colors">
            <IconUpload />
            <span className="text-sm text-ink truncate">
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

        {error && <p className="text-red-600 text-xs">{error}</p>}

        <button
          onClick={submit}
          disabled={loading || !file || !divisionId}
          className="pressable w-full bg-brand hover:bg-brand-hover disabled:opacity-50 text-white font-semibold py-2.5 rounded-xl text-sm transition-colors duration-150"
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
      <div className="bg-surface rounded-2xl w-full max-w-sm p-6 space-y-4 animate-sheet md:animate-modal">
        <h3 className="font-semibold text-ink text-center">Importación completada</h3>

        <div className="grid grid-cols-3 gap-3 text-center">
          <div className="bg-brand-soft rounded-xl p-3">
            <p className="text-2xl font-bold text-brand">{result.created}</p>
            <p className="text-xs text-ink-muted mt-1">Creados</p>
          </div>
          <div className="bg-blue-50 rounded-xl p-3">
            <p className="text-2xl font-bold text-blue-600">{result.updated}</p>
            <p className="text-xs text-ink-muted mt-1">Actualizados</p>
          </div>
          <div className="bg-surface-strong rounded-xl p-3">
            <p className="text-2xl font-bold text-ink-soft">{result.skipped}</p>
            <p className="text-xs text-ink-muted mt-1">Omitidos</p>
          </div>
        </div>

        {result.errors.length > 0 && (
          <div className="bg-red-50 rounded-xl p-3 space-y-1 max-h-40 overflow-y-auto">
            <p className="text-xs font-semibold text-red-600 mb-2">Errores ({result.errors.length})</p>
            {result.errors.map((e, i) => (
              <p key={i} className="text-xs text-red-700">Fila {e.row}: {e.reason}</p>
            ))}
          </div>
        )}

        <button
          onClick={onClose}
          className="pressable w-full bg-surface-strong hover:bg-surface-hover text-ink font-semibold py-2.5 rounded-xl text-sm transition-colors duration-150"
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
      <div className="bg-surface rounded-2xl w-full max-w-sm p-6 space-y-4 animate-sheet md:animate-modal" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-ink">Nuevo jugador</h3>
          <button onClick={onClose} className="text-ink-muted hover:text-ink"><IconX /></button>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="text-xs text-ink-muted block mb-1">Nombre *</label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-surface-strong rounded-lg px-3 py-2 text-sm text-ink outline-none focus:ring-2 focus:ring-brand-ring"
              placeholder="Nombre completo"
            />
          </div>
          <div>
            <label className="text-xs text-ink-muted block mb-1">División *</label>
            <select
              required
              value={divisionId}
              onChange={(e) => setDivisionId(e.target.value)}
              className="w-full bg-surface-strong rounded-lg px-3 py-2 text-sm text-ink outline-none focus:ring-2 focus:ring-brand-ring"
            >
              <option value="">— Seleccionar división —</option>
              {divisions.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-ink-muted block mb-1">Posición</label>
            <select
              value={position}
              onChange={(e) => setPosition(e.target.value)}
              className="w-full bg-surface-strong rounded-lg px-3 py-2 text-sm text-ink outline-none focus:ring-2 focus:ring-brand-ring"
            >
              <option value="">— Posición (opcional) —</option>
              {RUGBY_POSITIONS.map((pos) => (
                <option key={pos} value={pos}>{pos}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-ink-muted block mb-1">DNI</label>
            <input
              value={dni}
              onChange={(e) => setDni(e.target.value)}
              className="w-full bg-surface-strong rounded-lg px-3 py-2 text-sm text-ink outline-none focus:ring-2 focus:ring-brand-ring"
              placeholder="Opcional"
            />
          </div>
          {error && <p className="text-red-600 text-xs">{error}</p>}
          <button
            type="submit"
            disabled={saving || !name.trim() || !divisionId}
            className="pressable w-full bg-brand hover:bg-brand-hover disabled:opacity-50 text-white font-semibold py-2.5 rounded-xl text-sm transition-colors duration-150"
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
      <div className="bg-surface rounded-t-2xl w-full max-w-sm p-5 space-y-3 animate-sheet md:animate-modal" onClick={(e) => e.stopPropagation()}>
        <div className="w-10 h-1 bg-surface-hover rounded-full mx-auto" />
        <p className="text-sm text-ink-muted text-center">
          Mover <span className="text-ink font-semibold">{count}</span> jugador{count !== 1 ? "es" : ""} a...
        </p>
        <div className="space-y-2">
          {available.length === 0 && (
            <p className="text-ink-muted text-sm text-center py-4">No hay otras divisiones disponibles</p>
          )}
          {available.map((d) => (
            <button
              key={d.id}
              onClick={() => onMove(d.id)}
              className="w-full text-left bg-surface-strong hover:bg-surface-hover text-ink rounded-xl px-4 py-3 text-sm font-medium transition-colors"
            >
              {d.name}
            </button>
          ))}
        </div>
        <button onClick={onClose} className="w-full text-ink-muted text-sm py-2">
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
      <div className="bg-surface rounded-2xl w-full max-w-xs p-6 space-y-4 animate-sheet md:animate-modal">
        <p className="text-ink text-center">
          ¿Mover <strong>{count}</strong> jugador{count !== 1 ? "es" : ""} a{" "}
          <strong>{divisionName}</strong>?
        </p>
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 bg-surface-strong hover:bg-surface-hover text-ink rounded-xl py-2.5 text-sm font-medium"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 bg-brand hover:bg-brand-hover text-white rounded-xl py-2.5 text-sm font-medium"
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
  //: Con miles de jugadores importados, renderizar todo de una es lo que
  //: hacía la página pesar cientos de miles de píxeles de alto. Se muestra de
  //: a tandas y se resetea cada vez que cambia el filtro.
  const RENDER_BATCH = 150;
  const [renderLimit, setRenderLimit] = useState(RENDER_BATCH);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [multiMode, setMultiMode] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [showMoveSheet, setShowMoveSheet] = useState(false);
  const [confirmMove, setConfirmMove] = useState<{ divId: string; divName: string } | null>(null);
  const [toast, setToast] = useState("");
  /** Ids en riesgo de deserción, por división. El plantel es donde se los mira. */
  const [atRisk, setAtRisk] = useState<Set<string>>(new Set());
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const canEdit = user?.role === "club_admin" || user?.role === "match_director";

  useEffect(() => {
    if (!user?.club_id) return;
    fetchDivisions(user.club_id);
    fetchAllPlayers(user.club_id);
  }, [user?.club_id]);

  useEffect(() => {
    if (!user?.club_id) return;
    let cancelled = false;

    api
      .get<string[]>(`/clubs/${user.club_id}/at-risk`, { params: { days: 30 } })
      // Sin asistencia cargada no hay riesgo que reportar: no es un error.
      .catch(() => ({ data: [] as string[] }))
      .then(({ data }) => {
        if (!cancelled) setAtRisk(new Set(data));
      });

    return () => {
      cancelled = true;
    };
  }, [user?.club_id]);

  const visiblePlayers = players.filter((p) => {
    const matchDiv = activeDivId === "all" || p.division_id === activeDivId;
    const matchSearch = !search || p.name.toLowerCase().includes(search.toLowerCase()) ||
      (p.position ?? "").toLowerCase().includes(search.toLowerCase());
    return matchDiv && matchSearch;
  });
  const renderedPlayers = visiblePlayers.slice(0, renderLimit);

  useEffect(() => {
    setRenderLimit(RENDER_BATCH);
  }, [activeDivId, search]);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === renderedPlayers.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(renderedPlayers.map((p) => p.id)));
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
    <div className="min-h-screen bg-white text-ink">
      {/* Header */}
      <div
        className={`px-4 pt-4 pb-3 transition-colors ${
          multiMode ? "bg-brand-soft" : "bg-white"
        }`}
      >
        {multiMode ? (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button onClick={exitMultiMode} className="text-ink-muted hover:text-ink">
                <IconX />
              </button>
              <span className="font-semibold">{selected.size} seleccionado{selected.size !== 1 ? "s" : ""}</span>
            </div>
            <button
              onClick={() => setShowMoveSheet(true)}
              disabled={selected.size === 0}
              className="pressable bg-brand hover:bg-brand-hover disabled:opacity-40 text-white text-sm font-semibold px-4 py-2 rounded-xl transition-colors duration-150"
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
                  className="pressable bg-surface-strong hover:bg-surface-hover text-ink-soft hover:text-ink rounded-xl p-2 transition-colors duration-150"
                  title="Importar desde Excel"
                >
                  <IconUpload />
                </button>
                <button
                  onClick={() => setShowAddModal(true)}
                  className="pressable bg-brand hover:bg-brand-hover text-white rounded-xl p-2 transition-colors duration-150"
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
              ? "bg-brand text-white"
              : "bg-surface-strong text-ink-soft hover:bg-surface-hover"
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
                ? "bg-brand text-white"
                : "bg-surface-strong text-ink-soft hover:bg-surface-hover"
            }`}
          >
            {d.name}
          </button>
        ))}
      </div>

      {/* Search + select all */}
      <div className="px-4 pb-3 space-y-2">
        <div className="flex items-center gap-2 bg-surface rounded-xl px-3 py-2">
          <span className="text-ink-muted"><IconSearch /></span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar jugador..."
            className="flex-1 bg-transparent text-sm text-ink placeholder-ink-faint outline-none"
          />
        </div>
        {multiMode && (
          <button
            onClick={toggleAll}
            className="text-sm text-brand hover:text-brand transition-colors"
          >
            {selected.size === renderedPlayers.length ? "Deseleccionar todos" : "Seleccionar todos"}
          </button>
        )}
      </div>

      {/* Player list */}
      <div className="px-4 space-y-1.5">
        {loading && (
          <div className="text-center py-12 text-ink-muted">Cargando jugadores...</div>
        )}
        {!loading && visiblePlayers.length === 0 && (
          <div className="text-center py-12 space-y-3">
            <p className="text-ink-muted">No hay jugadores{search ? ` que coincidan con "${search}"` : " en esta división"}</p>
            {canEdit && !search && (
              <button
                onClick={() => setShowAddModal(true)}
                className="text-brand hover:text-brand text-sm font-medium"
              >
                + Agregar primer jugador
              </button>
            )}
          </div>
        )}
        {renderedPlayers.map((player) => {
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
                  ? "bg-brand-soft border border-brand-ring"
                  : "bg-surface hover:bg-surface-hover active:bg-surface-strong"
              }`}
            >
              {/* Checkbox */}
              {multiMode && (
                <div
                  className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                    isSelected ? "bg-brand border-green-500" : "border-gray-500"
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
                <div className="w-10 h-10 rounded-full bg-surface-strong flex items-center justify-center text-ink-muted text-sm font-bold shrink-0">
                  {player.name.charAt(0).toUpperCase()}
                </div>
              )}

              {/* Info */}
              <div className="flex-1 min-w-0">
                <p className="text-ink font-medium text-sm truncate">{player.name}</p>
                <p className="text-ink-muted text-xs truncate">
                  {player.position ?? "Sin posición"}
                  {activeDivId === "all" && divName && (
                    <span className="ml-2 text-ink-muted">· {divName}</span>
                  )}
                </p>
              </div>

              {atRisk.has(player.id) && (
                <span
                  className="text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 bg-red-100 text-red-700"
                  title="3 ausencias seguidas o menos de 50% de asistencia"
                >
                  en riesgo
                </span>
              )}

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
                  className="text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 bg-red-100 text-red-700"
                  title="Apto médico vencido"
                >
                  sin apto
                </span>
              )}

              {/* Chevron */}
              {!multiMode && (
                <span className="text-ink-faint shrink-0"><IconChevron /></span>
              )}
            </div>
          );
        })}
      </div>

      {/* Count footer */}
      {visiblePlayers.length > 0 && (
        <div className="text-center py-4 space-y-2">
          <p className="text-xs text-ink-faint">
            {renderedPlayers.length < visiblePlayers.length
              ? `Mostrando ${renderedPlayers.length} de ${visiblePlayers.length} jugadores`
              : `${visiblePlayers.length} jugador${visiblePlayers.length !== 1 ? "es" : ""}`}
            {activeDivId !== "all" && ` en ${activeDivName}`}
          </p>
          {renderedPlayers.length < visiblePlayers.length && (
            <button
              onClick={() => setRenderLimit((n) => n + RENDER_BATCH)}
              className="text-sm text-brand hover:text-brand transition-colors"
            >
              Cargar {Math.min(RENDER_BATCH, visiblePlayers.length - renderedPlayers.length)} más
            </button>
          )}
        </div>
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
          <div className="bg-surface-strong text-ink text-sm px-5 py-2.5 rounded-full shadow-lg">
            {toast}
          </div>
        </div>
      )}
    </div>
  );
}
