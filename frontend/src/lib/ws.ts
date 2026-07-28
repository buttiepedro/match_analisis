import { wsBase } from "./apiBase";

type WSMessage = { type: string; data: unknown };
type MsgHandler = (msg: WSMessage) => void;

export interface ConnectOptions {
  onMessage: MsgHandler;
  /** Fires on every successful open, including reconnections. */
  onConnect?: () => void;
  onDisconnect?: () => void;
  /** Fires only on a re-open after a drop — use it to re-sync missed state. */
  onReconnect?: () => void;
}

const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 30000;

/**
 * Backoff exponencial con jitter: 1s, 2s, 4s, 8s, 16s, 30s (tope).
 * El jitter evita que todos los clientes reconecten en el mismo instante
 * cuando el backend se reinicia a mitad de partido.
 */
function backoffDelay(attempt: number): number {
  const exponential = Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_DELAY_MS);
  return exponential * (0.75 + Math.random() * 0.5);
}

function buildUrl(sessionId: string, token: string): string {
  return `${wsBase()}/ws/session/${sessionId}?token=${encodeURIComponent(token)}`;
}

class SessionWebSocket {
  private ws: WebSocket | null = null;
  private opts: ConnectOptions | null = null;
  private sessionId = "";
  private token = "";

  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private onlineListener: (() => void) | null = null;
  private hasConnectedOnce = false;
  /** true mientras el consumidor quiere estar conectado (no llamó a disconnect). */
  private wanted = false;

  connect(sessionId: string, token: string, opts: ConnectOptions): void {
    this.sessionId = sessionId;
    this.token = token;
    this.opts = opts;
    this.wanted = true;
    this.attempt = 0;
    this.hasConnectedOnce = false;

    // Al recuperar conectividad, no esperamos al backoff: reintentamos ya.
    if (!this.onlineListener) {
      this.onlineListener = () => {
        if (this.wanted && this.ws?.readyState !== WebSocket.OPEN) {
          this.clearTimer();
          this.attempt = 0;
          this.open();
        }
      };
      window.addEventListener("online", this.onlineListener);
    }

    this.open();
  }

  private open(): void {
    if (!this.wanted) return;

    let socket: WebSocket;
    try {
      socket = new WebSocket(buildUrl(this.sessionId, this.token));
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = socket;

    socket.onopen = () => {
      this.attempt = 0;
      this.opts?.onConnect?.();
      if (this.hasConnectedOnce) this.opts?.onReconnect?.();
      this.hasConnectedOnce = true;
    };

    socket.onmessage = (e) => {
      try {
        this.opts?.onMessage(JSON.parse(e.data as string));
      } catch {
        // ignore malformed messages
      }
    };

    socket.onclose = (e) => {
      this.opts?.onDisconnect?.();
      // 4001/4003/4004 = token inválido, sin acceso o sesión inexistente.
      // Reintentar no cambia el resultado, así que cortamos.
      if (e.code >= 4001 && e.code <= 4004) {
        this.wanted = false;
        return;
      }
      this.scheduleReconnect();
    };

    socket.onerror = () => {
      // onclose siempre llega después de onerror; el reintento se agenda ahí.
    };
  }

  private scheduleReconnect(): void {
    if (!this.wanted || this.reconnectTimer) return;
    const delay = backoffDelay(this.attempt);
    this.attempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.open();
    }, delay);
  }

  private clearTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  sendTimerControl(action: string, extras?: Record<string, unknown>): boolean {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "timer_control", action, ...extras }));
      return true;
    }
    return false;
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  disconnect(): void {
    this.wanted = false;
    this.clearTimer();
    if (this.onlineListener) {
      window.removeEventListener("online", this.onlineListener);
      this.onlineListener = null;
    }
    if (this.ws) {
      // Evita que el onclose del cierre manual dispare un reintento.
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.close();
      this.ws = null;
    }
    this.opts = null;
  }
}

export const sessionWS = new SessionWebSocket();
