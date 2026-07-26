import { create } from "zustand";
import api from "../lib/axios";

export interface Player {
  id: string;
  division_id: string;
  name: string;
  position: string | null;
  dni: string | null;
  profile_photo_url: string | null;
  is_active: boolean;
}

export interface Division {
  id: string;
  name: string;
  club_id: string;
  is_active: boolean;
}

export interface Measurement {
  id: string;
  player_id: string;
  measured_at: string;
  weight_kg: number | null;
  height_cm: number | null;
  bmi: number | null;
  fat_fold_tricep_mm: number | null;
  fat_fold_subscapular_mm: number | null;
  fat_fold_suprailiac_mm: number | null;
  fat_fold_abdominal_mm: number | null;
  fat_fold_biceps_mm: number | null;
  body_fat_percent: number | null;
  /** Juego de pliegues / sexo / banda etaria usados, ej. "dw4c/M/20-29". */
  body_fat_method: string | null;
  notes: string | null;
  created_at: string;
}

export interface PhysicalTest {
  id: string;
  player_id: string;
  test_date: string;
  test_type: string;
  value: number;
  unit: string;
  notes: string | null;
  created_at: string;
}

export interface DivisionHistoryEntry {
  id: string;
  division_id: string;
  division_name: string;
  from_date: string;
  to_date: string | null;
}

interface SquadState {
  players: Player[];
  divisions: Division[];
  loading: boolean;
  error: string | null;

  // Per-player data (cached by player_id)
  measurements: Record<string, Measurement[]>;
  physicalTests: Record<string, PhysicalTest[]>;
  divisionHistory: Record<string, DivisionHistoryEntry[]>;

  fetchDivisions: (clubId: string) => Promise<void>;
  fetchPlayers: (divisionId: string) => Promise<void>;
  fetchAllPlayers: (clubId: string) => Promise<void>;
  fetchMeasurements: (playerId: string) => Promise<void>;
  fetchPhysicalTests: (playerId: string) => Promise<void>;
  fetchDivisionHistory: (playerId: string) => Promise<void>;

  addMeasurement: (playerId: string, data: Partial<Measurement>) => Promise<Measurement>;
  deleteMeasurement: (playerId: string, measurementId: string) => Promise<void>;

  addPhysicalTest: (playerId: string, data: Partial<PhysicalTest>) => Promise<PhysicalTest>;
  deletePhysicalTest: (playerId: string, testId: string) => Promise<void>;

  batchMovePlayers: (playerIds: string[], toDivisionId: string) => Promise<void>;
  movePlayerOptimistic: (playerIds: string[], toDivisionId: string) => void;
  importPlayersXlsx: (file: File, divisionId: string) => Promise<ImportResult>;
}

export interface ImportResult {
  created: number;
  updated: number;
  skipped: number;
  errors: { row: number; reason: string }[];
  total_rows: number;
}

