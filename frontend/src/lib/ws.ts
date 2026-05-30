type WSMessage = { type: string; data: unknown };
type MsgHandler = (msg: WSMessage) => void;

class SessionWebSocket {
  private ws: WebSocket | null = null;
  private onMsg: MsgHandler | null = null;
  private onOpen: (() => void) | null = null;
  private onClose: (() => void) | null = null;

  connect(
    sessionId: string,
    token: string,
    onMessage: MsgHandler,
    onConnect?: () => void,
    onDisconnect?: () => void
  ): void {
    const apiUrl = import.meta.env.VITE_API_URL || `${window.location.protocol}//${window.location.host}`;
    const proto = apiUrl.startsWith("https") ? "wss:" : "ws:";
    const host = new URL(apiUrl).host;
    const url = `${proto}//${host}/ws/session/${sessionId}?token=${encodeURIComponent(token)}`;

    this.onMsg = onMessage;
    this.onOpen = onConnect ?? null;
    this.onClose = onDisconnect ?? null;

    this.ws = new WebSocket(url);

    this.ws.onopen = () => this.onOpen?.();

    this.ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data as string);
        this.onMsg?.(data);
      } catch {
        // ignore malformed messages
      }
    };

    this.ws.onclose = () => this.onClose?.();
    this.ws.onerror = () => this.onClose?.();
  }

  sendTimerControl(action: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "timer_control", action }));
    }
  }

  disconnect(): void {
    this.ws?.close();
    this.ws = null;
  }
}

export const sessionWS = new SessionWebSocket();
