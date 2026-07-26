import { useEffect, useRef, useState } from "react";
import api from "../lib/axios";
import { parseApiError } from "../lib/errors";

const TIPO_LABEL: Record<string, string> = {
  try: "Try",
  penalty: "Penal",
  yellow_card: "Amarilla",
  red_card: "Roja",
  substitution: "Cambio",
};

function eventDesc(e: PdfEvent): string {
  const base = TIPO_LABEL[e.tipo] ?? e.tipo;
  if (e.tipo === "try") return `${base}${e.metadata?.converted ? " (conv.)" : ""} · Dor. ${e.dorsal ?? "?"}`;
  if (e.tipo === "substitution") return `${base} ${e.dorsal_out ?? "?"} → ${e.dorsal_in ?? "?"}`;
  return `${base} · Dor. ${e.dorsal ?? "?"}`;
}

interface PdfPlayer {
  pos: number;
  dor: number;
  nombre_pdf: string;
  nombre_norm: string;
  status: "on_field" | "bench";
  doc_num: string;
}

interface PdfEvent {
  tiempo: string;
  minuto: number;
  tipo: string;
  dorsal?: number;
  dorsal_out?: number;
  dorsal_in?: number;
  reason?: string;
  observaciones?: string;
  metadata?: Record<string, unknown>;
}

interface ParsedMatch {
  match_number: string;
  local_team: string;
  visitante_team: string;
  local_score: number;
  visitante_score: number;
  fecha: string | null;
  lineup_local: PdfPlayer[];
  lineup_visitante: PdfPlayer[];
  incidencias_local: PdfEvent[];
  incidencias_visitante: PdfEvent[];
}

interface DbPlayer {
  id: string;
  name: string;
  position: string | null;
  dni: string | null;
}

interface Resolution {
  pdfPlayer: PdfPlayer;
  dbPlayerId: string | null;
}

interface Tournament {
  id: string;
  name: string;
  division: { id: string; name: string };
}

interface Division {
  id: string;
  name: string;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  tournaments: Tournament[];
  divisions: Division[];
  clubName: string;
  onImportDone: (tournamentId: string) => void;
}

type Step = "select" | "uploading" | "confirm" | "player-dialog" | "creating";