export const useSquadStore = create<SquadState>((set, get) => ({
  players: [],
  divisions: [],
  loading: false,
  error: null,
  measurements: {},
  physicalTests: {},
  divisionHistory: {},

  fetchDivisions: async (clubId) => {
    const { data } = await api.get(`/clubs/${clubId}/divisions`);
    set({ divisions: data });
  },

  fetchPlayers: async (divisionId) => {
    set({ loading: true, error: null });
    try {
      const { data } = await api.get(`/divisions/${divisionId}/players`);
      set({ players: data, loading: false });
    } catch {
      set({ loading: false, error: "Error cargando jugadores" });
    }
  },

  fetchAllPlayers: async (clubId) => {
    set({ loading: true, error: null });
    try {
      const { data } = await api.get(`/clubs/${clubId}/players`);
      set({ players: data, loading: false });
    } catch {
      set({ loading: false, error: "Error cargando jugadores" });
    }
  },

  fetchMeasurements: async (playerId) => {
    const { data } = await api.get(`/players/${playerId}/measurements`);
    set((s) => ({ measurements: { ...s.measurements, [playerId]: data } }));
  },

  fetchPhysicalTests: async (playerId) => {
    const { data } = await api.get(`/players/${playerId}/tests`);
    set((s) => ({ physicalTests: { ...s.physicalTests, [playerId]: data } }));
  },

  fetchDivisionHistory: async (playerId) => {
    const { data } = await api.get(`/players/${playerId}/history`);
    set((s) => ({ divisionHistory: { ...s.divisionHistory, [playerId]: data } }));
  },

  addMeasurement: async (playerId, data) => {
    const { data: created } = await api.post(`/players/${playerId}/measurements`, data);
    set((s) => ({
      measurements: {
        ...s.measurements,
        [playerId]: [created, ...(s.measurements[playerId] ?? [])],
      },
    }));
    return created;
  },

  deleteMeasurement: async (playerId, measurementId) => {
    await api.delete(`/players/${playerId}/measurements/${measurementId}`);
    set((s) => ({
      measurements: {
        ...s.measurements,
        [playerId]: (s.measurements[playerId] ?? []).filter((m) => m.id !== measurementId),
      },
    }));
  },

  addPhysicalTest: async (playerId, data) => {
    const { data: created } = await api.post(`/players/${playerId}/tests`, data);
    set((s) => ({
      physicalTests: {
        ...s.physicalTests,
        [playerId]: [created, ...(s.physicalTests[playerId] ?? [])],
      },
    }));
    return created;
  },

  deletePhysicalTest: async (playerId, testId) => {
    await api.delete(`/players/${playerId}/tests/${testId}`);
    set((s) => ({
      physicalTests: {
        ...s.physicalTests,
        [playerId]: (s.physicalTests[playerId] ?? []).filter((t) => t.id !== testId),
      },
    }));
  },

  movePlayerOptimistic: (playerIds, toDivisionId) => {
    set((s) => ({
      players: s.players.map((p) =>
        playerIds.includes(p.id) ? { ...p, division_id: toDivisionId } : p
      ),
    }));
  },

  importPlayersXlsx: async (file, divisionId) => {
    const form = new FormData();
    form.append("file", file);
    form.append("division_id", divisionId);
    const { data } = await api.post("/import/players-xlsx", form, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    return data as ImportResult;
  },

  batchMovePlayers: async (playerIds, toDivisionId) => {
    get().movePlayerOptimistic(playerIds, toDivisionId);
    try {
      await api.patch("/players/batch-move", { player_ids: playerIds, to_division_id: toDivisionId });
    } catch (err) {
      // revert not implemented — just refetch
      throw err;
    }
  },
}));

export const TEST_TYPE_META: Record<string, { label: string; unit: string; category: string }> = {
  sprint_10m:     { label: "Sprint 10m",       unit: "seconds",   category: "Velocidad" },
  sprint_20m:     { label: "Sprint 20m",       unit: "seconds",   category: "Velocidad" },
  sprint_40m:     { label: "Sprint 40m",       unit: "seconds",   category: "Velocidad" },
  accel_5m:       { label: "Aceleración 5m",   unit: "seconds",   category: "Aceleración" },
  bronco:         { label: "Bronco Test",       unit: "seconds",   category: "Aeróbico" },
  bench_1rm:      { label: "Press banca 1RM",  unit: "kg",        category: "Fuerza" },
  squat_1rm:      { label: "Sentadilla 1RM",   unit: "kg",        category: "Fuerza" },
  hip_thrust_1rm: { label: "Hip Thrust 1RM",   unit: "kg",        category: "Fuerza" },
  shoulder_1rm:   { label: "Press hombro 1RM", unit: "kg",        category: "Fuerza" },
  cmj:            { label: "Salto CMJ",         unit: "cm",        category: "Salto" },
  long_jump:      { label: "Salto horizontal",  unit: "m",         category: "Salto" },
  sit_reach:      { label: "Sit and reach",     unit: "cm",        category: "Flexibilidad" },
  vo2max:         { label: "VO2max estimado",   unit: "ml/kg/min", category: "Aeróbico" },
};

export function formatTestValue(value: number, unit: string): string {
  if (unit === "seconds") {
    const m = Math.floor(value / 60);
    const s = (value % 60).toFixed(2);
    if (m > 0) return `${m}:${s.padStart(5, "0")}`;
    return `${value.toFixed(2)}s`;
  }
  return `${value} ${unit}`;
}
