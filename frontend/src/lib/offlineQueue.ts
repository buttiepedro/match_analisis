import { useSyncExternalStore } from "react";
import api from "./axios";

const STORAGE_KEY = "match_analisis:event_queue:v1";
const RETRY_INTERVAL_MS = 15000;

export interface QueuedEvent {
  /** id local, prefijado `local:` para distinguirlo de los ids del servidor */
  id: string;
  /**
   * Agrupador para filtrar y limpiar: id de sesión para eventos de partido, id
   * de entrenamiento para asistencia.
   */
  scope?: string;
  /** Sólo lo traen los ítems encolados antes de generalizar la cola. */
  sessionId?: string;
  /** Ausente en ítems legacy, que siempre eran POST al endpoint de eventos. */
  method?: "post" | "put";
  url?: string;
  body: Record<string, unknown>;
  queuedAt: number;
}

/**
 * Los tres resolvers de abajo existen para que un ítem encolado con la versión
 * anterior — que sólo guardaba `sessionId` y asumía POST a `/events` — se siga
 * enviando bien después de un deploy. Descartarlos sería perder los eventos de
 * un partido que se jugó sin señal.
 */
function scopeOf(item: QueuedEvent): string {
  return item.scope ?? item.sessionId ?? "";
}

function urlOf(item: QueuedEvent): string {
  return item.url ?? `/sessions/${scopeOf(item)}/events`;
}

function methodOf(item: QueuedEvent): "post" | "put" {
  return item.method ?? "post";
}

type Listener = () => void;

const listeners = new Set<Listener>();
let retryTimer: ReturnType<typeof setInterval> | null = null;
let flushing = false;

// ── Persistencia ──────────────────────────────────────────────────────────────

function read(): QueuedEvent[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as QueuedEvent[]) : [];
  } catch {
    return [];
  }
}

function write(queue: QueuedEvent[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
  } catch {
    // localStorage lleno o bloqueado: la cola queda sólo en memoria del render actual.
  }
  listeners.forEach((l) => l());
}

function localId(): string {
  return `local:${Date.now()}:${Math.random().toString(36).slice(2, 9)}`;
}

// ── API pública ───────────────────────────────────────────────────────────────

export function pendingEvents(scope?: string): QueuedEvent[] {
  const all = read();
  return scope ? all.filter((e) => scopeOf(e) === scope) : all;
}

export function pendingCount(sessionId?: string): number {
  return pendingEvents(sessionId).length;
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Cantidad de eventos pendientes de envío, reactiva. */
export function usePendingCount(sessionId?: string): number {
  return useSyncExternalStore(
    subscribe,
    () => pendingCount(sessionId),
    () => 0
  );
}

export function enqueue(sessionId: string, body: Record<string, unknown>): QueuedEvent {
  const item: QueuedEvent = {
    id: localId(),
    scope: sessionId,
    sessionId,
    body,
    queuedAt: Date.now(),
  };
  write([...read(), item]);
  ensureRetryTimer();
  return item;
}

/**
 * Encola una request cualquiera. A diferencia de `enqueue`, que siempre apunta al
 * endpoint de eventos, acá el llamador define método y URL.
 *
 * Para que reintentar sea seguro el endpoint destino tiene que ser idempotente:
 * la asistencia usa `PUT` de la planilla completa justamente por eso.
 */
export function enqueueRequest(
  scope: string,
  method: "post" | "put",
  url: string,
  body: Record<string, unknown>
): QueuedEvent {
  const item: QueuedEvent = { id: localId(), scope, method, url, body, queuedAt: Date.now() };
  // Una planilla más nueva reemplaza a la anterior del mismo entrenamiento: sin
  // esto, quince correcciones offline serían quince requests al reconectar.
  const rest = read().filter((e) => !(scopeOf(e) === scope && e.url === url));
  write([...rest, item]);
  ensureRetryTimer();
  return item;
}

/**
 * Distingue una caída de red (recuperable, va a la cola) de un rechazo del
 * servidor (403, 422 — reintentar no sirve). Axios no expone `response` cuando
 * la request nunca llegó a destino.
 */
function isNetworkFailure(err: unknown): boolean {
  const e = err as { response?: unknown; code?: string };
  if (e?.response) return false;
  return true;
}

export interface PostEventResult {
  queued: boolean;
  /** Presente sólo cuando quedó encolado, para poder mostrarlo optimistamente. */
  local?: QueuedEvent;
}

/**
 * Registra un evento. Si hay conectividad lo manda directo y deja que el
 * servidor lo selle con su propio timer (autoritativo). Si no la hay, lo encola
 * junto con el tiempo de partido del momento, para que al reenviarlo conserve el
 * minuto real del hecho y no el de la reconexión.
 */
export async function postEvent(
  sessionId: string,
  body: Record<string, unknown>,
  stamp: { timer_seconds: number; half: number }
): Promise<PostEventResult> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return { queued: true, local: enqueue(sessionId, { ...body, ...stamp }) };
  }

  try {
    await api.post(`/sessions/${sessionId}/events`, body);
    return { queued: false };
  } catch (err) {
    if (isNetworkFailure(err)) {
      return { queued: true, local: enqueue(sessionId, { ...body, ...stamp }) };
    }
    throw err;
  }
}

