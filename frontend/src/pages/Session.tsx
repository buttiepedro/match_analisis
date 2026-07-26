import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Timer from "../components/Timer";
import JuegoEventos from "../components/tabs/JuegoEventos";
import LinesScrum from "../components/tabs/LinesScrum";
import Events from "../components/tabs/PenaltiesPossession";
import api from "../lib/axios";
import { flush, pendingEvents, usePendingCount } from "../lib/offlineQueue";
import { sessionWS } from "../lib/ws";
import { useAuthStore } from "../store/authStore";
import { useSessionStore } from "../store/sessionStore";

type Tab = "tackles" | "lines" | "events";

const TABS: { id: Tab; label: string }[] = [
  { id: "tackles", label: "Juego" },
  { id: "lines", label: "Lines & Scrum" },
  { id: "events", label: "Cambios" },
];

const TAB_ORDER: Tab[] = ["tackles", "lines", "events"];

export default function Session() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const token = useAuthStore((s) => s.token);
  const {
    session, timer, wsConnected,
    setSession, setTimer, addEvent, setEvents, setLineup, setWsConnected, reset,
  } = useSessionStore();

  const [activeTab, setActiveTab] = useState<Tab>("tackles");
  const [loading, setLoading] = useState(true);
  const touchStartX = useRef<number>(0);

  const pending = usePendingCount(id);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    const diff = touchStartX.current - e.changedTouches[0].clientX;
    if (Math.abs(diff) < 50) return;
    const currentIndex = TAB_ORDER.indexOf(activeTab);
    if (diff > 0 && currentIndex < TAB_ORDER.length - 1) {
      setActiveTab(TAB_ORDER[currentIndex + 1]);
    } else if (diff < 0 && currentIndex > 0) {
      setActiveTab(TAB_ORDER[currentIndex - 1]);
    }
  };

  const canControl =
    user?.role === "superadmin" ||
    user?.role === "club_admin" ||
    user?.role === "match_director";

  /**
   * Trae los eventos del servidor conservando los que siguen encolados: sin eso,
   * un refetch borraría de pantalla eventos que todavía no se enviaron.
   */
  const refreshEvents = useCallback(async () => {
    if (!id) return;
    const { data } = await api.get(`/sessions/${id}/events`);
    const stillQueued = new Set(pendingEvents(id).map((e) => e.id));
    const locals = useSessionStore
      .getState()
      .events.filter((e) => e.pending && stillQueued.has(e.id));
    setEvents([...locals, ...data]);
  }, [id, setEvents]);

  // Load session data + lineup
  useEffect(() => {
    if (!id) return;
    Promise.all([
      api.get(`/sessions/${id}`),
      api.get(`/sessions/${id}/events`),
      api.get(`/sessions/${id}/lineup`),
    ])
      .then(([sRes, eRes, lRes]) => {
        setSession({ ...sRes.data, tournament_id: sRes.data.tournament_id });
        setEvents(eRes.data);
        setLineup(lRes.data);
      })
      .catch(() => navigate("/tournaments"))
      .finally(() => setLoading(false));
  }, [id]);

  // WebSocket connection — se reconecta sola tras un corte
  useEffect(() => {
    if (!id || !token) return;

    sessionWS.connect(id, token, {
      onMessage: (msg) => {
        if (msg.type === "timer_tick" || msg.type === "timer_state") {
          setTimer(msg.data as never);
        } else if (msg.type === "event_registered") {
          addEvent(msg.data as never);
        }
      },
      onConnect: () => setWsConnected(true),
      onDisconnect: () => setWsConnected(false),
      onReconnect: () => {
        // Al volver: vaciar la cola y re-sincronizar lo que pasó mientras no estábamos.
        void flush().then(() => refreshEvents().catch(() => {}));
      },
    });

    return () => {
      sessionWS.disconnect();
      setWsConnected(false);
    };
  }, [id, token]);

  // Vaciar la cola en cuanto vuelve la conectividad del navegador
  useEffect(() => {
    const onOnline = () => {
      void flush().then((r) => {
        if (r.sent > 0) refreshEvents().catch(() => {});
      });
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [refreshEvents]);

  // Cleanup on unmount
  useEffect(() => () => reset(), []);

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <p className="text-ink-muted">Cargando...</p>
      </div>
    );
  }

  if (!session) return null;

  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 pt-3 pb-1">
        <button
          onClick={() => navigate("/tournaments")}
          className="text-ink-muted text-sm hover:text-ink"
        >
          ← Volver
        </button>
        <div className="flex items-center gap-3">
          {pending > 0 && (
            <button
              onClick={() => void flush().then(() => refreshEvents().catch(() => {}))}
              className="text-xs font-medium text-amber-600 hover:text-amber-700 transition-colors"
              title="Eventos registrados sin conexión. Se envían solos al recuperarla — tocá para reintentar ahora."
            >
              ⧗ {pending} sin enviar
            </button>
          )}
          <span className={`text-xs font-medium ${wsConnected ? "text-brand" : "text-red-600"}`}>
            {wsConnected ? "● En vivo" : "○ Reconectando..."}
          </span>
        </div>
      </div>

      {/* Timer (sticky) */}
      <div className="sticky top-0 z-10">
        <Timer
          timer={timer}
          canControl={canControl}
          homeTeam={session.home_team}
          awayTeam={session.away_team}
          halfDurationMinutes={session.half_duration_minutes}
        />
      </div>

      {/* Tabs */}
      <div className="flex border-b border-line bg-white">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`flex-1 py-3 text-xs font-semibold transition-colors ${
              activeTab === t.id
                ? "text-brand border-b-2 border-green-400"
                : "text-ink-muted"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div
        className="flex-1 overflow-y-auto pb-8"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {activeTab === "tackles" && (
          <JuegoEventos sessionId={session.id} homeTeam={session.home_team} />
        )}
        {activeTab === "lines" && <LinesScrum sessionId={session.id} />}
        {activeTab === "events" && (
          <Events
            sessionId={session.id}
            homeTeam={session.home_team}
            awayTeam={session.away_team}
          />
        )}
      </div>
    </div>
  );
}
