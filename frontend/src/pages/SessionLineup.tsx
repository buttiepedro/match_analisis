import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import api from "../lib/axios";
import { parseApiError } from "../lib/errors";
import { useAuthStore } from "../store/authStore";
import { positionByJersey } from "../lib/rugby";

interface SessionInfo {
  id: string;
  home_team: string;
  away_team: string;
  tournament_id: string;
  status: string;
}

interface AvailablePlayer {
  id: string;
  name: string;
  position: string | null;
}

interface LineupEntry {
  id: string;
  player_id: string;
  jersey_number: number;
  position: string | null;
  team: string;
  status: string;
  player: { id: string; name: string; position: string | null };
}

interface SuggestedEntry {
  player_id: string;
  player_name: string;
  jersey_number: number;
  position: string | null;
  status: string;
  available: boolean;
}

interface Suggested {
  source_session_id: string | null;
  source_label: string | null;
  entries: SuggestedEntry[];
}

/** 1-15 titulares, 16-23 suplentes: la numeración reglamentaria. */
const STARTER_NUMBERS = Array.from({ length: 15 }, (_, i) => i + 1);
const BENCH_NUMBERS = Array.from({ length: 8 }, (_, i) => i + 16);

/** playerId por número de camiseta. El estado entero del armado es esto. */
type Slots = Record<number, string | undefined>;

function jerseyOf(slots: Slots, playerId: string): number | undefined {
  return Object.keys(slots)
    .map(Number)
    .find((n) => slots[n] === playerId);
}

