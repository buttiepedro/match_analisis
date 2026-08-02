import { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import Screen from "../src/components/Screen";
import { Button, Card, EmptyState, ErrorBanner, Loading, SectionLabel } from "../src/components/Kit";
import api from "../src/lib/api";
import { parseApiError } from "../src/lib/errors";
import { useAuthStore } from "../src/store/authStore";
import { colors, radius, spacing } from "../src/theme";

interface NutritionSlot {
  id: string;
  starts_at: string;
  status: "libre" | "reservado" | "cancelado";
  notes: string | null;
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleDateString("es-AR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Reservar/cancelar turno con la nutricionista — mismo backend que
 * `frontend/src/pages/MiNutricion.tsx`. Ver [[turnos-nutricion]].
 */
export default function Nutricion() {
  const user = useAuthStore((s) => s.user);
  const [free, setFree] = useState<NutritionSlot[]>([]);
  const [mine, setMine] = useState<NutritionSlot[]>([]);
  const [notesFor, setNotesFor] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = () => {
    if (!user?.club_id) return;
    Promise.all([
      api.get<NutritionSlot[]>(`/clubs/${user.club_id}/nutrition-slots`),
      api.get<NutritionSlot[]>("/me/nutrition-appointments"),
    ])
      .then(([freeRes, mineRes]) => {
        setFree(freeRes.data);
        setMine(mineRes.data);
      })
      .catch((err) => setError(parseApiError(err, "No se pudo cargar la agenda")))
      .finally(() => setLoading(false));
  };

  useEffect(load, [user?.club_id]);

  const nextAppointment = useMemo(
    () =>
      mine
        .filter((s) => s.status === "reservado" && new Date(s.starts_at) > new Date())
        .sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0] ?? null,
    [mine]
  );

  const book = async (slotId: string) => {
    setBusy(slotId);
    setError("");
    try {
      await api.post(`/nutrition-slots/${slotId}/book`, { notes: notes.trim() || undefined });
      setNotesFor(null);
      setNotes("");
      load();
    } catch (err) {
      setError(parseApiError(err, "No se pudo reservar — puede que alguien se haya adelantado"));
      load();
    } finally {
      setBusy(null);
    }
  };

  const cancel = async (slotId: string) => {
    setBusy(slotId);
    setError("");
    try {
      await api.post(`/nutrition-slots/${slotId}/cancel`);
      load();
    } catch (err) {
      setError(parseApiError(err, "No se pudo cancelar"));
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return (
      <Screen scroll={false}>
        <Loading />
      </Screen>
    );
  }

  return (
    <Screen onRefresh={load} refreshing={loading}>
      <ErrorBanner>{error}</ErrorBanner>

      {nextAppointment ? (
        <Card style={{ padding: spacing.md, marginBottom: spacing.lg, backgroundColor: colors.brandSoft }}>
          <SectionLabel>Tu turno</SectionLabel>
          <Text style={styles.nextText}>{formatWhen(nextAppointment.starts_at)}</Text>
          {nextAppointment.notes && <Text style={styles.notesText}>"{nextAppointment.notes}"</Text>}
          <Text
            onPress={() => cancel(nextAppointment.id)}
            style={[styles.cancelLink, busy === nextAppointment.id && { opacity: 0.5 }]}
          >
            {busy === nextAppointment.id ? "Cancelando..." : "Cancelar turno"}
          </Text>
        </Card>
      ) : (
        <View style={{ marginBottom: spacing.lg }}>
          <EmptyState>No tenés ningún turno reservado.</EmptyState>
        </View>
      )}

      <SectionLabel>Horarios disponibles</SectionLabel>
      {free.length === 0 ? (
        <EmptyState>No hay horarios libres por ahora. Volvé a mirar más tarde.</EmptyState>
      ) : (
        <Card>
          {free.map((s, i) => (
            <View key={s.id} style={[styles.slotRow, i > 0 && styles.rowBorder]}>
              <View style={styles.slotHeader}>
                <Text style={styles.slotText}>{formatWhen(s.starts_at)}</Text>
                {notesFor !== s.id && (
                  <Text
                    onPress={() => {
                      setNotesFor(s.id);
                      setNotes("");
                    }}
                    style={[styles.reserveLink, busy !== null && { opacity: 0.5 }]}
                  >
                    Reservar
                  </Text>
                )}
              </View>
              {notesFor === s.id && (
                <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
                  <TextInput
                    value={notes}
                    onChangeText={setNotes}
                    placeholder="Motivo de la consulta (opcional)"
                    placeholderTextColor={colors.inkFaint}
                    style={styles.input}
                  />
                  <View style={{ flexDirection: "row", gap: spacing.sm }}>
                    <View style={{ flex: 1 }}>
                      <Button
                        label={busy === s.id ? "Reservando..." : "Confirmar"}
                        onPress={() => book(s.id)}
                        loading={busy === s.id}
                      />
                    </View>
                    <Text onPress={() => setNotesFor(null)} style={styles.cancelInline}>
                      Cancelar
                    </Text>
                  </View>
                </View>
              )}
            </View>
          ))}
        </Card>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  nextText: { fontSize: 15, color: colors.ink, marginTop: 2, textTransform: "capitalize" },
  notesText: { fontSize: 12, color: colors.inkMuted, marginTop: 4 },
  cancelLink: { fontSize: 12, fontWeight: "600", color: colors.danger, marginTop: spacing.sm },
  slotRow: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  slotHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  slotText: { fontSize: 14, color: colors.ink, textTransform: "capitalize", flex: 1 },
  reserveLink: { fontSize: 13, fontWeight: "600", color: colors.brand },
  input: {
    backgroundColor: colors.surfaceStrong,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontSize: 13,
    color: colors.ink,
  },
  cancelInline: { color: colors.inkMuted, fontSize: 14, alignSelf: "center", paddingHorizontal: spacing.sm },
});