export interface FlushResult {
  sent: number;
  discarded: number;
  remaining: number;
}

/**
 * Reenvía la cola en orden. Ante una falla de red corta y deja el resto para el
 * próximo intento; ante un rechazo del servidor descarta ese ítem (reintentarlo
 * lo dejaría trabado para siempre) y sigue con los demás.
 */
export async function flush(): Promise<FlushResult> {
  if (flushing) return { sent: 0, discarded: 0, remaining: pendingCount() };
  flushing = true;

  let sent = 0;
  let discarded = 0;

  try {
    while (true) {
      const queue = read();
      if (queue.length === 0) break;

      const [head, ...rest] = queue;
      try {
        await api[methodOf(head)](urlOf(head), head.body);
        sent += 1;
        write(rest);
      } catch (err) {
        if (isNetworkFailure(err)) break;
        console.warn("[offlineQueue] request descartada por rechazo del servidor", head, err);
        discarded += 1;
        write(rest);
      }
    }
  } finally {
    flushing = false;
  }

  const remaining = pendingCount();
  if (remaining === 0) stopRetryTimer();
  return { sent, discarded, remaining };
}

export function clearSession(sessionId: string): void {
  write(read().filter((e) => scopeOf(e) !== sessionId));
}

export interface PutResult {
  queued: boolean;
}

/**
 * `PUT` tolerante a cortes, para escrituras idempotentes como la planilla de
 * asistencia. Mismo criterio que `postEvent`: falla de red va a la cola, rechazo
 * del servidor se propaga.
 */
export async function putQueued(
  scope: string,
  url: string,
  body: Record<string, unknown>
): Promise<PutResult> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    enqueueRequest(scope, "put", url, body);
    return { queued: true };
  }

  try {
    await api.put(url, body);
    return { queued: false };
  } catch (err) {
    if (isNetworkFailure(err)) {
      enqueueRequest(scope, "put", url, body);
      return { queued: true };
    }
    throw err;
  }
}

/** Descarta un evento encolado que el usuario borró antes de que se enviara. */
export function removeQueued(id: string): void {
  write(read().filter((e) => e.id !== id));
}

export function isLocalId(id: string): boolean {
  return id.startsWith("local:");
}

// ── Reintento automático ──────────────────────────────────────────────────────

function ensureRetryTimer(): void {
  if (retryTimer) return;
  retryTimer = setInterval(() => {
    if (pendingCount() > 0) void flush();
    else stopRetryTimer();
  }, RETRY_INTERVAL_MS);
}

function stopRetryTimer(): void {
  if (retryTimer) {
    clearInterval(retryTimer);
    retryTimer = null;
  }
}

/** Se instala una sola vez al cargar el módulo. */
if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    if (pendingCount() > 0) void flush();
  });
  if (pendingCount() > 0) ensureRetryTimer();
}
