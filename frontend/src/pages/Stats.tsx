import { useEffect, useState } from "react";
import ReactECharts from "echarts-for-react";
import api from "../lib/axios";
import { useAuthStore } from "../store/authStore";

// ── Types ─────────────────────────────────────────────────────────────────────

interface RawEvent {
  id: string;
  event_type: string;
  player_id: string | null;
  player_number: number | null;
  team: "home" | "away";
  half: number;
  timer_seconds: number;
  metadata?: Record<string, unknown>;
}

interface LineupEntry {
  player_id: string;
  jersey_number: number;
  player: { name: string };
}

interface SessionInfo {
  id: string;
  home_team: string;
  away_team: string;
  scheduled_at: string | null;
  tournament_name: string;
}

interface LoadedSession extends SessionInfo {
  events: RawEvent[];
  playerNames: Record<string, string>; // player_id → "#N Nombre"
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtTime(s: number) {
  return `${Math.floor(s / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;
}

function obtained(e: RawEvent) {
  return (e.metadata as any)?.obtained === true;
}

const CHART_BG = "transparent";
const TEXT_COLOR = "#9CA3AF";
const GRID_COLOR = "#374151";
const TOOLTIP_STYLE = {
  backgroundColor: "#1F2937",
  borderColor: "#374151",
  textStyle: { color: "#F3F4F6" },
};

function baseOption() {
  return {
    backgroundColor: CHART_BG,
    textStyle: { color: TEXT_COLOR },
    grid: { containLabel: true, left: 16, right: 24, top: 40, bottom: 16 },
    tooltip: { ...TOOLTIP_STYLE },
  };
}

// ── Chart options ─────────────────────────────────────────────────────────────

function cardsOption(events: RawEvent[], playerNames: Record<string, string>) {
  const map: Record<string, { yellow: number; red: number }> = {};
  for (const e of events) {
    if (e.event_type !== "yellow_card" && e.event_type !== "red_card") continue;
    if (!e.player_id) continue;
    if (!map[e.player_id]) map[e.player_id] = { yellow: 0, red: 0 };
    if (e.event_type === "yellow_card") map[e.player_id].yellow++;
    else map[e.player_id].red++;
  }

  const players = Object.keys(map).map((pid) => playerNames[pid] ?? `ID: ${pid.slice(0, 6)}`);
  const yellow = Object.values(map).map((v) => v.yellow);
  const red = Object.values(map).map((v) => v.red);

  if (players.length === 0) return null;

  return {
    ...baseOption(),
    legend: { top: 0, textStyle: { color: TEXT_COLOR }, data: ["Amarillas", "Rojas"] },
    xAxis: { type: "value", splitLine: { lineStyle: { color: GRID_COLOR } }, axisLine: { lineStyle: { color: GRID_COLOR } } },
    yAxis: { type: "category", data: players, axisLine: { lineStyle: { color: GRID_COLOR } }, axisLabel: { color: TEXT_COLOR } },
    series: [
      {
        name: "Amarillas", type: "bar", stack: "cards", data: yellow,
        itemStyle: { color: "#FBBF24" },
        label: { show: true, position: "inside", formatter: (p: any) => p.value > 0 ? p.value : "" },
      },
      {
        name: "Rojas", type: "bar", stack: "cards", data: red,
        itemStyle: { color: "#EF4444" },
        label: { show: true, position: "inside", formatter: (p: any) => p.value > 0 ? p.value : "" },
      },
    ],
  };
}

function penaltiesOption(events: RawEvent[]) {
  // New-style: team indicates who received the penalty
  const homeNew = events.filter((e) => e.event_type === "penalty" && e.team === "home").length;
  const awayNew = events.filter((e) => e.event_type === "penalty" && e.team === "away").length;
  // Legacy compat
  const favor = events.filter((e) => e.event_type === "penalty_won").length + homeNew;
  const contra = events.filter((e) => e.event_type === "penalty_conceded").length + awayNew;

  return {
    ...baseOption(),
    grid: { ...baseOption().grid, top: 16 },
    tooltip: { ...TOOLTIP_STYLE, trigger: "axis", axisPointer: { type: "shadow" } },
    xAxis: { type: "category", data: ["Penales"], axisLabel: { color: TEXT_COLOR }, axisLine: { lineStyle: { color: GRID_COLOR } } },
    yAxis: { type: "value", splitLine: { lineStyle: { color: GRID_COLOR } }, axisLabel: { color: TEXT_COLOR } },
    series: [
      {
        name: "A favor", type: "bar", data: [favor],
        itemStyle: { color: "#4ADE80" },
        label: { show: true, position: "top", color: TEXT_COLOR, formatter: (p: any) => `${p.value} favor` },
      },
      {
        name: "En contra", type: "bar", data: [contra],
        itemStyle: { color: "#EF4444" },
        label: { show: true, position: "top", color: TEXT_COLOR, formatter: (p: any) => `${p.value} contra` },
      },
    ],
    legend: { top: 0, textStyle: { color: TEXT_COLOR }, data: ["A favor", "En contra"] },
  };
}

function setpieceOption(
  title: string,
  favorType: string,
  againstType: string,
  events: RawEvent[],
) {
  const favorWith = events.filter((e) => e.event_type === favorType && obtained(e)).length;
  const favorWithout = events.filter((e) => e.event_type === favorType && !obtained(e)).length;
  const againstWith = events.filter((e) => e.event_type === againstType && obtained(e)).length;
  const againstWithout = events.filter((e) => e.event_type === againstType && !obtained(e)).length;

  const categories = ["Propios", "Ajenos"];

  return {
    ...baseOption(),
    legend: {
      top: 0, textStyle: { color: TEXT_COLOR },
      data: ["Con obtención", "Sin obtención"],
    },
    tooltip: { ...TOOLTIP_STYLE, trigger: "axis", axisPointer: { type: "shadow" } },
    xAxis: { type: "category", data: categories, axisLabel: { color: TEXT_COLOR }, axisLine: { lineStyle: { color: GRID_COLOR } } },
    yAxis: { type: "value", splitLine: { lineStyle: { color: GRID_COLOR } }, axisLabel: { color: TEXT_COLOR } },
    series: [
      {
        name: "Con obtención", type: "bar", stack: title, barMaxWidth: 60,
        data: [favorWith, againstWith],
        itemStyle: { color: "#4ADE80" },
        label: { show: true, position: "inside", formatter: (p: any) => p.value > 0 ? p.value : "" },
      },
      {
        name: "Sin obtención", type: "bar", stack: title, barMaxWidth: 60,
        data: [favorWithout, againstWithout],
        itemStyle: { color: "#F87171" },
        label: { show: true, position: "inside", formatter: (p: any) => p.value > 0 ? p.value : "" },
      },
    ],
  };
}

const TIMELINE_CATEGORIES = [
  "Tackles", "Lines", "Scrums", "Penales", "Tarjetas", "Posesión", "Cambios",
] as const;

type TimelineCat = typeof TIMELINE_CATEGORIES[number];

const EVENT_CATEGORY: Record<string, TimelineCat> = {
  tackle_effective: "Tackles", tackle_missed: "Tackles",
  lineout_favor: "Lines", lineout_against: "Lines",
  scrum_favor: "Scrums", scrum_against: "Scrums",
  try: "Penales", penalty: "Penales",
  penalty_conceded: "Penales", penalty_won: "Penales",
  yellow_card: "Tarjetas", red_card: "Tarjetas",
  turnover_conceded: "Posesión", turnover_won: "Posesión",
  knock_on: "Posesión", forward_pass: "Posesión", lost_in_contact: "Posesión",
  substitution: "Cambios",
};

const EVENT_LABEL: Record<string, string> = {
  tackle_effective: "Tackle efectivo", tackle_missed: "Tackle errado",
  lineout_favor: "Line a favor", lineout_against: "Line en contra",
  scrum_favor: "Scrum a favor", scrum_against: "Scrum en contra",
  try: "Try", penalty: "Penal",
  penalty_conceded: "Penal cometido", penalty_won: "Penal ganado",
  yellow_card: "Tarjeta amarilla", red_card: "Tarjeta roja",
  turnover_conceded: "Turnover perdido", turnover_won: "Turnover ganado",
  knock_on: "Knock-on", forward_pass: "Forward", lost_in_contact: "Perdida en contacto",
  substitution: "Cambio",
};

function timelineOption(session: LoadedSession) {
  const dataByHalf = [1, 2].map((half) => {
    const evs = session.events.filter((e) => e.half === half && EVENT_CATEGORY[e.event_type]);
    return evs.map((e) => ({
      value: [e.timer_seconds, TIMELINE_CATEGORIES.indexOf(EVENT_CATEGORY[e.event_type] ?? "Penales")],
      eventType: e.event_type,
      team: e.team,
      player: e.player_id ? (session.playerNames[e.player_id] ?? "") : "",
      half,
    }));
  });

  const allData = dataByHalf.flat();
  const homeData = allData.filter((d) => d.team === "home");
  const awayData = allData.filter((d) => d.team === "away");

  const maxSeconds = Math.max(...session.events.map((e) => e.timer_seconds), 40 * 60);
  const halftimeSeconds = Math.max(...session.events.filter((e) => e.half === 1).map((e) => e.timer_seconds), 0);

  return {
    ...baseOption(),
    grid: { containLabel: true, left: 16, right: 24, top: 48, bottom: 32 },
    legend: {
      top: 0, textStyle: { color: TEXT_COLOR },
      data: [`${session.home_team} (local)`, `${session.away_team} (visitante)`],
    },
    tooltip: {
      ...TOOLTIP_STYLE,
      trigger: "item",
      formatter: (params: any) => {
        const d = params.data;
        return `<b>${EVENT_LABEL[d.eventType] ?? d.eventType}</b><br/>T${d.half} ${fmtTime(d.value[0])}${d.player ? `<br/>${d.player}` : ""}`;
      },
    },
    xAxis: {
      type: "value",
      name: "Tiempo",
      nameTextStyle: { color: TEXT_COLOR },
      min: 0,
      max: maxSeconds + 60,
      axisLabel: { color: TEXT_COLOR, formatter: (v: number) => fmtTime(v) },
      splitLine: { lineStyle: { color: GRID_COLOR } },
      axisLine: { lineStyle: { color: GRID_COLOR } },
    },
    yAxis: {
      type: "category",
      data: [...TIMELINE_CATEGORIES],
      axisLabel: { color: TEXT_COLOR },
      axisLine: { lineStyle: { color: GRID_COLOR } },
    },
    series: [
      {
        name: `${session.home_team} (local)`,
        type: "scatter",
        symbolSize: 10,
        itemStyle: { color: "#60A5FA" },
        data: homeData.map((d) => ({ value: d.value, eventType: d.eventType, team: d.team, player: d.player, half: d.half })),
      },
      {
        name: `${session.away_team} (visitante)`,
        type: "scatter",
        symbolSize: 10,
        symbol: "triangle",
        itemStyle: { color: "#FB923C" },
        data: awayData.map((d) => ({ value: d.value, eventType: d.eventType, team: d.team, player: d.player, half: d.half })),
      },
    ],
    ...(halftimeSeconds > 0 ? {
      visualMap: undefined,
      graphic: [{
        type: "line",
        shape: { x1: 0, y1: 0, x2: 0, y2: 0 },
      }],
    } : {}),
    markLine: {
      data: halftimeSeconds > 0 ? [{ xAxis: halftimeSeconds, name: "HT", label: { formatter: "HT", color: TEXT_COLOR } }] : [],
    },
  };
}

// ── Section wrapper ───────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-gray-800 rounded-xl p-4 mb-4">
      <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-3">{title}</p>
      {children}
    </div>
  );
}

function Empty({ msg }: { msg: string }) {
  return <p className="text-gray-600 text-sm py-4 text-center">{msg}</p>;
}

// ── Main component ────────────────────────────────────────────────────────────

export default function Stats() {
  const user = useAuthStore((s) => s.user);

  const [sessions, setSessions] = useState<LoadedSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string>("all");

  useEffect(() => {
    const clubId = user?.club_id;
    if (!clubId) { setLoading(false); return; }

    (async () => {
      try {
        const { data: tournaments } = await api.get<{ id: string; name: string; season: string | null }[]>(
          `/clubs/${clubId}/tournaments`
        );

        const sessionGroups = await Promise.all(
          tournaments.map((t) =>
            api.get<{ id: string; home_team: string; away_team: string; scheduled_at: string | null }[]>(
              `/tournaments/${t.id}/sessions`
            ).then(({ data }) =>
              data.map((s) => ({ ...s, tournament_name: `${t.name}${t.season ? ` ${t.season}` : ""}` }))
            ).catch(() => [])
          )
        );
        const flatSessions = sessionGroups.flat();

        const loaded = await Promise.all(
          flatSessions.map(async (s) => {
            const [evRes, luRes] = await Promise.all([
              api.get<RawEvent[]>(`/sessions/${s.id}/events`).then((r) => r.data).catch(() => []),
              api.get<LineupEntry[]>(`/sessions/${s.id}/lineup`).then((r) => r.data).catch(() => []),
            ]);
            const playerNames: Record<string, string> = {};
            for (const e of luRes) {
              playerNames[e.player_id] = `#${e.jersey_number} ${e.player.name}`;
            }
            return { ...s, events: evRes, playerNames } as LoadedSession;
          })
        );

        setSessions(loaded);
      } catch {
        setLoadError("Error al cargar estadísticas. Revisá la conexión e intentá de nuevo.");
      } finally {
        setLoading(false);
      }
    })();
  }, [user?.club_id]);

  const filtered = selectedId === "all" ? sessions : sessions.filter((s) => s.id === selectedId);
  const allEvents = filtered.flatMap((s) => s.events);
  const allNames = Object.assign({}, ...filtered.map((s) => s.playerNames));
  const selectedSession = sessions.find((s) => s.id === selectedId);

  const cardsOpt = cardsOption(allEvents, allNames);
  const penaltiesOpt = penaltiesOption(allEvents);
  const scrumsOpt = setpieceOption("Scrums", "scrum_favor", "scrum_against", allEvents);
  const linesOpt = setpieceOption("Lines", "lineout_favor", "lineout_against", allEvents);
  const timelineOpt = selectedSession ? timelineOption(selectedSession) : null;

  const chartStyle = { height: "260px" };

  return (
    <div className="p-4 max-w-3xl">
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-xl font-bold text-white">Estadísticas</h1>
        <select
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          className="bg-gray-700 text-white text-sm rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-green-600"
        >
          <option value="all">Todos los partidos</option>
          {sessions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.home_team} vs {s.away_team}
              {s.scheduled_at ? ` · ${new Date(s.scheduled_at).toLocaleDateString("es-AR", { day: "numeric", month: "short" })}` : ""}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <p className="text-gray-400 text-sm">Cargando estadísticas...</p>
      ) : loadError ? (
        <p className="text-red-400 text-sm">{loadError}</p>
      ) : sessions.length === 0 ? (
        <p className="text-gray-500 text-sm">No hay partidos con datos todavía.</p>
      ) : (
        <>
          {/* Cards per player */}
          <Section title="Tarjetas por jugador">
            {cardsOpt
              ? <ReactECharts option={cardsOpt} style={chartStyle} />
              : <Empty msg="Sin tarjetas registradas con jugador asociado." />}
          </Section>

          {/* Penalties */}
          <Section title="Penales">
            <ReactECharts option={penaltiesOpt} style={chartStyle} />
          </Section>

          {/* Scrums */}
          <Section title="Scrums — propios vs ajenos (con/sin obtención)">
            {(allEvents.some((e) => e.event_type === "scrum_favor" || e.event_type === "scrum_against"))
              ? <ReactECharts option={scrumsOpt} style={chartStyle} />
              : <Empty msg="Sin scrums registrados." />}
          </Section>

          {/* Lines */}
          <Section title="Line-outs — propios vs ajenos (con/sin obtención)">
            {(allEvents.some((e) => e.event_type === "lineout_favor" || e.event_type === "lineout_against"))
              ? <ReactECharts option={linesOpt} style={chartStyle} />
              : <Empty msg="Sin line-outs registrados." />}
          </Section>

          {/* Timeline — only for specific session */}
          {selectedSession && timelineOpt && (
            <Section title={`Línea de tiempo — ${selectedSession.home_team} vs ${selectedSession.away_team}`}>
              {selectedSession.events.length === 0
                ? <Empty msg="Sin eventos en este partido." />
                : <ReactECharts option={timelineOpt} style={{ height: "340px" }} />}
            </Section>
          )}

          {selectedId === "all" && (
            <p className="text-gray-600 text-xs text-center mt-2">
              Seleccioná un partido para ver la línea de tiempo
            </p>
          )}
        </>
      )}
    </div>
  );
}
