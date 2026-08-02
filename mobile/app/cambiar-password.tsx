import { useState } from "react";
import { KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, View } from "react-native";
import { Button, ErrorBanner } from "../src/components/Kit";
import api from "../src/lib/api";
import { parseApiError } from "../src/lib/errors";
import { useAuthStore } from "../src/store/authStore";
import { colors, radius, spacing } from "../src/theme";

/**
 * Obligatorio en el primer ingreso — mismo criterio que
 * `frontend/src/pages/ChangePassword.tsx`: cierra la ventana entre el
 * import del padrón y el primer ingreso real del socio.
 */
export default function CambiarPassword() {
  const markPasswordChanged = useAuthStore((s) => s.markPasswordChanged);

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (next !== repeat) {
      setError("Las dos contraseñas nuevas no coinciden");
      return;
    }
    setLoading(true);
    setError("");
    try {
      await api.post("/auth/change-password", {
        current_password: current,
        new_password: next,
      });
      markPasswordChanged();
    } catch (err) {
      setError(parseApiError(err, "No se pudo cambiar la contraseña"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={styles.container}>
        <Text style={styles.title}>Elegí tu contraseña</Text>
        <Text style={styles.subtitle}>
          Es tu primer ingreso. Cambiá la contraseña que te dio el club por una tuya.
        </Text>

        <View style={styles.form}>
          <View style={styles.field}>
            <Text style={styles.label}>Contraseña que te dio el club</Text>
            <TextInput
              value={current}
              onChangeText={setCurrent}
              secureTextEntry
              style={styles.input}
            />
          </View>
          <View style={styles.field}>
            <Text style={styles.label}>Nueva contraseña</Text>
            <TextInput value={next} onChangeText={setNext} secureTextEntry style={styles.input} />
            <Text style={styles.hint}>Mínimo 8 caracteres.</Text>
          </View>
          <View style={styles.field}>
            <Text style={styles.label}>Repetila</Text>
            <TextInput value={repeat} onChangeText={setRepeat} secureTextEntry style={styles.input} />
          </View>

          <ErrorBanner>{error}</ErrorBanner>

          <Button label={loading ? "Guardando..." : "Guardar"} onPress={submit} loading={loading} />
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.white },
  container: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
    maxWidth: 400,
    width: "100%",
    alignSelf: "center",
  },
  title: { fontSize: 22, fontWeight: "700", color: colors.ink, textAlign: "center" },
  subtitle: {
    fontSize: 14,
    color: colors.inkMuted,
    textAlign: "center",
    marginTop: 4,
    marginBottom: spacing.xl,
  },
  form: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md },
  field: { gap: 4 },
  label: { fontSize: 13, color: colors.inkSoft },
  input: {
    backgroundColor: colors.surfaceStrong,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.ink,
  },
  hint: { fontSize: 11, color: colors.inkFaint },
});
