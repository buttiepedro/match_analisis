import { PropsWithChildren } from "react";
import { RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, spacing } from "../theme";

interface Props extends PropsWithChildren {
  /** Si se pasa, envuelve el contenido en un `ScrollView` con pull-to-refresh. */
  onRefresh?: () => void;
  refreshing?: boolean;
  scroll?: boolean;
}

/** Marco común: fondo blanco, safe area, padding — evita repetirlo pantalla por pantalla. */
export default function Screen({ children, onRefresh, refreshing, scroll = true }: Props) {
  const content = scroll ? (
    <ScrollView
      contentContainerStyle={styles.scrollContent}
      refreshControl={
        onRefresh ? (
          <RefreshControl refreshing={Boolean(refreshing)} onRefresh={onRefresh} tintColor={colors.brand} />
        ) : undefined
      }
    >
      {children}
    </ScrollView>
  ) : (
    <View style={styles.scrollContent}>{children}</View>
  );

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      {content}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.white },
  scrollContent: { padding: spacing.lg, paddingBottom: spacing.xl * 2 },
});
