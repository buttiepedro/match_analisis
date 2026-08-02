import { useEffect, useState } from "react";
import { Linking, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import Screen from "../src/components/Screen";
import { Button, Card, EmptyState, ErrorBanner, Loading, Pill, SegmentedControl } from "../src/components/Kit";
import api from "../src/lib/api";
import { parseApiError } from "../src/lib/errors";
import { useAuthStore } from "../src/store/authStore";
import { colors, radius, spacing } from "../src/theme";

interface JobPost {
  id: string;
  kind: "busca" | "ofrece";
  title: string;
  description: string;
  contact: string;
  status: string;
  author_name: string;
  expires_on: string | null;
}

const KIND_LABEL: Record<string, string> = { busca: "Busca", ofrece: "Ofrece" };
const EMPTY = { kind: "busca" as "busca" | "ofrece", title: "", description: "", contact: "" };

function daysLeft(iso: string): string {
  const days = Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
  if (days <= 0) return "vence hoy";
  if (days === 1) return "vence mañana";
  return `vence en ${days} días`;
}

/**
 * Lectura y publicación — sin moderación, que es una acción del club
 * ([[bolsa-trabajo]]). Mismo backend que `frontend/src/pages/JobBoard.tsx`,
 * sin el compositor de texto enriquecido ni imagen de portada (fuera de
 * alcance de la v1, ver [[app-movil]]).
 */
export default function Bolsa() {
  const user = useAuthStore((s) => s.user);
  const canPost = (user?.permissions ?? []).includes("bolsa.publicar");
  const clubId = user?.club_id;

  const [view, setView] = useState<"bolsa" | "mios">("bolsa");
  const [posts, setPosts] = useState<JobPost[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [composing, setComposing] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);

  const load = () => {
    if (!clubId) return;
    setLoading(true);
    api
      .get<JobPost[]>(`/clubs/${clubId}/job-posts`, { params: { mine: view === "mios" || undefined } })
      .then(({ data }) => setPosts(data))
      .catch((err) => setError(parseApiError(err, "No se pudo cargar la bolsa")))
      .finally(() => setLoading(false));
  };

  useEffect(load, [clubId, view]);

  const crear = async () => {
    if (!clubId) return;
    setBusy(true);
    setError("");
    try {
      await api.post(`/clubs/${clubId}/job-posts`, form);
      setForm(EMPTY);
      setComposing(false);
      load();
    } catch (err) {
      setError(parseApiError(err, "No se pudo crear el aviso"));
    } finally {
      setBusy(false);
    }
  };

  if (!clubId) return null;

  const listo = form.title.trim() && form.description.trim() && form.contact.trim();

  return (
    <Screen onRefresh={load} refreshing={loading}>
      <Text style={styles.subtitle}>
        Sólo para socios del club. Los avisos se revisan antes de publicarse y vencen a los 30 días.
      </Text>

      {canPost && (
        <View style={{ marginBottom: spacing.md }}>
          <SegmentedControl
            value={view}
            onChange={setView}
            options={[
              { key: "bolsa", label: "Avisos" },
              { key: "mios", label: "Mis avisos" },
            ]}
          />
        </View>
      )}

      <ErrorBanner>{error}</ErrorBanner>

      {canPost && (
        composing ? (
          <Card style={{ padding: spacing.md, gap: spacing.sm, marginBottom: spacing.lg }}>
            <SegmentedControl
              value={form.kind}
              onChange={(k) => setForm((f) => ({ ...f, kind: k }))}
              options={[
                { key: "busca", label: "Busca" },
                { key: "ofrece", label: "Ofrece" },
              ]}
            />
            <TextInput
              placeholder="Título — ej: Electricista matriculado"
              placeholderTextColor={colors.inkFaint}
              value={form.title}
              onChangeText={(t) => setForm((f) => ({ ...f, title: t }))}
              style={styles.input}
            />
            <TextInput
              placeholder="Contá de qué se trata"
              placeholderTextColor={colors.inkFaint}
              value={form.description}
              onChangeText={(t) => setForm((f) => ({ ...f, description: t }))}
              multiline
              numberOfLines={4}
              style={[styles.input, styles.textarea]}
            />
            <TextInput
              placeholder="Cómo te contactan — teléfono o mail"
              placeholderTextColor={colors.inkFaint}
              value={form.contact}
              onChangeText={(t) => setForm((f) => ({ ...f, contact: t }))}
              style={styles.input}
            />
            <View style={{ flexDirection: "row", gap: spacing.sm }}>
              <View style={{ flex: 1 }}>
                <Button label={busy ? "Creando..." : "Publicar"} onPress={crear} loading={busy} disabled={!listo} />
              </View>
              <Pressable onPress={() => { setComposing(false); setForm(EMPTY); }} style={styles.cancelBtn}>
                <Text style={styles.cancelText}>Cancelar</Text>
              </Pressable>
            </View>
          </Card>
        ) : (
          <Pressable onPress={() => setComposing(true)} style={styles.composeButton}>
            <Text style={styles.composeText}>+ Publicar un aviso</Text>
          </Pressable>
        )
      )}

      {loading ? (
        <Loading />
      ) : posts.length === 0 ? (
        <EmptyState>
          {view === "mios" ? "Todavía no publicaste ningún aviso." : "Todavía no hay avisos publicados."}
        </EmptyState>
      ) : (
        posts.map((post) => {
          const open = expanded === post.id;
          return (
            <Card key={post.id} style={{ marginBottom: spacing.md }}>
              <Pressable onPress={() => setExpanded(open ? null : post.id)} style={styles.postHeader}>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: "row", gap: spacing.xs, marginBottom: 4 }}>
                    <Pill label={KIND_LABEL[post.kind]} tone={post.kind === "ofrece" ? "brand" : "neutral"} />
                    {post.status !== "publicado" && <Pill label={post.status} tone="amber" />}
                  </View>
                  <Text style={styles.postTitle}>{post.title}</Text>
                  <Text style={styles.postMeta}>
                    {post.author_name}
                    {post.expires_on ? ` · ${daysLeft(post.expires_on)}` : " · sin publicar"}
                  </Text>
                </View>
              </Pressable>
              {open && (
                <View style={styles.postBody}>
                  <Text style={styles.postDescription}>{post.description}</Text>
                  <Text
                    onPress={() => Linking.openURL(`mailto:${post.contact}`).catch(() => {})}
                    style={styles.contactLink}
                  >
                    Contacto: {post.contact}
                  </Text>
                </View>
              )}
            </Card>
          );
        })
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  subtitle: { fontSize: 12, color: colors.inkMuted, marginBottom: spacing.md },
  input: { backgroundColor: colors.surfaceStrong, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: 10, fontSize: 14, color: colors.ink },
  textarea: { minHeight: 80, textAlignVertical: "top" },
  cancelBtn: { justifyContent: "center", paddingHorizontal: spacing.md },
  cancelText: { color: colors.inkMuted, fontSize: 14 },
  composeButton: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    alignItems: "center",
    marginBottom: spacing.lg,
  },
  composeText: { color: colors.ink, fontWeight: "600", fontSize: 14 },
  postHeader: { padding: spacing.md },
  postTitle: { fontSize: 15, fontWeight: "700", color: colors.ink },
  postMeta: { fontSize: 11, color: colors.inkFaint, marginTop: 4 },
  postBody: { paddingHorizontal: spacing.md, paddingBottom: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line, paddingTop: spacing.sm },
  postDescription: { fontSize: 13, color: colors.inkSoft, lineHeight: 19 },
  contactLink: { fontSize: 13, color: colors.brand, fontWeight: "600", marginTop: spacing.sm },
});
