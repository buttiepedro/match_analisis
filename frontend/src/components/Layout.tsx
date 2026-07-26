import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuthStore } from "../store/authStore";

type NavItem = { label: string; path: string; icon: React.ReactNode };

function IconBall() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 2a10 10 0 0 1 7.07 17.07M4.93 4.93A10 10 0 0 0 12 22" />
      <path d="M12 2v20M2 12h20" />
    </svg>
  );
}

function IconUsers() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function IconActivity() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  );
}


function IconSettings() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </svg>
  );
}

function IconHome() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}

function IconClipboard() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="8" height="4" x="8" y="2" rx="1" ry="1" />
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
      <path d="m9 14 2 2 4-4" />
    </svg>
  );
}

function IconBuilding() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="16" height="20" x="4" y="2" rx="2" ry="2" />
      <path d="M9 22v-4h6v4" />
      <path d="M8 6h.01M16 6h.01M12 6h.01M12 10h.01M8 10h.01M16 10h.01M12 14h.01M8 14h.01M16 14h.01" />
    </svg>
  );
}

const NAV_BY_ROLE: Record<string, NavItem[]> = {
  superadmin: [
    { label: "Clubes", path: "/clubs", icon: <IconBuilding /> },
  ],
  // Cinco es el techo del bottom nav a 360px. "Hoy" entra sacando "Físico", que
  // se llega desde el perfil del jugador; el calendario, desde Hoy.
  club_admin: [
    { label: "Hoy",        path: "/hoy",         icon: <IconHome /> },
    { label: "Partidos",   path: "/tournaments", icon: <IconBall /> },
    { label: "Asistencia", path: "/trainings",   icon: <IconClipboard /> },
    { label: "Plantel",    path: "/squad",       icon: <IconUsers /> },
    { label: "Config",     path: "/config",      icon: <IconSettings /> },
  ],
  match_director: [
    { label: "Hoy",        path: "/hoy",         icon: <IconHome /> },
    { label: "Partidos",   path: "/tournaments", icon: <IconBall /> },
    { label: "Asistencia", path: "/trainings",   icon: <IconClipboard /> },
    { label: "Plantel",    path: "/squad",       icon: <IconUsers /> },
    { label: "Físico",     path: "/performance", icon: <IconActivity /> },
  ],
  analyst: [
    { label: "Hoy",        path: "/hoy",         icon: <IconHome /> },
    { label: "Partidos",   path: "/tournaments", icon: <IconBall /> },
    { label: "Asistencia", path: "/trainings",   icon: <IconClipboard /> },
    { label: "Plantel",    path: "/squad",       icon: <IconUsers /> },
    { label: "Físico",     path: "/performance", icon: <IconActivity /> },
  ],
  // El jugador no tiene nada que hacer en las pantallas de club.
  player: [
    { label: "Mi ficha", path: "/mi-ficha", icon: <IconUsers /> },
  ],
};

export default function Layout({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();
  const location = useLocation();

  const items: NavItem[] = user ? (NAV_BY_ROLE[user.role] ?? []) : [];

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  const isActive = (path: string) => {
    if (path === "/tournaments") return location.pathname === "/tournaments" || location.pathname.startsWith("/stats");
    return location.pathname === path || location.pathname.startsWith(path + "/");
  };

  return (
    <div className="min-h-screen bg-white text-ink flex flex-col">
      {/* Top header — mobile only, shows title + logout */}
      <header className="flex items-center justify-between px-4 py-3 bg-surface border-b border-line md:hidden">
        <span className="font-bold text-ink text-sm">Rugby Analisis</span>
        <button
          onClick={handleLogout}
          className="text-xs text-ink-muted hover:text-ink transition-colors"
        >
          Salir
        </button>
      </header>

      {/* Desktop sidebar — only for superadmin or on wide screens */}
      {user?.role === "superadmin" && (
        <aside className="hidden md:flex md:w-56 bg-surface flex-col border-r border-line fixed inset-y-0 left-0">
          <div className="px-4 py-5 border-b border-line">
            <span className="font-bold text-ink">Rugby Analisis</span>
          </div>
          <nav className="flex-1 px-3 py-4 space-y-1">
            {items.map((item) => (
              <Link
                key={item.path}
                to={item.path}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isActive(item.path)
                    ? "bg-brand text-white"
                    : "text-ink-muted hover:bg-surface-strong hover:text-ink"
                }`}
              >
                {item.icon}
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="px-4 py-4 border-t border-line">
            <p className="text-sm font-semibold text-ink truncate">{user?.full_name}</p>
            <p className="text-xs text-ink-muted mb-3">{user?.role}</p>
            <button onClick={handleLogout} className="text-xs text-ink-muted hover:text-ink">
              Cerrar sesión
            </button>
          </div>
        </aside>
      )}

      {/* Page content */}
      <main className={`flex-1 overflow-auto pb-20 md:pb-0 ${user?.role === "superadmin" ? "md:ml-56" : ""}`}>
        {children}
      </main>

      {/* Bottom nav — all roles except superadmin, mobile + tablet */}
      {user?.role !== "superadmin" && items.length > 0 && (
        <nav className="fixed bottom-0 inset-x-0 bg-surface border-t border-line z-10 md:hidden">
          <div className="flex">
            {items.map((item) => {
              const active = isActive(item.path);
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`flex-1 flex flex-col items-center gap-0.5 py-2.5 text-[10px] font-medium transition-colors ${
                    active ? "text-brand" : "text-ink-muted hover:text-ink"
                  }`}
                >
                  <span className={active ? "text-brand" : "text-ink-muted"}>
                    {item.icon}
                  </span>
                  {item.label}
                </Link>
              );
            })}
          </div>
        </nav>
      )}

      {/* Desktop top nav bar for non-superadmin */}
      {user?.role !== "superadmin" && items.length > 0 && (
        <nav className="hidden md:flex fixed top-0 inset-x-0 bg-surface border-b border-line z-10 items-center px-6 h-14">
          <span className="font-bold text-ink text-sm mr-8">Rugby Analisis</span>
          <div className="flex gap-1 flex-1">
            {items.map((item) => {
              const active = isActive(item.path);
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    active ? "bg-brand text-white" : "text-ink-muted hover:bg-surface-strong hover:text-ink"
                  }`}
                >
                  {item.icon}
                  {item.label}
                </Link>
              );
            })}
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-ink-muted">{user?.full_name}</span>
            <button onClick={handleLogout} className="text-xs text-ink-muted hover:text-ink transition-colors">
              Salir
            </button>
          </div>
        </nav>
      )}

      {/* Spacer for desktop top nav on non-superadmin */}
      {user?.role !== "superadmin" && <div className="hidden md:block h-14 order-first" />}
    </div>
  );
}
