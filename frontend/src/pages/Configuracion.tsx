import { useEffect, useState } from "react";
import api from "../lib/axios";
import { parseApiError } from "../lib/errors";
import { useAuthStore } from "../store/authStore";

type ConfigTab = "divisions" | "players" | "users";

interface Division { id: string; name: string; is_active: boolean }
interface PlayerWithDivision {
  id: string;
  division_id: string;
  division_name: string;
  name: string;
  position: string | null;
  is_active: boolean;
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

  useEffect(() => {
    if (!clubId) return;
    api.get<Division[]>(`/clubs/${clubId}/divisions`)
      .then(({ data }) => setDivisions(data))
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

  // ── Players ────────────────────────────────────────────────────────────────
  const [allPlayers,         setAllPlayers]         = useState<PlayerWithDivision[]>([]);
  const [playersLoaded,      setPlayersLoaded]      = useState(false);
  const [loadingPlayers,     setLoadingPlayers]     = useState(false);
  const [playerDivFilter,    setPlayerDivFilter]    = useState("");
  const [addingPlayer,       setAddingPlayer]       = useState(false);
  const [playerForm,         setPlayerForm]         = useState({ name: "", position: "", divisionId: "" });
  const [playerSubmitting,   setPlayerSubmitting]   = useState(false);
  const [playerError,        setPlayerError]        = useState<string | null>(null);

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
      const { data: raw } = await api.post<{ id: string; division_id: string; name: string; position: string | null; is_active: boolean }>(
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

  // ── Users ──────────────────────────────────────────────────────────────────
  const [users,          setUsers]          = useState<ClubUser[]>([]);
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
      .then(({ data }) => { setUsers(data); setUsersLoaded(true); })
      .finally(() => setLoadingUsers(false));
  }, [activeTab, clubId, usersLoaded]);

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
      <h1 className="text-xl font-bold text-white mb-5">Configuración</h1>

      {/* Tab selector */}
      <div className="flex gap-1 bg-gray-800 rounded-xl p-1 mb-6">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors ${
              activeTab === t.id ? "bg-green-700 text-white" : "text-gray-400 hover:text-white"
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
            <p className="text-sm text-gray-400">{divisions.length} división{divisions.length !== 1 ? "es" : ""}</p>
            {!addingDiv && (
              <button
                onClick={() => { setAddingDiv(true); setDivError(null); }}
                className="text-sm bg-green-700 hover:bg-green-600 text-white px-4 py-2 rounded-lg transition-colors"
              >
                + Nueva división
              </button>
            )}
          </div>

          {addingDiv && (
            <form onSubmit={handleCreateDivision} className="bg-gray-800 rounded-xl p-4 mb-4 space-y-3">
              <input
                required autoFocus
                placeholder="Nombre de la división"
                value={divName}
                onChange={(e) => setDivName(e.target.value)}
                className="w-full bg-gray-700 text-white text-sm rounded-lg px-3 py-2.5 placeholder-gray-400 outline-none focus:ring-1 focus:ring-green-600"
              />
              {divError && <p className="text-red-400 text-xs">{divError}</p>}
              <div className="flex gap-2">
                <button type="submit" disabled={divSubmitting}
                  className="text-sm bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white px-4 py-2 rounded-lg transition-colors">
                  {divSubmitting ? "Guardando..." : "Guardar"}
                </button>
                <button type="button"
                  onClick={() => { setAddingDiv(false); setDivError(null); setDivName(""); }}
                  className="text-sm text-gray-400 hover:text-white px-4 py-2 rounded-lg transition-colors">
                  Cancelar
                </button>
              </div>
            </form>
          )}

          {loadingDivs ? (
            <p className="text-gray-400 text-sm">Cargando...</p>
          ) : divisions.length === 0 ? (
            <p className="text-gray-500 text-sm">No hay divisiones todavía.</p>
          ) : (
            <ul className="space-y-2">
              {divisions.map((d) => (
                <li key={d.id} className="bg-gray-800 rounded-xl px-4 py-3">
                  <span className="text-white text-sm font-medium">{d.name}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {/* ── Jugadores ──────────────────────────────────────────────────── */}
      {activeTab === "players" && (
        <>
          {loadingDivs && !playersLoaded ? (
            <p className="text-gray-400 text-sm">Cargando...</p>
          ) : divisions.length === 0 ? (
            <p className="text-gray-500 text-sm">Primero creá una división en la pestaña Divisiones.</p>
          ) : (
            <>
              {/* Division filter pills */}
              {divisions.length > 1 && (
                <div className="flex gap-2 flex-wrap mb-4">
                  <button
                    onClick={() => setPlayerDivFilter("")}
                    className={`text-sm px-4 py-1.5 rounded-full transition-colors ${
                      playerDivFilter === "" ? "bg-green-700 text-white" : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                    }`}
                  >
                    Todas
                  </button>
                  {divisions.map((d) => (
                    <button
                      key={d.id}
                      onClick={() => setPlayerDivFilter(d.id)}
                      className={`text-sm px-4 py-1.5 rounded-full transition-colors ${
                        playerDivFilter === d.id ? "bg-green-700 text-white" : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                      }`}
                    >
                      {d.name}
                    </button>
                  ))}
                </div>
              )}

              <div className="flex items-center justify-between mb-3">
                <p className="text-sm text-gray-400">
                  {filteredPlayers.length} jugador{filteredPlayers.length !== 1 ? "es" : ""}
                </p>
                {!addingPlayer && (
                  <button
                    onClick={openAddPlayer}
                    className="text-sm bg-green-700 hover:bg-green-600 text-white px-3 py-1.5 rounded-lg transition-colors"
                  >
                    + Agregar jugador
                  </button>
                )}
              </div>

              {addingPlayer && (
                <form onSubmit={handleCreatePlayer} className="bg-gray-800 rounded-xl p-4 mb-4 space-y-3">
                  <input
                    required autoFocus
                    placeholder="Nombre del jugador"
                    value={playerForm.name}
                    onChange={(e) => setPlayerForm((f) => ({ ...f, name: e.target.value }))}
                    className="w-full bg-gray-700 text-white text-sm rounded-lg px-3 py-2.5 placeholder-gray-400 outline-none focus:ring-1 focus:ring-green-600"
                  />
                  <input
                    placeholder="Posición (opcional)"
                    value={playerForm.position}
                    onChange={(e) => setPlayerForm((f) => ({ ...f, position: e.target.value }))}
                    className="w-full bg-gray-700 text-white text-sm rounded-lg px-3 py-2.5 placeholder-gray-400 outline-none focus:ring-1 focus:ring-green-600"
                  />
                  <select
                    required
                    value={playerForm.divisionId}
                    onChange={(e) => setPlayerForm((f) => ({ ...f, divisionId: e.target.value }))}
                    className="w-full bg-gray-700 text-white text-sm rounded-lg px-3 py-2.5 outline-none focus:ring-1 focus:ring-green-600"
                  >
                    <option value="">— División —</option>
                    {divisions.map((d) => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>
                  {playerError && <p className="text-red-400 text-xs">{playerError}</p>}
                  <div className="flex gap-2">
                    <button type="submit" disabled={playerSubmitting}
                      className="text-sm bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white px-4 py-2 rounded-lg transition-colors">
                      {playerSubmitting ? "Guardando..." : "Guardar"}
                    </button>
                    <button type="button"
                      onClick={() => { setAddingPlayer(false); setPlayerError(null); }}
                      className="text-sm text-gray-400 hover:text-white px-4 py-2 rounded-lg transition-colors">
                      Cancelar
                    </button>
                  </div>
                </form>
              )}

              {loadingPlayers ? (
                <p className="text-gray-400 text-sm">Cargando jugadores...</p>
              ) : filteredPlayers.length === 0 ? (
                <p className="text-gray-500 text-sm">
                  {playerDivFilter ? "No hay jugadores en esta división." : "No hay jugadores todavía."}
                </p>
              ) : (
                <ul className="space-y-2">
                  {filteredPlayers.map((p) => (
                    <li key={p.id} className="bg-gray-800 rounded-xl px-4 py-3 flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <span className="text-white text-sm font-medium">{p.name}</span>
                        {p.position && <span className="text-gray-400 text-xs ml-2">{p.position}</span>}
                      </div>
                      {divisions.length > 1 && (
                        <span className="text-xs text-gray-500 bg-gray-700 px-2 py-0.5 rounded-full shrink-0">
                          {p.division_name}
                        </span>
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
            <p className="text-sm text-gray-400">{users.length} usuario{users.length !== 1 ? "s" : ""}</p>
            <button
              onClick={() => { setShowUserModal(true); setUserError(null); }}
              className="text-sm bg-green-700 hover:bg-green-600 text-white px-4 py-2 rounded-lg transition-colors"
            >
              + Nuevo usuario
            </button>
          </div>

          {loadingUsers ? (
            <p className="text-gray-400 text-sm">Cargando...</p>
          ) : users.length === 0 ? (
            <p className="text-gray-500 text-sm">No hay usuarios todavía.</p>
          ) : (
            <ul className="space-y-2">
              {users.map((u) => (
                <li key={u.id} className="bg-gray-800 rounded-xl px-4 py-3 flex items-center justify-between">
                  <div>
                    <p className="text-white text-sm font-medium">{u.full_name}</p>
                    <p className="text-gray-400 text-xs">{u.email}</p>
                  </div>
                  <span className="text-xs text-gray-400">{ROLE_LABEL[u.role] ?? u.role}</span>
                </li>
              ))}
            </ul>
          )}

          {showUserModal && (
            <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
              <div className="bg-gray-800 rounded-2xl w-full max-w-md p-6">
                <h2 className="text-white font-bold text-lg mb-4">Nuevo usuario</h2>
                <form onSubmit={handleCreateUser} className="space-y-3">
                  <input required placeholder="Nombre completo"
                    value={userForm.full_name}
                    onChange={(e) => setUserForm((f) => ({ ...f, full_name: e.target.value }))}
                    className="w-full bg-gray-700 text-white text-sm rounded-lg px-3 py-2.5 placeholder-gray-400 outline-none focus:ring-1 focus:ring-green-600"
                  />
                  <input required type="email" placeholder="Email"
                    value={userForm.email}
                    onChange={(e) => setUserForm((f) => ({ ...f, email: e.target.value }))}
                    className="w-full bg-gray-700 text-white text-sm rounded-lg px-3 py-2.5 placeholder-gray-400 outline-none focus:ring-1 focus:ring-green-600"
                  />
                  <input required type="password" placeholder="Contraseña"
                    value={userForm.password}
                    onChange={(e) => setUserForm((f) => ({ ...f, password: e.target.value }))}
                    className="w-full bg-gray-700 text-white text-sm rounded-lg px-3 py-2.5 placeholder-gray-400 outline-none focus:ring-1 focus:ring-green-600"
                  />
                  <select value={userForm.role}
                    onChange={(e) => setUserForm((f) => ({ ...f, role: e.target.value as typeof userForm.role }))}
                    className="w-full bg-gray-700 text-white text-sm rounded-lg px-3 py-2.5 outline-none focus:ring-1 focus:ring-green-600"
                  >
                    <option value="match_director">Director de partido</option>
                    <option value="analyst">Analista</option>
                  </select>
                  {userError && <p className="text-red-400 text-xs">{userError}</p>}
                  <div className="flex gap-3 pt-2">
                    <button type="submit" disabled={userSubmitting}
                      className="flex-1 bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white text-sm font-medium py-2.5 rounded-lg transition-colors">
                      {userSubmitting ? "Guardando..." : "Crear usuario"}
                    </button>
                    <button type="button"
                      onClick={() => { setShowUserModal(false); setUserError(null); }}
                      className="flex-1 bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm font-medium py-2.5 rounded-lg transition-colors">
                      Cancelar
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
