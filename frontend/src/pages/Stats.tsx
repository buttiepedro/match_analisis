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
  team: "user" | "rival";
  half: number;
  timer_seconds: number;
  reason?: string | null;
  metadata?: Record<string, unknown>;
}

interface NormalizedEvent extends RawEvent {
  isUserClub: boolean;
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
  division: { id: string; name: string };
}

interface LoadedSession extends SessionInfo {
  events: RawEvent[];
  playerNames: Record<string, string>;
  userTeam: "user" | "rival";
}

interface TeamScore {
  tries: number;
  conversions: number;
  penaltyKicks: number;
  drops: number;
  total: number;
}

type CatFilter = "all" | "points" | "game" | "errors" | "discipline" | "objectives";

interface Objectives {
  lines: number;
  scrums: number;
  exits: number;
  tackles: number;
}

const OBJECTIVES_KEY = "match_analisis_objectives";
const DEFAULT_OBJECTIVES: Objectives = { lines: 80, scrums: 80, exits: 75, tackles: 85 };

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtTime(s: number) {
  return `${Math.floor(s / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;
}

function obtained(e: RawEvent) {
  return e.metadata?.obtained === true;
}

function calcTeamScore(events: NormalizedEvent[]): TeamScore {
  let tries = 0, conversions = 0, penaltyKicks = 0, drops = 0;
  for (const e of events) {
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
const CLUB_COLOR = "#60A5FA";
const RIVAL_COLOR = "#FB923C";

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

function triesOption(events: NormalizedEvent[], clubName: string, rivalName: string) {
  const cConv   = events.filter(e => e.isUserClub && e.event_type === "try" && e.metadata?.converted === true).length;
  const cNoConv = events.filter(e => e.isUserClub && e.event_type === "try" && e.metadata?.converted !== true).length;
  const rConv   = events.filter(e => !e.isUserClub && e.event_type === "try" && e.metadata?.converted === true).length;
  const rNoConv = events.filter(e => !e.isUserClub && e.event_type === "try" && e.metadata?.converted !== true).length;

  if (cConv + cNoConv + rConv + rNoConv === 0) return null;

  return {
    ...baseOption(),
    legend: { top: 0, textStyle: { color: TEXT_COLOR }, data: ["Convertidos", "No convertidos"] },
    tooltip: { ...TOOLTIP_STYLE, trigger: "axis", axisPointer: { type: "shadow" } },
    xAxis: { type: "value", splitLine: { lineStyle: { color: GRID_COLOR } } },
    yAxis: {
      type: "category",
      data: [rivalName, clubName],
      axisLabel: { color: TEXT_COLOR },
      axisLine: { lineStyle: { color: GRID_COLOR } },
    },
    series: [
      {
        name: "Convertidos", type: "bar", stack: "tries", barMaxWidth: 50,
        data: [rConv, cConv],
        itemStyle: { color: "#4ADE80" },
        label: barLabel(),
      },
      {
        name: "No convertidos", type: "bar", stack: "tries", barMaxWidth: 50,
        data: [rNoConv, cNoConv],
        itemStyle: { color: "#6B7280" },
        label: barLabel(),
      },
    ],
  };
}

function penaltyBreakdownOption(events: NormalizedEvent[], clubName: string, rivalName: string) {
  const reasons = ["line", "scrum", "juega", "a_los_palos"] as const;
  const reasonLabels = ["Line", "Scrum", "Juega", "A los palos"];

  const clubData  = reasons.map(r => events.filter(e => e.isUserClub  && e.event_type === "penalty" && e.reason === r).length);
  const rivalData = reasons.map(r => events.filter(e => !e.isUserClub && e.event_type === "penalty" && e.reason === r).length);
  const cConv = events.filter(e => e.isUserClub  && e.event_type === "penalty" && e.reason === "a_los_palos" && e.metadata?.converted === true).length;
  const rConv = events.filter(e => !e.isUserClub && e.event_type === "penalty" && e.reason === "a_los_palos" && e.metadata?.converted === true).length;

  if (clubData.every(v => v === 0) && rivalData.every(v => v === 0)) return null;

  return {
    ...baseOption(),
    legend: { top: 0, textStyle: { color: TEXT_COLOR }, data: [clubName, rivalName] },
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
            const conv = p.seriesName === clubName ? cConv : rConv;
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
        name: clubName, type: "bar", barMaxWidth: 50,
        data: clubData,
        itemStyle: { color: CLUB_COLOR },
        label: barLabel(),
      },
      {
        name: rivalName, type: "bar", barMaxWidth: 50,
        data: rivalData,
        itemStyle: { color: RIVAL_COLOR },
        label: barLabel(),
      },
    ],
  };
}

function dropsOption(events: NormalizedEvent[], clubName: string, rivalName: string) {
  const clubDrops  = events.filter(e => e.isUserClub  && e.event_type === "drop").length;
  const rivalDrops = events.filter(e => !e.isUserClub && e.event_type === "drop").length;
  if (clubDrops + rivalDrops === 0) return null;

  return {
    ...baseOption(),
    grid: { containLabel: true, left: 16, right: 24, top: 16, bottom: 16 },
    tooltip: { ...TOOLTIP_STYLE, trigger: "axis", axisPointer: { type: "shadow" } },
    xAxis: { type: "value", splitLine: { lineStyle: { color: GRID_COLOR } } },
    yAxis: {
      type: "category",
      data: [rivalName, clubName],
      axisLabel: { color: TEXT_COLOR },
      axisLine: { lineStyle: { color: GRID_COLOR } },
    },
    series: [{
      name: "Drops", type: "bar", barMaxWidth: 50,
      data: [rivalDrops, clubDrops],
      itemStyle: { color: "#A78BFA" },
      label: barLabel(),
    }],
  };
}

function errorsOption(events: NormalizedEvent[], clubName: string, rivalName: string) {
  const errorTypes = ["knock_on", "forward_pass", "lost_in_contact"] as const;
  const errorLabels = ["Knock-on", "Forward", "Perdida en contacto"];

  const clubData  = errorTypes.map(t => events.filter(e => e.isUserClub  && e.event_type === t).length);
  const rivalData = errorTypes.map(t => events.filter(e => !e.isUserClub && e.event_type === t).length);

  if (clubData.every(v => v === 0) && rivalData.every(v => v === 0)) return null;

  return {
    ...baseOption(),
    legend: { top: 0, textStyle: { color: TEXT_COLOR }, data: [clubName, rivalName] },
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
        name: clubName, type: "bar", barMaxWidth: 50,
        data: clubData,
        itemStyle: { color: CLUB_COLOR },
        label: barLabel(),
      },
      {
        name: rivalName, type: "bar", barMaxWidth: 50,
        data: rivalData,
        itemStyle: { color: RIVAL_COLOR },
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

function tacklesOption(events: NormalizedEvent[], clubName: string) {
  const concretado = events.filter(e => e.isUserClub && e.event_type === "tackle_effective").length;
  const errado     = events.filter(e => e.isUserClub && e.event_type === "tackle_missed").length;
  const positivo   = events.filter(e => e.isUserClub && e.event_type === "tackle_positive").length;

  if (concretado + errado + positivo === 0) return null;

  return {
    ...baseOption(),
    grid: { containLabel: true, left: 16, right: 24, top: 16, bottom: 16 },
    tooltip: { ...TOOLTIP_STYLE, trigger: "axis", axisPointer: { type: "shadow" } },
    xAxis: { type: "value", splitLine: { lineStyle: { color: GRID_COLOR } } },
    yAxis: {
      type: "category",
      data: ["Positivo", "Errado", "Concretado"],
      axisLabel: { color: TEXT_COLOR },
      axisLine: { lineStyle: { color: GRID_COLOR } },
    },
    series: [{
      name: clubName, type: "bar", barMaxWidth: 50,
      data: [positivo, errado, concretado],
      itemStyle: { color: CLUB_COLOR },
      label: barLabel(),
    }],
  };
}

function possessionBreakdownOption(events: NormalizedEvent[]) {
  const motivos = ["ruck", "maul", "contacto", "pesca", "patada", "knock_on"];
  const motivoLabels = ["Ruck", "Maul", "Contacto", "Pesca", "Patada", "Knock On"];

  const lostData = motivos.map(m => events.filter(e => e.isUserClub && e.event_type === "possession_lost" && e.reason === m).length);
  const wonData  = motivos.map(m => events.filter(e => e.isUserClub && e.event_type === "ball_won"       && e.reason === m).length);

  if (lostData.every(v => v === 0) && wonData.every(v => v === 0)) return null;

  return {
    ...baseOption(),
    legend: { top: 0, textStyle: { color: TEXT_COLOR }, data: ["Perdidas", "Ganadas"] },
    tooltip: { ...TOOLTIP_STYLE, trigger: "axis", axisPointer: { type: "shadow" } },
    xAxis: { type: "value", splitLine: { lineStyle: { color: GRID_COLOR } } },
    yAxis: {
      type: "category",
      data: motivoLabels,
      axisLabel: { color: TEXT_COLOR },
      axisLine: { lineStyle: { color: GRID_COLOR } },
    },
    series: [
      {
        name: "Perdidas", type: "bar", barMaxWidth: 50,
        data: lostData,
        itemStyle: { color: "#F87171" },
        label: barLabel(),
      },
      {
        name: "Ganadas", type: "bar", barMaxWidth: 50,
        data: wonData,
        itemStyle: { color: "#4ADE80" },
        label: barLabel(),
      },
    ],
  };
}

function attackOption(events: NormalizedEvent[], clubName: string) {
  const breaks   = events.filter(e => e.isUserClub && e.event_type === "line_break").length;
  const offloads = events.filter(e => e.isUserClub && e.event_type === "offload").length;

  if (breaks + offloads === 0) return null;

  return {
    ...baseOption(),
    grid: { containLabel: true, left: 16, right: 24, top: 16, bottom: 16 },
    tooltip: { ...TOOLTIP_STYLE, trigger: "axis", axisPointer: { type: "shadow" } },
    xAxis: { type: "value", splitLine: { lineStyle: { color: GRID_COLOR } } },
    yAxis: {
      type: "category",
      data: ["Offload", "Quiebre"],
      axisLabel: { color: TEXT_COLOR },
      axisLine: { lineStyle: { color: GRID_COLOR } },
    },
    series: [{
      name: clubName, type: "bar", barMaxWidth: 50,
      data: [offloads, breaks],
      itemStyle: { color: CLUB_COLOR },
      label: barLabel(),
    }],
  };
}

const TIMELINE_CATEGORIES = [
  "Tackles", "Lines", "Scrums", "Puntos", "Tarjetas", "Posesión", "Cambios",
] as const;

type TimelineCat = typeof TIMELINE_CATEGORIES[number];

const EVENT_CATEGORY: Record<string, TimelineCat> = {
  tackle_effective: "Tackles", tackle_missed: "Tackles", tackle_positive: "Tackles",
  lineout_favor: "Lines", lineout_against: "Lines",
  exit_favor: "Lines", exit_against: "Lines",
  scrum_favor: "Scrums", scrum_against: "Scrums",
  try: "Puntos", penalty: "Puntos", drop: "Puntos",
  penalty_conceded: "Puntos", penalty_won: "Puntos",
  yellow_card: "Tarjetas", red_card: "Tarjetas",
  turnover_conceded: "Posesión", turnover_won: "Posesión",
  knock_on: "Posesión", forward_pass: "Posesión", lost_in_contact: "Posesión",
  possession_lost: "Posesión", ball_won: "Posesión",
  line_break: "Posesión", offload: "Posesión",
  substitution: "Cambios",
};

const EVENT_LABEL: Record<string, string> = {
  tackle_effective: "Tackle efectivo", tackle_missed: "Tackle errado", tackle_positive: "Tackle positivo",
  lineout_favor: "Line a favor", lineout_against: "Line en contra",
  exit_favor: "Salida a favor", exit_against: "Salida en contra",
  scrum_favor: "Scrum a favor", scrum_against: "Scrum en contra",
  try: "Try", penalty: "Penal", drop: "Drop",
  penalty_conceded: "Penal cometido", penalty_won: "Penal ganado",
  yellow_card: "Tarjeta amarilla", red_card: "Tarjeta roja",
  turnover_conceded: "Turnover perdido", turnover_won: "Turnover ganado",
  knock_on: "Knock-on", forward_pass: "Forward", lost_in_contact: "Perdida en contacto",
  possession_lost: "Posesión perdida", ball_won: "Pelota ganada",
  line_break: "Quiebre", offload: "Offload",
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

  const allData  = dataByHalf.flat();
  const homeData = allData.filter((d) => d.team === "user");
  const awayData = allData.filter((d) => d.team === "rival");
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
        itemStyle: { color: CLUB_COLOR },
        data: homeData.map((d) => ({ value: d.value, eventType: d.eventType, team: d.team, player: d.player, half: d.half })),
      },
      {
        name: `${session.away_team} (visitante)`,
        type: "scatter",
        symbolSize: 10,
        symbol: "triangle",
        itemStyle: { color: RIVAL_COLOR },
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
  clubEvents,
  rivalEvents,
  clubName,
  rivalName,
}: {
  clubEvents: NormalizedEvent[];
  rivalEvents: NormalizedEvent[];
  clubName: string;
  rivalName: string;
}) {
  const club  = calcTeamScore(clubEvents);
  const rival = calcTeamScore(rivalEvents);

  const rows = [
    { label: "Tries (×5)",           cVal: club.tries,        rVal: rival.tries },
    { label: "Conversiones (×2)",    cVal: club.conversions,  rVal: rival.conversions },
    { label: "Penales a palos (×3)", cVal: club.penaltyKicks, rVal: rival.penaltyKicks },
    { label: "Drops (×3)",           cVal: club.drops,        rVal: rival.drops },
  ];

  return (
    <div className="bg-gray-800 rounded-xl overflow-hidden mb-4">
      <div className="grid grid-cols-2 divide-x divide-gray-700">
        <div className="px-4 py-4 text-center">
          <p className="text-blue-400 text-xs font-semibold truncate">{clubName}</p>
          <p className="text-white text-5xl font-bold mt-1">{club.total}</p>
          <p className="text-gray-500 text-xs mt-0.5">pts</p>
        </div>
        <div className="px-4 py-4 text-center">
          <p className="text-orange-400 text-xs font-semibold truncate">{rivalName}</p>
          <p className="text-white text-5xl font-bold mt-1">{rival.total}</p>
          <p className="text-gray-500 text-xs mt-0.5">pts</p>
        </div>
      </div>
      <div className="border-t border-gray-700 px-4 pb-3 pt-2">
        <div className="grid grid-cols-3 text-xs text-gray-500 pb-1 mb-1 border-b border-gray-700/50">
          <span />
          <span className="text-center text-blue-400 font-semibold">{clubName}</span>
          <span className="text-center text-orange-400 font-semibold">{rivalName}</span>
        </div>
        {rows.map((r) => (
          <div key={r.label} className="grid grid-cols-3 text-xs py-1">
            <span className="text-gray-400">{r.label}</span>
            <span className={`text-center font-semibold ${r.cVal > 0 ? "text-white" : "text-gray-600"}`}>{r.cVal}</span>
            <span className={`text-center font-semibold ${r.rVal > 0 ? "text-white" : "text-gray-600"}`}>{r.rVal}</span>
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
  { value: "objectives", label: "Objetivos" },
];

export default function Stats() {
  const user = useAuthStore((s) => s.user);

  const [sessions,   setSessions]   = useState<LoadedSession[]>([]);
  const [clubName,   setClubName]   = useState<string>("");
  const [loading,    setLoading]    = useState(true);
  const [loadError,  setLoadError]  = useState<string | null>(null);
  const [selectedId,     setSelectedId]     = useState<string>("all");
  const [catFilter,      setCatFilter]      = useState<CatFilter>("all");
  const [divisionFilter, setDivisionFilter] = useState<string>("");
  const [objectives, setObjectives] = useState<Objectives>(() => {
    try {
      const stored = localStorage.getItem(OBJECTIVES_KEY);
      return stored ? { ...DEFAULT_OBJECTIVES, ...JSON.parse(stored) } : DEFAULT_OBJECTIVES;
    } catch {
      return DEFAULT_OBJECTIVES;
    }
  });

  const updateObjective = (key: keyof Objectives, value: number) => {
    const next = { ...objectives, [key]: Math.max(0, Math.min(100, value)) };
    setObjectives(next);
    localStorage.setItem(OBJECTIVES_KEY, JSON.stringify(next));
  };

  useEffect(() => {
    const clubId = user?.club_id;
    if (!clubId) { setLoading(false); return; }

    (async () => {
      try {
        const [{ data: club }, { data: tournaments }] = await Promise.all([
          api.get<{ id: string; name: string }>(`/clubs/${clubId}`),
          api.get<{ id: string; name: string; season: string | null; division: { id: string; name: string } }[]>(`/clubs/${clubId}/tournaments`),
        ]);

        setClubName(club.name);

        const sessionGroups = await Promise.all(
          tournaments.map((t) =>
            api.get<{ id: string; home_team: string; away_team: string; scheduled_at: string | null }[]>(
              `/tournaments/${t.id}/sessions`
            ).then(({ data }) =>
              data.map((s) => ({
                ...s,
                tournament_name: `${t.name}${t.season ? ` ${t.season}` : ""}`,
                division: t.division,
              }))
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
            const userTeam: "user" | "rival" = s.home_team === club.name ? "user" : "rival";
            return { ...s, events: evRes, playerNames, userTeam } as LoadedSession;
          })
        );

        const sorted = loaded.sort((a, b) => {
          if (!a.scheduled_at && !b.scheduled_at) return 0;
          if (!a.scheduled_at) return 1;
          if (!b.scheduled_at) return -1;
          return new Date(b.scheduled_at).getTime() - new Date(a.scheduled_at).getTime();
        });
        setSessions(sorted);
      } catch {
        setLoadError("Error al cargar estadísticas. Revisá la conexión e intentá de nuevo.");
      } finally {
        setLoading(false);
      }
    })();
  }, [user?.club_id]);

  const divisions = Array.from(
    new Map(sessions.map((s) => [s.division.id, s.division])).values()
  );

  const sessionsInDivision = divisionFilter
    ? sessions.filter((s) => s.division.id === divisionFilter)
    : sessions;

  const handleDivisionChange = (divId: string) => {
    setDivisionFilter(divId);
    if (divId && selectedId !== "all") {
      const sel = sessions.find((s) => s.id === selectedId);
      if (sel?.division.id !== divId) setSelectedId("all");
    }
  };

  const filteredSessions = selectedId === "all"
    ? sessionsInDivision
    : sessions.filter((s) => s.id === selectedId);

  const allEvents: NormalizedEvent[] = filteredSessions.flatMap((s) =>
    s.events.map((e) => ({ ...e, isUserClub: e.team === s.userTeam }))
  );

  const allNames = Object.assign({}, ...filteredSessions.map((s) => s.playerNames));
  const selectedSession = sessions.find((s) => s.id === selectedId);

  const displayClubName = clubName || "Local";
  const opponentName = selectedSession
    ? (selectedSession.userTeam === "user" ? selectedSession.away_team : selectedSession.home_team)
    : "Rivales";

  const clubEvents  = allEvents.filter((e) => e.isUserClub);
  const rivalEvents = allEvents.filter((e) => !e.isUserClub);

  const showPoints     = catFilter === "all" || catFilter === "points";
  const showGame       = catFilter === "all" || catFilter === "game";
  const showErrors     = catFilter === "all" || catFilter === "errors";
  const showDisc       = catFilter === "all" || catFilter === "discipline";
  const showObjetivos  = catFilter === "objectives";

  function obPct(numerator: number, denominator: number): number | null {
    return denominator === 0 ? null : Math.round((numerator / denominator) * 100);
  }

  const linesFavor  = allEvents.filter(e => e.event_type === "lineout_favor");
  const scrumsFavor = allEvents.filter(e => e.event_type === "scrum_favor");
  const exitsFavor  = allEvents.filter(e => e.event_type === "exit_favor");
  const allTackles  = allEvents.filter(e => ["tackle_effective", "tackle_missed", "tackle_positive"].includes(e.event_type));

  const metrics = [
    {
      key: "lines" as keyof Objectives,
      label: "Obtención en lines propios",
      actual: obPct(linesFavor.filter(e => e.metadata?.obtained === true).length, linesFavor.length),
      num: linesFavor.filter(e => e.metadata?.obtained === true).length,
      den: linesFavor.length,
    },
    {
      key: "scrums" as keyof Objectives,
      label: "Obtención en scrums propios",
      actual: obPct(scrumsFavor.filter(e => e.metadata?.obtained === true).length, scrumsFavor.length),
      num: scrumsFavor.filter(e => e.metadata?.obtained === true).length,
      den: scrumsFavor.length,
    },
    {
      key: "exits" as keyof Objectives,
      label: "Obtención en salidas",
      actual: obPct(exitsFavor.filter(e => e.metadata?.obtained === true).length, exitsFavor.length),
      num: exitsFavor.filter(e => e.metadata?.obtained === true).length,
      den: exitsFavor.length,
    },
    {
      key: "tackles" as keyof Objectives,
      label: "Efectividad de tackles",
      actual: obPct(allEvents.filter(e => e.event_type === "tackle_effective").length, allTackles.length),
      num: allEvents.filter(e => e.event_type === "tackle_effective").length,
      den: allTackles.length,
    },
  ];

  const triesOpt   = triesOption(allEvents, displayClubName, opponentName);
  const penaltyOpt = penaltyBreakdownOption(allEvents, displayClubName, opponentName);
  const dropsOpt   = dropsOption(allEvents, displayClubName, opponentName);
  const errorsOpt  = errorsOption(allEvents, displayClubName, opponentName);
  const cardsOpt   = cardsOption(allEvents, allNames);
  const scrumOpt       = setpieceOption("Scrums", "scrum_favor", "scrum_against", allEvents);
  const linesOpt       = setpieceOption("Lines",  "lineout_favor", "lineout_against", allEvents);
  const salidasOpt     = setpieceOption("Salidas", "exit_favor", "exit_against", allEvents);
  const tacklesOpt     = tacklesOption(allEvents, displayClubName);
  const possessionOpt  = possessionBreakdownOption(allEvents);
  const attackOpt      = attackOption(allEvents, displayClubName);
  const timelineOpt    = selectedSession ? timelineOption(selectedSession) : null;

  const chartStyle = { height: "220px" };

  return (
    <div className="p-4 max-w-3xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h1 className="text-xl font-bold text-white">Estadísticas</h1>
        <select
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          className="bg-gray-700 text-white text-sm rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-green-600"
        >
          <option value="all">Todos los partidos</option>
          {sessionsInDivision.map((s) => (
            <option key={s.id} value={s.id}>
              {displayClubName} vs {s.userTeam === "user" ? s.away_team : s.home_team}
              {s.scheduled_at
                ? ` · ${new Date(s.scheduled_at).toLocaleDateString("es-AR", { day: "numeric", month: "short" })}`
                : ""}
            </option>
          ))}
        </select>
      </div>

      {/* Division filter pills */}
      {!loading && divisions.length > 1 && (
        <div className="flex gap-2 mb-3 flex-wrap">
          <button
            onClick={() => handleDivisionChange("")}
            className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
              divisionFilter === ""
                ? "bg-green-700 text-white"
                : "bg-gray-700 text-gray-300 hover:bg-gray-600"
            }`}
          >
            Todas
          </button>
          {divisions.map((d) => (
            <button
              key={d.id}
              onClick={() => handleDivisionChange(d.id)}
              className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
                divisionFilter === d.id
                  ? "bg-green-700 text-white"
                  : "bg-gray-700 text-gray-300 hover:bg-gray-600"
              }`}
            >
              {d.name}
            </button>
          ))}
        </div>
      )}

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
              <ScoreSummary
                clubEvents={clubEvents}
                rivalEvents={rivalEvents}
                clubName={displayClubName}
                rivalName={opponentName}
              />

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
              {tacklesOpt && (
                <Section title="Tackles">
                  <ReactECharts option={tacklesOpt} style={{ height: "140px" }} />
                </Section>
              )}

              {attackOpt && (
                <Section title="Ataque — quiebres y offloads">
                  <ReactECharts option={attackOpt} style={{ height: "120px" }} />
                </Section>
              )}

              {possessionOpt && (
                <Section title="Posesión por motivo">
                  <ReactECharts option={possessionOpt} style={chartStyle} />
                </Section>
              )}

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

              {allEvents.some(e => e.event_type === "exit_favor" || e.event_type === "exit_against") && (
                <Section title="Salidas — propias vs ajenas (con/sin obtención)">
                  <ReactECharts option={salidasOpt} style={chartStyle} />
                </Section>
              )}
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

          {/* ── Objetivos ────────────────────────────────────────────────── */}
          {showObjetivos && (
            <div className="space-y-3">
              {metrics.map((m) => {
                const target = objectives[m.key];
                const isGood = m.actual !== null && m.actual >= target;
                const barWidth = m.actual !== null ? Math.min(m.actual, 100) : 0;

                return (
                  <div key={m.key} className="bg-gray-800 rounded-xl p-4 space-y-3">
                    {/* Header */}
                    <div className="flex items-center justify-between">
                      <span className="text-white text-sm font-semibold">{m.label}</span>
                      <div className="flex items-center gap-1.5">
                        <span className="text-gray-400 text-xs">Objetivo:</span>
                        <input
                          type="number"
                          min="0"
                          max="100"
                          value={target}
                          onChange={(e) => updateObjective(m.key, Number(e.target.value))}
                          className="w-12 bg-gray-700 text-white text-xs text-center rounded-lg px-1.5 py-1 outline-none focus:ring-1 focus:ring-green-600"
                        />
                        <span className="text-gray-400 text-xs">%</span>
                      </div>
                    </div>

                    {/* Actual value + bar */}
                    <div className="flex items-center gap-4">
                      <span className={`text-3xl font-bold w-16 shrink-0 ${
                        m.actual === null ? "text-gray-600" : isGood ? "text-green-400" : "text-red-400"
                      }`}>
                        {m.actual === null ? "—" : `${m.actual}%`}
                      </span>

                      <div className="flex-1 space-y-1">
                        {/* Bar */}
                        <div className="relative h-3 bg-gray-700 rounded-full overflow-visible">
                          <div
                            className={`h-full rounded-full transition-[width] duration-500 ${isGood ? "bg-green-500" : "bg-red-500"}`}
                            style={{ width: `${barWidth}%` }}
                          />
                          {/* Target marker */}
                          <div
                            className="absolute top-[-3px] bottom-[-3px] w-0.5 bg-white/50 rounded-full"
                            style={{ left: `${target}%` }}
                          />
                        </div>
                        <div className="text-xs text-gray-500">
                          {m.den === 0 ? "Sin datos" : `${m.num} de ${m.den}`}
                          <span className="ml-2 text-gray-600">· objetivo {target}%</span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* ── Timeline (solo "Todos", partido específico) ─────────────── */}
          {catFilter === "all" && selectedSession && timelineOpt && (
            <Section title={`Línea de tiempo — ${displayClubName} vs ${opponentName}`}>
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
