/**
 * Dónde cree la app que está la API.
 *
 * Equivocarse acá no da un error visible: da una app que carga bien y no puede
 * hacer una sola llamada. Y como el valor se lee al importar el módulo, cada
 * caso necesita resetear módulos y volver a importar.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

async function loadWith(value: string | undefined) {
  vi.resetModules();
  if (value === undefined) {
    vi.stubEnv("VITE_API_URL", "");
  } else {
    vi.stubEnv("VITE_API_URL", value);
  }
  return import("./apiBase");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function stubLocation(protocol: string, host: string) {
  vi.stubGlobal("window", { location: { protocol, host } });
}

describe("apiBase", () => {
  it("sin configurar, apunta al mismo origen en la raíz", async () => {
    const { apiBase, isSameOrigin } = await loadWith(undefined);
    expect(apiBase).toBe("");
    expect(isSameOrigin).toBe(true);
  });

  it("acepta un prefijo de ruta, que es como se despliega en producción", async () => {
    const { apiBase, isSameOrigin } = await loadWith("/api");
    expect(apiBase).toBe("/api");
    expect(isSameOrigin).toBe(true);
  });

  it("deja pasar una URL completa a otro dominio", async () => {
    const { apiBase, isSameOrigin } = await loadWith("https://api.club.com");
    expect(apiBase).toBe("https://api.club.com");
    expect(isSameOrigin).toBe(false);
  });

  it("a un host pelado le asume https, no http", async () => {
    // Es lo que escribe alguien que copió el host de un panel de hosting.
    // Asumir http ahí sería mandar contraseñas en claro.
    const { apiBase } = await loadWith("api.club.com");
    expect(apiBase).toBe("https://api.club.com");
  });

  it("ignora la barra final, que se cuela al copiar y pegar", async () => {
    const { apiBase } = await loadWith("https://api.club.com/");
    expect(apiBase).toBe("https://api.club.com");
  });
});

describe("wsBase", () => {
  it("en mismo origen hereda https como wss", async () => {
    // Si la página es https y el socket ws, el browser lo bloquea por contenido
    // mixto — y el cronómetro deja de sincronizar en pleno partido.
    stubLocation("https:", "app.club.com");
    const { wsBase } = await loadWith("/api");
    expect(wsBase()).toBe("wss://app.club.com/api");
  });

  it("en mismo origen sobre http usa ws", async () => {
    stubLocation("http:", "localhost:3000");
    const { wsBase } = await loadWith(undefined);
    expect(wsBase()).toBe("ws://localhost:3000");
  });

  it("con API en otro dominio usa el host de la API, no el de la página", async () => {
    stubLocation("https:", "app.club.com");
    const { wsBase } = await loadWith("https://api.club.com");
    expect(wsBase()).toBe("wss://api.club.com");
  });

  it("conserva el prefijo de ruta de una API en otro dominio", async () => {
    stubLocation("https:", "app.club.com");
    const { wsBase } = await loadWith("https://api.club.com/v1");
    expect(wsBase()).toBe("wss://api.club.com/v1");
  });
});
