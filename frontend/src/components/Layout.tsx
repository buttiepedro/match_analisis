import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuthStore } from "../store/authStore";

/*
  Navegación única: una barra lateral, colapsable en escritorio y en cajón
  (off-canvas) en teléfono.

  Reemplaza al esquema anterior de bottom nav + top nav, que topaba en cinco
  ítems a 360px. Ese techo venía empujando pantallas fuera del menú a medida que
  la app crecía: Mediciones quedó sin entrada para el administrador, y Calendario
  y Estadísticas sin entrada para nadie. Una lista vertical scrollea, así que el
  problema no se repite cuando entre la próxima pantalla.
*/

const COLLAPSED_KEY = "match_analisis:nav_collapsed";

type NavItem = {
  label: string;
  path: string;
  icon: React.ReactNode;
  /** Rutas que también deben marcar este ítem como activo. */
  alias?: string[];
  /** Capacidad que habilita el ítem. Sin ella no aparece en el menú. */
  permission?: string;
};

type NavGroup = { title: string; items: NavItem[] };

// ── Iconos ────────────────────────────────────────────────────────────────────

const svg = {
  width: 20,
  height: 20,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const IconHome = () => (
  <svg {...svg}>
    <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <polyline points="9 22 9 12 15 12 15 22" />
  </svg>
);

const IconCalendar = () => (
  <svg {...svg}>
    <rect width="18" height="18" x="3" y="4" rx="2" />
    <path d="M16 2v4M8 2v4M3 10h18" />
  </svg>
);

const IconBall = () => (
  <svg {...svg}>
    <circle cx="12" cy="12" r="10" />
    <path d="M12 2a10 10 0 0 1 7.07 17.07M4.93 4.93A10 10 0 0 0 12 22" />
    <path d="M12 2v20M2 12h20" />
  </svg>
);

const IconChart = () => (
  <svg {...svg}>
    <path d="M3 3v18h18" />
    <rect x="7" y="12" width="3" height="6" rx="1" />
    <rect x="12" y="8" width="3" height="10" rx="1" />
    <rect x="17" y="4" width="3" height="14" rx="1" />
  </svg>
);

const IconUsers = () => (
  <svg {...svg}>
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);

const IconUser = () => (
  <svg {...svg}>
    <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
);

const IconClipboard = () => (
  <svg {...svg}>
    <rect width="8" height="4" x="8" y="2" rx="1" ry="1" />
    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
    <path d="m9 14 2 2 4-4" />
  </svg>
);

const IconActivity = () => (
  <svg {...svg}>
    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
  </svg>
);

const IconSettings = () => (
  <svg {...svg}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
  </svg>
);

const IconBuilding = () => (
  <svg {...svg}>
    <rect width="16" height="20" x="4" y="2" rx="2" ry="2" />
    <path d="M9 22v-4h6v4" />
    <path d="M8 6h.01M16 6h.01M12 6h.01M12 10h.01M8 10h.01M16 10h.01M12 14h.01M8 14h.01M16 14h.01" />
  </svg>
);

const IconDumbbell = () => (
  <svg {...svg}>
    <path d="M6 5v14M18 5v14M2 9v6M22 9v6M6 12h12" />
  </svg>
);

const IconCard = () => (
  <svg {...svg}>
    <rect width="20" height="14" x="2" y="5" rx="2" />
    <path d="M2 10h20" />
  </svg>
);

const IconMenu = () => (
  <svg {...svg} width="22" height="22">
    <path d="M3 6h18M3 12h18M3 18h18" />
  </svg>
);

const IconClose = () => (
  <svg {...svg} width="22" height="22">
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);

const IconChevron = ({ dir }: { dir: "left" | "right" }) => (
  <svg {...svg} width="16" height="16">
    <path d={dir === "left" ? "m15 18-6-6 6-6" : "m9 18 6-6-6-6"} />
  </svg>
);

const IconLogout = () => (
  <svg {...svg} width="16" height="16">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <path d="M21 12H9" />
  </svg>
);

// ── Menú por rol ──────────────────────────────────────────────────────────────

const HOY: NavItem = { label: "Hoy", path: "/hoy", icon: <IconHome /> };
const CALENDARIO: NavItem = { label: "Calendario", path: "/calendario", icon: <IconCalendar /> };
const PARTIDOS: NavItem = { label: "Partidos", path: "/tournaments", icon: <IconBall />, alias: ["/torneos"] };
const STATS: NavItem = { label: "Estadísticas", path: "/stats", icon: <IconChart /> };
const PLANTEL: NavItem = { label: "Plantel", path: "/squad", icon: <IconUsers /> };
const ASISTENCIA: NavItem = { label: "Asistencia", path: "/trainings", icon: <IconClipboard /> };
const MEDICIONES: NavItem = { label: "Mediciones", path: "/mediciones", icon: <IconActivity />, alias: ["/performance"] };
const CONFIG: NavItem = { label: "Configuración", path: "/config", icon: <IconSettings /> };
const SOCIOS: NavItem = { label: "Socios", path: "/socios", icon: <IconCard />, permission: "socios.ver_todas" };
const GIMNASIO: NavItem = { label: "Gimnasio", path: "/gimnasio", icon: <IconDumbbell />, permission: "gimnasio.ver" };
const MI_CUOTA: NavItem = { label: "Mi cuota", path: "/mi-club", icon: <IconCard /> };

/** Mismo menú para director y analista: ninguno de los dos configura el club. */
const CUERPO_TECNICO: NavGroup[] = [
  { title: "Día a día", items: [HOY, CALENDARIO] },
  { title: "Partido", items: [PARTIDOS, STATS] },
  { title: "Plantel", items: [PLANTEL, ASISTENCIA, MEDICIONES, GIMNASIO] },
];

const NAV_BY_ROLE: Record<string, NavGroup[]> = {
  superadmin: [{ title: "Administración", items: [{ label: "Clubes", path: "/clubs", icon: <IconBuilding /> }] }],
  club_admin: [...CUERPO_TECNICO, { title: "Club", items: [SOCIOS, CONFIG] }],
  match_director: CUERPO_TECNICO,
  analyst: CUERPO_TECNICO,
  // Un socio importado del padrón entra con `player` en el enum viejo. Ve su
  // cuota; la ficha deportiva sólo si además es jugador, y la pantalla lo resuelve.
  player: [
    {
      title: "Mi cuenta",
      items: [MI_CUOTA, { label: "Mi ficha", path: "/mi-ficha", icon: <IconUser /> }],
    },
  ],
};

const ROLE_LABEL: Record<string, string> = {
  superadmin: "Superadmin",
  club_admin: "Administrador",
  match_director: "Director de partido",
  analyst: "Analista",
  player: "Jugador",
};

// ── Layout ────────────────────────────────────────────────────────────────────

export default function Layout({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();
  const location = useLocation();

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem(COLLAPSED_KEY) === "1"
  );

  // El menú se filtra por capacidad, no sólo por rol: con permisos por
  // capacidades, dos usuarios con el mismo `role` pueden tener menús distintos.
  const granted = new Set(user?.permissions ?? []);
  const groups = (user ? NAV_BY_ROLE[user.role] ?? [] : [])
    .map((g) => ({
      ...g,
      items: g.items.filter((i) => !i.permission || granted.has(i.permission)),
    }))
    .filter((g) => g.items.length > 0);

  // Navegar cierra el cajón: si quedara abierto taparía la pantalla recién abierta.
  useEffect(() => setDrawerOpen(false), [location.pathname]);

  useEffect(() => {
    if (!drawerOpen) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawerOpen(false);
    };
    // Sin esto el fondo scrollea detrás del cajón al arrastrar.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [drawerOpen]);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      localStorage.setItem(COLLAPSED_KEY, prev ? "0" : "1");
      return !prev;
    });
  };

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  const isActive = (item: NavItem) =>
    [item.path, ...(item.alias ?? [])].some(
      (p) => location.pathname === p || location.pathname.startsWith(p + "/")
    );

  const currentLabel = groups
    .flatMap((g) => g.items)
    .find(isActive)?.label;

  /** Una sola definición de la lista, usada por el cajón y por la barra fija. */
  const navList = (iconsOnly: boolean) => (
    <nav className="flex-1 overflow-y-auto no-scrollbar px-3 py-4 space-y-5">
      {groups.map((group) => (
        <div key={group.title}>
          {!iconsOnly && (
            <p className="px-3 mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
              {group.title}
            </p>
          )}
          <div className="space-y-0.5">
            {group.items.map((item) => {
              const active = isActive(item);
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  aria-current={active ? "page" : undefined}
                  title={iconsOnly ? item.label : undefined}
                  className={`pressable flex items-center gap-3 rounded-lg text-sm font-medium transition-colors ${
                    iconsOnly ? "justify-center px-0 py-2.5" : "px-3 py-2.5"
                  } ${
                    active
                      ? "bg-brand text-white"
                      : "text-ink-soft hover:bg-surface-strong hover:text-ink"
                  }`}
                >
                  <span className="shrink-0">{item.icon}</span>
                  {!iconsOnly && <span className="truncate">{item.label}</span>}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );

  const brandHeader = (iconsOnly: boolean) => (
    <div
      className={`flex items-center gap-2 border-b border-line px-4 ${
        iconsOnly ? "justify-center px-0" : ""
      } h-14 shrink-0`}
    >
      {!iconsOnly && <span className="font-bold text-ink text-sm truncate">Rugby Analisis</span>}
      {iconsOnly && <span className="font-bold text-brand text-base">RA</span>}
    </div>
  );

  const userFooter = (iconsOnly: boolean) => (
    <div className={`border-t border-line py-3 shrink-0 ${iconsOnly ? "px-2" : "px-4"}`}>
      {iconsOnly ? (
        <button
          onClick={handleLogout}
          title="Cerrar sesión"
          aria-label="Cerrar sesión"
          className="pressable w-full flex justify-center py-2 rounded-lg text-ink-muted hover:bg-surface-strong hover:text-ink transition-colors"
        >
          <IconLogout />
        </button>
      ) : (
        <>
          <p className="text-sm font-semibold text-ink truncate">{user?.full_name}</p>
          <p className="text-xs text-ink-muted mb-2 truncate">
            {ROLE_LABEL[user?.role ?? ""] ?? user?.role}
          </p>
          <button
            onClick={handleLogout}
            className="pressable flex items-center gap-1.5 text-xs text-ink-muted hover:text-ink transition-colors"
          >
            <IconLogout />
            Cerrar sesión
          </button>
        </>
      )}
    </div>
  );

  // Un rol desconocido igual tiene que poder cerrar sesión: se muestra el marco
  // con la lista vacía en lugar de dejar al usuario sin salida.
  if (!user) {
    return <div className="min-h-screen bg-white text-ink">{children}</div>;
  }

  return (
    <div className="min-h-screen bg-white text-ink">
      {/* ── Barra lateral fija — escritorio ─────────────────────────────── */}
      <aside
        className={`hidden md:flex fixed inset-y-0 left-0 z-20 flex-col bg-surface border-r border-line transition-[width] duration-200 ${
          collapsed ? "w-[68px]" : "w-56"
        }`}
        style={{ transitionTimingFunction: "var(--ease-out)" }}
      >
        {brandHeader(collapsed)}
        {navList(collapsed)}

        <button
          onClick={toggleCollapsed}
          aria-label={collapsed ? "Expandir menú" : "Colapsar menú"}
          title={collapsed ? "Expandir menú" : "Colapsar menú"}
          className={`pressable flex items-center gap-2 border-t border-line py-2.5 text-xs text-ink-muted hover:bg-surface-strong hover:text-ink transition-colors shrink-0 ${
            collapsed ? "justify-center px-0" : "px-4"
          }`}
        >
          <IconChevron dir={collapsed ? "right" : "left"} />
          {!collapsed && "Colapsar"}
        </button>

        {userFooter(collapsed)}
      </aside>

      {/* ── Encabezado — teléfono ───────────────────────────────────────── */}
      <header className="md:hidden sticky top-0 z-20 flex items-center gap-3 h-14 px-3 bg-surface border-b border-line">
        <button
          onClick={() => setDrawerOpen(true)}
          aria-label="Abrir menú"
          aria-expanded={drawerOpen}
          className="pressable p-1.5 -ml-1 rounded-lg text-ink hover:bg-surface-strong transition-colors"
        >
          <IconMenu />
        </button>
        {/* Mostrar dónde estoy importa más que repetir la marca en cada pantalla. */}
        <span className="font-bold text-ink text-sm truncate">
          {currentLabel ?? "Rugby Analisis"}
        </span>
      </header>

      {/* ── Cajón — teléfono ────────────────────────────────────────────── */}
      {drawerOpen && (
        <div className="md:hidden fixed inset-0 z-40">
          <div
            className="absolute inset-0 bg-ink/40 animate-overlay"
            onClick={() => setDrawerOpen(false)}
          />
          <aside
            role="dialog"
            aria-modal="true"
            aria-label="Menú de navegación"
            className="relative flex h-full w-[264px] max-w-[82vw] flex-col bg-surface border-r border-line animate-drawer"
          >
            <div className="flex items-center justify-between h-14 px-4 border-b border-line shrink-0">
              <span className="font-bold text-ink text-sm">Rugby Analisis</span>
              <button
                onClick={() => setDrawerOpen(false)}
                aria-label="Cerrar menú"
                className="pressable p-1 -mr-1 rounded-lg text-ink-muted hover:bg-surface-strong hover:text-ink transition-colors"
              >
                <IconClose />
              </button>
            </div>
            {navList(false)}
            {userFooter(false)}
          </aside>
        </div>
      )}

      {/* ── Contenido ───────────────────────────────────────────────────── */}
      <main
        className={`transition-[margin] duration-200 ${collapsed ? "md:ml-[68px]" : "md:ml-56"}`}
        style={{ transitionTimingFunction: "var(--ease-out)" }}
      >
        {children}
      </main>
    </div>
  );
}
