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
  team: "user" | "rival";
  player_id?: string | null;
  player_number?: number | null;
  reason?: string | null;
  metadata?: Record<string, unknown>;
  /** true mientras el evento vive sólo en la cola offline del cliente. */
  pending?: boolean;
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
  team: "user" | "rival";
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
  removeEvent: (id: string) => void;
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
  // Un evento puede llegar por WebSocket y por el POST optimista a la vez:
  // el id es la única fuente de verdad para no duplicarlo.
  addEvent: (e) =>
    set((state) =>
      state.events.some((prev) => prev.id === e.id)
        ? state
        : { events: [e, ...state.events] }
    ),
  removeEvent: (id) => set((state) => ({ events: state.events.filter((e) => e.id !== id) })),
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
): { user: number; rival: number } {
  return events
    .filter((e) => types.includes(e.event_type))
    .reduce(
      (acc, e) => {
        // Guard for legacy "home"/"away" values during migration transitions
        const key = (e.team as string) === "home" ? "user"
          : (e.team as string) === "away" ? "rival"
          : e.team;
        acc[key]++;
        return acc;
      },
      { user: 0, rival: 0 }
    );
}
