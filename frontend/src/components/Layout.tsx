import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuthStore } from "../store/authStore";

type NavItem = { label: string; path: string };

const NAV_BY_ROLE: Record<string, NavItem[]> = {
  superadmin: [
    { label: "Clubes", path: "/clubs" },
  ],
  club_admin: [
    { label: "Partidos", path: "/dashboard" },
    { label: "Torneos", path: "/tournaments" },
    { label: "Divisiones", path: "/divisions" },
    { label: "Jugadores", path: "/players" },
    { label: "Usuarios", path: "/users" },
    { label: "Estadísticas", path: "/stats" },
  ],
  match_director: [
    { label: "Partidos", path: "/dashboard" },
    { label: "Estadísticas", path: "/stats" },
  ],
  analyst: [
    { label: "Partidos", path: "/dashboard" },
    { label: "Estadísticas", path: "/stats" },
  ],
};

function HamburgerIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
      <rect y="3" width="20" height="2" rx="1" />
      <rect y="9" width="20" height="2" rx="1" />
      <rect y="15" width="20" height="2" rx="1" />
    </svg>
  );
}

export default function Layout({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();
  const location = useLocation();

  const items: NavItem[] = user ? (NAV_BY_ROLE[user.role] ?? []) : [];

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  const navLinks = (
    <nav className="flex-1 px-3 py-4 space-y-1">
      {items.map((item) => (
        <Link
          key={item.path}
          to={item.path}
          onClick={() => setOpen(false)}
          className={`block px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
            location.pathname === item.path
              ? "bg-green-700 text-white"
              : "text-gray-400 hover:bg-gray-700 hover:text-white"
          }`}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );

  const userFooter = (
    <div className="px-4 py-4 border-t border-gray-700">
      <p className="text-sm font-semibold text-white truncate">{user?.full_name}</p>
      <p className="text-xs text-gray-400 mb-3">{user?.role}</p>
      <button
        onClick={handleLogout}
        className="text-xs text-gray-400 hover:text-white transition-colors"
      >
        Cerrar sesión
      </button>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-900 text-white flex">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex md:w-56 bg-gray-800 flex-col border-r border-gray-700 fixed inset-y-0 left-0">
        <div className="px-4 py-5 border-b border-gray-700">
          <span className="font-bold text-white">Rugby Analisis</span>
        </div>
        {navLinks}
        {userFooter}
      </aside>

      {/* Mobile overlay */}
      {open && (
        <div
          className="fixed inset-0 bg-black/50 z-20 md:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Mobile drawer */}
      <aside
        className={`fixed inset-y-0 left-0 w-56 bg-gray-800 border-r border-gray-700 z-30 flex flex-col transform transition-transform duration-200 md:hidden ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="px-4 py-5 border-b border-gray-700">
          <span className="font-bold text-white">Rugby Analisis</span>
        </div>
        {navLinks}
        {userFooter}
      </aside>

      {/* Page content */}
      <div className="flex-1 flex flex-col md:ml-56 min-w-0">
        {/* Mobile top bar */}
        <header className="md:hidden flex items-center gap-3 px-4 py-3 bg-gray-800 border-b border-gray-700">
          <button
            onClick={() => setOpen(true)}
            className="text-gray-400 hover:text-white"
            aria-label="Abrir menú"
          >
            <HamburgerIcon />
          </button>
          <span className="font-bold text-white text-sm">Rugby Analisis</span>
        </header>
        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}
