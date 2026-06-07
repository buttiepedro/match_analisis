import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Timer from "../components/Timer";
import JuegoEventos from "../components/tabs/JuegoEventos";
import LinesScrum from "../components/tabs/LinesScrum";
import Events from "../components/tabs/PenaltiesPossession";
import api from "../lib/axios";
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
      .catch(() => navigate("/dashboard"))
      .finally(() => setLoading(false));
  }, [id]);

  // WebSocket connection
  useEffect(() => {
    if (!id || !token) return;

    sessionWS.connect(
      id,
      token,
      (msg) => {
        if (msg.type === "timer_tick" || msg.type === "timer_state") {
          setTimer(msg.data as never);
        } else if (msg.type === "event_registered") {
          addEvent(msg.data as never);
        }
      },
      () => setWsConnected(true),
      () => setWsConnected(false),
    );

    return () => {
      sessionWS.disconnect();
      setWsConnected(false);
    };
  }, [id, token]);

  // Cleanup on unmount
  useEffect(() => () => reset(), []);

  const refreshEvents = () =>
    api.get(`/sessions/${id}/events`).then((r) => setEvents(r.data));

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <p className="text-gray-400">Cargando...</p>
      </div>
    );
  }

  if (!session) return null;

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 pt-3 pb-1">
        <button
          onClick={() => navigate("/dashboard")}
          className="text-gray-400 text-sm hover:text-white"
        >
          ← Volver
        </button>
        <span className={`text-xs font-medium ${wsConnected ? "text-green-400" : "text-red-400"}`}>
          {wsConnected ? "● En vivo" : "○ Desconectado"}
        </span>
      </div>

      {/* Timer (sticky) */}
      <div className="sticky top-0 z-10">
        <Timer
          timer={timer}
          canControl={canControl}
          homeTeam={session.home_team}
          awayTeam={session.away_team}
        />
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-700 bg-gray-900">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`flex-1 py-3 text-xs font-semibold transition-colors ${
              activeTab === t.id
                ? "text-green-400 border-b-2 border-green-400"
                : "text-gray-400"
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
        {activeTab === "lines" && (
          <LinesScrum sessionId={session.id} onEvent={refreshEvents} />
        )}
        {activeTab === "events" && (
          <Events
            sessionId={session.id}
            homeTeam={session.home_team}
            awayTeam={session.away_team}
            onEvent={refreshEvents}
          />
        )}
      </div>
    </div>
  );
}
