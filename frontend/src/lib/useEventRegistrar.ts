import { useCallback, useState } from "react";
import { parseApiError } from "./errors";
import { postEvent } from "./offlineQueue";
import { timerStamp } from "./timer";
import { sessionWS } from "./ws";
import { useSessionStore, EventData } from "../store/sessionStore";

export interface RegisterOptions {
  team: "user" | "rival";
  reason?: string;
  player_id?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Punto único de registro de eventos del tablero.
 *
 * Resuelve tres cosas que antes quedaban en cada tab:
 *  - tolerancia a cortes de red (delega en la cola offline),
 *  - reflejo inmediato en la UI cuando el evento no vuelve por WebSocket,
 *  - traducción del error de API a un mensaje mostrable.
 */
export function useEventRegistrar(sessionId: string) {
  const timer = useSessionStore((s) => s.timer);
  const addEvent = useSessionStore((s) => s.addEvent);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const register = useCallback(
    async (event_type: string, opts: RegisterOptions): Promise<boolean> => {
      setLoading(true);
      setError("");

      const stamp = timerStamp(timer);
      const body: Record<string, unknown> = {
        event_type,
        team: opts.team,
        ...(opts.reason !== undefined ? { reason: opts.reason } : {}),
        ...(opts.player_id !== undefined ? { player_id: opts.player_id } : {}),
        ...(opts.metadata !== undefined ? { metadata: opts.metadata } : {}),
      };

      try {
        const result = await postEvent(sessionId, body, stamp);

        // El evento vuelve por WebSocket sólo si el socket está vivo. Si quedó
        // encolado o el socket está caído, lo mostramos localmente para que los
        // contadores no se queden atrás; el refetch al reconectar reconcilia.
        if (result.queued || !sessionWS.isConnected()) {
          const optimistic: EventData = {
            id: result.local?.id ?? `local:${stamp.timer_seconds}:${event_type}`,
            event_type,
            half: stamp.half,
            timer_seconds: stamp.timer_seconds,
            team: opts.team,
            player_id: opts.player_id ?? null,
            player_number: null,
            reason: opts.reason ?? null,
            metadata: opts.metadata ?? {},
            pending: result.queued,
          };
          addEvent(optimistic);
        }
        return true;
      } catch (err) {
        setError(parseApiError(err, "Error al registrar el evento"));
        return false;
      } finally {
        setLoading(false);
      }
    },
    [sessionId, timer, addEvent]
  );

  return { register, loading, error, setError };
}
