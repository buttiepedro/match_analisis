import { PropsWithChildren, ReactNode, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, radius, spacing } from "../theme";

/**
 * Una sección por división, colapsable. Puerto de
 * `frontend/src/components/DivisionAccordion.tsx` — compartido por Club
 * (fixture/tablas/citados): la propia división primero, la primera
 * expandida, el resto colapsado.
 */
export default function DivisionAccordion({
  title,
  defaultOpen,
  badge,
  children,
}: PropsWithChildren<{
  title: string;
  defaultOpen: boolean;
  badge?: ReactNode;
}>) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <View style={styles.container}>
      <Pressable onPress={() => setOpen((o) => !o)} style={styles.header}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        {badge}
        <Text style={styles.chevron}>{open ? "▴" : "▾"}</Text>
      </Pressable>
      {open && <View style={styles.body}>{children}</View>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    overflow: "hidden",
    marginBottom: spacing.md,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  title: { flex: 1, fontSize: 14, fontWeight: "600", color: colors.ink },
  chevron: { color: colors.inkFaint },
  body: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
});
