import { Suspense, lazy } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useAuthStore } from "./store/authStore";
import Layout from "./components/Layout";
import Login from "./pages/Login";

/*
  Todo salvo el login se carga por demanda. El tablero de cancha es la pantalla
  que más importa que entre con mala señal, y hasta acá arrastraba ECharts, xlsx
  y jspdf sin usarlos.
*/
const Session = lazy(() => import("./pages/Session"));
const Clubs = lazy(() => import("./pages/Clubs"));
const Tournaments = lazy(() => import("./pages/Tournaments"));
const SessionLineup = lazy(() => import("./pages/SessionLineup"));
const Stats = lazy(() => import("./pages/Stats"));
const Configuracion = lazy(() => import("./pages/Configuracion"));
const Squad = lazy(() => import("./pages/Squad"));
const PlayerProfile = lazy(() => import("./pages/PlayerProfile"));
const Performance = lazy(() => import("./pages/Performance"));
const Trainings = lazy(() => import("./pages/Trainings"));
const TrainingAttendance = lazy(() => import("./pages/TrainingAttendance"));
const Hoy = lazy(() => import("./pages/Hoy"));
const Calendar = lazy(() => import("./pages/Calendar"));
const PlayerPortal = lazy(() => import("./pages/PlayerPortal"));
const MemberPortal = lazy(() => import("./pages/MemberPortal"));
const ChangePassword = lazy(() => import("./pages/ChangePassword"));
const Members = lazy(() => import("./pages/Members"));

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const token = useAuthStore((s) => s.token);
  const mustChange = useAuthStore((s) => s.user?.must_change_password);

  if (!token) return <Navigate to="/login" replace />;
  // Con la contraseña por defecto sin cambiar no se llega a ninguna pantalla.
  // Es lo que acota la ventana entre el import del padrón y el primer ingreso:
  // hasta acá, esa contraseña es la misma para todos los socios de esa tanda.
  if (mustChange) return <Navigate to="/cambiar-password" replace />;
  return <>{children}</>;
}

/** Exige sesión pero **no** el cambio de contraseña: si no, sería un bucle. */
function AuthedRoute({ children }: { children: React.ReactNode }) {
  const token = useAuthStore((s) => s.token);
  return token ? <>{children}</> : <Navigate to="/login" replace />;
}

function LayoutRoute({ children }: { children: React.ReactNode }) {
  return (
    <PrivateRoute>
      <Layout>{children}</Layout>
    </PrivateRoute>
  );
}

/** Discreto a propósito: un flash de "Cargando..." en cada ruta molesta más que ayuda. */
function RouteFallback() {
  return <div className="p-6 text-sm text-ink-muted">Cargando...</div>;
}

/** Landing por rol: el jugador no tiene nada que hacer en las pantallas de club. */
function Home() {
  const role = useAuthStore((s) => s.user?.role);
  const clubId = useAuthStore((s) => s.user?.club_id);
  if (role === "superadmin") return <Navigate to="/clubs" replace />;
  // Un socio importado del padrón entra con rol `player` en el enum viejo, pero
  // su ficha es la de socio. `/mi-club` resuelve cuál mostrar.
  if (role === "player") return <Navigate to="/mi-club" replace />;
  if (!clubId) return <Navigate to="/login" replace />;
  return <Navigate to="/hoy" replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/login" element={<Login />} />
          {/* Fuera de PrivateRoute: es la única pantalla alcanzable con el flag arriba. */}
          <Route
            path="/cambiar-password"
            element={<AuthedRoute><ChangePassword /></AuthedRoute>}
          />

          <Route path="/clubs"        element={<LayoutRoute><Clubs /></LayoutRoute>} />
          <Route path="/hoy"          element={<LayoutRoute><Hoy /></LayoutRoute>} />
          <Route path="/tournaments"  element={<LayoutRoute><Tournaments /></LayoutRoute>} />
          <Route path="/torneos"      element={<LayoutRoute><Tournaments /></LayoutRoute>} />
          <Route path="/stats"        element={<LayoutRoute><Stats /></LayoutRoute>} />
          <Route path="/config"       element={<LayoutRoute><Configuracion /></LayoutRoute>} />
          <Route path="/squad"        element={<LayoutRoute><Squad /></LayoutRoute>} />
          <Route path="/squad/:id"    element={<LayoutRoute><PlayerProfile /></LayoutRoute>} />
          <Route path="/mediciones"   element={<LayoutRoute><Performance /></LayoutRoute>} />
          {/* Ruta anterior: se conserva para no romper links ya guardados. */}
          <Route path="/performance"  element={<Navigate to="/mediciones" replace />} />
          <Route path="/trainings"     element={<LayoutRoute><Trainings /></LayoutRoute>} />
          <Route path="/trainings/:id" element={<LayoutRoute><TrainingAttendance /></LayoutRoute>} />
          <Route path="/calendario"    element={<LayoutRoute><Calendar /></LayoutRoute>} />
          <Route path="/mi-ficha"      element={<LayoutRoute><PlayerPortal /></LayoutRoute>} />
          <Route path="/mi-club"       element={<LayoutRoute><MemberPortal /></LayoutRoute>} />
          <Route path="/socios"        element={<LayoutRoute><Members /></LayoutRoute>} />

          {/* Session views — no sidebar */}
          <Route path="/sessions/:id"        element={<PrivateRoute><Session /></PrivateRoute>} />
          <Route path="/sessions/:id/lineup" element={<PrivateRoute><SessionLineup /></PrivateRoute>} />

          <Route path="/" element={<Home />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
