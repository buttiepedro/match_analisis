import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import Screen from "../../src/components/Screen";
import { Button, Card, EmptyState, ErrorBanner, Loading, Pill, SectionLabel } from "../../src/components/Kit";
import PushBanner from "../../src/components/PushBanner";
import api from "../../src/lib/api";
import { parseApiError } from "../../src/lib/errors";
import { useAuthStore } from "../../src/store/authStore";
import { colors, radius, spacing } from "../../src/theme";

// ── Socio: cuota ─────────────────────────────────────────────────────────────

interface Membership {
  full_name: string;
  member_number: string | null;
  category: string | null;
  dues_up_to_date: boolean;
  dues_synced_at: string;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("es-AR", { day: "numeric", month: "long", year: "numeric" });
}

function MembershipCard({ data }: { data: Membership }) {
  const upToDate = data.dues_up_to_date;
  return (
    <View style={{ marginBottom: spacing.lg }}>
      <SectionLabel>Mi cuota</SectionLabel>
      <View style={[styles.duesCard, { backgroundColor: upToDate ? colors.brandSoft : colors.dangerSoft }]}>
        <Text style={[styles.duesTitle, { color: upToDate ? colors.brand : colors.danger }]}>
          {upToDate ? "Estás al día" : "Tenés la cuota pendiente"}
        </Text>
        <Text style={styles.duesMeta}>Según el último dato del club, {formatDate(data.dues_synced_at)}</Text>
      </View>
      <Card style={{ marginTop: spacing.sm }}>
        {[
          ["Socio N°", data.member_number ?? "—"],
          ["Categoría", data.category ?? "—"],
        ].map(([label, value], i) => (
          <View key={label} style={[styles.kvRow, i > 0 && styles.rowBorder]}>
            <Text style={styles.kvLabel}>{label}</Text>
            <Text style={styles.kvValue}>{value}</Text>
          </View>
        ))}
      </Card>
    </View>
  );
}

// ── Jugador: ficha ───────────────────────────────────────────────────────────

interface Player {
  id: string;
  name: string;
  position: string | null;
  availability: string;
  phone: string | null;
  emergency_phone: string | null;
  email: string | null;
  obra_social: string | null;
  medical_clearance_expires: string | null;
  clearance_expired: boolean;
  clearance_expiring: boolean;
}
interface AttendanceDetail {
  percent_30: number;
  percent_90: number;
  percent_season: number;
}
interface SeasonStats {
  matches: number;
  minutes: number;
  tries: number;
  tackles: number;
}

