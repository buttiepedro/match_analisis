import { Stack } from "expo-router";
import { useEffect } from "react";
import { View } from "react-native";
import { useAuthStore } from "../src/store/authStore";

/**
 * Guarda de rutas con `Stack.Protected` — patrón actual de expo-router.
 * Tres estados excluyentes: sesión válida, sesión que exige cambiar la
 * contraseña (mismo flujo que `must_change_password` en la web), y sin
 * sesión. Ver [[app-movil]].
 */
export default function RootLayout() {
  const status = useAuthStore((s) => s.status);
  const bootstrap = useAuthStore((s) => s.bootstrap);
  const mustChangePassword = useAuthStore((s) => Boolean(s.user?.must_change_password));

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  if (status === "loading") {
    return <View style={{ flex: 1, backgroundColor: "#ffffff" }} />;
  }

  const authenticated = status === "authenticated";

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={authenticated && !mustChangePassword}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen
          name="nutricion"
          options={{ headerShown: true, title: "Turno de nutrición" }}
        />
        <Stack.Screen
          name="bolsa"
          options={{ headerShown: true, title: "Bolsa de trabajo" }}
        />
        <Stack.Screen
          name="gimnasio"
          options={{ headerShown: true, title: "Gimnasio" }}
        />
      </Stack.Protected>

      <Stack.Protected guard={authenticated && mustChangePassword}>
        <Stack.Screen name="cambiar-password" />
      </Stack.Protected>

      <Stack.Protected guard={!authenticated}>
        <Stack.Screen name="login" />
      </Stack.Protected>
    </Stack>
  );
}
