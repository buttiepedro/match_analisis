import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import * as XLSX from "xlsx";
import api from "../lib/axios";
import { parseApiError } from "../lib/errors";
import { useAuthStore } from "../store/authStore";

interface LineupEntryFull {
  id: string;
  jersey_number: number;
  position: string | null;
  team: string;
  status: string;
  player: { id: string; name: string; position: string | null };
}
interface EventData {
  id: string;
  event_type: string;
  team: string;
  reason?: string;
  metadata?: { obtained?: boolean; converted?: boolean; team?: string };
}

interface Division {
  id: string;
  name: string;
}

interface Session {
  id: string;
  tournament_id: string;
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
const EMPTY_SESSION_FORM = { away_team: "", scheduled_at: "", half_duration_minutes: "40" };
const EMPTY_EDIT_SESSION_FORM = { away_team: "", scheduled_at: "", tournament_id: "" };

export default function Tournaments() {
  const clubId = useAuthStore((s) => s.user?.club_id);
  const navigate = useNavigate();

  const [clubName, setClubName] = useState("");
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [loading, setLoading] = useState(true);

  const [showModal, setShowModal] = useState(false);
  const [tForm, setTForm] = useState(EMPTY_TOURNAMENT_FORM);
  const [tSubmitting, setTSubmitting] = useState(false);
  const [tError, setTError] = useState<string | null>(null);

  const [divisionFilter, setDivisionFilter] = useState("");

  const filterDivisions = Array.from(
    new Map(tournaments.map((t) => [t.division.id, t.division])).values()
  );
  const visibleTournaments = divisionFilter
    ? tournaments.filter((t) => t.division.id === divisionFilter)
    : tournaments;

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [sessionsMap, setSessionsMap] = useState<Record<string, Session[]>>({});
  const [sessionsLoading, setSessionsLoading] = useState<string | null>(null);

  const [addingSessionFor, setAddingSessionFor] = useState<string | null>(null);
  const [sForm, setSForm] = useState(EMPTY_SESSION_FORM);
  const [sSubmitting, setSSubmitting] = useState(false);
  const [sError, setSError] = useState<string | null>(null);

  const [confirmDeleteSession, setConfirmDeleteSession] = useState<string | null>(null);

  // Planilla export/import
  const [exportingSession,  setExportingSession]  = useState<string | null>(null);
  const [importingPlanilla, setImportingPlanilla] = useState(false);
  const planillaImportRef   = useRef<HTMLInputElement>(null);
  const importTournamentRef = useRef<string>("");
  const [deletingSession, setDeletingSession] = useState<string | null>(null);

  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editSessionForm, setEditSessionForm] = useState(EMPTY_EDIT_SESSION_FORM);
  const [editSessionSubmitting, setEditSessionSubmitting] = useState(false);
  const [editSessionError, setEditSessionError] = useState<string | null>(null);

  const handleDeleteSession = async (sessionId: string, tournamentId: string) => {
    setDeletingSession(sessionId);
    try {
      await api.delete(`/sessions/${sessionId}`);
      setSessionsMap((prev) => ({
        ...prev,
        [tournamentId]: (prev[tournamentId] ?? []).filter((s) => s.id !== sessionId),
      }));
      setConfirmDeleteSession(null);
    } catch (err) {
      alert(parseApiError(err, "Error al eliminar el partido"));
    } finally {
      setDeletingSession(null);
    }
  };

  const handleEditSession = async (sessionId: string, originalTournamentId: string) => {
    setEditSessionSubmitting(true);
    setEditSessionError(null);
    try {
      const payload: Record<string, unknown> = {};
      if (editSessionForm.away_team) payload.away_team = editSessionForm.away_team;
      if (editSessionForm.scheduled_at) payload.scheduled_at = editSessionForm.scheduled_at;
      if (editSessionForm.tournament_id && editSessionForm.tournament_id !== originalTournamentId) {
        payload.tournament_id = editSessionForm.tournament_id;
      }
      const { data: updated } = await api.patch<Session>(`/sessions/${sessionId}`, payload);
      const newTournamentId = (payload.tournament_id as string | undefined) ?? originalTournamentId;
      setSessionsMap((prev) => {
        const next = { ...prev };
        if (newTournamentId !== originalTournamentId) {
          next[originalTournamentId] = (next[originalTournamentId] ?? []).filter((s) => s.id !== sessionId);
          next[newTournamentId] = [updated, ...(next[newTournamentId] ?? [])];
        } else {
          next[originalTournamentId] = (next[originalTournamentId] ?? []).map((s) => s.id === sessionId ? updated : s);
        }
        return next;
      });
      setEditingSessionId(null);
      setEditSessionForm(EMPTY_EDIT_SESSION_FORM);
    } catch (err) {
      setEditSessionError(parseApiError(err, "Error al editar el partido"));
    } finally {
      setEditSessionSubmitting(false);
    }
  };

