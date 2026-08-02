import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import api from "./api";

/**
 * Registro de push nativo — mismo backend que la web
 * (`POST /me/notification-devices`, ver [[notificaciones]]), con
 * `channel='fcm'`/`'apns'` en vez de `'web_push'`. El token lo entrega
 * `expo-notifications` vía el servicio de Expo Push, que es quien realmente
 * le habla a FCM/APNs — la app nunca gestiona certificados a mano. Ver
 * [[app-movil]].
 */

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export function isPushSupported(): boolean {
  // El simulador/emulador no recibe push de verdad, y expo-notifications
  // tira si se le pide un token ahí — mismo criterio que la web descartando
  // navegadores sin PushManager.
  return Device.isDevice;
}

/**
 * Sin projectId (no hay `eas init` corrido — ver [[app-movil]], "Qué falta
 * para publicar"), `getExpoPushTokenAsync` no puede pedir un token. Se
 * devuelve `null` en vez de tirar: la bandeja de notificaciones sigue
 * funcionando igual, sólo el push queda apagado — mismo criterio que
 * `VAPID_PUBLIC_KEY` sin configurar en la web.
 */
function projectId(): string | null {
  return Constants.expoConfig?.extra?.eas?.projectId ?? null;
}

export async function registerForPushNotifications(): Promise<void> {
  if (!isPushSupported()) return;

  const id = projectId();
  if (!id) return;

  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;
  if (existing !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== "granted") return;

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "default",
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  const token = await Notifications.getExpoPushTokenAsync({ projectId: id });
  await api.post("/me/notification-devices", {
    channel: Platform.OS === "ios" ? "apns" : "fcm",
    endpoint: token.data,
  });
}
