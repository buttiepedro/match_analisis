import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import Screen from "../src/components/Screen";
import { Card, EmptyState, Loading, Pill, SegmentedControl } from "../src/components/Kit";
import api from "../src/lib/api";
import { colors, spacing } from "../src/theme";

interface GymExercise {
  id: string;
  name: string;
  sets: number | null;
  reps: string | null;
  load_type: string;
  load_value: number | null;
  load_test_label: string | null;
  resolved_load_kg: number | null;
  unresolved_reason: string | null;
  notes: string | null;
}
interface GymDay {
  id: string;
  week: number;
  day: number;
  name: string;
  exercises: GymExercise[];
}
interface GymPlan {
  id: string;
  name: string;
  weeks: number;
  days: GymDay[];
}
interface MyGymPlan {
  plan: GymPlan | null;
  completed_day_ids: string[];
}

const DAY_NAMES = ["", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

/**
 * Plan de gimnasio propio, con los kilos ya resueltos contra los tests del
 * jugador — mismo backend que `frontend/src/pages/PlayerPortal.tsx`
 * (pestaña Gimnasio). Ver [[gimnasio]].
 */
export default function Gimnasio() {
  const [data, setData] = useState<MyGymPlan | null>(null);
  const [week, setWeek] = useState("1");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  const load = () => {
    api
      .get<MyGymPlan>("/me/gym-plan")
      .then(({ data }) => setData(data))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const markDone = async (dayId: string) => {
    setSaving(dayId);
    try {
      await api.post("/me/gym-logs", { day_id: dayId });
      load();
    } finally {
      setSaving(null);
    }
  };

  if (loading) {
    return (
      <Screen scroll={false}>
        <Loading />
      </Screen>
    );
  }

  if (!data?.plan) {
    return (
      <Screen>
        <EmptyState>Tu división todavía no tiene un plan de gimnasio cargado.</EmptyState>
      </Screen>
    );
  }

  const { plan, completed_day_ids } = data;
  const completed = new Set(completed_day_ids);
  const weekNum = Number(week);
  const days = plan.days.filter((d) => d.week === weekNum).sort((a, b) => a.day - b.day);

  return (
    <Screen onRefresh={load} refreshing={loading}>
      <Text style={styles.planName}>{plan.name}</Text>

      {plan.weeks > 1 && (
        <View style={{ marginVertical: spacing.md }}>
          <SegmentedControl
            value={week}
            onChange={setWeek}
            options={Array.from({ length: plan.weeks }, (_, i) => ({
              key: String(i + 1),
              label: `Sem ${i + 1}`,
            }))}
          />
        </View>
      )}

      {days.length === 0 ? (
        <EmptyState>No hay sesiones cargadas para esta semana.</EmptyState>
      ) : (
        days.map((day) => {
          const done = completed.has(day.id);
          return (
            <Card key={day.id} style={{ marginBottom: spacing.md }}>
              <View style={styles.dayHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.dayName}>{day.name}</Text>
                  <Text style={styles.dayMeta}>{DAY_NAMES[day.day] ?? `Día ${day.day}`}</Text>
                </View>
                <Text
                  onPress={() => !done && markDone(day.id)}
                  style={[styles.doneButton, done ? styles.doneButtonDone : styles.doneButtonPending]}
                >
                  {done ? "Hecha" : saving === day.id ? "..." : "Marcar hecha"}
                </Text>
              </View>
              {day.exercises.map((e, i) => (
                <View key={e.id} style={[styles.exerciseRow, i === 0 ? styles.exerciseFirst : styles.rowBorder]}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.exerciseName}>{e.name}</Text>
                    <Text style={styles.exerciseMeta}>
                      {[e.sets && `${e.sets} series`, e.reps && `${e.reps} reps`].filter(Boolean).join(" · ") || "—"}
                    </Text>
                    {e.notes && <Text style={styles.exerciseNotes}>{e.notes}</Text>}
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    {e.resolved_load_kg != null ? (
                      <>
                        <Text style={styles.loadValue}>{e.resolved_load_kg} kg</Text>
                        {e.load_type === "porcentaje_test" && (
                          <Text style={styles.loadDetail}>
                            {e.load_value}% de tu {e.load_test_label}
                          </Text>
                        )}
                      </>
                    ) : e.unresolved_reason ? (
                      <Pill label={e.unresolved_reason} tone="amber" />
                    ) : (
                      <Text style={styles.loadDetail}>Sin carga</Text>
                    )}
                  </View>
                </View>
              ))}
            </Card>
          );
        })
      )}

      <Text style={styles.footer}>Los kilos salen de tus propios tests.</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  planName: { fontSize: 15, fontWeight: "600", color: colors.ink },
  dayHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  dayName: { fontSize: 14, fontWeight: "500", color: colors.ink },
  dayMeta: { fontSize: 11, color: colors.inkFaint, marginTop: 2 },
  doneButton: { fontSize: 11, fontWeight: "600", paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: 8, overflow: "hidden" },
  doneButtonDone: { backgroundColor: colors.brandSoft, color: colors.brand },
  doneButtonPending: { backgroundColor: colors.surfaceStrong, color: colors.inkSoft },
  exerciseRow: { flexDirection: "row", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm + 2 },
  exerciseFirst: {},
  rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  exerciseName: { fontSize: 13, color: colors.ink },
  exerciseMeta: { fontSize: 11, color: colors.inkFaint, marginTop: 2 },
  exerciseNotes: { fontSize: 11, color: colors.inkMuted, marginTop: 2 },
  loadValue: { fontSize: 14, fontWeight: "700", color: colors.ink },
  loadDetail: { fontSize: 10, color: colors.inkFaint, marginTop: 2 },
  footer: { fontSize: 11, color: colors.inkFaint, textAlign: "center", marginTop: spacing.sm },
});
