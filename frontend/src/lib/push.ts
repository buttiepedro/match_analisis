import api from "./axios";

/**
 * Suscripción del navegador al push. El backend genera las claves VAPID una
 * vez por instalación; acá sólo se pide el permiso, se registra el service
 * worker y se manda la suscripción resultante.
 *
 * El id del device que devuelve el backend se guarda en este navegador para
 * poder des-suscribirse después — es información de **este** dispositivo, no
 * del usuario, así que localStorage (no el store de auth) es donde va.
 */
const DEVICE_ID_KEY = "match_analisis:push_device_id";

export function isPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

async function getRegistration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration();
  return existing ?? navigator.serviceWorker.register("/sw.js");
}

export async function currentPushSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null;
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) return null;
  return registration.pushManager.getSubscription();
}

/** `true` si este navegador ya tiene una suscripción activa. */
export async function isSubscribed(): Promise<boolean> {
  return (await currentPushSubscription()) !== null;
}

export async function subscribeToPush(): Promise<void> {
  if (!isPushSupported()) {
    throw new Error("Este navegador no soporta notificaciones push.");
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("No se otorgó el permiso de notificaciones.");
  }

  const registration = await getRegistration();
  await navigator.serviceWorker.ready;

  const { data: vapid } = await api.get<{ public_key: string }>("/push/vapid-public-key");
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    // El tipo de lib.dom más nuevo exige `BufferSource` estricto; el
    // `Uint8Array` construido acá siempre está respaldado por un
    // `ArrayBuffer` real, nunca por un `SharedArrayBuffer`.
    applicationServerKey: urlBase64ToUint8Array(vapid.public_key) as BufferSource,
  });

  const json = subscription.toJSON();
  const { data: device } = await api.post<{ id: string }>("/me/notification-devices", {
    channel: "web_push",
    endpoint: json.endpoint,
    p256dh: json.keys?.p256dh,
    auth_secret: json.keys?.auth,
  });
  localStorage.setItem(DEVICE_ID_KEY, device.id);
}

export async function unsubscribeFromPush(): Promise<void> {
  const subscription = await currentPushSubscription();
  if (subscription) await subscription.unsubscribe();

  const deviceId = localStorage.getItem(DEVICE_ID_KEY);
  if (deviceId) {
    await api.delete(`/me/notification-devices/${deviceId}`).catch(() => {});
    localStorage.removeItem(DEVICE_ID_KEY);
  }
}