function PlayerCard({ player, onUpdated }: { player: Player; onUpdated: (p: Player) => void }) {
  const [editing, setEditing] = useState(false);
  const [phone, setPhone] = useState(player.phone ?? "");
  const [emergencyPhone, setEmergencyPhone] = useState(player.emergency_phone ?? "");
  const [email, setEmail] = useState(player.email ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [attendance, setAttendance] = useState<AttendanceDetail | null>(null);
  const [season, setSeason] = useState<SeasonStats | null>(null);

  useEffect(() => {
    api.get<AttendanceDetail>(`/players/${player.id}/attendance`).then(({ data }) => setAttendance(data)).catch(() => {});
    api.get<SeasonStats>(`/players/${player.id}/season-stats`).then(({ data }) => setSeason(data)).catch(() => {});
  }, [player.id]);

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const { data } = await api.patch<Player>("/me/player", {
        phone: phone.trim() || undefined,
        emergency_phone: emergencyPhone.trim() || undefined,
        email: email.trim() || undefined,
      });
      onUpdated(data);
      setEditing(false);
    } catch (err) {
      setError(parseApiError(err, "No se pudo guardar"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={{ marginBottom: spacing.lg }}>
      <SectionLabel>Mi ficha</SectionLabel>

      <Card style={{ padding: spacing.md, marginBottom: spacing.sm }}>
        <Text style={styles.playerName}>{player.name}</Text>
        <Text style={styles.playerPosition}>{player.position ?? "Sin posición"}</Text>
        {player.availability !== "disponible" && (
          <View style={{ marginTop: spacing.sm }}>
            <Pill label={`Figurás como ${player.availability.replace("_", " ")}`} tone="amber" />
          </View>
        )}
      </Card>

      {season && season.matches > 0 && (
        <View style={styles.statsRow}>
          {[
            ["Partidos", season.matches],
            ["Minutos", season.minutes],
            ["Tries", season.tries],
            ["Tackles", season.tackles],
          ].map(([label, value]) => (
            <View key={label as string} style={styles.statBox}>
              <Text style={styles.statValue}>{value}</Text>
              <Text style={styles.statLabel}>{label}</Text>
            </View>
          ))}
        </View>
      )}

      {attendance && (
        <View style={styles.statsRow}>
          {[
            ["30 días", attendance.percent_30],
            ["90 días", attendance.percent_90],
            ["Temporada", attendance.percent_season],
          ].map(([label, value]) => (
            <View key={label as string} style={styles.statBox}>
              <Text style={styles.statValue}>{value}%</Text>
              <Text style={styles.statLabel}>{label}</Text>
            </View>
          ))}
        </View>
      )}

      {player.medical_clearance_expires && (
        <Card
          style={{
            padding: spacing.md,
            marginTop: spacing.sm,
            backgroundColor: player.clearance_expired
              ? colors.dangerSoft
              : player.clearance_expiring
                ? colors.amberSoft
                : colors.surface,
          }}
        >
          <Text style={styles.clearanceText}>
            Apto médico vence el {formatDate(player.medical_clearance_expires)}
          </Text>
          {player.clearance_expired && (
            <Text style={styles.clearanceWarning}>Vencido — avisá al club para renovarlo.</Text>
          )}
        </Card>
      )}

      <View style={styles.sectionHeader}>
        <Text style={styles.contactLabel}>Contacto</Text>
        {!editing && (
          <Pressable onPress={() => setEditing(true)}>
            <Text style={styles.editLink}>Editar</Text>
          </Pressable>
        )}
      </View>

      {editing ? (
        <Card style={{ padding: spacing.md, gap: spacing.sm }}>
          <TextInput
            value={phone}
            onChangeText={setPhone}
            placeholder="Teléfono"
            placeholderTextColor={colors.inkFaint}
            style={styles.input}
          />
          <TextInput
            value={emergencyPhone}
            onChangeText={setEmergencyPhone}
            placeholder="Teléfono de emergencia"
            placeholderTextColor={colors.inkFaint}
            style={styles.input}
          />
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="Email"
            placeholderTextColor={colors.inkFaint}
            autoCapitalize="none"
            style={styles.input}
          />
          <ErrorBanner>{error}</ErrorBanner>
          <View style={{ flexDirection: "row", gap: spacing.sm }}>
            <View style={{ flex: 1 }}>
              <Button label={saving ? "Guardando..." : "Guardar"} onPress={save} loading={saving} />
            </View>
            <Pressable onPress={() => setEditing(false)} style={styles.cancelBtn}>
              <Text style={styles.cancelText}>Cancelar</Text>
            </Pressable>
          </View>
        </Card>
      ) : (
        <Card>
          {[
            ["Teléfono", player.phone],
            ["Tel. de emergencia", player.emergency_phone],
            ["Email", player.email],
            ["Obra social", player.obra_social],
          ].map(([label, value], i) => (
            <View key={label} style={[styles.kvRow, i > 0 && styles.rowBorder]}>
              <Text style={styles.kvLabel}>{label}</Text>
              <Text style={styles.kvValue}>{value ?? "—"}</Text>
            </View>
          ))}
        </Card>
      )}
    </View>
  );
}

// ── Pantalla ─────────────────────────────────────────────────────────────────

interface QuickLink {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  href: "/nutricion" | "/gimnasio" | "/bolsa";
  permission?: string;
}
const LINKS: QuickLink[] = [
  { label: "Turno de nutrición", icon: "leaf-outline", href: "/nutricion", permission: "nutricion.turnos_reservar" },
  { label: "Gimnasio", icon: "barbell-outline", href: "/gimnasio", permission: "gimnasio.ver_propio" },
  { label: "Bolsa de trabajo", icon: "briefcase-outline", href: "/bolsa", permission: "bolsa.ver" },
];

/**
 * "Cuenta" reemplaza a `/mi-club` + `/mi-ficha` de la web en una sola
 * pantalla: pide las dos (`/me/membership`, `/me/player`) y muestra las que
 * respondan — un jugador que también es socio (caso real, ver [[socios]])
 * ve las dos secciones, no tiene que elegir cuál mirar. Ver [[app-movil]].
 *
 * Simplificado contra `PlayerPortal.tsx`: sin subida de foto (agrega
 * `expo-image-picker` y un flujo de recorte que no entró en el alcance de
 * esta v1) y sin sparklines de tests/físico (necesitan `react-native-svg`,
 * ver [[app-movil]] "Qué se simplificó").
 */
export default function Cuenta() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const permissions = user?.permissions ?? [];

  const [membership, setMembership] = useState<Membership | null>(null);
  const [player, setPlayer] = useState<Player | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get<Membership>("/me/membership").then(({ data }) => setMembership(data)).catch(() => {}),
      api.get<Player>("/me/player").then(({ data }) => setPlayer(data)).catch(() => {}),
    ]).finally(() => setLoading(false));
  }, []);

  const visibleLinks = LINKS.filter((l) => !l.permission || permissions.includes(l.permission));

  if (loading) {
    return (
      <Screen scroll={false}>
        <Loading />
      </Screen>
    );
  }

  return (
    <Screen>
      <PushBanner />
      {membership && <MembershipCard data={membership} />}
      {player && <PlayerCard player={player} onUpdated={setPlayer} />}

      {!membership && !player && (
        <EmptyState>No encontramos tu ficha de socio ni de jugador. Hablá con el club.</EmptyState>
      )}

      {visibleLinks.length > 0 && (
        <View style={{ marginBottom: spacing.lg }}>
          <SectionLabel>Accesos</SectionLabel>
          <Card>
            {visibleLinks.map((link, i) => (
              <Pressable
                key={link.href}
                onPress={() => router.push(link.href)}
                style={[styles.linkRow, i > 0 && styles.rowBorder]}
              >
                <Ionicons name={link.icon} size={18} color={colors.brand} />
                <Text style={styles.linkRowLabel}>{link.label}</Text>
                <Ionicons name="chevron-forward" size={16} color={colors.inkFaint} />
              </Pressable>
            ))}
          </Card>
        </View>
      )}

      <Text style={styles.userMeta}>{user?.full_name}</Text>
      <Button label="Cerrar sesión" variant="secondary" onPress={() => logout()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  duesCard: { borderRadius: radius.lg, padding: spacing.lg, alignItems: "center" },
  duesTitle: { fontSize: 20, fontWeight: "700" },
  duesMeta: { fontSize: 12, color: colors.inkMuted, marginTop: spacing.sm, textAlign: "center" },
  kvRow: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingVertical: spacing.sm + 2 },
  rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  kvLabel: { fontSize: 13, color: colors.inkMuted },
  kvValue: { fontSize: 13, color: colors.ink, fontWeight: "500" },
  playerName: { fontSize: 17, fontWeight: "700", color: colors.ink },
  playerPosition: { fontSize: 12, color: colors.inkMuted, marginTop: 2 },
  statsRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  statBox: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: "center" },
  statValue: { fontSize: 17, fontWeight: "700", color: colors.ink },
  statLabel: { fontSize: 10, color: colors.inkMuted, marginTop: 2 },
  clearanceText: { fontSize: 13, color: colors.ink },
  clearanceWarning: { fontSize: 11, color: colors.danger, marginTop: 4 },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: spacing.lg, marginBottom: spacing.sm },
  contactLabel: { fontSize: 11, fontWeight: "700", color: colors.inkMuted, textTransform: "uppercase", letterSpacing: 0.5 },
  editLink: { fontSize: 12, color: colors.brand, fontWeight: "600" },
  input: { backgroundColor: colors.surfaceStrong, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: 10, fontSize: 14, color: colors.ink },
  cancelBtn: { justifyContent: "center", paddingHorizontal: spacing.md },
  cancelText: { color: colors.inkMuted, fontSize: 14 },
  linkRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  linkRowLabel: { flex: 1, fontSize: 14, color: colors.ink },
  userMeta: { fontSize: 12, color: colors.inkMuted, textAlign: "center", marginBottom: spacing.sm },
});
