import { PropsWithChildren } from "react";
import {
  ActivityIndicator,
  Pressable,
  PressableProps,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { colors, radius, spacing } from "../theme";

/**
 * Kit chico de piezas reusadas por todas las pantallas del portal — mismo
 * espíritu que las clases utilitarias de `frontend/` (tarjeta con fondo
 * `surface`, texto `ink-muted`, etc.), pero como componentes de RN. Ver
 * [[app-movil]].
 */

export function Card({ children, style }: PropsWithChildren<{ style?: object }>) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function SectionLabel({ children }: PropsWithChildren) {
  return <Text style={styles.sectionLabel}>{children}</Text>;
}

export function EmptyState({ children }: PropsWithChildren) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyText}>{children}</Text>
    </View>
  );
}

export function ErrorBanner({ children }: PropsWithChildren) {
  if (!children) return null;
  return (
    <View style={styles.errorBanner}>
      <Text style={styles.errorText}>{children}</Text>
    </View>
  );
}

export function Loading() {
  return (
    <View style={styles.loading}>
      <ActivityIndicator color={colors.brand} />
    </View>
  );
}

export function Pill({
  label,
  tone = "neutral",
}: {
  label: string;
  tone?: "brand" | "danger" | "sky" | "amber" | "neutral";
}) {
  const palette: Record<string, { bg: string; fg: string }> = {
    brand: { bg: colors.brandSoft, fg: colors.brand },
    danger: { bg: colors.dangerSoft, fg: colors.danger },
    sky: { bg: colors.skySoft, fg: colors.sky },
    amber: { bg: colors.amberSoft, fg: colors.amber },
    neutral: { bg: colors.surfaceStrong, fg: colors.inkSoft },
  };
  const c = palette[tone];
  return (
    <View style={[styles.pill, { backgroundColor: c.bg }]}>
      <Text style={[styles.pillText, { color: c.fg }]}>{label}</Text>
    </View>
  );
}

interface ButtonProps extends PressableProps {
  label: string;
  variant?: "primary" | "secondary" | "danger";
  loading?: boolean;
}

export function Button({ label, variant = "primary", loading, disabled, style, ...rest }: ButtonProps) {
  const isDisabled = disabled || loading;
  return (
    <Pressable
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.button,
        variant === "primary" && styles.buttonPrimary,
        variant === "secondary" && styles.buttonSecondary,
        variant === "danger" && styles.buttonDanger,
        isDisabled && styles.buttonDisabled,
        pressed && !isDisabled && styles.buttonPressed,
        style as object,
      ]}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator color={variant === "secondary" ? colors.brand : colors.white} />
      ) : (
        <Text
          style={[
            styles.buttonText,
            variant === "secondary" && { color: colors.brand },
          ]}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { key: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={styles.segmented}>
      {options.map((o) => (
        <Pressable
          key={o.key}
          onPress={() => onChange(o.key)}
          style={[styles.segment, value === o.key && styles.segmentActive]}
        >
          <Text style={[styles.segmentText, value === o.key && styles.segmentTextActive]}>
            {o.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    overflow: "hidden",
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.inkMuted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
  },
  empty: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
    alignItems: "center",
  },
  emptyText: {
    color: colors.inkMuted,
    fontSize: 14,
    textAlign: "center",
  },
  errorBanner: {
    backgroundColor: colors.dangerSoft,
    borderRadius: radius.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  errorText: { color: colors.danger, fontSize: 13 },
  loading: { paddingVertical: spacing.xl * 2, alignItems: "center" },
  pill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.full,
    alignSelf: "flex-start",
  },
  pillText: { fontSize: 11, fontWeight: "700" },
  button: {
    borderRadius: radius.md,
    paddingVertical: 13,
    paddingHorizontal: spacing.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonPrimary: { backgroundColor: colors.brand },
  buttonSecondary: { backgroundColor: colors.surfaceStrong },
  buttonDanger: { backgroundColor: colors.danger },
  buttonDisabled: { opacity: 0.5 },
  buttonPressed: { opacity: 0.85 },
  buttonText: { color: colors.white, fontWeight: "600", fontSize: 15 },
  segmented: {
    flexDirection: "row",
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: 4,
    gap: 4,
  },
  segment: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    alignItems: "center",
  },
  segmentActive: { backgroundColor: colors.brand },
  segmentText: { fontSize: 13, fontWeight: "600", color: colors.inkMuted },
  segmentTextActive: { color: colors.white },
});