function titleCase(s: string): string {
  return s.split(" ").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

export default function UarImportModal({
  isOpen,
  onClose,
  tournaments,
  divisions,
  clubName,
  onImportDone,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>("select");
  const [error, setError] = useState<string | null>(null);

  const [tournamentId, setTournamentId] = useState("");
  const [divisionId, setDivisionId] = useState("");

  const [parsed, setParsed] = useState<ParsedMatch | null>(null);
  const [userSide, setUserSide] = useState<"local" | "visitante">("local");
  const [editRival, setEditRival] = useState("");
  const [editFecha, setEditFecha] = useState("");
  const [resolutions, setResolutions] = useState<Resolution[]>([]);

  const [pendingQueue, setPendingQueue] = useState<Resolution[]>([]);
  const [currentRes, setCurrentRes] = useState<Resolution | null>(null);
  const [creatingPlayer, setCreatingPlayer] = useState(false);
  const [showEvents, setShowEvents] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setStep("select");
      setError(null);
      setParsed(null);
      setTournamentId("");
      setDivisionId("");
      setResolutions([]);
      setPendingQueue([]);
      setCurrentRes(null);
      setShowEvents(false);
    }
  }, [isOpen]);

  // Pre-select first tournament/division when they load
  useEffect(() => {
    if (isOpen && !tournamentId && tournaments.length > 0) setTournamentId(tournaments[0].id);
  }, [isOpen, tournaments, tournamentId]);
  useEffect(() => {
    if (isOpen && !divisionId && divisions.length > 0) setDivisionId(divisions[0].id);
  }, [isOpen, divisions, divisionId]);

  if (!isOpen) return null;

  const handleSelectPdf = () => {
    if (!tournamentId) { setError("Seleccioná un torneo"); return; }
    if (!divisionId) { setError("Seleccioná una división"); return; }
    setError(null);
    fileRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setStep("uploading");
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const [{ data: matchData }, { data: players }] = await Promise.all([
        api.post<ParsedMatch>("/import/lineup-pdf", form),
        api.get<DbPlayer[]>(`/divisions/${divisionId}/players`),
      ]);

      const clubLow = clubName.toLowerCase();
      const localLow = matchData.local_team.toLowerCase();
      const side = localLow.includes(clubLow) || clubLow.includes(localLow) ? "local" : "visitante";
      setUserSide(side);

      const rival = side === "local" ? matchData.visitante_team : matchData.local_team;
      setEditRival(rival);
      setEditFecha(matchData.fecha ? matchData.fecha.replace("T", " ").slice(0, 16) : "");

      const userLineup = side === "local" ? matchData.lineup_local : matchData.lineup_visitante;
      const resolvedList: Resolution[] = userLineup.map((p) => {
        let match = p.doc_num
          ? players.find((db) => db.dni === p.doc_num)
          : undefined;
        if (!match) {
          match = players.find((db) => {
            const dbNorm = db.name.toLowerCase().trim();
            return dbNorm === p.nombre_norm || dbNorm.includes(p.nombre_norm) || p.nombre_norm.includes(dbNorm);
          });
        }
        return { pdfPlayer: p, dbPlayerId: match?.id ?? null };
      });

      setParsed(matchData);
      setResolutions(resolvedList);
      setStep("confirm");
    } catch (err) {
      setError(parseApiError(err, "Error al procesar el PDF"));
      setStep("select");
    }
  };

  const handleConfirm = () => {
    const unmatched = resolutions.filter((r) => r.dbPlayerId === null);
    if (unmatched.length > 0) {
      setPendingQueue(unmatched);
      setCurrentRes(unmatched[0]);
      setStep("player-dialog");
    } else {
      doCreate(resolutions);
    }
  };

  const handleCreatePlayer = async () => {
    if (!currentRes) return;
    setCreatingPlayer(true);
    setError(null);
    try {
      const { data: newPlayer } = await api.post<DbPlayer>(`/divisions/${divisionId}/players`, {
        name: titleCase(currentRes.pdfPlayer.nombre_norm),
        position: null,
        dni: currentRes.pdfPlayer.doc_num || null,
      });
      const updated = resolutions.map((r) =>
        r.pdfPlayer.pos === currentRes.pdfPlayer.pos ? { ...r, dbPlayerId: newPlayer.id } : r
      );
      const remaining = pendingQueue.slice(1);
      setResolutions(updated);
      if (remaining.length > 0) {
        setPendingQueue(remaining);
        setCurrentRes(remaining[0]);
      } else {
        setPendingQueue([]);
        setCurrentRes(null);
        doCreate(updated);
      }
    } catch (err) {
      setError(parseApiError(err, "Error al crear jugador"));
    } finally {
      setCreatingPlayer(false);
    }
  };

  const doCreate = async (finalResolutions: Resolution[]) => {
    if (!parsed) return;
    setStep("creating");
    setError(null);
    try {
      const userIncid = userSide === "local" ? parsed.incidencias_local : parsed.incidencias_visitante;
      const rivalIncid = userSide === "local" ? parsed.incidencias_visitante : parsed.incidencias_local;

      const lineup = finalResolutions
        .filter((r) => r.dbPlayerId !== null)
        .map((r) => ({
          player_id: r.dbPlayerId!,
          jersey_number: r.pdfPlayer.dor,
          status: r.pdfPlayer.status,
          team: "user",
          dni: r.pdfPlayer.doc_num || null,
        }));

      const mapEvents = (evs: PdfEvent[], team: "user" | "rival") =>
        evs.map((e) => ({
          tiempo: e.tiempo,
          minuto: e.minuto,
          tipo: e.tipo,
          team,
          reason: e.reason ?? null,
          metadata: {
            ...(e.metadata ?? {}),
            ...(e.dorsal != null ? { dorsal: e.dorsal } : {}),
            ...(e.dorsal_out != null ? { dorsal_out: e.dorsal_out, dorsal_in: e.dorsal_in } : {}),
            ...(e.observaciones ? { observaciones: e.observaciones } : {}),
          },
        }));

      const events = [
        ...mapEvents(userIncid, "user"),
        ...mapEvents(rivalIncid, "rival"),
      ].sort((a, b) => {
        const hMap: Record<string, number> = { "1T": 0, "2T": 1 };
        return (hMap[a.tiempo] ?? 0) - (hMap[b.tiempo] ?? 0) || a.minuto - b.minuto;
      });

      const homeTeam = userSide === "local" ? clubName : editRival;
      const awayTeam = userSide === "local" ? editRival : clubName;
      const scheduledAt = editFecha ? new Date(editFecha.replace(" ", "T")).toISOString() : null;

      await api.post("/import/confirm", {
        tournament_id: tournamentId,
        home_team: homeTeam,
        away_team: awayTeam,
        scheduled_at: scheduledAt,
        lineup,
        events,
      });

      onImportDone(tournamentId);
    } catch (err) {
      setError(parseApiError(err, "Error al importar el partido"));
      setStep("confirm");
    }
  };

  const userLineup = parsed
    ? userSide === "local" ? parsed.lineup_local : parsed.lineup_visitante
    : [];
  const rivalLineup = parsed
    ? userSide === "local" ? parsed.lineup_visitante : parsed.lineup_local
    : [];
  const totalEvents =
    (parsed?.incidencias_local.length ?? 0) + (parsed?.incidencias_visitante.length ?? 0);
  const notFound = resolutions.filter((r) => r.dbPlayerId === null).length;

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 animate-overlay">
      <div className="bg-surface rounded-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden animate-modal">
        {/* Header */}
        <div className="px-6 pt-5 pb-4 border-b border-line flex-shrink-0">
          <h2 className="text-ink font-bold text-lg">Importar Ficha BD UAR</h2>
          {parsed?.match_number && (
            <p className="text-xs text-ink-muted mt-0.5">Tarjeta N° {parsed.match_number}</p>
          )}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {/* ── STEP: select ── */}
          {step === "select" && (
            <>
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-ink-muted uppercase tracking-wide block mb-1">Torneo</label>
                  <select
                    value={tournamentId}
                    onChange={(e) => setTournamentId(e.target.value)}
                    className="w-full bg-surface-strong text-ink text-sm rounded-lg px-3 py-2.5 outline-none focus:ring-1 focus:ring-brand-ring"
                  >
                    <option value="">— Seleccionar —</option>
                    {tournaments.map((t) => (
                      <option key={t.id} value={t.id}>{t.name} ({t.division.name})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-ink-muted uppercase tracking-wide block mb-1">División de tus jugadores</label>
                  <select
                    value={divisionId}
                    onChange={(e) => setDivisionId(e.target.value)}
                    className="w-full bg-surface-strong text-ink text-sm rounded-lg px-3 py-2.5 outline-none focus:ring-1 focus:ring-brand-ring"
                  >
                    <option value="">— Seleccionar —</option>
                    {divisions.map((d) => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              {error && <p className="text-red-600 text-xs">{error}</p>}
            </>
          )}

          {/* ── STEP: uploading ── */}
          {step === "uploading" && (
            <div className="flex flex-col items-center justify-center py-10 gap-3">
              <div className="w-8 h-8 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-ink-muted text-sm">Procesando PDF...</p>
            </div>
          )}

          {/* ── STEP: confirm ── */}
          {step === "confirm" && parsed && (
            <>
              {/* Match header */}
              <div className="bg-surface-strong/50 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-center flex-1">
                    <p className="text-xs text-ink-muted mb-0.5">{userSide === "local" ? "Tu equipo (LOCAL)" : "Rival (LOCAL)"}</p>
                    <p className="text-ink font-bold text-sm">{parsed.local_team}</p>
                    <p className="text-2xl font-bold text-brand">{parsed.local_score}</p>
                  </div>
                  <p className="text-ink-faint font-bold text-lg px-3">—</p>
                  <div className="text-center flex-1">
                    <p className="text-xs text-ink-muted mb-0.5">{userSide === "visitante" ? "Tu equipo (VISIT.)" : "Rival (VISIT.)"}</p>
                    <p className="text-ink font-bold text-sm">{parsed.visitante_team}</p>
                    <p className="text-2xl font-bold text-red-600">{parsed.visitante_score}</p>
                  </div>
                </div>
              </div>

              {/* Editable rival + fecha */}
              <div className="space-y-2">
                <div>
                  <label className="text-xs text-ink-muted uppercase tracking-wide block mb-1">Nombre del rival (editable)</label>
                  <input
                    value={editRival}
                    onChange={(e) => setEditRival(e.target.value)}
                    className="w-full bg-surface-strong text-ink text-sm rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-brand-ring"
                  />
                </div>
                <div>
                  <label className="text-xs text-ink-muted uppercase tracking-wide block mb-1">Fecha y hora</label>
                  <input
                    type="datetime-local"
                    value={editFecha}
                    onChange={(e) => setEditFecha(e.target.value)}
                    className="w-full bg-surface-strong text-ink text-sm rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-brand-ring"
                  />
                </div>
              </div>

              {/* User lineup */}
              <div>
                <p className="text-xs text-ink-muted uppercase tracking-wide mb-2">
                  Tu plantel — {userLineup.length} jugadores
                </p>
                <div className="space-y-1 max-h-52 overflow-y-auto">
                  {resolutions.map((r) => (
                    <div
                      key={r.pdfPlayer.pos}
                      className="flex items-center justify-between bg-surface-hover rounded-lg px-3 py-1.5"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-ink-muted w-5 text-right">{r.pdfPlayer.dor}</span>
                        <div>
                          <span className="text-sm text-ink">{titleCase(r.pdfPlayer.nombre_norm)}</span>
                          {r.pdfPlayer.doc_num && (
                            <span className="block text-xs text-ink-muted">DNI {r.pdfPlayer.doc_num}</span>
                          )}
                        </div>
                        <span className="text-xs text-ink-muted">
                          {r.pdfPlayer.status === "on_field" ? "Titular" : "Suplente"}
                        </span>
                      </div>
                      <span className={`text-xs font-medium ${r.dbPlayerId ? "text-brand" : "text-yellow-600"}`}>
                        {r.dbPlayerId ? "✓ En BD" : "⚠ No hallado"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Rival lineup count */}
              <p className="text-xs text-ink-muted">
                Plantel rival: {rivalLineup.length} jugadores (referencia, no se importa al lineup)
              </p>

              {/* Events section */}
              <div>
                <button
                  onClick={() => setShowEvents((v) => !v)}
                  className="w-full flex items-center justify-between bg-surface-hover hover:bg-surface-hover rounded-lg px-4 py-2.5 transition-colors"
                >
                  <span className="text-sm text-ink-soft font-medium">
                    Eventos a importar
                    <span className="ml-2 text-xs text-ink-muted">({totalEvents} en total)</span>
                  </span>
                  <span className="text-ink-muted text-xs">{showEvents ? "▲" : "▼"}</span>
                </button>
                {showEvents && (
                  <div className="mt-1 max-h-52 overflow-y-auto space-y-0.5 rounded-lg">
                    {/* User events */}
                    {(userSide === "local" ? parsed.incidencias_local : parsed.incidencias_visitante).length > 0 && (
                      <>
                        <p className="text-xs text-ink-muted uppercase tracking-wide px-2 pt-2 pb-1">Tu equipo</p>
                        {(userSide === "local" ? parsed.incidencias_local : parsed.incidencias_visitante).map((e, i) => (
                          <div key={i} className="flex items-center gap-2 px-3 py-1 bg-surface-strong/30 rounded">
                            <span className="text-xs text-ink-muted w-7">{e.tiempo}</span>
                            <span className="text-xs text-ink-muted w-8">min.{e.minuto}</span>
                            <span className={`text-xs font-medium ${
                              e.tipo === "try" ? "text-brand" :
                              e.tipo === "penalty" ? "text-blue-600" :
                              e.tipo === "yellow_card" ? "text-yellow-600" :
                              e.tipo === "red_card" ? "text-red-600" :
                              "text-ink-soft"
                            }`}>
                              {eventDesc(e)}
                            </span>
                          </div>
                        ))}
                      </>
                    )}
                    {/* Rival events */}
                    {(userSide === "local" ? parsed.incidencias_visitante : parsed.incidencias_local).length > 0 && (
                      <>
                        <p className="text-xs text-ink-muted uppercase tracking-wide px-2 pt-2 pb-1">Rival</p>
                        {(userSide === "local" ? parsed.incidencias_visitante : parsed.incidencias_local).map((e, i) => (
                          <div key={i} className="flex items-center gap-2 px-3 py-1 bg-surface-strong/20 rounded">
                            <span className="text-xs text-ink-muted w-7">{e.tiempo}</span>
                            <span className="text-xs text-ink-muted w-8">min.{e.minuto}</span>
                            <span className={`text-xs font-medium ${
                              e.tipo === "try" ? "text-brand" :
                              e.tipo === "penalty" ? "text-blue-600" :
                              e.tipo === "yellow_card" ? "text-yellow-600" :
                              e.tipo === "red_card" ? "text-red-600" :
                              "text-ink-soft"
                            }`}>
                              {eventDesc(e)}
                            </span>
                          </div>
                        ))}
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* Bottom summary */}
              {notFound > 0 && (
                <p className="text-yellow-600 text-xs">
                  ⚠ {notFound} jugador{notFound > 1 ? "es" : ""} no encontrado{notFound > 1 ? "s" : ""} — se crearán en la división seleccionada
                </p>
              )}

              {error && <p className="text-red-600 text-xs">{error}</p>}
            </>
          )}

          {/* ── STEP: player-dialog ── */}
          {step === "player-dialog" && currentRes && (
            <div className="py-4 space-y-5">
              <div className="bg-yellow-900/30 border border-yellow-700/50 rounded-xl p-4">
                <p className="text-yellow-300 font-semibold text-sm mb-1">Jugador no encontrado</p>
                <p className="text-ink text-base font-bold">
                  {titleCase(currentRes.pdfPlayer.nombre_norm)}
                </p>
                <p className="text-ink-muted text-xs mt-0.5">N° {currentRes.pdfPlayer.dor} · {currentRes.pdfPlayer.status === "on_field" ? "Titular" : "Suplente"}</p>
              </div>
              <p className="text-ink-soft text-sm">
                Este jugador no está en la división seleccionada. ¿Qué querés hacer?
              </p>
              {pendingQueue.length > 1 && (
                <p className="text-xs text-ink-muted">{pendingQueue.length - 1} jugador{pendingQueue.length > 2 ? "es" : ""} más por resolver</p>
              )}
              {error && <p className="text-red-600 text-xs">{error}</p>}
            </div>
          )}

          {/* ── STEP: creating ── */}
          {step === "creating" && (
            <div className="flex flex-col items-center justify-center py-10 gap-3">
              <div className="w-8 h-8 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-ink-muted text-sm">Importando partido...</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 pb-5 pt-3 border-t border-line flex-shrink-0">
          {step === "select" && (
            <div className="flex gap-3">
              <button
                onClick={handleSelectPdf}
                className="pressable flex-1 bg-brand hover:bg-brand-hover text-white text-sm font-medium py-2.5 rounded-lg transition-colors duration-150"
              >
                Seleccionar PDF
              </button>
              <button
                onClick={onClose}
                className="pressable flex-1 bg-surface-strong hover:bg-surface-hover text-ink-soft text-sm font-medium py-2.5 rounded-lg transition-colors duration-150"
              >
                Cancelar
              </button>
            </div>
          )}

          {step === "confirm" && (
            <div className="flex gap-3">
              <button
                onClick={handleConfirm}
                className="pressable flex-1 bg-brand hover:bg-brand-hover text-white text-sm font-medium py-2.5 rounded-lg transition-colors duration-150"
              >
                Confirmar e importar
              </button>
              <button
                onClick={onClose}
                className="pressable flex-1 bg-surface-strong hover:bg-surface-hover text-ink-soft text-sm font-medium py-2.5 rounded-lg transition-colors duration-150"
              >
                Cancelar
              </button>
            </div>
          )}

          {step === "player-dialog" && currentRes && (
            <div className="flex gap-3">
              <button
                onClick={handleCreatePlayer}
                disabled={creatingPlayer}
                className="pressable flex-1 bg-brand hover:bg-brand-hover disabled:opacity-50 text-white text-sm font-medium py-2.5 rounded-lg transition-colors duration-150"
              >
                {creatingPlayer ? "Creando..." : "Crear jugador"}
              </button>
              <button
                onClick={onClose}
                disabled={creatingPlayer}
                className="pressable flex-1 bg-surface-strong hover:bg-surface-hover disabled:opacity-50 text-ink-soft text-sm font-medium py-2.5 rounded-lg transition-colors duration-150"
              >
                Cancelar importación
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Hidden file input */}
      <input
        ref={fileRef}
        type="file"
        accept=".pdf"
        className="hidden"
        onChange={handleFileChange}
      />
    </div>
  );
}
