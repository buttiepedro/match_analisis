import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Button } from "../src/components/Kit";
import { useAuthStore } from "../src/store/authStore";
import { colors, radius, spacing } from "../src/theme";

interface ClubOption {
  slug: string;
  name: string;
}

/**
 * Mismo flujo que `frontend/src/pages/Login.tsx`: email o DNI, y el
 * selector de club sólo aparece si el mismo DNI resuelve a más de un club
 * (409 con `detail.clubs`). Ver [[app-movil]], "Resolución de club" —
 * camino 1 (selector), sin depender de subdominios.
 */
export default function Login() {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [clubs, setClubs] = useState<ClubOption[]>([]);
  const [clubSlug, setClubSlug] = useState("");
  const login = useAuthStore((s) => s.login);

  const handleSubmit = async () => {
    setError("");
    setLoading(true);
    try {
      await login(identifier, password, clubSlug || undefined);
      // La navegación la resuelve `_layout.tsx` solo: cambia `status` y el
      // guard de `Stack.Protected` conmuta a `(tabs)`.
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      if (err?.response?.status === 409 && detail?.clubs) {
        setClubs(detail.clubs);
        setClubSlug(detail.clubs[0]?.slug ?? "");
        setError(detail.message ?? "Elegí tu club");
      } else {
        setError("Usuario o contraseña incorrectos");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.container}>
        <Text style={styles.title}>Rugby Analisis</Text>
        <Text style={styles.subtitle}>Portal del socio y del jugador</Text>

        <View style={styles.form}>
          <View style={styles.field}>
            <Text style={styles.label}>Email o DNI</Text>
            <TextInput
              value={identifier}
              onChangeText={(t) => {
                setIdentifier(t);
                setClubs([]);
                setClubSlug("");
              }}
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.input}
              placeholder="tu@email.com o tu DNI"
              placeholderTextColor={colors.inkFaint}
            />
            <Text style={styles.hint}>Si sos socio, ingresá con tu DNI sin puntos.</Text>
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Contraseña</Text>
            <TextInput
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              style={styles.input}
              placeholder="••••••••"
              placeholderTextColor={colors.inkFaint}
            />
          </View>

          {clubs.length > 0 && (
            <View style={styles.field}>
              <Text style={styles.label}>Club</Text>
              <View style={styles.clubList}>
                {clubs.map((c) => (
                  <Text
                    key={c.slug}
                    onPress={() => setClubSlug(c.slug)}
                    style={[
                      styles.clubOption,
                      clubSlug === c.slug && styles.clubOptionActive,
                    ]}
                  >
                    {c.name}
                  </Text>
                ))}
              </View>
            </View>
          )}

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Button label={loading ? "Ingresando..." : "Ingresar"} onPress={handleSubmit} loading={loading} />
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
  title: { fontSize: 26, fontWeight: "700", color: colors.ink, textAlign: "center" },
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
  error: { color: colors.danger, fontSize: 13, textAlign: "center" },
  clubList: { gap: spacing.xs },
  clubOption: {
    backgroundColor: colors.surfaceStrong,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontSize: 14,
    color: colors.ink,
  },
  clubOptionActive: {
    backgroundColor: colors.brandSoft,
    color: colors.brand,
    fontWeight: "600",
  },
});
