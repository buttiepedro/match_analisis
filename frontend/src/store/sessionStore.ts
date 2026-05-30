import { create } from "zustand";

export interface TimerData {
  half: number;
  status: "stopped" | "running" | "paused" | "halftime" | "finished";
  elapsed_seconds: number;
  server_timestamp: string;
}

export interface EventData {
  id: string;
  event_type: string;
  half: number;
  timer_seconds: number;
  team: "home" | "away";
  player_number?: number | null;
  reason?: string | null;
}

export interface SessionData {
  id: string;
  tournament_id: string;
  home_team: string;
  away_team: string;
  status: string;
  half_duration_minutes: number;
}

export interface LineupPlayer {
  id: string;
  player_id: string;
  jersey_number: number;
  position?: string | null;
  team: "home" | "away";
  status: "on_field" | "bench" | "substituted_out";
  player: {
    id: string;
    name: string;
    position?: string | null;
  };
}

interface SessionStore {
  session: SessionData | null;
  timer: TimerData | null;
  events: EventData[];
  lineup: LineupPlayer[];
  wsConnected: boolean;

  setSession: (s: SessionData) => void;
  setTimer: (t: TimerData) => void;
  addEvent: (e: EventData) => void;
  setEvents: (ev: EventData[]) => void;
  setLineup: (l: LineupPlayer[]) => void;
  applySubstitution: (outId: string, inId: string) => void;
  setWsConnected: (b: boolean) => void;
  reset: () => void;
}

export const useSessionStore = create<SessionStore>((set) => ({
  session: null,
  timer: null,
  events: [],
  lineup: [],
  wsConnected: false,

  setSession: (s) => set({ session: s }),
  setTimer: (t) => set({ timer: t }),
  addEvent: (e) => set((state) => ({ events: [e, ...state.events] })),
  setEvents: (ev) => set({ events: ev }),
  setLineup: (l) => set({ lineup: l }),
  applySubstitution: (outId, inId) =>
    set((state) => ({
      lineup: state.lineup.map((p) => {
        if (p.id === outId) return { ...p, status: "substituted_out" as const };
        if (p.id === inId) return { ...p, status: "on_field" as const };
        return p;
      }),
    })),
  setWsConnected: (b) => set({ wsConnected: b }),
  reset: () => set({ session: null, timer: null, events: [], lineup: [], wsConnected: false }),
}));

// ── Derived selectors ──────────────────────────────────────────────────────────

export function countEvents(
  events: EventData[],
  types: string[]
): { home: number; away: number } {
  return events
    .filter((e) => types.includes(e.event_type))
    .reduce(
      (acc, e) => {
        acc[e.team]++;
        return acc;
      },
      { home: 0, away: 0 }
    );
}
