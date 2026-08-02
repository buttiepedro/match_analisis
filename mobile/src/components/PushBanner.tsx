import { useEffect, useState } from "react";
import * as Notifications from "expo-notifications";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { isPushSupported, registerForPushNotifications } from "../lib/push";
import { colors, radius, spacing } from "../theme";

type Status = "loading" | "unsupported" | "on" | "off";

/**
 * Opt-in en contexto, no al abrir la app — mismo criterio que
 * `frontend/src/pages/PlayerPortal.tsx`'s `PushBanner`: pedir el permiso en
 * el primer segundo de la sesión es la forma más confiable de que se
 * rechace para siempre. Ver [[app-movil]].
 */
export default function PushBanner() {
  const [status, setStatus] = useState<Status>("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isPushSupported()) {
      setStatus("unsupported");
      return;
    }
    Notifications.getPermissionsAsync().then(({ status: s }) => setStatus(s === "granted" ? "on" : "off"));
  }, []);

  const activate = async () => {
    setBusy(true);
    setError("");
    try {
      await registerForPushNotifications();
      const { status: s } = await Notifications.getPermissionsAsync();
      setStatus(s === "granted" ? "on" : "off");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo activar");
    } finally {
      setBusy(false);
    }
  };

  if (status === "loading" || status === "unsupported" || status === "on") return null;

  return (
    <View style={styles.banner}>
      <Text style={styles.text}>Activá los avisos para enterarte apenas haya novedades.</Text>
      <Pressable onPress={activate} disabled={busy}>
        <Text style={styles.action}>{busy ? "..." : "Activar"}</Text>
      </Pressable>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: colors.brandSoft,
    borderRadius: radius.lg,
    padding: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  text: { flex: 1, fontSize: 13, color: colors.ink },
  action: { fontSize: 13, fontWeight: "700", color: colors.brand },
  error: { fontSize: 11, color: colors.danger, position: "absolute", bottom: -18, left: spacing.md },
});
