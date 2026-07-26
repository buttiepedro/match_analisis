import { useEffect, useRef, useState } from "react";
import * as XLSX from "xlsx";
import api from "../lib/axios";
import { parseApiError } from "../lib/errors";
import { useAuthStore } from "../store/authStore";
import { RUGBY_POSITIONS } from "../lib/rugby";
import CropModal from "../components/CropModal";
import UnifyPlayersModal from "../components/UnifyPlayersModal";

type ConfigTab = "divisions" | "players" | "users";

interface Division { id: string; name: string; is_active: boolean }
interface PlayerWithDivision {
  id: string;
  division_id: string;
  division_name: string;
  name: string;
  position: string | null;
  dni?: string | null;
  profile_photo_url?: string | null;
  is_active: boolean;
}

function PlayerAvatar({ player, size = 38 }: { player: PlayerWithDivision; size?: number }) {
  const src = player.profile_photo_url ?? null;
  return (
    <div
      className="rounded-full overflow-hidden bg-surface-strong flex items-center justify-center flex-shrink-0"
      style={{ width: size, height: size }}
    >
      {src ? (
        <img src={src} alt={player.name} className="w-full h-full object-cover" />
      ) : (
        <span className="text-ink-soft font-bold" style={{ fontSize: size * 0.4 }}>
          {player.name.trim()[0]?.toUpperCase() ?? "?"}
        </span>
      )}
    </div>
  );
}
interface ClubUser { id: string; email: string; full_name: string; role: string }

const ROLE_LABEL: Record<string, string> = {
  club_admin:     "Admin de club",
  match_director: "Director de partido",
  analyst:        "Analista",
};

const TABS: { id: ConfigTab; label: string }[] = [
  { id: "divisions", label: "Divisiones" },
  { id: "players",   label: "Jugadores" },
  { id: "users",     label: "Usuarios" },
];

