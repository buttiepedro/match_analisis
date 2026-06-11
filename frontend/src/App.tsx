import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useAuthStore } from "./store/authStore";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import Session from "./pages/Session";
import Clubs from "./pages/Clubs";
import Tournaments from "./pages/Tournaments";
import Players from "./pages/Players";
import SessionLineup from "./pages/SessionLineup";
import Stats from "./pages/Stats";
import Configuracion from "./pages/Configuracion";

function PrivateRoute({ children }: { children: React.ReactNode }) {
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

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />

        <Route path="/clubs" element={<LayoutRoute><Clubs /></LayoutRoute>} />
        <Route path="/tournaments" element={<LayoutRoute><Tournaments /></LayoutRoute>} />
        <Route path="/players" element={<LayoutRoute><Players /></LayoutRoute>} />
        <Route path="/stats" element={<LayoutRoute><Stats /></LayoutRoute>} />
        <Route path="/config" element={<LayoutRoute><Configuracion /></LayoutRoute>} />

        {/* Session views — no sidebar */}
        <Route path="/sessions/:id" element={<PrivateRoute><Session /></PrivateRoute>} />
        <Route path="/sessions/:id/lineup" element={<PrivateRoute><SessionLineup /></PrivateRoute>} />

        <Route path="/" element={<Navigate to="/tournaments" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
