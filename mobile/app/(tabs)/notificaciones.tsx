import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Screen from "../../src/components/Screen";
import { EmptyState, ErrorBanner, Loading } from "../../src/components/Kit";
import api from "../../src/lib/api";
import { parseApiError } from "../../src/lib/errors";
import { colors, radius, spacing } from "../../src/theme";

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  data: { url?: string; [key: string]: unknown };
  read_at: string | null;
  created_at: string;
}

function timeAgo(iso: string): string {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "recién";
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `hace ${days} día(s)`;
  return new Date(iso).toLocaleDateString("es-AR", { day: "numeric", month: "short" });
}

/**
 * La bandeja: mismo backend que la web (`GET /me/notifications`). El
 * `data.url` que manda cada disparador es una ruta de `frontend/` (ej.
 * `/mi-formacion/:id`), que no existe en esta app — no hay tablero de
 * partido en la v1 ([[app-movil]], "El recorte"). Se toca igual y se
 * marca leída; navegar a ese `url` queda pendiente hasta que haya una
 * pantalla equivalente del lado de la app.
 */
export default function Notificaciones() {
  const router = useRouter();
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    api
      .get<Notification[]>("/me/notifications")
      .then(({ data }) => setItems(data))
      .catch((err) => setError(parseApiError(err, "No se pudieron cargar las notificaciones")))
      .finally(() => setLoading(false));
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const open = async (n: Notification) => {
    if (!n.read_at) {
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)));
      api.post(`/me/notifications/${n.id}/read`).catch(() => {});
    }
    if (n.data?.url === "/nutricion" || n.data?.url?.startsWith("/nutricion")) {
      router.push("/nutricion");
    }
  };

  if (loading && items.length === 0) {
    return (
      <Screen scroll={false}>
        <Loading />
      </Screen>
    );
  }

  return (
    <Screen onRefresh={load} refreshing={loading}>
      <ErrorBanner>{error}</ErrorBanner>

      {items.length === 0 ? (
        <EmptyState>Todavía no tenés notificaciones.</EmptyState>
      ) : (
        <View style={styles.list}>
          {items.map((n, i) => (
            <Pressable
              key={n.id}
              onPress={() => open(n)}
              style={[
                styles.item,
                i > 0 && styles.itemBorder,
                !n.read_at && styles.itemUnread,
              ]}
            >
              {!n.read_at && <View style={styles.dot} />}
              <View style={styles.itemBody}>
                <Text style={styles.itemTitle}>{n.title}</Text>
                <Text style={styles.itemText}>{n.body}</Text>
                <Text style={styles.itemTime}>{timeAgo(n.created_at)}</Text>
              </View>
            </Pressable>
          ))}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { backgroundColor: colors.surface, borderRadius: radius.lg, overflow: "hidden" },
  item: { flexDirection: "row", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  itemBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  itemUnread: { backgroundColor: colors.brandSoft },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.brand, marginTop: 6 },
  itemBody: { flex: 1, gap: 2 },
  itemTitle: { fontSize: 14, fontWeight: "600", color: colors.ink },
  itemText: { fontSize: 13, color: colors.inkSoft },
  itemTime: { fontSize: 11, color: colors.inkFaint, marginTop: 2 },
});