  useEffect(() => {
    if (!clubId) return;
    Promise.all([
      api.get<{ id: string; name: string }>(`/clubs/${clubId}`),
      api.get<Division[]>(`/clubs/${clubId}/divisions`),
      api.get<Tournament[]>(`/clubs/${clubId}/tournaments`),
    ]).then(([cRes, dRes, tRes]) => {
      setClubName(cRes.data.name);
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
        home_team: clubName,
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

  const exportPlanilla = async (sessionId: string) => {
    setExportingSession(sessionId);
    try {
      const [{ data: lineupData }, { data: eventsData }] = await Promise.all([
        api.get<LineupEntryFull[]>(`/sessions/${sessionId}/lineup`),
        api.get<EventData[]>(`/sessions/${sessionId}/events`),
      ]);
      const session = Object.values(sessionsMap).flat().find((s) => s.id === sessionId);

      const wb = XLSX.utils.book_new();

      const homeTeam = session?.home_team ?? "";
      const awayTeam = session?.away_team ?? "";

      const wsInfo = XLSX.utils.aoa_to_sheet([
        ["Campo", "Valor"],
        ["Local",  homeTeam],
        ["Rival",  awayTeam],
        ["Fecha",  session?.scheduled_at ? new Date(session.scheduled_at).toLocaleDateString("es-AR") : ""],
      ]);
      wsInfo["!cols"] = [{ wch: 15 }, { wch: 30 }];
      XLSX.utils.book_append_sheet(wb, wsInfo, "Partido");

      const wsPlantel = XLSX.utils.aoa_to_sheet([
        ["Camiseta", "Nombre", "Posicion", "Equipo", "Estado"],
        ...lineupData.map((e) => [
          e.jersey_number,
          e.player.name,
          e.position ?? e.player.position ?? "",
          e.team === "user" ? homeTeam : awayTeam,
          e.status === "on_field" ? "Titular" : "Suplente",
        ]),
      ]);
      wsPlantel["!cols"] = [{ wch: 10 }, { wch: 30 }, { wch: 15 }, { wch: 12 }, { wch: 12 }];
      XLSX.utils.book_append_sheet(wb, wsPlantel, "Plantel");

      const wsEventos = XLSX.utils.aoa_to_sheet([
        ["Tipo", "Equipo", "Razon", "Convertido"],
        ...eventsData.map((e) => [
          e.event_type,
          e.team === "user" ? homeTeam : awayTeam,
          e.reason ?? "",
          e.metadata?.converted !== undefined ? (e.metadata.converted ? "Si" : "No") : "",
        ]),
      ]);
      wsEventos["!cols"] = [{ wch: 25 }, { wch: 12 }, { wch: 20 }, { wch: 12 }];
      XLSX.utils.book_append_sheet(wb, wsEventos, "Eventos");

      const safe = (s: string) => s.replace(/[^a-z0-9áéíóúñ\s]/gi, "").trim();
      XLSX.writeFile(wb, `planilla-${safe(session?.home_team ?? "local")}-vs-${safe(session?.away_team ?? "visitante")}.xlsx`);
    } catch (err) {
      alert(parseApiError(err, "Error al exportar planilla"));
    } finally {
      setExportingSession(null);
    }
  };

  const handleImportPlanilla = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const tournamentId = importTournamentRef.current;
    if (!file || !tournamentId || !clubId) return;
    e.target.value = "";
    setImportingPlanilla(true);
    try {
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: "array" });

      // Parse Partido sheet
      const wsInfo = wb.Sheets["Partido"];
      const infoKV: Record<string, string> = {};
      if (wsInfo) {
        XLSX.utils.sheet_to_json<{ Campo: string; Valor: string }>(wsInfo)
          .forEach((r) => { if (r.Campo) infoKV[r.Campo] = String(r.Valor ?? ""); });
      }

      // Create session
      const { data: newSession } = await api.post<Session>(`/tournaments/${tournamentId}/sessions`, {
        home_team: clubName,
        away_team: (infoKV["Rival"] ?? infoKV["Visitante"] ?? "").trim() || "Rival",
        scheduled_at: null,
        half_duration_minutes: 40,
      });

      // Parse Plantel
      const wsPlantel = wb.Sheets["Plantel"];
      if (wsPlantel) {
        const { data: clubPlayers } = await api.get<Array<{ id: string; name: string }>>(`/clubs/${clubId}/players`);
        const plantelRows = XLSX.utils.sheet_to_json<{
          Camiseta?: number; Nombre?: string; Posicion?: string; Equipo?: string; Estado?: string;
        }>(wsPlantel);
        for (const row of plantelRows) {
          if (!row.Nombre) continue;
          const player = clubPlayers.find((p) => p.name.toLowerCase() === row.Nombre!.toLowerCase());
          if (!player) continue;
          try {
            await api.post(`/sessions/${newSession.id}/lineup`, {
              player_id: player.id,
              jersey_number: row.Camiseta ?? 0,
              position: row.Posicion || null,
              team:   row.Equipo === clubName ? "user" : "rival",
              status: row.Estado === "Titular" ? "on_field" : "bench",
            });
          } catch { /* skip unmatchable entries */ }
        }
      }

      // Parse Eventos
      const wsEventos = wb.Sheets["Eventos"];
      if (wsEventos) {
        const eventRows = XLSX.utils.sheet_to_json<{
          Tipo?: string; Equipo?: string; Razon?: string; Convertido?: string;
        }>(wsEventos);
        for (const row of eventRows) {
          if (!row.Tipo) continue;
          const payload: Record<string, unknown> = {
            event_type: row.Tipo,
            team: row.Equipo === clubName ? "user" : "rival",
          };
          if (row.Razon) payload.reason = row.Razon;
          if (row.Convertido === "Si" || row.Convertido === "No") {
            payload.metadata = { converted: row.Convertido === "Si" };
          }
          try { await api.post(`/sessions/${newSession.id}/events`, payload); } catch { /* skip */ }
        }
      }

      setSessionsMap((prev) => ({
        ...prev,
        [tournamentId]: [newSession, ...(prev[tournamentId] ?? [])],
      }));
      setExpandedId(tournamentId);
    } catch (err) {
      alert(parseApiError(err, "Error al importar planilla"));
    } finally {
      setImportingPlanilla(false);
    }
  };

  return (
    <div className="p-6 max-w-2xl">
      {/* Hidden file input for planilla import */}
      <input
        ref={planillaImportRef}
        type="file"
        accept=".xlsx,.xls"
        onChange={handleImportPlanilla}
        className="hidden"
      />

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

      {/* Division filter pills */}
      {!loading && filterDivisions.length > 1 && (
        <div className="flex gap-2 mb-5 flex-wrap">
          <button
            onClick={() => setDivisionFilter("")}
            className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
              divisionFilter === "" ? "bg-green-700 text-white" : "bg-gray-700 text-gray-300 hover:bg-gray-600"
            }`}
          >
            Todas
          </button>
          {filterDivisions.map((d) => (
            <button
              key={d.id}
              onClick={() => setDivisionFilter(d.id)}
              className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
                divisionFilter === d.id ? "bg-green-700 text-white" : "bg-gray-700 text-gray-300 hover:bg-gray-600"
              }`}
            >
              {d.name}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <p className="text-gray-400 text-sm">Cargando...</p>
      ) : visibleTournaments.length === 0 ? (
        <p className="text-gray-500 text-sm">
          {divisionFilter ? "No hay torneos en esta división." : "No hay torneos todavía."}
        </p>
      ) : (
        <div className="space-y-3">
          {visibleTournaments.map((t) => (
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
                        <li key={s.id} className="bg-gray-700 rounded-lg overflow-hidden">
                          <button
                            onClick={() => navigate(`/sessions/${s.id}`)}
                            className="w-full flex items-center justify-between px-3 py-2 hover:bg-gray-600 transition-colors"
                          >
                            <span className="text-sm text-white">
                              {s.home_team} vs {s.away_team}
                            </span>
                            <span className="text-xs text-gray-400">
                              {STATUS_LABEL[s.status] ?? s.status}
                            </span>
                          </button>
                          <div className="border-t border-gray-600 px-3 py-1.5 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <button
                                onClick={() => navigate(`/sessions/${s.id}/lineup`)}
                                className="text-xs text-green-400 hover:text-green-300 transition-colors"
                              >
                                Alineación →
                              </button>
                              <button
                                onClick={() => exportPlanilla(s.id)}
                                disabled={exportingSession === s.id}
                                className="text-xs text-blue-400 hover:text-blue-300 disabled:opacity-50 transition-colors"
                              >
                                {exportingSession === s.id ? "..." : "Planilla ↓"}
                              </button>
                            </div>
                            {confirmDeleteSession === s.id ? (
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-gray-400">¿Eliminar?</span>
                                <button
                                  onClick={() => handleDeleteSession(s.id, t.id)}
                                  disabled={deletingSession === s.id}
                                  className="text-xs bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white px-2 py-0.5 rounded transition-colors"
                                >
                                  {deletingSession === s.id ? "..." : "Sí"}
                                </button>
                                <button
                                  onClick={() => setConfirmDeleteSession(null)}
                                  className="text-xs text-gray-400 hover:text-white transition-colors"
                                >
                                  No
                                </button>
                              </div>
                            ) : (
                              <div className="flex items-center gap-3">
                                <button
                                  onClick={() => {
                                    setEditingSessionId(s.id);
                                    setEditSessionError(null);
                                    setEditSessionForm({
                                      away_team: s.away_team,
                                      scheduled_at: s.scheduled_at ? s.scheduled_at.slice(0, 16) : "",
                                      tournament_id: t.id,
                                    });
                                  }}
                                  className="text-xs text-gray-500 hover:text-white transition-colors"
                                >
                                  Editar
                                </button>
                                <button
                                  onClick={() => setConfirmDeleteSession(s.id)}
                                  className="text-xs text-gray-600 hover:text-red-400 transition-colors"
                                >
                                  Eliminar
                                </button>
                              </div>
                            )}
                          </div>
                          {editingSessionId === s.id && (
                            <div className="border-t border-gray-600 px-3 py-3 space-y-2">
                              <input
                                placeholder="Rival"
                                value={editSessionForm.away_team}
                                onChange={(e) => setEditSessionForm((f) => ({ ...f, away_team: e.target.value }))}
                                className="w-full bg-gray-600 text-white text-sm rounded-lg px-3 py-2 placeholder-gray-400 outline-none focus:ring-1 focus:ring-green-600"
                              />
                              <input
                                type="datetime-local"
                                value={editSessionForm.scheduled_at}
                                onChange={(e) => setEditSessionForm((f) => ({ ...f, scheduled_at: e.target.value }))}
                                className="w-full bg-gray-600 text-white text-sm rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-green-600"
                              />
                              <select
                                value={editSessionForm.tournament_id}
                                onChange={(e) => setEditSessionForm((f) => ({ ...f, tournament_id: e.target.value }))}
                                className="w-full bg-gray-600 text-white text-sm rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-green-600"
                              >
                                {tournaments.map((tor) => (
                                  <option key={tor.id} value={tor.id}>{tor.name}</option>
                                ))}
                              </select>
                              {editSessionError && <p className="text-red-400 text-xs">{editSessionError}</p>}
                              <div className="flex gap-2">
                                <button
                                  onClick={() => handleEditSession(s.id, t.id)}
                                  disabled={editSessionSubmitting}
                                  className="text-xs bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg transition-colors"
                                >
                                  {editSessionSubmitting ? "..." : "Guardar"}
                                </button>
                                <button
                                  onClick={() => { setEditingSessionId(null); setEditSessionError(null); }}
                                  className="text-xs text-gray-400 hover:text-white px-3 py-1.5 rounded-lg transition-colors"
                                >
                                  Cancelar
                                </button>
                              </div>
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}

                  {addingSessionFor === t.id ? (
                    <form onSubmit={(e) => handleCreateSession(e, t.id)} className="space-y-2 mt-2">
                      <div className="flex items-center gap-2 bg-gray-600/50 rounded-lg px-3 py-2">
                        <span className="text-xs text-gray-400">Tu equipo:</span>
                        <span className="text-white text-sm font-medium">{clubName}</span>
                      </div>
                      <input
                        required
                        placeholder="Rival"
                        value={sForm.away_team}
                        onChange={(e) => setSForm((f) => ({ ...f, away_team: e.target.value }))}
                        className="w-full bg-gray-700 text-white text-sm rounded-lg px-3 py-2 placeholder-gray-400 outline-none focus:ring-1 focus:ring-green-600"
                      />
                      <div className="grid grid-cols-2 gap-2">
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
                    <div className="flex items-center gap-4">
                      <button
                        onClick={() => { setAddingSessionFor(t.id); setSError(null); setSForm(EMPTY_SESSION_FORM); }}
                        className="text-sm text-green-400 hover:text-green-300 transition-colors"
                      >
                        + Nuevo partido
                      </button>
                      <button
                        onClick={() => { importTournamentRef.current = t.id; planillaImportRef.current?.click(); }}
                        disabled={importingPlanilla}
                        className="text-sm text-gray-400 hover:text-white disabled:opacity-50 transition-colors"
                      >
                        {importingPlanilla ? "Importando..." : "↑ Importar planilla"}
                      </button>
                    </div>
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