export default function Configuracion() {
  const clubId = useAuthStore((s) => s.user?.club_id);
  const [activeTab, setActiveTab] = useState<ConfigTab>("divisions");

  // ── Divisions ──────────────────────────────────────────────────────────────
  const [divisions,     setDivisions]     = useState<Division[]>([]);
  const [loadingDivs,   setLoadingDivs]   = useState(true);
  const [addingDiv,     setAddingDiv]     = useState(false);
  const [divName,       setDivName]       = useState("");
  const [divSubmitting, setDivSubmitting] = useState(false);
  const [divError,      setDivError]      = useState<string | null>(null);
  const [divLoadError,  setDivLoadError]  = useState<string | null>(null);
  const [editingDivId,  setEditingDivId]  = useState<string | null>(null);
  const [editDivName,   setEditDivName]   = useState("");

  useEffect(() => {
    if (!clubId) return;
    api.get<Division[]>(`/clubs/${clubId}/divisions`)
      .then(({ data }) => setDivisions(data))
      .catch(() => setDivLoadError("Error al cargar divisiones"))
      .finally(() => setLoadingDivs(false));
  }, [clubId]);

  const handleCreateDivision = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clubId) return;
    setDivSubmitting(true);
    setDivError(null);
    try {
      const { data } = await api.post<Division>(`/clubs/${clubId}/divisions`, { name: divName });
      setDivisions((prev) => [...prev, data]);
      setDivName("");
      setAddingDiv(false);
    } catch (err) {
      setDivError(parseApiError(err, "Error al crear la división"));
    } finally {
      setDivSubmitting(false);
    }
  };

  const handleRenameDivision = async (id: string) => {
    if (!clubId) return;
    const name = editDivName.trim();
    if (!name) return;
    setDivSubmitting(true);
    setDivError(null);
    try {
      const { data } = await api.patch<Division>(`/clubs/${clubId}/divisions/${id}`, { name });
      setDivisions((prev) => prev.map((d) => (d.id === id ? data : d)));
      setEditingDivId(null);
    } catch (err) {
      setDivError(parseApiError(err, "Error al renombrar la división"));
    } finally {
      setDivSubmitting(false);
    }
  };

  const handleDeleteDivision = async (d: Division) => {
    if (!clubId) return;
    if (!confirm(`¿Eliminar la división "${d.name}"?`)) return;
    setDivError(null);
    try {
      await api.delete(`/clubs/${clubId}/divisions/${d.id}`);
      setDivisions((prev) => prev.filter((x) => x.id !== d.id));
    } catch (err) {
      // El backend rechaza el borrado si quedan jugadores o torneos activos y
      // explica cuántos: ese detalle es la parte útil del mensaje.
      setDivError(parseApiError(err, "Error al eliminar la división"));
    }
  };

  // ── Players ────────────────────────────────────────────────────────────────
  const [allPlayers,       setAllPlayers]       = useState<PlayerWithDivision[]>([]);
  const [playersLoaded,    setPlayersLoaded]    = useState(false);
  const [loadingPlayers,   setLoadingPlayers]   = useState(false);
  const [playerDivFilter,  setPlayerDivFilter]  = useState("");
  const [addingPlayer,     setAddingPlayer]     = useState(false);
  const [playerForm,       setPlayerForm]       = useState({ name: "", position: "", divisionId: "" });
  const [playerSubmitting, setPlayerSubmitting] = useState(false);
  const [playerError,      setPlayerError]      = useState<string | null>(null);

  // Edit player
  const [editingPlayerId, setEditingPlayerId] = useState<string | null>(null);
  const [editForm,        setEditForm]        = useState({ name: "", position: "", divisionId: "" });
  const [editSubmitting,  setEditSubmitting]  = useState(false);
  const [editError,       setEditError]       = useState<string | null>(null);

  // Import/export
  const importRef = useRef<HTMLInputElement>(null);
  const [importing,     setImporting]     = useState(false);
  const [importResult,  setImportResult]  = useState<string | null>(null);

  // Photo upload
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadTargetRef = useRef<{ playerId: string; divisionId: string } | null>(null);
  const [uploadingPlayerId, setUploadingPlayerId] = useState<string | null>(null);
  const [cropSrc, setCropSrc] = useState<string | null>(null);

  // Unify
  const [unifyKeepPlayer, setUnifyKeepPlayer] = useState<PlayerWithDivision | null>(null);

  useEffect(() => {
    if (activeTab !== "players" || playersLoaded || !clubId) return;
    setLoadingPlayers(true);
    api.get<PlayerWithDivision[]>(`/clubs/${clubId}/players`)
      .then(({ data }) => { setAllPlayers(data); setPlayersLoaded(true); })
      .finally(() => setLoadingPlayers(false));
  }, [activeTab, clubId, playersLoaded]);

  const filteredPlayers = playerDivFilter
    ? allPlayers.filter((p) => p.division_id === playerDivFilter)
    : allPlayers;

  const openAddPlayer = () => {
    const defaultDivId = playerDivFilter || divisions[0]?.id || "";
    setPlayerForm({ name: "", position: "", divisionId: defaultDivId });
    setPlayerError(null);
    setAddingPlayer(true);
  };

  const handleCreatePlayer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!playerForm.divisionId) return;
    setPlayerSubmitting(true);
    setPlayerError(null);
    try {
      const { data: raw } = await api.post<Omit<PlayerWithDivision, "division_name">>(
        `/divisions/${playerForm.divisionId}/players`,
        { name: playerForm.name, position: playerForm.position || null }
      );
      const divName = divisions.find((d) => d.id === playerForm.divisionId)?.name ?? "";
      setAllPlayers((prev) => [...prev, { ...raw, division_name: divName }]);
      setPlayerForm((f) => ({ ...f, name: "", position: "" }));
      setAddingPlayer(false);
    } catch (err) {
      setPlayerError(parseApiError(err, "Error al agregar jugador"));
    } finally {
      setPlayerSubmitting(false);
    }
  };

  const openEditPlayer = (p: PlayerWithDivision) => {
    setEditingPlayerId(p.id);
    setEditForm({ name: p.name, position: p.position ?? "", divisionId: p.division_id });
    setEditError(null);
  };

  const handleEditPlayer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPlayerId) return;
    const player = allPlayers.find((p) => p.id === editingPlayerId);
    if (!player) return;
    setEditSubmitting(true);
    setEditError(null);
    try {
      const body: Record<string, unknown> = {
        name: editForm.name,
        position: editForm.position || null,
      };
      if (editForm.divisionId !== player.division_id) body.division_id = editForm.divisionId;
      await api.patch(`/divisions/${player.division_id}/players/${player.id}`, body);
      const newDivName = divisions.find((d) => d.id === editForm.divisionId)?.name ?? player.division_name;
      setAllPlayers((prev) =>
        prev.map((p) =>
          p.id === editingPlayerId
            ? { ...p, name: editForm.name, position: editForm.position || null, division_id: editForm.divisionId, division_name: newDivName }
            : p
        )
      );
      setEditingPlayerId(null);
    } catch (err) {
      setEditError(parseApiError(err, "Error al actualizar jugador"));
    } finally {
      setEditSubmitting(false);
    }
  };

  const exportPlayersExcel = () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ["ID", "Jugador", "Posicion", "Division"],
      ...allPlayers.map((p) => [p.id, p.name, p.position ?? "", p.division_name]),
    ]);
    ws["!cols"] = [{ wch: 38 }, { wch: 30 }, { wch: 18 }, { wch: 20 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Jugadores");
    XLSX.writeFile(wb, "jugadores.xlsx");
  };

  const handleImportPlayers = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setImporting(true);
    setImportResult(null);
    try {
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, string>>(ws);

      let created = 0, updated = 0, errors = 0;

      for (const row of rows) {
        const name = (row["Jugador"] ?? "").trim();
        const position = (row["Posicion"] ?? "").trim() || null;
        const divisionName = (row["Division"] ?? "").trim();
        const rowId = (row["ID"] ?? "").trim();
        if (!name || !divisionName) continue;

        const div = divisions.find((d) => d.name.toLowerCase() === divisionName.toLowerCase());
        if (!div) { errors++; continue; }

        try {
          if (rowId) {
            const existing = allPlayers.find((p) => p.id === rowId);
            if (existing) {
              const body: Record<string, unknown> = { name, position };
              if (existing.division_id !== div.id) body.division_id = div.id;
              await api.patch(`/divisions/${existing.division_id}/players/${existing.id}`, body);
              updated++;
            } else {
              await api.post(`/divisions/${div.id}/players`, { name, position });
              created++;
            }
          } else {
            await api.post(`/divisions/${div.id}/players`, { name, position });
            created++;
          }
        } catch { errors++; }
      }

      setImportResult(`✓ ${created} creados, ${updated} actualizados${errors > 0 ? `, ${errors} errores` : ""}`);
      setPlayersLoaded(false); // trigger reload
    } catch {
      setImportResult("Error al leer el archivo");
    } finally {
      setImporting(false);
    }
  };

  // ── Photo upload ──────────────────────────────────────────────────────────
  function triggerPhotoUpload(p: PlayerWithDivision) {
    uploadTargetRef.current = { playerId: p.id, divisionId: p.division_id };
    fileInputRef.current?.click();
  }

  function handlePhotoFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !uploadTargetRef.current) return;
    e.target.value = "";
    const reader = new FileReader();
    reader.onload = () => setCropSrc(reader.result as string);
    reader.readAsDataURL(file);
  }

  async function handleCropConfirm(blob: Blob) {
    const target = uploadTargetRef.current;
    if (!target) return;
    setCropSrc(null);
    setUploadingPlayerId(target.playerId);
    try {
      const formData = new FormData();
      formData.append("file", blob, "photo.png");
      const { data } = await api.post<{ id: string; profile_photo_url: string | null }>(
        `/divisions/${target.divisionId}/players/${target.playerId}/photo`,
        formData,
        { headers: { "Content-Type": "multipart/form-data" } },
      );
      setAllPlayers((prev) =>
        prev.map((p) => (p.id === target.playerId ? { ...p, profile_photo_url: data.profile_photo_url } : p)),
      );
    } catch (err) {
      alert(parseApiError(err, "Error al subir la foto"));
    } finally {
      setUploadingPlayerId(null);
    }
  }

  function handleCropCancel() {
    setCropSrc(null);
    uploadTargetRef.current = null;
  }

  // ── Users ──────────────────────────────────────────────────────────────────
  const [users,          setUsers]          = useState<ClubUser[]>([]);
  /** Alcance por usuario. **Vacío = todas las divisiones**, no "ninguna". */
  const [userScopes,     setUserScopes]     = useState<Record<string, string[]>>({});
  const [editingScopeFor, setEditingScopeFor] = useState<string | null>(null);
  const [loadingUsers,   setLoadingUsers]   = useState(false);
  const [usersLoaded,    setUsersLoaded]    = useState(false);
  const [showUserModal,  setShowUserModal]  = useState(false);
  const [userForm,       setUserForm]       = useState({
    full_name: "", email: "", password: "",
    role: "match_director" as "match_director" | "analyst",
  });
  const [userSubmitting, setUserSubmitting] = useState(false);
  const [userError,      setUserError]      = useState<string | null>(null);

  useEffect(() => {
    if (activeTab !== "users" || usersLoaded || !clubId) return;
    setLoadingUsers(true);
    api.get<ClubUser[]>(`/clubs/${clubId}/users`)
      .then(async ({ data }) => {
        setUsers(data);
        setUsersLoaded(true);
        const scopes = await Promise.all(
          data.map((u) =>
            api
              .get<string[]>(`/clubs/${clubId}/users/${u.id}/divisions`)
              .then(({ data: ids }) => [u.id, ids] as const)
              .catch(() => [u.id, [] as string[]] as const)
          )
        );
        setUserScopes(Object.fromEntries(scopes));
      })
      .finally(() => setLoadingUsers(false));
  }, [activeTab, clubId, usersLoaded]);

  const toggleUserDivision = async (userId: string, divisionId: string) => {
    if (!clubId) return;
    const current = userScopes[userId] ?? [];
    const next = current.includes(divisionId)
      ? current.filter((id) => id !== divisionId)
      : [...current, divisionId];

    // Optimista: el toggle tiene que sentirse instantáneo; si falla se revierte.
    setUserScopes((prev) => ({ ...prev, [userId]: next }));
    try {
      const { data } = await api.put<string[]>(
        `/clubs/${clubId}/users/${userId}/divisions`,
        { division_ids: next }
      );
      setUserScopes((prev) => ({ ...prev, [userId]: data }));
    } catch {
      setUserScopes((prev) => ({ ...prev, [userId]: current }));
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clubId) return;
    setUserSubmitting(true);
    setUserError(null);
    try {
      const { data } = await api.post<ClubUser>(`/clubs/${clubId}/users`, userForm);
      setUsers((prev) => [...prev, data]);
      setShowUserModal(false);
      setUserForm({ full_name: "", email: "", password: "", role: "match_director" });
    } catch (err) {
      setUserError(parseApiError(err, "Error al crear el usuario"));
    } finally {
      setUserSubmitting(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="p-6 max-w-lg">
      <h1 className="text-xl font-bold text-ink mb-5">Configuración</h1>

      {/* Tab selector */}
      <div className="flex gap-1 bg-surface rounded-xl p-1 mb-6">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors ${
              activeTab === t.id ? "bg-brand text-white" : "text-ink-muted hover:text-ink"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Divisiones ─────────────────────────────────────────────────── */}
      {activeTab === "divisions" && (
        <>
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-ink-muted">{divisions.length} división{divisions.length !== 1 ? "es" : ""}</p>
            {!addingDiv && (
              <button
                onClick={() => { setAddingDiv(true); setDivError(null); }}
                className="text-sm bg-brand hover:bg-brand-hover text-white px-4 py-2 rounded-lg transition-colors"
              >
                + Nueva división
              </button>
            )}
          </div>

          {addingDiv && (
            <form onSubmit={handleCreateDivision} className="bg-surface rounded-xl p-4 mb-4 space-y-3">
              <input
                required autoFocus
                placeholder="Nombre de la división"
                value={divName}
                onChange={(e) => setDivName(e.target.value)}
                className="w-full bg-surface-strong text-ink text-sm rounded-lg px-3 py-2.5 placeholder-ink-faint outline-none focus:ring-1 focus:ring-brand-ring"
              />
              {divError && <p className="text-red-600 text-xs">{divError}</p>}
              <div className="flex gap-2">
                <button type="submit" disabled={divSubmitting}
                  className="text-sm bg-brand hover:bg-brand-hover disabled:opacity-50 text-white px-4 py-2 rounded-lg transition-colors">
                  {divSubmitting ? "Guardando..." : "Guardar"}
                </button>
                <button type="button"
                  onClick={() => { setAddingDiv(false); setDivError(null); setDivName(""); }}
                  className="text-sm text-ink-muted hover:text-ink px-4 py-2 rounded-lg transition-colors">
                  Cancelar
                </button>
              </div>
            </form>
          )}

          {divLoadError ? (
            <p className="text-red-600 text-sm">{divLoadError}</p>
          ) : loadingDivs ? (
            <p className="text-ink-muted text-sm">Cargando...</p>
          ) : divisions.length === 0 ? (
            <p className="text-ink-muted text-sm">No hay divisiones todavía.</p>
          ) : (
            <>
              {divError && !addingDiv && <p className="text-red-600 text-xs mb-2">{divError}</p>}
              <ul className="space-y-2">
                {divisions.map((d) => (
                  <li key={d.id} className="bg-surface rounded-xl px-4 py-3 flex items-center gap-2">
                    {editingDivId === d.id ? (
                      <>
                        <input
                          autoFocus
                          value={editDivName}
                          onChange={(e) => setEditDivName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleRenameDivision(d.id);
                            if (e.key === "Escape") setEditingDivId(null);
                          }}
                          className="flex-1 bg-surface-strong text-ink text-sm rounded-lg px-3 py-1.5 outline-none focus:ring-1 focus:ring-brand-ring"
                        />
                        <button
                          onClick={() => handleRenameDivision(d.id)}
                          disabled={divSubmitting}
                          className="text-xs bg-brand hover:bg-brand-hover disabled:opacity-50 text-white px-3 py-1.5 rounded-lg transition-colors"
                        >
                          Guardar
                        </button>
                        <button
                          onClick={() => setEditingDivId(null)}
                          className="text-xs text-ink-muted hover:text-ink px-2 py-1.5 transition-colors"
                        >
                          Cancelar
                        </button>
                      </>
                    ) : (
                      <>
                        <span className="text-ink text-sm font-medium flex-1">{d.name}</span>
                        <button
                          onClick={() => {
                            setEditingDivId(d.id);
                            setEditDivName(d.name);
                            setDivError(null);
                          }}
                          className="text-xs text-ink-muted hover:text-ink px-2 py-1 transition-colors"
                        >
                          Renombrar
                        </button>
                        <button
                          onClick={() => handleDeleteDivision(d)}
                          className="text-xs text-ink-muted hover:text-red-600 px-2 py-1 transition-colors"
                        >
                          Eliminar
                        </button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}

      {/* ── Jugadores ──────────────────────────────────────────────────── */}
      {activeTab === "players" && (
        <>
          {loadingDivs && !playersLoaded ? (
            <p className="text-ink-muted text-sm">Cargando...</p>
          ) : divisions.length === 0 ? (
            <p className="text-ink-muted text-sm">Primero creá una división en la pestaña Divisiones.</p>
          ) : (
            <>
              {/* Division filter pills */}
              {divisions.length > 1 && (
                <div className="flex gap-2 flex-wrap mb-4">
                  <button
                    onClick={() => setPlayerDivFilter("")}
                    className={`text-sm px-4 py-1.5 rounded-full transition-colors ${
                      playerDivFilter === "" ? "bg-brand text-white" : "bg-surface-strong text-ink-soft hover:bg-surface-hover"
                    }`}
                  >
                    Todas
                  </button>
                  {divisions.map((d) => (
                    <button
                      key={d.id}
                      onClick={() => setPlayerDivFilter(d.id)}
                      className={`text-sm px-4 py-1.5 rounded-full transition-colors ${
                        playerDivFilter === d.id ? "bg-brand text-white" : "bg-surface-strong text-ink-soft hover:bg-surface-hover"
                      }`}
                    >
                      {d.name}
                    </button>
                  ))}
                </div>
              )}

              {/* Header row */}
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm text-ink-muted">
                  {filteredPlayers.length} jugador{filteredPlayers.length !== 1 ? "es" : ""}
                </p>
                <div className="flex items-center gap-1">
                  <button
                    onClick={exportPlayersExcel}
                    disabled={allPlayers.length === 0}
                    className="text-xs text-ink-muted hover:text-ink px-2 py-1.5 rounded transition-colors disabled:opacity-40"
                    title="Exportar a Excel"
                  >
                    ↓ Exportar
                  </button>
                  <button
                    onClick={() => importRef.current?.click()}
                    disabled={importing}
                    className="text-xs text-ink-muted hover:text-ink px-2 py-1.5 rounded transition-colors disabled:opacity-40"
                    title="Importar desde Excel"
                  >
                    {importing ? "Importando..." : "↑ Importar"}
                  </button>
                  <input
                    ref={importRef}
                    type="file"
                    accept=".xlsx,.xls"
                    onChange={handleImportPlayers}
                    className="hidden"
                  />
                  {!addingPlayer && (
                    <button
                      onClick={openAddPlayer}
                      className="text-sm bg-brand hover:bg-brand-hover text-white px-3 py-1.5 rounded-lg transition-colors ml-1"
                    >
                      + Agregar
                    </button>
                  )}
                </div>
              </div>

              {importResult && (
                <p className={`text-xs mb-3 ${importResult.startsWith("✓") ? "text-brand" : "text-red-600"}`}>
                  {importResult}
                </p>
              )}

              {addingPlayer && (
                <form onSubmit={handleCreatePlayer} className="bg-surface rounded-xl p-4 mb-4 space-y-3">
                  <input
                    required autoFocus
                    placeholder="Nombre del jugador"
                    value={playerForm.name}
                    onChange={(e) => setPlayerForm((f) => ({ ...f, name: e.target.value }))}
                    className="w-full bg-surface-strong text-ink text-sm rounded-lg px-3 py-2.5 placeholder-ink-faint outline-none focus:ring-1 focus:ring-brand-ring"
                  />
                  <select
                    value={playerForm.position}
                    onChange={(e) => setPlayerForm((f) => ({ ...f, position: e.target.value }))}
                    className="w-full bg-surface-strong text-ink text-sm rounded-lg px-3 py-2.5 outline-none focus:ring-1 focus:ring-brand-ring"
                  >
                    <option value="">— Posición (opcional) —</option>
                    {RUGBY_POSITIONS.map((pos) => (
                      <option key={pos} value={pos}>{pos}</option>
                    ))}
                  </select>
                  <select
                    required
                    value={playerForm.divisionId}
                    onChange={(e) => setPlayerForm((f) => ({ ...f, divisionId: e.target.value }))}
                    className="w-full bg-surface-strong text-ink text-sm rounded-lg px-3 py-2.5 outline-none focus:ring-1 focus:ring-brand-ring"
                  >
                    <option value="">— División —</option>
                    {divisions.map((d) => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>
                  {playerError && <p className="text-red-600 text-xs">{playerError}</p>}
                  <div className="flex gap-2">
                    <button type="submit" disabled={playerSubmitting}
                      className="text-sm bg-brand hover:bg-brand-hover disabled:opacity-50 text-white px-4 py-2 rounded-lg transition-colors">
                      {playerSubmitting ? "Guardando..." : "Guardar"}
                    </button>
                    <button type="button"
                      onClick={() => { setAddingPlayer(false); setPlayerError(null); }}
                      className="text-sm text-ink-muted hover:text-ink px-4 py-2 rounded-lg transition-colors">
                      Cancelar
                    </button>
                  </div>
                </form>
              )}

              {loadingPlayers ? (
                <p className="text-ink-muted text-sm">Cargando jugadores...</p>
              ) : filteredPlayers.length === 0 ? (
                <p className="text-ink-muted text-sm">
                  {playerDivFilter ? "No hay jugadores en esta división." : "No hay jugadores todavía."}
                </p>
              ) : (
                <ul className="space-y-2">
                  {filteredPlayers.map((p) => (
                    <li key={p.id} className="bg-surface rounded-xl overflow-hidden">
                      {editingPlayerId === p.id ? (
                        <form onSubmit={handleEditPlayer} className="p-4 space-y-3">
                          <p className="text-xs text-ink-muted uppercase tracking-wide">Editar jugador</p>
                          <input
                            required
                            value={editForm.name}
                            onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                            placeholder="Nombre"
                            className="w-full bg-surface-strong text-ink text-sm rounded-lg px-3 py-2 placeholder-ink-faint outline-none focus:ring-1 focus:ring-brand-ring"
                          />
                          <select
                            value={editForm.position}
                            onChange={(e) => setEditForm((f) => ({ ...f, position: e.target.value }))}
                            className="w-full bg-surface-strong text-ink text-sm rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-brand-ring"
                          >
                            <option value="">— Posición —</option>
                            {RUGBY_POSITIONS.map((pos) => (
                              <option key={pos} value={pos}>{pos}</option>
                            ))}
                          </select>
                          <select
                            required
                            value={editForm.divisionId}
                            onChange={(e) => setEditForm((f) => ({ ...f, divisionId: e.target.value }))}
                            className="w-full bg-surface-strong text-ink text-sm rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-brand-ring"
                          >
                            {divisions.map((d) => (
                              <option key={d.id} value={d.id}>{d.name}</option>
                            ))}
                          </select>
                          {editError && <p className="text-red-600 text-xs">{editError}</p>}
                          <div className="flex gap-2">
                            <button type="submit" disabled={editSubmitting}
                              className="text-sm bg-brand hover:bg-brand-hover disabled:opacity-50 text-white px-4 py-1.5 rounded-lg transition-colors">
                              {editSubmitting ? "Guardando..." : "Guardar"}
                            </button>
                            <button type="button"
                              onClick={() => { setEditingPlayerId(null); setEditError(null); }}
                              className="text-sm text-ink-muted hover:text-ink px-4 py-1.5 rounded-lg transition-colors">
                              Cancelar
                            </button>
                          </div>
                        </form>
                      ) : (
                        <div className="px-4 py-3 flex items-center gap-3">
                          {/* Avatar + photo upload */}
                          <div className="relative group flex-shrink-0">
                            <PlayerAvatar player={p} size={40} />
                            <button
                              onClick={() => triggerPhotoUpload(p)}
                              disabled={uploadingPlayerId === p.id}
                              className="absolute inset-0 rounded-full bg-black/0 group-hover:bg-black/50 flex items-center justify-center transition-colors duration-150 disabled:opacity-50"
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
                            <span className="text-ink text-sm font-medium block truncate">{p.name}</span>
                            {p.position && <span className="text-ink-muted text-xs">{p.position}</span>}
                            {p.dni && <span className="text-ink-muted text-xs block">DNI {p.dni}</span>}
                          </div>
                          {/* Division pill */}
                          {divisions.length > 1 && (
                            <span className="text-xs text-ink-muted bg-surface-strong px-2 py-0.5 rounded-full shrink-0">
                              {p.division_name}
                            </span>
                          )}
                          {/* Unify + Edit */}
                          {filteredPlayers.length >= 2 && (
                            <button
                              onClick={() => setUnifyKeepPlayer(p)}
                              className="text-xs text-ink-muted hover:text-yellow-600 transition-colors shrink-0"
                              title="Unificar con otro jugador"
                            >
                              Unificar →
                            </button>
                          )}
                          <button
                            onClick={() => openEditPlayer(p)}
                            className="text-ink-muted hover:text-ink text-sm px-1.5 py-0.5 rounded transition-colors"
                            title="Editar"
                          >
                            ✎
                          </button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </>
      )}

      {/* ── Usuarios ───────────────────────────────────────────────────── */}
      {activeTab === "users" && (
        <>
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-ink-muted">{users.length} usuario{users.length !== 1 ? "s" : ""}</p>
            <button
              onClick={() => { setShowUserModal(true); setUserError(null); }}
              className="text-sm bg-brand hover:bg-brand-hover text-white px-4 py-2 rounded-lg transition-colors"
            >
              + Nuevo usuario
            </button>
          </div>

          {loadingUsers ? (
            <p className="text-ink-muted text-sm">Cargando...</p>
          ) : users.length === 0 ? (
            <p className="text-ink-muted text-sm">No hay usuarios todavía.</p>
          ) : (
            <ul className="space-y-2">
              {users.map((u) => {
                const scope = userScopes[u.id] ?? [];
                const editing = editingScopeFor === u.id;
                return (
                  <li key={u.id} className="bg-surface rounded-xl px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-ink text-sm font-medium truncate">{u.full_name}</p>
                        <p className="text-ink-muted text-xs truncate">{u.email}</p>
                      </div>
                      <span className="text-xs text-ink-muted shrink-0">
                        {ROLE_LABEL[u.role] ?? u.role}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                      <span className="text-[11px] text-ink-muted">
                        {scope.length === 0
                          ? "Todas las divisiones"
                          : scope
                              .map((id) => divisions.find((d) => d.id === id)?.name ?? "?")
                              .join(" · ")}
                      </span>
                      <button
                        onClick={() => setEditingScopeFor(editing ? null : u.id)}
                        className="pressable text-[11px] text-brand hover:text-brand transition-colors duration-150"
                      >
                        {editing ? "Cerrar" : "Cambiar"}
                      </button>
                    </div>

                    {editing && (
                      <div className="mt-2 pt-2 border-t border-line">
                        <p className="text-[11px] text-ink-muted mb-2">
                          Sin ninguna marcada, el usuario ve todas las divisiones.
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {divisions.filter((d) => d.is_active).map((d) => {
                            const on = scope.includes(d.id);
                            return (
                              <button
                                key={d.id}
                                onClick={() => toggleUserDivision(u.id, d.id)}
                                className={`pressable px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors duration-150 ${
                                  on ? "bg-brand text-white" : "bg-surface-strong text-ink-soft"
                                }`}
                              >
                                {d.name}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {showUserModal && (
            <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 animate-overlay">
              <div className="bg-surface rounded-2xl w-full max-w-md p-6 animate-modal">
                <h2 className="text-ink font-bold text-lg mb-4">Nuevo usuario</h2>
                <form onSubmit={handleCreateUser} className="space-y-3">
                  <input required placeholder="Nombre completo"
                    value={userForm.full_name}
                    onChange={(e) => setUserForm((f) => ({ ...f, full_name: e.target.value }))}
                    className="w-full bg-surface-strong text-ink text-sm rounded-lg px-3 py-2.5 placeholder-ink-faint outline-none focus:ring-1 focus:ring-brand-ring"
                  />
                  <input required type="email" placeholder="Email"
                    value={userForm.email}
                    onChange={(e) => setUserForm((f) => ({ ...f, email: e.target.value }))}
                    className="w-full bg-surface-strong text-ink text-sm rounded-lg px-3 py-2.5 placeholder-ink-faint outline-none focus:ring-1 focus:ring-brand-ring"
                  />
                  <input required type="password" placeholder="Contraseña"
                    value={userForm.password}
                    onChange={(e) => setUserForm((f) => ({ ...f, password: e.target.value }))}
                    className="w-full bg-surface-strong text-ink text-sm rounded-lg px-3 py-2.5 placeholder-ink-faint outline-none focus:ring-1 focus:ring-brand-ring"
                  />
                  <select value={userForm.role}
                    onChange={(e) => setUserForm((f) => ({ ...f, role: e.target.value as typeof userForm.role }))}
                    className="w-full bg-surface-strong text-ink text-sm rounded-lg px-3 py-2.5 outline-none focus:ring-1 focus:ring-brand-ring"
                  >
                    <option value="match_director">Director de partido</option>
                    <option value="analyst">Analista</option>
                  </select>
                  {userError && <p className="text-red-600 text-xs">{userError}</p>}
                  <div className="flex gap-3 pt-2">
                    <button type="submit" disabled={userSubmitting}
                      className="pressable flex-1 bg-brand hover:bg-brand-hover disabled:opacity-50 text-white text-sm font-medium py-2.5 rounded-lg transition-colors duration-150">
                      {userSubmitting ? "Guardando..." : "Crear usuario"}
                    </button>
                    <button type="button"
                      onClick={() => { setShowUserModal(false); setUserError(null); }}
                      className="pressable flex-1 bg-surface-strong hover:bg-surface-hover text-ink-soft text-sm font-medium py-2.5 rounded-lg transition-colors duration-150">
                      Cancelar
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </>
      )}

      {/* Hidden photo upload input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={handlePhotoFileChange}
      />

      {cropSrc && (
        <CropModal
          imageSrc={cropSrc}
          onConfirm={handleCropConfirm}
          onCancel={handleCropCancel}
        />
      )}

      {unifyKeepPlayer && (
        <UnifyPlayersModal
          isOpen={true}
          keepPlayer={unifyKeepPlayer}
          allPlayers={filteredPlayers}
          divisionId={unifyKeepPlayer.division_id}
          onDone={(absorbedId) => {
            setAllPlayers((prev) => prev.filter((p) => p.id !== absorbedId));
            setUnifyKeepPlayer(null);
          }}
          onClose={() => setUnifyKeepPlayer(null)}
        />
      )}
    </div>
  );
}
