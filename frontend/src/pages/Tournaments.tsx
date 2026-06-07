import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import * as XLSX from "xlsx";
import { newWorkbook, appendSheet, downloadWorkbook, addr, sc, merge, type StyledWorksheet } from "../lib/xlsxStyle";
import { calcPoints, countTries, countPenalties, countDrops, countCards, countTackles, countAttack, countSetpiece } from "../lib/stats";
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
      const homeTeam = session?.home_team ?? "Local";
      const awayTeam = session?.away_team ?? "Visitante";
      const fechaStr = session?.scheduled_at
        ? new Date(session.scheduled_at).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" })
        : "—";

      // Cast for stats helpers (same shape at runtime)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ev = eventsData as any[];

      const homePoints = calcPoints(ev, "user");
      const awayPoints = calcPoints(ev, "rival");
      const homeTries  = countTries(ev, "user");
      const awayTries  = countTries(ev, "rival");
      const homePen    = countPenalties(ev, "user");
      const awayPen    = countPenalties(ev, "rival");
      const homeDrops  = countDrops(ev, "user");
      const awayDrops  = countDrops(ev, "rival");
      const homeCards  = countCards(ev, "user");
      const awayCards  = countCards(ev, "rival");
      const tackles    = countTackles(ev);
      const attack     = countAttack(ev);
      const lineout    = countSetpiece(ev, "lineout");
      const scrum      = countSetpiece(ev, "scrum");
      const exit_      = countSetpiece(ev, "exit");

      // ── Styles ────────────────────────────────────────────────────────────
      const S = {
        title:     { fill: { fgColor: { rgb: "1B4332" } }, font: { bold: true, sz: 16, color: { rgb: "FFFFFF" } }, alignment: { horizontal: "center" as const } },
        score:     { fill: { fgColor: { rgb: "2D6A4F" } }, font: { bold: true, sz: 20, color: { rgb: "FFFFFF" } }, alignment: { horizontal: "center" as const } },
        meta:      { fill: { fgColor: { rgb: "40916C" } }, font: { sz: 10, color: { rgb: "D8F3DC" } }, alignment: { horizontal: "center" as const } },
        secHeader: { fill: { fgColor: { rgb: "2D3748" } }, font: { bold: true, sz: 11, color: { rgb: "FFFFFF" } } },
        colHeader: { fill: { fgColor: { rgb: "374151" } }, font: { bold: true, sz: 10, color: { rgb: "D1FAE5" } }, alignment: { horizontal: "center" as const } },
        label:     { font: { sz: 10, color: { rgb: "D1D5DB" } } },
        numHome:   { font: { bold: true, sz: 11, color: { rgb: "6EE7B7" } }, alignment: { horizontal: "center" as const } },
        numAway:   { font: { bold: true, sz: 11, color: { rgb: "FCA5A5" } }, alignment: { horizontal: "center" as const } },
        totalHome: { fill: { fgColor: { rgb: "064E3B" } }, font: { bold: true, sz: 12, color: { rgb: "6EE7B7" } }, alignment: { horizontal: "center" as const } },
        totalAway: { fill: { fgColor: { rgb: "7F1D1D" } }, font: { bold: true, sz: 12, color: { rgb: "FCA5A5" } }, alignment: { horizontal: "center" as const } },
        totalLabel:{ fill: { fgColor: { rgb: "111827" } }, font: { bold: true, sz: 11, color: { rgb: "FFFFFF" } } },
        yellow:    { font: { bold: true, sz: 10, color: { rgb: "FCD34D" } }, alignment: { horizontal: "center" as const } },
        red:       { font: { bold: true, sz: 10, color: { rgb: "F87171" } }, alignment: { horizontal: "center" as const } },
        infoLine:  { font: { sz: 10, color: { rgb: "9CA3AF" } } },
        // Plantel
        teamHeaderHome: { fill: { fgColor: { rgb: "14532D" } }, font: { bold: true, sz: 11, color: { rgb: "BBF7D0" } }, alignment: { horizontal: "center" as const } },
        teamHeaderAway: { fill: { fgColor: { rgb: "7C2D12" } }, font: { bold: true, sz: 11, color: { rgb: "FED7AA" } }, alignment: { horizontal: "center" as const } },
        subHeader:  { fill: { fgColor: { rgb: "1F2937" } }, font: { bold: true, sz: 10, color: { rgb: "9CA3AF" } } },
        rowEven:    { fill: { fgColor: { rgb: "111827" } }, font: { sz: 10, color: { rgb: "E5E7EB" } } },
        rowOdd:     { fill: { fgColor: { rgb: "1F2937" } }, font: { sz: 10, color: { rgb: "E5E7EB" } } },
        jerseyHome: { fill: { fgColor: { rgb: "111827" } }, font: { bold: true, sz: 11, color: { rgb: "6EE7B7" } }, alignment: { horizontal: "center" as const } },
        jerseyOdd:  { fill: { fgColor: { rgb: "1F2937" } }, font: { bold: true, sz: 11, color: { rgb: "6EE7B7" } }, alignment: { horizontal: "center" as const } },
        jerseyAway: { fill: { fgColor: { rgb: "111827" } }, font: { bold: true, sz: 11, color: { rgb: "FCA5A5" } }, alignment: { horizontal: "center" as const } },
        jerseyAwayOdd: { fill: { fgColor: { rgb: "1F2937" } }, font: { bold: true, sz: 11, color: { rgb: "FCA5A5" } }, alignment: { horizontal: "center" as const } },
      };

      const wb = newWorkbook();

      // ── Sheet 1: Resumen ──────────────────────────────────────────────────
      const wsR: StyledWorksheet = {};
      const merges = [];
      let r = 0;

      const setRow = (row: number, cells: Array<[number, ReturnType<typeof sc>]>) => {
        cells.forEach(([c, cell]) => { wsR[addr(row, c)] = cell; });
      };

      // Title
      wsR[addr(r, 0)] = sc("PLANILLA DE PARTIDO", S.title);
      merges.push(merge(r, 0, r, 4)); r++;

      // Score
      wsR[addr(r, 0)] = sc(`${homeTeam}   ${homePoints}  —  ${awayPoints}   ${awayTeam}`, S.score);
      merges.push(merge(r, 0, r, 4)); r++;

      // Meta
      wsR[addr(r, 0)] = sc(`Fecha: ${fechaStr}`, S.meta);
      merges.push(merge(r, 0, r, 4)); r++;

      r++; // spacer

      // PUNTUACIÓN section
      wsR[addr(r, 0)] = sc("PUNTUACIÓN", S.secHeader);
      merges.push(merge(r, 0, r, 2)); r++;

      setRow(r, [[0, sc("", S.colHeader)], [1, sc(homeTeam, S.colHeader)], [2, sc(awayTeam, S.colHeader)]]); r++;
      setRow(r, [[0, sc("Tries (×5)", S.label)],           [1, sc(homeTries.total,      S.numHome)], [2, sc(awayTries.total,      S.numAway)]]); r++;
      setRow(r, [[0, sc("Conversiones (×2)", S.label)],    [1, sc(homeTries.converted,  S.numHome)], [2, sc(awayTries.converted,  S.numAway)]]); r++;
      setRow(r, [[0, sc("Penales a palos (×3)", S.label)], [1, sc(homePen.converted,    S.numHome)], [2, sc(awayPen.converted,    S.numAway)]]); r++;
      setRow(r, [[0, sc("Drops (×3)", S.label)],           [1, sc(homeDrops,             S.numHome)], [2, sc(awayDrops,            S.numAway)]]); r++;

      // Total row
      wsR[addr(r, 0)] = sc("TOTAL",       S.totalLabel);
      wsR[addr(r, 1)] = sc(homePoints,    S.totalHome);
      wsR[addr(r, 2)] = sc(awayPoints,    S.totalAway);
      r++;

      r++; // spacer

      // DISCIPLINA section
      wsR[addr(r, 0)] = sc("DISCIPLINA", S.secHeader);
      merges.push(merge(r, 0, r, 2)); r++;

      setRow(r, [[0, sc("", S.colHeader)], [1, sc(homeTeam, S.colHeader)], [2, sc(awayTeam, S.colHeader)]]); r++;
      setRow(r, [[0, sc("Amarillas", S.label)], [1, sc(homeCards.yellow, S.yellow)], [2, sc(awayCards.yellow, S.yellow)]]); r++;
      setRow(r, [[0, sc("Rojas",     S.label)], [1, sc(homeCards.red,    S.red)],    [2, sc(awayCards.red,    S.red)]]); r++;

      r++; // spacer

      // JUEGO section
      wsR[addr(r, 0)] = sc(`JUEGO — ${homeTeam}`, S.secHeader);
      merges.push(merge(r, 0, r, 4)); r++;

      const infoLine = (text: string) => {
        wsR[addr(r, 0)] = sc(text, S.infoLine);
        merges.push(merge(r, 0, r, 4));
        r++;
      };

      infoLine(`Tackles: Concretados ${tackles.effective} · Errados ${tackles.missed} · Positivos ${tackles.positive}`);
      infoLine(`Ataque: Quiebres ${attack.line_break} · Offloads ${attack.offload}`);

      const lostTotal = ev.filter((e) => e.event_type === "possession_lost").length;
      const wonTotal  = ev.filter((e) => e.event_type === "ball_won").length;
      if (lostTotal > 0 || wonTotal > 0) {
        const byReason = (type: string) => {
          const motivos = ["ruck", "maul", "contacto", "pesca", "patada", "knock_on"];
          return motivos
            .map((m) => `${m.charAt(0).toUpperCase() + m.slice(1)}: ${ev.filter((e) => e.event_type === type && e.reason === m).length}`)
            .filter((s) => !s.endsWith(": 0"))
            .join(" · ") || "—";
        };
        if (lostTotal > 0) infoLine(`Posesión perdida: ${byReason("possession_lost")}`);
        if (wonTotal  > 0) infoLine(`Pelota ganada: ${byReason("ball_won")}`);
      }

      r++; // spacer

      // LÍNEAS Y SCRUMS section
      wsR[addr(r, 0)] = sc("LÍNEAS Y SCRUMS", S.secHeader);
      merges.push(merge(r, 0, r, 4)); r++;

      if (lineout.favor_con + lineout.favor_sin + lineout.contra_con + lineout.contra_sin > 0) {
        infoLine(`Lines a favor: ${lineout.favor_con + lineout.favor_sin} (${lineout.favor_con} con obtención)`);
        infoLine(`Lines en contra: ${lineout.contra_con + lineout.contra_sin} (${lineout.contra_con} con obtención)`);
      } else {
        infoLine("Lines: sin datos");
      }

      if (scrum.favor_con + scrum.favor_sin + scrum.contra_con + scrum.contra_sin > 0) {
        infoLine(`Scrums a favor: ${scrum.favor_con + scrum.favor_sin} (${scrum.favor_con} con obtención)`);
        infoLine(`Scrums en contra: ${scrum.contra_con + scrum.contra_sin} (${scrum.contra_con} con obtención)`);
      } else {
        infoLine("Scrums: sin datos");
      }

      if (exit_.favor_con + exit_.favor_sin + exit_.contra_con + exit_.contra_sin > 0) {
        infoLine(`Salidas a favor: ${exit_.favor_con + exit_.favor_sin} (${exit_.favor_con} con obtención)`);
        infoLine(`Salidas en contra: ${exit_.contra_con + exit_.contra_sin} (${exit_.contra_con} con obtención)`);
      }

      // Sheet range, merges, col widths, row heights
      wsR["!ref"]    = addr(0, 0) + ":" + addr(r - 1, 4);
      wsR["!merges"] = merges;
      wsR["!cols"]   = [{ wch: 26 }, { wch: 18 }, { wch: 18 }, { wch: 10 }, { wch: 10 }];
      wsR["!rows"]   = [{ hpt: 28 }, { hpt: 30 }, { hpt: 18 }];

      appendSheet(wb, wsR, "Resumen");

      // ── Sheet 2: Plantel ──────────────────────────────────────────────────
      const wsP: StyledWorksheet = {};
      let pr = 0;

      const addPlantelRow = (
        jersey: string | number, name: string, pos: string, estado: string,
        isHome: boolean, odd: boolean
      ) => {
        const jStyle = isHome
          ? (odd ? S.jerseyOdd  : S.jerseyHome)
          : (odd ? S.jerseyAwayOdd : S.jerseyAway);
        const rStyle = odd ? S.rowOdd : S.rowEven;
        wsP[addr(pr, 0)] = sc(jersey, jStyle);
        wsP[addr(pr, 1)] = sc(name,   rStyle);
        wsP[addr(pr, 2)] = sc(pos,    rStyle);
        wsP[addr(pr, 3)] = sc(estado, rStyle);
        pr++;
      };

      const plantelMerges: typeof merges = [];

      // Column headers
      const phStyle = S.colHeader;
      [["N°", 0], ["Nombre", 1], ["Posición", 2], ["Estado", 3]].forEach(([h, c]) => {
        wsP[addr(pr, c as number)] = sc(h as string, phStyle);
      });
      pr++;

      const home = lineupData.filter((e) => e.team === "user").sort((a, b) => a.jersey_number - b.jersey_number);
      const away = lineupData.filter((e) => e.team === "rival").sort((a, b) => a.jersey_number - b.jersey_number);
      const homeTitulares = home.filter((e) => e.status === "on_field");
      const homeSuplentes = home.filter((e) => e.status !== "on_field");
      const awayTitulares = away.filter((e) => e.status === "on_field");
      const awaySuplentes = away.filter((e) => e.status !== "on_field");

      const addTeamSection = (name: string, titulares: typeof home, suplentes: typeof home, isHome: boolean) => {
        // Team header
        wsP[addr(pr, 0)] = sc(name, isHome ? S.teamHeaderHome : S.teamHeaderAway);
        plantelMerges.push(merge(pr, 0, pr, 3));
        pr++;

        // Titulares subheader
        wsP[addr(pr, 0)] = sc("Titulares", S.subHeader);
        plantelMerges.push(merge(pr, 0, pr, 3));
        pr++;

        titulares.forEach((e, i) => {
          addPlantelRow(e.jersey_number, e.player.name, e.position ?? e.player.position ?? "—", "Titular", isHome, i % 2 === 1);
        });

        if (suplentes.length > 0) {
          wsP[addr(pr, 0)] = sc("Suplentes", S.subHeader);
          plantelMerges.push(merge(pr, 0, pr, 3));
          pr++;

          suplentes.forEach((e, i) => {
            addPlantelRow(e.jersey_number, e.player.name, e.position ?? e.player.position ?? "—", "Suplente", isHome, i % 2 === 1);
          });
        }
        pr++; // spacer
      };

      addTeamSection(homeTeam, homeTitulares, homeSuplentes, true);
      addTeamSection(awayTeam, awayTitulares, awaySuplentes, false);

      wsP["!ref"]    = addr(0, 0) + ":" + addr(pr - 1, 3);
      wsP["!merges"] = plantelMerges;
      wsP["!cols"]   = [{ wch: 6 }, { wch: 30 }, { wch: 18 }, { wch: 10 }];

      appendSheet(wb, wsP, "Plantel");

      // ── Sheet 3: Eventos (raw — para re-import) ───────────────────────────
      const wsE = XLSX.utils.aoa_to_sheet([
        ["Tipo", "Equipo", "Razon", "Convertido"],
        ...eventsData.map((e) => [
          e.event_type,
          e.team === "user" ? homeTeam : awayTeam,
          e.reason ?? "",
          e.metadata?.converted !== undefined ? (e.metadata.converted ? "Si" : "No") : "",
        ]),
      ]);
      wsE["!cols"] = [{ wch: 25 }, { wch: 12 }, { wch: 20 }, { wch: 12 }];
      XLSX.utils.book_append_sheet(wb as never, wsE, "Eventos");

      const safe = (s: string) => s.replace(/[^a-z0-9áéíóúñ\s]/gi, "").trim();
      downloadWorkbook(wb, `planilla-${safe(homeTeam)}-vs-${safe(awayTeam)}.xlsx`);
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
