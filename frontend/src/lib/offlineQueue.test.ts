import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import api from "./axios";
import {
  clearSession,
  enqueue,
  flush,
  isLocalId,
  pendingCount,
  pendingEvents,
  postEvent,
  removeQueued,
  subscribe,
} from "./offlineQueue";

const STAMP = { timer_seconds: 725, half: 1 };

/** Error de red: axios no adjunta `response` cuando la request nunca llegó. */
function networkError() {
  return Object.assign(new Error("Network Error"), { code: "ERR_NETWORK" });
}

/** Rechazo del servidor: hay `response`, reintentar no cambia nada. */
function serverError(status: number) {
  return Object.assign(new Error(`Request failed with status ${status}`), {
    response: { status, data: { detail: "nope" } },
  });
}

function setOnline(value: boolean) {
  Object.defineProperty(navigator, "onLine", { value, configurable: true });
}

beforeEach(() => {
  localStorage.clear();
  setOnline(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("postEvent", () => {
  it("envía directo cuando hay conexión y no encola nada", async () => {
    const post = vi.spyOn(api, "post").mockResolvedValue({ data: {} } as never);

    const result = await postEvent("s1", { event_type: "try", team: "user" }, STAMP);

    expect(result.queued).toBe(false);
    expect(pendingCount()).toBe(0);
    // Online el sello lo pone el servidor, que es la fuente autoritativa.
    expect(post).toHaveBeenCalledWith("/sessions/s1/events", {
      event_type: "try",
      team: "user",
    });
  });

  it("encola con el tiempo de partido cuando el navegador está offline", async () => {
    setOnline(false);
    const post = vi.spyOn(api, "post");

    const result = await postEvent("s1", { event_type: "try", team: "user" }, STAMP);

    expect(post).not.toHaveBeenCalled();
    expect(result.queued).toBe(true);
    expect(pendingEvents("s1")[0].body).toEqual({
      event_type: "try",
      team: "user",
      timer_seconds: 725,
      half: 1,
    });
  });

  it("encola cuando el POST falla por red", async () => {
    vi.spyOn(api, "post").mockRejectedValue(networkError());

    const result = await postEvent("s1", { event_type: "drop", team: "user" }, STAMP);

    expect(result.queued).toBe(true);
    expect(pendingCount("s1")).toBe(1);
  });

  it("propaga el error y NO encola cuando el servidor rechaza", async () => {
    vi.spyOn(api, "post").mockRejectedValue(serverError(403));

    await expect(
      postEvent("s1", { event_type: "drop", team: "user" }, STAMP)
    ).rejects.toBeTruthy();
    expect(pendingCount()).toBe(0);
  });

  it("el id local es reconocible", async () => {
    setOnline(false);
    const result = await postEvent("s1", { event_type: "try", team: "user" }, STAMP);
    expect(isLocalId(result.local!.id)).toBe(true);
  });
});

describe("flush", () => {
  it("envía todo lo encolado y vacía la cola", async () => {
    enqueue("s1", { event_type: "try", team: "user" });
    enqueue("s1", { event_type: "drop", team: "user" });
    const post = vi.spyOn(api, "post").mockResolvedValue({ data: {} } as never);

    const result = await flush();

    expect(result).toEqual({ sent: 2, discarded: 0, remaining: 0 });
    expect(post).toHaveBeenCalledTimes(2);
    expect(pendingCount()).toBe(0);
  });

  it("respeta el orden de registro", async () => {
    enqueue("s1", { event_type: "primero", team: "user" });
    enqueue("s1", { event_type: "segundo", team: "user" });
    const post = vi.spyOn(api, "post").mockResolvedValue({ data: {} } as never);

    await flush();

    expect(post.mock.calls.map((c) => (c[1] as any).event_type)).toEqual([
      "primero",
      "segundo",
    ]);
  });

  it("corta ante una falla de red y conserva la cola para el próximo intento", async () => {
    enqueue("s1", { event_type: "try", team: "user" });
    enqueue("s1", { event_type: "drop", team: "user" });
    vi.spyOn(api, "post").mockRejectedValue(networkError());

    const result = await flush();

    expect(result.sent).toBe(0);
    expect(result.remaining).toBe(2);
  });

  it("descarta el evento que el servidor rechaza y sigue con el resto", async () => {
    enqueue("s1", { event_type: "invalido", team: "user" });
    enqueue("s1", { event_type: "valido", team: "user" });
    vi.spyOn(api, "post")
      .mockRejectedValueOnce(serverError(422))
      .mockResolvedValueOnce({ data: {} } as never);

    const result = await flush();

    expect(result).toEqual({ sent: 1, discarded: 1, remaining: 0 });
  });

  it("no reenvía lo que quedó a medias en un flush anterior", async () => {
    enqueue("s1", { event_type: "a", team: "user" });
    enqueue("s1", { event_type: "b", team: "user" });
    vi.spyOn(api, "post")
      .mockResolvedValueOnce({ data: {} } as never)
      .mockRejectedValueOnce(networkError());

    await flush();
    expect(pendingEvents().map((e) => e.body.event_type)).toEqual(["b"]);

    vi.spyOn(api, "post").mockResolvedValue({ data: {} } as never);
    const second = await flush();
    expect(second.sent).toBe(1);
    expect(pendingCount()).toBe(0);
  });

  it("con la cola vacía no hace nada", async () => {
    const post = vi.spyOn(api, "post");
    expect(await flush()).toEqual({ sent: 0, discarded: 0, remaining: 0 });
    expect(post).not.toHaveBeenCalled();
  });
});

describe("administración de la cola", () => {
  it("pendingEvents filtra por sesión", () => {
    enqueue("s1", { event_type: "a", team: "user" });
    enqueue("s2", { event_type: "b", team: "user" });

    expect(pendingCount("s1")).toBe(1);
    expect(pendingCount("s2")).toBe(1);
    expect(pendingCount()).toBe(2);
  });

  it("removeQueued descarta un evento sin tocar los demás", () => {
    const first = enqueue("s1", { event_type: "a", team: "user" });
    enqueue("s1", { event_type: "b", team: "user" });

    removeQueued(first.id);

    expect(pendingEvents("s1").map((e) => e.body.event_type)).toEqual(["b"]);
  });

  it("clearSession sólo limpia la sesión indicada", () => {
    enqueue("s1", { event_type: "a", team: "user" });
    enqueue("s2", { event_type: "b", team: "user" });

    clearSession("s1");

    expect(pendingCount("s1")).toBe(0);
    expect(pendingCount("s2")).toBe(1);
  });

  it("la cola sobrevive a una recarga de la página", () => {
    enqueue("s1", { event_type: "try", team: "user", timer_seconds: 900, half: 2 });

    // Simula el arranque limpio del módulo leyendo el mismo localStorage.
    const raw = JSON.parse(localStorage.getItem("match_analisis:event_queue:v1")!);

    expect(raw).toHaveLength(1);
    expect(raw[0].body.timer_seconds).toBe(900);
  });

  it("un localStorage corrupto no rompe la lectura", () => {
    localStorage.setItem("match_analisis:event_queue:v1", "{no es json");
    expect(pendingEvents()).toEqual([]);
  });

  it("notifica a los suscriptores en cada cambio", () => {
    const listener = vi.fn();
    const unsubscribe = subscribe(listener);

    enqueue("s1", { event_type: "a", team: "user" });
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    enqueue("s1", { event_type: "b", team: "user" });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
