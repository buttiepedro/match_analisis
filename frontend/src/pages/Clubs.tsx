import { useEffect, useState } from "react";
import api from "../lib/axios";

interface Club {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
}

interface ClubUser {
  id: string;
  email: string;
  full_name: string;
  role: string;
  is_active: boolean;
}

const EMPTY_CLUB_FORM = {
  name: "",
  admin_full_name: "",
  admin_email: "",
  admin_password: "",
};

const EMPTY_USER_FORM = {
  full_name: "",
  email: "",
  password: "",
  role: "match_director" as "match_director" | "analyst",
};

export default function Clubs() {
  const [clubs, setClubs] = useState<Club[]>([]);
  const [loading, setLoading] = useState(true);

  const [showClubModal, setShowClubModal] = useState(false);
  const [clubForm, setClubForm] = useState(EMPTY_CLUB_FORM);
  const [clubError, setClubError] = useState<string | null>(null);
  const [clubSubmitting, setClubSubmitting] = useState(false);

  const [expandedClub, setExpandedClub] = useState<string | null>(null);
  const [usersMap, setUsersMap] = useState<Record<string, ClubUser[]>>({});
  const [usersLoading, setUsersLoading] = useState<string | null>(null);

  const [addingUserFor, setAddingUserFor] = useState<string | null>(null);
  const [userForm, setUserForm] = useState(EMPTY_USER_FORM);
  const [userError, setUserError] = useState<string | null>(null);
  const [userSubmitting, setUserSubmitting] = useState(false);

  const fetchClubs = async () => {
    try {
      const { data } = await api.get<Club[]>("/clubs");
      setClubs(data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchClubs(); }, []);

  const toggleClub = async (clubId: string) => {
    if (expandedClub === clubId) {
      setExpandedClub(null);
      setAddingUserFor(null);
      return;
    }
    setExpandedClub(clubId);
    setAddingUserFor(null);
    if (!usersMap[clubId]) {
      setUsersLoading(clubId);
      try {
        const { data } = await api.get<ClubUser[]>(`/clubs/${clubId}/users`);
        setUsersMap((prev) => ({ ...prev, [clubId]: data }));
      } finally {
        setUsersLoading(null);
      }
    }
  };

  const handleCreateClub = async (e: React.FormEvent) => {
    e.preventDefault();
    setClubSubmitting(true);
    setClubError(null);
    try {
      await api.post("/clubs", clubForm);
      setShowClubModal(false);
      setClubForm(EMPTY_CLUB_FORM);
      await fetchClubs();
    } catch (err: any) {
      const detail = err.response?.data?.detail;
      if (Array.isArray(detail)) {
        setClubError(detail.map((d: any) => `${d.loc?.at(-1)}: ${d.msg}`).join(" · "));
      } else {
        setClubError(detail ?? "Error al crear el club");
      }
    } finally {
      setClubSubmitting(false);
    }
  };

  const handleCreateUser = async (e: React.FormEvent, clubId: string) => {
    e.preventDefault();
    setUserSubmitting(true);
    setUserError(null);
    try {
      const { data } = await api.post<ClubUser>(`/clubs/${clubId}/users`, userForm);
      setUsersMap((prev) => ({
        ...prev,
        [clubId]: [...(prev[clubId] ?? []), data],
      }));
      setAddingUserFor(null);
      setUserForm(EMPTY_USER_FORM);
    } catch (err: any) {
      const detail = err.response?.data?.detail;
      if (Array.isArray(detail)) {
        setUserError(detail.map((d: any) => `${d.loc?.at(-1)}: ${d.msg}`).join(" · "));
      } else {
        setUserError(detail ?? "Error al crear el usuario");
      }
    } finally {
      setUserSubmitting(false);
    }
  };

  const ROLE_LABEL: Record<string, string> = {
    superadmin: "Superadmin",
    club_admin: "Admin de club",
    match_director: "Director de partido",
    analyst: "Analista",
  };

  return (
    <div className="p-6 max-w-2xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-white">Clubes</h1>
        <button
          onClick={() => { setShowClubModal(true); setClubError(null); }}
          className="text-sm bg-green-700 hover:bg-green-600 text-white px-4 py-2 rounded-lg transition-colors"
        >
          + Nuevo club
        </button>
      </div>

      {loading ? (
        <p className="text-gray-400 text-sm">Cargando...</p>
      ) : clubs.length === 0 ? (
        <p className="text-gray-500 text-sm">No hay clubes todavía.</p>
      ) : (
        <div className="space-y-3">
          {clubs.map((club) => (
            <div key={club.id} className="bg-gray-800 rounded-xl overflow-hidden">
              <button
                onClick={() => toggleClub(club.id)}
                className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-750 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span className="text-white font-medium">{club.name}</span>
                  <span className="text-xs text-gray-500">{club.slug}</span>
                  {!club.is_active && (
                    <span className="text-xs bg-red-900 text-red-300 px-2 py-0.5 rounded-full">
                      inactivo
                    </span>
                  )}
                </div>
                <span className="text-gray-400 text-sm">
                  {expandedClub === club.id ? "▲" : "▼"}
                </span>
              </button>

              {expandedClub === club.id && (
                <div className="border-t border-gray-700 px-4 py-3">
                  <p className="text-xs text-gray-400 uppercase tracking-wide mb-3">Usuarios</p>

                  {usersLoading === club.id ? (
                    <p className="text-gray-500 text-sm mb-3">Cargando...</p>
                  ) : (usersMap[club.id] ?? []).length === 0 ? (
                    <p className="text-gray-500 text-sm mb-3">Sin usuarios.</p>
                  ) : (
                    <ul className="space-y-2 mb-3">
                      {(usersMap[club.id] ?? []).map((u) => (
                        <li key={u.id} className="flex items-center justify-between">
                          <div>
                            <span className="text-sm text-white">{u.full_name}</span>
                            <span className="text-xs text-gray-400 ml-2">{u.email}</span>
                          </div>
                          <span className="text-xs text-gray-400">
                            {ROLE_LABEL[u.role] ?? u.role}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}

                  {addingUserFor === club.id ? (
                    <form onSubmit={(e) => handleCreateUser(e, club.id)} className="space-y-2 mt-2">
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          required
                          placeholder="Nombre completo"
                          value={userForm.full_name}
                          onChange={(e) => setUserForm((f) => ({ ...f, full_name: e.target.value }))}
                          className="col-span-2 bg-gray-700 text-white text-sm rounded-lg px-3 py-2 placeholder-gray-400 outline-none focus:ring-1 focus:ring-green-600"
                        />
                        <input
                          required
                          type="email"
                          placeholder="Email"
                          value={userForm.email}
                          onChange={(e) => setUserForm((f) => ({ ...f, email: e.target.value }))}
                          className="bg-gray-700 text-white text-sm rounded-lg px-3 py-2 placeholder-gray-400 outline-none focus:ring-1 focus:ring-green-600"
                        />
                        <input
                          required
                          type="password"
                          placeholder="Contraseña"
                          value={userForm.password}
                          onChange={(e) => setUserForm((f) => ({ ...f, password: e.target.value }))}
                          className="bg-gray-700 text-white text-sm rounded-lg px-3 py-2 placeholder-gray-400 outline-none focus:ring-1 focus:ring-green-600"
                        />
                        <select
                          value={userForm.role}
                          onChange={(e) =>
                            setUserForm((f) => ({
                              ...f,
                              role: e.target.value as "match_director" | "analyst",
                            }))
                          }
                          className="col-span-2 bg-gray-700 text-white text-sm rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-green-600"
                        >
                          <option value="match_director">Director de partido</option>
                          <option value="analyst">Analista</option>
                        </select>
                      </div>
                      {userError && (
                        <p className="text-red-400 text-xs">{userError}</p>
                      )}
                      <div className="flex gap-2">
                        <button
                          type="submit"
                          disabled={userSubmitting}
                          className="text-sm bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white px-4 py-1.5 rounded-lg transition-colors"
                        >
                          {userSubmitting ? "Guardando..." : "Guardar"}
                        </button>
                        <button
                          type="button"
                          onClick={() => { setAddingUserFor(null); setUserError(null); setUserForm(EMPTY_USER_FORM); }}
                          className="text-sm text-gray-400 hover:text-white px-4 py-1.5 rounded-lg transition-colors"
                        >
                          Cancelar
                        </button>
                      </div>
                    </form>
                  ) : (
                    <button
                      onClick={() => { setAddingUserFor(club.id); setUserError(null); setUserForm(EMPTY_USER_FORM); }}
                      className="text-sm text-green-400 hover:text-green-300 transition-colors"
                    >
                      + Agregar usuario
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Create club modal */}
      {showClubModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-gray-800 rounded-2xl w-full max-w-md p-6">
            <h2 className="text-white font-bold text-lg mb-4">Nuevo club</h2>
            <form onSubmit={handleCreateClub} className="space-y-3">
              <input
                required
                placeholder="Nombre del club"
                value={clubForm.name}
                onChange={(e) => setClubForm((f) => ({ ...f, name: e.target.value }))}
                className="w-full bg-gray-700 text-white text-sm rounded-lg px-3 py-2.5 placeholder-gray-400 outline-none focus:ring-1 focus:ring-green-600"
              />
              <p className="text-xs text-gray-400 pt-1">Admin del club</p>
              <input
                required
                placeholder="Nombre completo"
                value={clubForm.admin_full_name}
                onChange={(e) => setClubForm((f) => ({ ...f, admin_full_name: e.target.value }))}
                className="w-full bg-gray-700 text-white text-sm rounded-lg px-3 py-2.5 placeholder-gray-400 outline-none focus:ring-1 focus:ring-green-600"
              />
              <input
                required
                type="email"
                placeholder="Email"
                value={clubForm.admin_email}
                onChange={(e) => setClubForm((f) => ({ ...f, admin_email: e.target.value }))}
                className="w-full bg-gray-700 text-white text-sm rounded-lg px-3 py-2.5 placeholder-gray-400 outline-none focus:ring-1 focus:ring-green-600"
              />
              <input
                required
                type="password"
                placeholder="Contraseña"
                value={clubForm.admin_password}
                onChange={(e) => setClubForm((f) => ({ ...f, admin_password: e.target.value }))}
                className="w-full bg-gray-700 text-white text-sm rounded-lg px-3 py-2.5 placeholder-gray-400 outline-none focus:ring-1 focus:ring-green-600"
              />
              {clubError && <p className="text-red-400 text-xs">{clubError}</p>}
              <div className="flex gap-3 pt-2">
                <button
                  type="submit"
                  disabled={clubSubmitting}
                  className="flex-1 bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white text-sm font-medium py-2.5 rounded-lg transition-colors"
                >
                  {clubSubmitting ? "Creando..." : "Crear club"}
                </button>
                <button
                  type="button"
                  onClick={() => { setShowClubModal(false); setClubError(null); setClubForm(EMPTY_CLUB_FORM); }}
                  className="flex-1 bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm font-medium py-2.5 rounded-lg transition-colors"
                >
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
