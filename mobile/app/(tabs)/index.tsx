import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Screen from "../../src/components/Screen";
import { Card } from "../../src/components/Kit";
import { useAuthStore } from "../../src/store/authStore";
import { colors, radius, spacing } from "../../src/theme";

interface QuickLink {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  href: "/nutricion" | "/gimnasio" | "/bolsa";
  /** Sólo si el permiso lo requiere — si no está listado, siempre visible. */
  permission?: string;
}

const QUICK_LINKS: QuickLink[] = [
  { label: "Turno de nutrición", icon: "leaf-outline", href: "/nutricion", permission: "nutricion.turnos_reservar" },
  { label: "Gimnasio", icon: "barbell-outline", href: "/gimnasio", permission: "gimnasio.ver_propio" },
  { label: "Bolsa de trabajo", icon: "briefcase-outline", href: "/bolsa", permission: "bolsa.ver" },
];

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Buen día";
  if (hour < 20) return "Buenas tardes";
  return "Buenas noches";
}

/**
 * Landing de la app: saludo y accesos directos a lo que no tiene tab propio
 * (nutrición, gimnasio, bolsa) — mismo criterio de "cinco es el techo" que
 * ya aplicó [[navigation]] en la web. Ver [[app-movil]].
 */
export default function Hoy() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const permissions = user?.permissions ?? [];

  const visibleLinks = QUICK_LINKS.filter((l) => !l.permission || permissions.includes(l.permission));

  return (
    <Screen>
      <Text style={styles.greeting}>{greeting()},</Text>
      <Text style={styles.name}>{user?.full_name?.split(" ")[0] ?? ""}</Text>

      {visibleLinks.length > 0 && (
        <View style={styles.grid}>
          {visibleLinks.map((link) => (
            <Pressable key={link.href} onPress={() => router.push(link.href)} style={styles.linkCard}>
              <Card style={styles.linkCardInner}>
                <View style={styles.iconCircle}>
                  <Ionicons name={link.icon} size={22} color={colors.brand} />
                </View>
                <Text style={styles.linkLabel}>{link.label}</Text>
              </Card>
            </Pressable>
          ))}
        </View>
      )}

      <Text style={styles.footer}>
        Fixture, tablas, citados y tu cuenta están en las otras pestañas.
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  greeting: { fontSize: 15, color: colors.inkMuted },
  name: { fontSize: 26, fontWeight: "700", color: colors.ink, marginBottom: spacing.xl },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  linkCard: { width: "47%" },
  linkCardInner: { padding: spacing.md, gap: spacing.sm },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    backgroundColor: colors.brandSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  linkLabel: { fontSize: 13, fontWeight: "600", color: colors.ink },
  footer: { fontSize: 11, color: colors.inkFaint, textAlign: "center", marginTop: spacing.xl },
});
