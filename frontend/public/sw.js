/**
 * Service worker mínimo, sólo para push.
 *
 * No cachea nada a propósito: esto no convierte la app en una PWA
 * offline-first, sólo registra el canal de push. Si el día de mañana se
 * decide perseguir la limitación de iOS por ese lado, es un cambio aparte.
 */

self.addEventListener("install", () => {
  // Sin cachear nada, no hay razón para esperar: se activa apenas se instala.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "match_analisis", body: event.data.text() };
  }

  const { title, body, data } = payload;

  event.waitUntil(
    // Sin `icon`/`badge`: el proyecto todavía no tiene un asset de marca para
    // esto, y el browser usa un ícono por defecto sin romper nada.
    self.registration.showNotification(title || "match_analisis", {
      body: body || "",
      data: data || {},
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      // Si ya hay una pestaña de la app abierta, la enfoca y navega ahí en vez
      // de abrir una ventana nueva.
      for (const client of clients) {
        if ("focus" in client) {
          client.postMessage({ type: "notification-click", url });
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(url);
      }
    })
  );
});
