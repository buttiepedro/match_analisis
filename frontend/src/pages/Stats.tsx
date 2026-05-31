import { useEffect, useState } from "react";
import ReactECharts from "echarts-for-react";
import api from "../lib/axios";
import { useAuthStore } from "../store/authStore";

// ── Types ──────────────────────────────────────────────────────────────────────

interface RawEvent {
  id: string;
  event_type: string;
  player_id: string | null;
  player_number: number | null;
  team: "home" | "away";
  half: number;
  timer_seconds: number;
  reason?: string | null;
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
  playerNames: Record<string, string>;
}

interface TeamScore {
  tries: number;
  conversions: number;
  penaltyKicks: number;
  drops: number;
  total: number;
}

type CatFilter = "all" | "points" | "game" | "errors" | "discipline";

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtTime(s: number) {
  return `${Math.floor(s / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;
}

function obtained(e: RawEvent) {
  return e.metadata?.obtained === true;
}

function calcTeamScore(events: RawEvent[], team: "home" | "away"): TeamScore {
  let tries = 0, conversions = 0, penaltyKicks = 0, drops = 0;
  for (const e of events.filter((ev) => ev.team === team)) {
    if (e.event_type === "try") {
      tries++;
      if (e.metadata?.converted === true) conversions++;
    }
    if (e.event_type === "penalty" && e.reason === "a_los_palos" && e.metadata?.converted === true) {
      penaltyKicks++;
    }
    if (e.event_type === "drop") drops++;
  }
  return {
    tries,
    conversions,
    penaltyKicks,
    drops,
    total: tries * 5 + conversions * 2 + penaltyKicks * 3 + drops * 3,
  };
}

// ── Chart constants ────────────────────────────────────────────────────────────

const TEXT_COLOR = "#9CA3AF";
const GRID_COLOR = "#374151";
const TOOLTIP_STYLE = {
  backgroundColor: "#1F2937",
  borderColor: "#374151",
  textStyle: { color: "#F3F4F6" },
};
const HOME_COLOR = "#60A5FA";
const AWAY_COLOR = "#FB923C";

function baseOption() {
  return {
    backgroundColor: "transparent",
    textStyle: { color: TEXT_COLOR },
    grid: { containLabel: true, left: 16, right: 24, top: 40, bottom: 16 },
    tooltip: { ...TOOLTIP_STYLE },
  };
}

function barLabel() {
  return { show: true, position: "inside" as const, formatter: (p: any) => p.value > 0 ? String(p.value) : "" };
}

// ── Chart functions ────────────────────────────────────────────────────────────

function triesOption(events: RawEvent[], homeName: string, awayName: string) {
  const hConv   = events.filter(e => e.event_type === "try" && e.team === "home" && e.metadata?.converted === true).length;
  const hNoConv = events.filter(e => e.event_type === "try" && e.team === "home" && e.metadata?.converted !== true).length;
  const aConv   = events.filter(e => e.event_type === "try" && e.team === "away" && e.metadata?.converted === true).length;
  const aNoConv = events.filter(e => e.event_type === "try" && e.team === "away" && e.metadata?.converted !== true).length;

  if (hConv + hNoConv + aConv + aNoConv === 0) return null;

  return {
    ...baseOption(),
    legend: { top: 0, textStyle: { color: TEXT_COLOR }, data: ["Convertidos", "No convertidos"] },
    tooltip: { ...TOOLTIP_STYLE, trigger: "axis", axisPointer: { type: "shadow" } },
    xAxis: { type: "value", splitLine: { lineStyle: { color: GRID_COLOR } } },
    yAxis: {
      type: "category",
      data: [awayName, homeName],
      axisLabel: { color: TEXT_COLOR },
      axisLine: { lineStyle: { color: GRID_COLOR } },
    },
    series: [
      {
        name: "Convertidos", type: "bar", stack: "tries", barMaxWidth: 50,
        data: [aConv, hConv],
        itemStyle: { color: "#4ADE80" },
        label: barLabel(),
      },
      {
        name: "No convertidos", type: "bar", stack: "tries", barMaxWidth: 50,
        data: [aNoConv, hNoConv],
        itemStyle: { color: "#6B7280" },
        label: barLabel(),
      },
    ],
  };
}

function penaltyBreakdownOption(events: RawEvent[], homeName: string, awayName: string) {
  const reasons = ["line", "scrum", "juega", "a_los_palos"] as const;
  const reasonLabels = ["Line", "Scrum", "Juega", "A los palos"];

  const homeData = reasons.map(r =>
    events.filter(e => e.event_type === "penalty" && e.team === "home" && e.reason === r).length
  );
  const awayData = reasons.map(r =>
    events.filter(e => e.event_type === "penalty" && e.team === "away" && e.reason === r).length
  );
  const hConv = events.filter(e =>
    e.event_type === "penalty" && e.team === "home" && e.reason === "a_los_palos" && e.metadata?.converted === true
  ).length;
  const aConv = events.filter(e =>
    e.event_type === "penalty" && e.team === "away" && e.reason === "a_los_palos" && e.metadata?.converted === true
  ).length;

  if (homeData.every(v => v === 0) && awayData.every(v => v === 0)) return null;

  return {
    ...baseOption(),
    legend: { top: 0, textStyle: { color: TEXT_COLOR }, data: [homeName, awayName] },
    tooltip: {
      ...TOOLTIP_STYLE,
      trigger: "axis",
      axisPointer: { type: "shadow" },
      formatter: (params: any) => {
        const cat: string = params[0]?.axisValue ?? "";
        let html = `<b>${cat}</b><br/>`;
        for (const p of params) {
          html += `${p.marker}${p.seriesName}: ${p.value}`;
          if (cat === "A los palos" && p.value > 0) {
            const conv = p.seriesName === homeName ? hConv : aConv;
            html += ` (${conv} conv.)`;
          }
          html += "<br/>";
        }
        return html;
      },
    },
    xAxis: { type: "value", splitLine: { lineStyle: { color: GRID_COLOR } } },
    yAxis: {
      type: "category",
      data: reasonLabels,
      axisLabel: { color: TEXT_COLOR },
      axisLine: { lineStyle: { color: GRID_COLOR } },
    },
    series: [
      {
        name: homeName, type: "bar", barMaxWidth: 50,
        data: homeData,
        itemStyle: { color: HOME_COLOR },
        label: barLabel(),
      },
      {
        name: awayName, type: "bar", barMaxWidth: 50,
        data: awayData,
        itemStyle: { color: AWAY_COLOR },
        label: barLabel(),
      },
    ],
  };
}

function dropsOption(events: RawEvent[], homeName: string, awayName: string) {
  const hDrops = events.filter(e => e.event_type === "drop" && e.team === "home").length;
  const aDrops = events.filter(e => e.event_type === "drop" && e.team === "away").length;
  if (hDrops + aDrops === 0) return null;

  return {
    ...baseOption(),
    grid: { containLabel: true, left: 16, right: 24, top: 16, bottom: 16 },
    tooltip: { ...TOOLTIP_STYLE, trigger: "axis", axisPointer: { type: "shadow" } },
    xAxis: { type: "value", splitLine: { lineStyle: { color: GRID_COLOR } } },
    yAxis: {
      type: "category",
      data: [awayName, homeName],
      axisLabel: { color: TEXT_COLOR },
      axisLine: { lineStyle: { color: GRID_COLOR } },
    },
    series: [{
      name: "Drops", type: "bar", barMaxWidth: 50,
      data: [aDrops, hDrops],
      itemStyle: { color: "#A78BFA" },
      label: barLabel(),
    }],
  };
}

function errorsOption(events: RawEvent[], homeName: string, awayName: string) {
  const errorTypes = ["knock_on", "forward_pass", "lost_in_contact"] as const;
  const errorLabels = ["Knock-on", "Forward", "Perdida en contacto"];

  const homeData = errorTypes.map(t => events.filter(e => e.event_type === t && e.team === "home").length);
  const awayData = errorTypes.map(t => events.filter(e => e.event_type === t && e.team === "away").length);

  if (homeData.every(v => v === 0) && awayData.every(v => v === 0)) return null;

  return {
    ...baseOption(),
    legend: { top: 0, textStyle: { color: TEXT_COLOR }, data: [homeName, awayName] },
    tooltip: { ...TOOLTIP_STYLE, trigger: "axis", axisPointer: { type: "shadow" } },
    xAxis: { type: "value", splitLine: { lineStyle: { color: GRID_COLOR } } },
    yAxis: {
      type: "category",
      data: errorLabels,
      axisLabel: { color: TEXT_COLOR },
      axisLine: { lineStyle: { color: GRID_COLOR } },
    },
    series: [
      {
        name: homeName, type: "bar", barMaxWidth: 50,
        data: homeData,
        itemStyle: { color: HOME_COLOR },
        label: barLabel(),
      },
      {
        name: awayName, type: "bar", barMaxWidth: 50,
        data: awayData,
        itemStyle: { color: AWAY_COLOR },
        label: barLabel(),
      },
    ],
  };
}

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
        name: "Amarillas", type: "bar", stack: "cards",
        data: yellow,
        itemStyle: { color: "#FBBF24" },
        label: barLabel(),
      },
      {
        name: "Rojas", type: "bar", stack: "cards",
        data: red,
        itemStyle: { color: "#EF4444" },
        label: barLabel(),
      },
    ],
  };
}

function setpieceOption(title: string, favorType: string, againstType: string, events: RawEvent[]) {
  const favorWith    = events.filter((e) => e.event_type === favorType && obtained(e)).length;
  const favorWithout = events.filter((e) => e.event_type === favorType && !obtained(e)).length;
  const againstWith  = events.filter((e) => e.event_type === againstType && obtained(e)).length;
  const againstWithout = events.filter((e) => e.event_type === againstType && !obtained(e)).length;

  return {
    ...baseOption(),
    legend: { top: 0, textStyle: { color: TEXT_COLOR }, data: ["Con obtención", "Sin obtención"] },
    tooltip: { ...TOOLTIP_STYLE, trigger: "axis", axisPointer: { type: "shadow" } },
    xAxis: {
      type: "category",
      data: ["Propios", "Ajenos"],
      axisLabel: { color: TEXT_COLOR },
      axisLine: { lineStyle: { color: GRID_COLOR } },
    },
    yAxis: { type: "value", splitLine: { lineStyle: { color: GRID_COLOR } }, axisLabel: { color: TEXT_COLOR } },
    series: [
      {
        name: "Con obtención", type: "bar", stack: title, barMaxWidth: 60,
        data: [favorWith, againstWith],
        itemStyle: { color: "#4ADE80" },
        label: barLabel(),
      },
      {
        name: "Sin obtención", type: "bar", stack: title, barMaxWidth: 60,
        data: [favorWithout, againstWithout],
        itemStyle: { color: "#F87171" },
        label: barLabel(),
      },
    ],
  };
}

const TIMELINE_CATEGORIES = [
  "Tackles", "Lines", "Scrums", "Puntos", "Tarjetas", "Posesión", "Cambios",
] as const;

type TimelineCat = typeof TIMELINE_CATEGORIES[number];

const EVENT_CATEGORY: Record<string, TimelineCat> = {
  tackle_effective: "Tackles", tackle_missed: "Tackles",
  lineout_favor: "Lines", lineout_against: "Lines",
  scrum_favor: "Scrums", scrum_against: "Scrums",
  try: "Puntos", penalty: "Puntos", drop: "Puntos",
  penalty_conceded: "Puntos", penalty_won: "Puntos",
  yellow_card: "Tarjetas", red_card: "Tarjetas",
  turnover_conceded: "Posesión", turnover_won: "Posesión",
  knock_on: "Posesión", forward_pass: "Posesión", lost_in_contact: "Posesión",
  substitution: "Cambios",
};

const EVENT_LABEL: Record<string, string> = {
  tackle_effective: "Tackle efectivo", tackle_missed: "Tackle errado",
  lineout_favor: "Line a favor", lineout_against: "Line en contra",
  scrum_favor: "Scrum a favor", scrum_against: "Scrum en contra",
  try: "Try", penalty: "Penal", drop: "Drop",
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
      value: [e.timer_seconds, TIMELINE_CATEGORIES.indexOf(EVENT_CATEGORY[e.event_type] ?? "Puntos")],
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
        itemStyle: { color: HOME_COLOR },
        data: homeData.map((d) => ({ value: d.value, eventType: d.eventType, team: d.team, player: d.player, half: d.half })),
      },
      {
        name: `${session.away_team} (visitante)`,
        type: "scatter",
        symbolSize: 10,
        symbol: "triangle",
        itemStyle: { color: AWAY_COLOR },
        data: awayData.map((d) => ({ value: d.value, eventType: d.eventType, team: d.team, player: d.player, half: d.half })),
      },
    ],
  };
}

// ── UI helpers ─────────────────────────────────────────────────────────────────

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

function PillGroup<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { label: string; value: T }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
            value === o.value
              ? "bg-green-600 text-white"
              : "bg-gray-700 text-gray-400 active:text-white"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function ScoreSummary({
  events,
  homeName,
  awayName,
}: {
  events: RawEvent[];
  homeName: string;
  awayName: string;
}) {
  const home = calcTeamScore(events, "home");
  const away = calcTeamScore(events, "away");

  const rows = [
    { label: "Tries (×5)", hVal: home.tries, aVal: away.tries },
    { label: "Conversiones (×2)", hVal: home.conversions, aVal: away.conversions },
    { label: "Penales a palos (×3)", hVal: home.penaltyKicks, aVal: away.penaltyKicks },
    { label: "Drops (×3)", hVal: home.drops, aVal: away.drops },
  ];

  return (
    <div className="bg-gray-800 rounded-xl overflow-hidden mb-4">
      <div className="grid grid-cols-2 divide-x divide-gray-700">
        <div className="px-4 py-4 text-center">
          <p className="text-blue-400 text-xs font-semibold truncate">{homeName}</p>
          <p className="text-white text-5xl font-bold mt-1">{home.total}</p>
          <p className="text-gray-500 text-xs mt-0.5">pts</p>
        </div>
        <div className="px-4 py-4 text-center">
          <p className="text-orange-400 text-xs font-semibold truncate">{awayName}</p>
          <p className="text-white text-5xl font-bold mt-1">{away.total}</p>
          <p className="text-gray-500 text-xs mt-0.5">pts</p>
        </div>
      </div>
      <div className="border-t border-gray-700 px-4 pb-3 pt-2">
        <div className="grid grid-cols-3 text-xs text-gray-500 pb-1 mb-1 border-b border-gray-700/50">
          <span />
          <span className="text-center text-blue-400 font-semibold">Local</span>
          <span className="text-center text-orange-400 font-semibold">Visitante</span>
        </div>
        {rows.map((r) => (
          <div key={r.label} className="grid grid-cols-3 text-xs py-1">
            <span className="text-gray-400">{r.label}</span>
            <span className={`text-center font-semibold ${r.hVal > 0 ? "text-white" : "text-gray-600"}`}>{r.hVal}</span>
            <span className={`text-center font-semibold ${r.aVal > 0 ? "text-white" : "text-gray-600"}`}>{r.aVal}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

const CAT_OPTIONS: { label: string; value: CatFilter }[] = [
  { value: "all",        label: "Todos" },
  { value: "points",     label: "Puntos" },
  { value: "game",       label: "Juego" },
  { value: "errors",     label: "Errores" },
  { value: "discipline", label: "Disciplina" },
];

export default function Stats() {
  const user = useAuthStore((s) => s.user);

  const [sessions, setSessions]     = useState<LoadedSession[]>([]);
  const [loading, setLoading]       = useState(true);
  const [loadError, setLoadError]   = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string>("all");
  const [catFilter, setCatFilter]   = useState<CatFilter>("all");

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

  const filteredSessions = selectedId === "all" ? sessions : sessions.filter((s) => s.id === selectedId);
  const allEvents        = filteredSessions.flatMap((s) => s.events);
  const allNames         = Object.assign({}, ...filteredSessions.map((s) => s.playerNames));
  const selectedSession  = sessions.find((s) => s.id === selectedId);
  const homeName         = selectedSession?.home_team ?? "Local";
  const awayName         = selectedSession?.away_team ?? "Visitante";

  const showPoints = catFilter === "all" || catFilter === "points";
  const showGame   = catFilter === "all" || catFilter === "game";
  const showErrors = catFilter === "all" || catFilter === "errors";
  const showDisc   = catFilter === "all" || catFilter === "discipline";

  const triesOpt   = triesOption(allEvents, homeName, awayName);
  const penaltyOpt = penaltyBreakdownOption(allEvents, homeName, awayName);
  const dropsOpt   = dropsOption(allEvents, homeName, awayName);
  const errorsOpt  = errorsOption(allEvents, homeName, awayName);
  const cardsOpt   = cardsOption(allEvents, allNames);
  const scrumOpt   = setpieceOption("Scrums", "scrum_favor", "scrum_against", allEvents);
  const linesOpt   = setpieceOption("Lines", "lineout_favor", "lineout_against", allEvents);
  const timelineOpt = selectedSession ? timelineOption(selectedSession) : null;

  const chartStyle = { height: "220px" };

  return (
    <div className="p-4 max-w-3xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
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
              {s.scheduled_at
                ? ` · ${new Date(s.scheduled_at).toLocaleDateString("es-AR", { day: "numeric", month: "short" })}`
                : ""}
            </option>
          ))}
        </select>
      </div>

      {/* Category filter */}
      <div className="mb-5">
        <PillGroup options={CAT_OPTIONS} value={catFilter} onChange={setCatFilter} />
      </div>

      {loading ? (
        <p className="text-gray-400 text-sm">Cargando estadísticas...</p>
      ) : loadError ? (
        <p className="text-red-400 text-sm">{loadError}</p>
      ) : sessions.length === 0 ? (
        <p className="text-gray-500 text-sm">No hay partidos con datos todavía.</p>
      ) : (
        <>
          {/* ── Puntos ──────────────────────────────────────────────────── */}
          {showPoints && (
            <>
              <ScoreSummary events={allEvents} homeName={homeName} awayName={awayName} />

              <Section title="Tries">
                {triesOpt
                  ? <ReactECharts option={triesOpt} style={chartStyle} />
                  : <Empty msg="Sin tries registrados." />}
              </Section>

              <Section title="Penales — por destino">
                {penaltyOpt
                  ? <ReactECharts option={penaltyOpt} style={chartStyle} />
                  : <Empty msg="Sin penales registrados." />}
              </Section>

              {dropsOpt && (
                <Section title="Drops">
                  <ReactECharts option={dropsOpt} style={{ height: "120px" }} />
                </Section>
              )}
            </>
          )}

          {/* ── Juego ───────────────────────────────────────────────────── */}
          {showGame && (
            <>
              <Section title="Line-outs — propios vs ajenos (con/sin obtención)">
                {allEvents.some(e => e.event_type === "lineout_favor" || e.event_type === "lineout_against")
                  ? <ReactECharts option={linesOpt} style={chartStyle} />
                  : <Empty msg="Sin line-outs registrados." />}
              </Section>

              <Section title="Scrums — propios vs ajenos (con/sin obtención)">
                {allEvents.some(e => e.event_type === "scrum_favor" || e.event_type === "scrum_against")
                  ? <ReactECharts option={scrumOpt} style={chartStyle} />
                  : <Empty msg="Sin scrums registrados." />}
              </Section>
            </>
          )}

          {/* ── Errores ─────────────────────────────────────────────────── */}
          {showErrors && (
            <Section title="Errores">
              {errorsOpt
                ? <ReactECharts option={errorsOpt} style={chartStyle} />
                : <Empty msg="Sin errores registrados." />}
            </Section>
          )}

          {/* ── Disciplina ──────────────────────────────────────────────── */}
          {showDisc && (
            <Section title="Tarjetas por jugador">
              {cardsOpt
                ? <ReactECharts option={cardsOpt} style={chartStyle} />
                : <Empty msg="Sin tarjetas con jugador asociado." />}
            </Section>
          )}

          {/* ── Timeline (solo "Todos", partido específico) ─────────────── */}
          {catFilter === "all" && selectedSession && timelineOpt && (
            <Section title={`Línea de tiempo — ${selectedSession.home_team} vs ${selectedSession.away_team}`}>
              {selectedSession.events.length === 0
                ? <Empty msg="Sin eventos en este partido." />
                : <ReactECharts option={timelineOpt} style={{ height: "340px" }} />}
            </Section>
          )}
          {catFilter === "all" && selectedId === "all" && (
            <p className="text-gray-600 text-xs text-center mt-2">
              Seleccioná un partido para ver la línea de tiempo
            </p>
          )}
        </>
      )}
    </div>
  );
}