export default function SessionLineup() {
  const { id: sessionId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === "club_admin" || user?.role === "superadmin";

  const [session, setSession] = useState<SessionInfo | null>(null);
  const [allPlayers, setAllPlayers] = useState<AvailablePlayer[]>([]);
  const [loading, setLoading] = useState(true);

  const [teamView, setTeamView] = useState<"user" | "rival">("user");
  const [slots, setSlots] = useState<Slots>({});
  const [savedSlots, setSavedSlots] = useState<Slots>({});

  const [pickingFor, setPickingFor] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadLineup = (team: "user" | "rival") => {
    if (!sessionId) return;
    api.get<LineupEntry[]>(`/sessions/${sessionId}/lineup`).then(({ data }) => {
      const next: Slots = {};
      data
        .filter((e) => e.team === team)
        .forEach((e) => {
          next[e.jersey_number] = e.player_id;
        });
      setSlots(next);
      setSavedSlots(next);
    });
  };

  useEffect(() => {
    if (!sessionId || !user?.club_id) return;
    Promise.all([
      api.get<SessionInfo>(`/sessions/${sessionId}`),
      api.get<LineupEntry[]>(`/sessions/${sessionId}/lineup`),
      api.get<AvailablePlayer[]>(`/clubs/${user.club_id}/players`),
    ])
      .then(([sRes, lRes, pRes]) => {
        setSession(sRes.data);
        setAllPlayers(pRes.data);
        const next: Slots = {};
        lRes.data
          .filter((e) => e.team === "user")
          .forEach((e) => {
            next[e.jersey_number] = e.player_id;
          });
        setSlots(next);
        setSavedSlots(next);
      })
      .catch((err) => setError(parseApiError(err, "No se pudo cargar el lineup")))
      .finally(() => setLoading(false));
  }, [sessionId, user?.club_id]);

  const playersById = useMemo(
    () => Object.fromEntries(allPlayers.map((p) => [p.id, p])),
    [allPlayers]
  );

  /**
   * Con el partido empezado el reemplazo masivo borraría quién entró y salió, así
   * que el backend lo rechaza. Mejor apagar la grilla que ofrecer un botón que
   * siempre va a fallar.
   */
  const started = Boolean(session && session.status !== "scheduled");
  const canEdit = isAdmin && !started;

  const filled = Object.values(slots).filter(Boolean).length;
  const dirty = useMemo(
    () => JSON.stringify(slots) !== JSON.stringify(savedSlots),
    [slots, savedSlots]
  );

  const switchTeam = (team: "user" | "rival") => {
    setTeamView(team);
    setNotice("");
    loadLineup(team);
  };

  /**
   * En el picker van primero los del puesto natural del casillero. En un plantel
   * de 40, buscar al hooker entre 40 nombres alfabéticos es el trabajo que esta
   * pantalla existe para evitar.
   */
  const pickerPlayers = useMemo(() => {
    if (pickingFor === null) return [];
    const slotPosition = positionByJersey(pickingFor);
    const q = search.trim().toLowerCase();

    return allPlayers
      .filter((p) => !q || p.name.toLowerCase().includes(q))
      .map((p) => ({
        ...p,
        assignedTo: jerseyOf(slots, p.id),
        matchesPosition: Boolean(slotPosition) && p.position === slotPosition,
      }))
      .sort((a, b) => {
        if (a.matchesPosition !== b.matchesPosition) return a.matchesPosition ? -1 : 1;
        // Los ya asignados a otro puesto van al fondo: elegirlos es un movimiento.
        const aTaken = a.assignedTo !== undefined;
        const bTaken = b.assignedTo !== undefined;
        if (aTaken !== bTaken) return aTaken ? 1 : -1;
        return a.name.localeCompare(b.name);
      });
  }, [pickingFor, allPlayers, slots, search]);

  const assign = (jersey: number, playerId: string) => {
    setSlots((prev) => {
      const next = { ...prev };
      // Un jugador no puede estar en dos casilleros: se lo mueve, no se lo clona.
      const previousJersey = jerseyOf(next, playerId);
      if (previousJersey !== undefined) delete next[previousJersey];
      next[jersey] = playerId;
      return next;
    });
    setPickingFor(null);
    setSearch("");
  };

  const clearSlot = (jersey: number) => {
    setSlots((prev) => {
      const next = { ...prev };
      delete next[jersey];
      return next;
    });
    setPickingFor(null);
    setSearch("");
  };

  const bringPrevious = async () => {
    if (!sessionId) return;
    setError("");
    try {
      const { data } = await api.get<Suggested>(`/sessions/${sessionId}/lineup/suggested`, {
        params: { team: teamView },
      });
      if (!data.entries.length) {
        setNotice("No hay un partido anterior de esta división con lineup cargado.");
        return;
      }
      const next: Slots = {};
      const dropped: string[] = [];
      data.entries.forEach((e) => {
        if (e.available) next[e.jersey_number] = e.player_id;
        else dropped.push(e.player_name);
      });
      setSlots(next);
      setNotice(
        dropped.length
          ? `Traído de ${data.source_label}. Quedaron afuera por baja o cambio de división: ${dropped.join(", ")}.`
          : `Traído de ${data.source_label}. Revisá y guardá.`
      );
    } catch (err) {
      setError(parseApiError(err, "No se pudo traer el lineup anterior"));
    }
  };

  const save = async () => {
    if (!sessionId) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const entries = Object.entries(slots)
        .filter(([, playerId]) => Boolean(playerId))
        .map(([jersey, playerId]) => ({
          player_id: playerId as string,
          jersey_number: Number(jersey),
          position: positionByJersey(Number(jersey)) || null,
          status: Number(jersey) <= 15 ? "on_field" : "bench",
        }));

      await api.put(`/sessions/${sessionId}/lineup`, { team: teamView, entries });
      setSavedSlots(slots);
      setNotice("Lineup guardado.");
    } catch (err) {
      setError(parseApiError(err, "No se pudo guardar el lineup"));
    } finally {
      setSaving(false);
    }
  };

  const copyToClipboard = async () => {
    const lines = [...STARTER_NUMBERS, ...BENCH_NUMBERS]
      .filter((n) => slots[n])
      .map((n) => `${n}. ${playersById[slots[n]!]?.name ?? "—"}`);
    const header = `${session?.home_team} vs ${session?.away_team}`;
    try {
      await navigator.clipboard.writeText([header, "", ...lines].join("\n"));
      setNotice("Convocatoria copiada — pegala en el grupo.");
    } catch {
      setError("El navegador no dejó copiar al portapapeles.");
    }
  };

  if (loading) {
    return <div className="p-6"><p className="text-gray-400 text-sm">Cargando...</p></div>;
  }

  const renderSlot = (jersey: number) => {
    const playerId = slots[jersey];
    const player = playerId ? playersById[playerId] : undefined;
    const position = positionByJersey(jersey);

    return (
      <button
        key={jersey}
        onClick={() => canEdit && setPickingFor(jersey)}
        disabled={!canEdit}
        className={`pressable-strong flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-left w-full transition-colors duration-150 ${
          player
            ? "bg-gray-800 hover:bg-gray-700/70"
            : "bg-gray-800/40 border border-dashed border-gray-700 hover:border-gray-600"
        } ${canEdit ? "" : "cursor-default"}`}
      >
        <span
          className={`w-7 h-7 shrink-0 rounded-lg grid place-items-center text-xs font-bold tabular-nums ${
            player ? "bg-green-700 text-white" : "bg-gray-700 text-gray-500"
          }`}
        >
          {jersey}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm text-white truncate leading-tight">
            {player?.name ?? <span className="text-gray-600">Vacío</span>}
          </span>
          <span className="block text-[11px] text-gray-500 truncate leading-tight">
            {position || (jersey > 15 ? "Suplente" : "")}
          </span>
        </span>
      </button>
    );
  };

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto pb-32">
      <div className="flex items-center gap-3 mb-4">
        <button
          onClick={() => navigate(-1)}
          className="pressable text-gray-400 hover:text-white text-sm transition-colors duration-150"
        >
          ← Volver
        </button>
        <h1 className="text-base font-bold text-white truncate">
          {session?.home_team} vs {session?.away_team}
        </h1>
      </div>

      <div className="flex gap-1 bg-gray-800/60 p-1 rounded-xl mb-4">
        {(["user", "rival"] as const).map((t) => (
          <button
            key={t}
            onClick={() => switchTeam(t)}
            className={`flex-1 py-2 rounded-lg text-sm font-semibold truncate px-2 transition-colors duration-150 ${
              teamView === t ? "bg-green-700 text-white" : "text-gray-400 hover:text-white"
            }`}
          >
            {t === "user" ? session?.home_team : session?.away_team}
          </button>
        ))}
      </div>

      {canEdit && (
        <div className="flex gap-2 mb-4">
          <button
            onClick={bringPrevious}
            className="pressable flex-1 bg-gray-800 hover:bg-gray-700 text-white text-xs font-semibold py-2.5 rounded-xl transition-colors duration-150"
          >
            Traer última fecha
          </button>
          <button
            onClick={copyToClipboard}
            disabled={filled === 0}
            className="pressable flex-1 bg-gray-800 hover:bg-gray-700 disabled:opacity-40 text-white text-xs font-semibold py-2.5 rounded-xl transition-colors duration-150"
          >
            Copiar convocatoria
          </button>
        </div>
      )}

      {started && isAdmin && (
        <p className="text-xs text-amber-200 bg-amber-950/40 border border-amber-900/50 rounded-lg px-3 py-2 mb-3">
          El partido ya empezó. El lineup queda como está para no perder los cambios
          registrados; corregí desde el tablero si hace falta.
        </p>
      )}

      {notice && (
        <p className="text-xs text-gray-300 bg-gray-800 rounded-lg px-3 py-2 mb-3">{notice}</p>
      )}
      {error && (
        <p className="text-xs text-red-400 bg-red-950/40 rounded-lg px-3 py-2 mb-3">{error}</p>
      )}

      <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Titulares</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 mb-5">
        {STARTER_NUMBERS.map(renderSlot)}
      </div>

      <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Suplentes</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
        {BENCH_NUMBERS.map(renderSlot)}
      </div>

      {/* Picker: hoja desde abajo en mobile, modal centrado en desktop. */}
      {pickingFor !== null && (
        <div
          className="fixed inset-0 bg-black/60 z-50 flex items-end md:items-center justify-center animate-overlay"
          onClick={() => { setPickingFor(null); setSearch(""); }}
        >
          <div
            className="bg-gray-800 rounded-t-2xl md:rounded-2xl w-full md:max-w-sm max-h-[75vh] flex flex-col animate-sheet md:animate-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 pb-3 border-b border-gray-700">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-sm font-semibold text-white">
                    Camiseta {pickingFor}
                  </p>
                  <p className="text-xs text-gray-400">
                    {positionByJersey(pickingFor) || "Suplente"}
                  </p>
                </div>
                {slots[pickingFor] && (
                  <button
                    onClick={() => clearSlot(pickingFor)}
                    className="pressable text-xs text-red-400 hover:text-red-300 px-3 py-1.5 rounded-lg bg-red-950/30 transition-colors duration-150"
                  >
                    Vaciar
                  </button>
                )}
              </div>
              <input
                autoFocus
                type="text"
                placeholder="Buscar jugador..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full bg-gray-700 text-white text-sm rounded-lg px-3 py-2.5 placeholder-gray-400 outline-none focus:ring-2 focus:ring-green-600"
              />
            </div>

            <ul className="overflow-y-auto p-2">
              {pickerPlayers.length === 0 ? (
                <li className="text-gray-500 text-sm p-4 text-center">Sin resultados.</li>
              ) : (
                pickerPlayers.map((p) => (
                  <li key={p.id}>
                    <button
                      onClick={() => assign(pickingFor, p.id)}
                      className="pressable w-full flex items-center gap-2 px-3 py-2.5 rounded-lg hover:bg-gray-700 text-left transition-colors duration-150"
                    >
                      <span className="flex-1 text-sm text-white truncate">{p.name}</span>
                      {p.matchesPosition && (
                        <span className="text-[10px] font-semibold text-green-400 bg-green-950/50 px-1.5 py-0.5 rounded shrink-0">
                          puesto
                        </span>
                      )}
                      {p.assignedTo !== undefined && (
                        <span className="text-[10px] text-amber-400 shrink-0 tabular-nums">
                          #{p.assignedTo}
                        </span>
                      )}
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>
        </div>
      )}

      {/* Guardar fijo: con 23 casilleros el botón al final queda lejísimos. */}
      {canEdit && (
        <div className="fixed bottom-0 inset-x-0 md:left-56 bg-gray-900/95 backdrop-blur border-t border-gray-800 px-4 py-3">
          <div className="max-w-2xl mx-auto flex items-center gap-3">
            <p className="text-xs text-gray-400 flex-1">
              <span className="tabular-nums text-white font-semibold">{filled}</span> de 23
              {dirty && <span className="text-amber-400"> · sin guardar</span>}
            </p>
            <button
              onClick={save}
              disabled={saving || !dirty}
              className="pressable bg-green-700 hover:bg-green-600 disabled:opacity-40 text-white text-sm font-semibold px-6 py-2.5 rounded-xl transition-colors duration-150"
            >
              {saving ? "Guardando..." : "Guardar"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
