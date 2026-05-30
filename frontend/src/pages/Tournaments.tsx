import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../lib/axios";
import { parseApiError } from "../lib/errors";
import { useAuthStore } from "../store/authStore";

interface Division {
  id: string;
  name: string;
}

interface Session {
  id: string;
  home_team: string;
  away_team: string;
  scheduled_at: string | null;
  status: string;
}

interface Tournament {
  id: string;
  name: string;
  season: string | null;
  division: Division;
  is_active: boolean;
}

const STATUS_LABEL: Record<string, string> = {
  scheduled: "Programado",
  active: "En curso",
  halftime: "Entretiempo",
  finished: "Finalizado",
};

const EMPTY_TOURNAMENT_FORM = { name: "", division_id: "", season: "" };
const EMPTY_SESSION_FORM = { home_team: "", away_team: "", scheduled_at: "", half_duration_minutes: "40" };

export default function Tournaments() {
  const clubId = useAuthStore((s) => s.user?.club_id);
  const navigate = useNavigate();

  const [divisions, setDivisions] = useState<Division[]>([]);
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [loading, setLoading] = useState(true);

  const [showModal, setShowModal] = useState(false);
  const [tForm, setTForm] = useState(EMPTY_TOURNAMENT_FORM);
  const [tSubmitting, setTSubmitting] = useState(false);
  const [tError, setTError] = useState<string | null>(null);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [sessionsMap, setSessionsMap] = useState<Record<string, Session[]>>({});
  const [sessionsLoading, setSessionsLoading] = useState<string | null>(null);

  const [addingSessionFor, setAddingSessionFor] = useState<string | null>(null);
  const [sForm, setSForm] = useState(EMPTY_SESSION_FORM);
  const [sSubmitting, setSSubmitting] = useState(false);
  const [sError, setSError] = useState<string | null>(null);

  useEffect(() => {
    if (!clubId) return;
    Promise.all([
      api.get<Division[]>(`/clubs/${clubId}/divisions`),
      api.get<Tournament[]>(`/clubs/${clubId}/tournaments`),
    ]).then(([dRes, tRes]) => {
      setDivisions(dRes.data);
      setTournaments(tRes.data);
      if (EMPTY_TOURNAMENT_FORM.division_id === "" && dRes.data.length > 0) {
        setTForm((f) => ({ ...f, division_id: dRes.data[0].id }));
      }
    }).finally(() => setLoading(false));
  }, [clubId]);

  const toggleTournament = async (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
      setAddingSessionFor(null);
      return;
    }
    setExpandedId(id);
    setAddingSessionFor(null);
    if (!sessionsMap[id]) {
      setSessionsLoading(id);
      try {
        const { data } = await api.get<Session[]>(`/tournaments/${id}/sessions`);
        setSessionsMap((prev) => ({ ...prev, [id]: data }));
      } finally {
        setSessionsLoading(null);
      }
    }
  };

  const handleCreateTournament = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clubId) return;
    setTSubmitting(true);
    setTError(null);
    try {
      const { data } = await api.post<Tournament>(`/clubs/${clubId}/tournaments`, {
        name: tForm.name,
        division_id: tForm.division_id,
        season: tForm.season || null,
      });
      setTournaments((prev) => [data, ...prev]);
      setShowModal(false);
      setTForm(EMPTY_TOURNAMENT_FORM);
    } catch (err) {
      setTError(parseApiError(err, "Error al crear el torneo"));
    } finally {
      setTSubmitting(false);
    }
  };

  const handleCreateSession = async (e: React.FormEvent, tournamentId: string) => {
    e.preventDefault();
    setSSubmitting(true);
    setSError(null);
    try {
      const { data } = await api.post<Session>(`/tournaments/${tournamentId}/sessions`, {
        home_team: sForm.home_team,
        away_team: sForm.away_team,
        scheduled_at: sForm.scheduled_at || null,
        half_duration_minutes: parseInt(sForm.half_duration_minutes, 10),
      });
      setSessionsMap((prev) => ({
        ...prev,
        [tournamentId]: [data, ...(prev[tournamentId] ?? [])],
      }));
      setAddingSessionFor(null);
      setSForm(EMPTY_SESSION_FORM);
    } catch (err) {
      setSError(parseApiError(err, "Error al crear el partido"));
    } finally {
      setSSubmitting(false);
    }
  };

  return (
    <div className="p-6 max-w-2xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-white">Torneos</h1>
        <button
          onClick={() => {
            setShowModal(true);
            setTError(null);
            setTForm((f) => ({ ...f, division_id: divisions[0]?.id ?? "" }));
          }}
          className="text-sm bg-green-700 hover:bg-green-600 text-white px-4 py-2 rounded-lg transition-colors"
        >
          + Nuevo torneo
        </button>
      </div>

      {loading ? (
        <p className="text-gray-400 text-sm">Cargando...</p>
      ) : tournaments.length === 0 ? (
        <p className="text-gray-500 text-sm">No hay torneos todavía.</p>
      ) : (
        <div className="space-y-3">
          {tournaments.map((t) => (
            <div key={t.id} className="bg-gray-800 rounded-xl overflow-hidden">
              <button
                onClick={() => toggleTournament(t.id)}
                className="w-full flex items-center justify-between px-4 py-3 text-left"
              >
                <div>
                  <span className="text-white font-medium">{t.name}</span>
                  <span className="text-xs text-gray-400 ml-2">{t.division.name}</span>
                  {t.season && <span className="text-xs text-gray-500 ml-2">{t.season}</span>}
                </div>
                <span className="text-gray-400 text-sm">{expandedId === t.id ? "▲" : "▼"}</span>
              </button>

              {expandedId === t.id && (
                <div className="border-t border-gray-700 px-4 py-3">
                  <p className="text-xs text-gray-400 uppercase tracking-wide mb-3">Partidos</p>

                  {sessionsLoading === t.id ? (
                    <p className="text-gray-500 text-sm mb-3">Cargando...</p>
                  ) : (sessionsMap[t.id] ?? []).length === 0 ? (
                    <p className="text-gray-500 text-sm mb-3">Sin partidos.</p>
                  ) : (
                    <ul className="space-y-2 mb-3">
                      {(sessionsMap[t.id] ?? []).map((s) => (
                        <li key={s.id}>
                          <button
                            onClick={() => navigate(`/sessions/${s.id}`)}
                            className="w-full flex items-center justify-between bg-gray-700 hover:bg-gray-600 rounded-lg px-3 py-2 transition-colors"
                          >
                            <span className="text-sm text-white">
                              {s.home_team} vs {s.away_team}
                            </span>
                            <span className="text-xs text-gray-400">
                              {STATUS_LABEL[s.status] ?? s.status}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}

                  {addingSessionFor === t.id ? (
                    <form onSubmit={(e) => handleCreateSession(e, t.id)} className="space-y-2 mt-2">
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          required
                          placeholder="Equipo local"
                          value={sForm.home_team}
                          onChange={(e) => setSForm((f) => ({ ...f, home_team: e.target.value }))}
                          className="bg-gray-700 text-white text-sm rounded-lg px-3 py-2 placeholder-gray-400 outline-none focus:ring-1 focus:ring-green-600"
                        />
                        <input
                          required
                          placeholder="Equipo visitante"
                          value={sForm.away_team}
                          onChange={(e) => setSForm((f) => ({ ...f, away_team: e.target.value }))}
                          className="bg-gray-700 text-white text-sm rounded-lg px-3 py-2 placeholder-gray-400 outline-none focus:ring-1 focus:ring-green-600"
                        />
                        <input
                          type="datetime-local"
                          value={sForm.scheduled_at}
                          onChange={(e) => setSForm((f) => ({ ...f, scheduled_at: e.target.value }))}
                          className="bg-gray-700 text-white text-sm rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-green-600"
                        />
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            min="1"
                            value={sForm.half_duration_minutes}
                            onChange={(e) => setSForm((f) => ({ ...f, half_duration_minutes: e.target.value }))}
                            className="w-20 bg-gray-700 text-white text-sm rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-green-600"
                          />
                          <span className="text-xs text-gray-400">min por tiempo</span>
                        </div>
                      </div>
                      {sError && <p className="text-red-400 text-xs">{sError}</p>}
                      <div className="flex gap-2">
                        <button
                          type="submit"
                          disabled={sSubmitting}
                          className="text-sm bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white px-4 py-1.5 rounded-lg transition-colors"
                        >
                          {sSubmitting ? "Guardando..." : "Crear partido"}
                        </button>
                        <button
                          type="button"
                          onClick={() => { setAddingSessionFor(null); setSError(null); setSForm(EMPTY_SESSION_FORM); }}
                          className="text-sm text-gray-400 hover:text-white px-4 py-1.5 rounded-lg transition-colors"
                        >
                          Cancelar
                        </button>
                      </div>
                    </form>
                  ) : (
                    <button
                      onClick={() => { setAddingSessionFor(t.id); setSError(null); setSForm(EMPTY_SESSION_FORM); }}
                      className="text-sm text-green-400 hover:text-green-300 transition-colors"
                    >
                      + Nuevo partido
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Create tournament modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-gray-800 rounded-2xl w-full max-w-md p-6">
            <h2 className="text-white font-bold text-lg mb-4">Nuevo torneo</h2>
            {divisions.length === 0 ? (
              <p className="text-yellow-400 text-sm mb-4">
                Necesitás crear al menos una división antes de crear un torneo.
              </p>
            ) : (
              <form onSubmit={handleCreateTournament} className="space-y-3">
                <input
                  required
                  placeholder="Nombre del torneo"
                  value={tForm.name}
                  onChange={(e) => setTForm((f) => ({ ...f, name: e.target.value }))}
                  className="w-full bg-gray-700 text-white text-sm rounded-lg px-3 py-2.5 placeholder-gray-400 outline-none focus:ring-1 focus:ring-green-600"
                />
                <select
                  required
                  value={tForm.division_id}
                  onChange={(e) => setTForm((f) => ({ ...f, division_id: e.target.value }))}
                  className="w-full bg-gray-700 text-white text-sm rounded-lg px-3 py-2.5 outline-none focus:ring-1 focus:ring-green-600"
                >
                  <option value="">— Seleccionar división —</option>
                  {divisions.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
                <input
                  placeholder="Temporada (opcional, ej: 2025)"
                  value={tForm.season}
                  onChange={(e) => setTForm((f) => ({ ...f, season: e.target.value }))}
                  className="w-full bg-gray-700 text-white text-sm rounded-lg px-3 py-2.5 placeholder-gray-400 outline-none focus:ring-1 focus:ring-green-600"
                />
                {tError && <p className="text-red-400 text-xs">{tError}</p>}
                <div className="flex gap-3 pt-2">
                  <button
                    type="submit"
                    disabled={tSubmitting}
                    className="flex-1 bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white text-sm font-medium py-2.5 rounded-lg transition-colors"
                  >
                    {tSubmitting ? "Creando..." : "Crear torneo"}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowModal(false); setTError(null); }}
                    className="flex-1 bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm font-medium py-2.5 rounded-lg transition-colors"
                  >
                    Cancelar
                  </button>
                </div>
              </form>
            )}
            {divisions.length === 0 && (
              <button
                onClick={() => setShowModal(false)}
                className="w-full mt-2 bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm font-medium py-2.5 rounded-lg transition-colors"
              >
                Cerrar
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
