import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { colors } from "../../src/theme";

/**
 * Cuatro tabs, no cinco ni seis — mismo techo que ya midió
 * [[navigation]] para la barra del frontend web ("cinco era el techo real
 * a 360px"). Turnos de nutrición, gimnasio y bolsa quedan alcanzables desde
 * "Cuenta" en vez de sumar tabs. Ver [[app-movil]].
 */
export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: true,
        tabBarActiveTintColor: colors.brand,
        tabBarInactiveTintColor: colors.inkFaint,
        tabBarStyle: { borderTopColor: colors.line },
        headerStyle: { backgroundColor: colors.white },
        headerTitleStyle: { color: colors.ink },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Hoy",
          tabBarIcon: ({ color, size }) => <Ionicons name="today-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="club"
        options={{
          title: "Club",
          tabBarIcon: ({ color, size }) => <Ionicons name="trophy-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="cuenta"
        options={{
          title: "Cuenta",
          tabBarIcon: ({ color, size }) => <Ionicons name="person-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="notificaciones"
        options={{
          // "Avisos" a secas colisiona con el vocabulario de la bolsa de
          // trabajo (sus propios "avisos") — mismo nombre que usa la web
          // para evitar la ambigüedad.
          title: "Notificaciones",
          tabBarIcon: ({ color, size }) => <Ionicons name="notifications-outline" size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}
