import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import api from "../lib/axios";
import { useAuthStore } from "../store/authStore";
import { useBrandingStore } from "../store/brandingStore";

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
  /**
   * Capacidades que habilitan el ítem: alcanza con **una**. Sin ninguna de
   * ellas, no aparece.
   *
   * Varias porque hay pantallas que agregan cosas de distinto dominio —
   * Calendario junta entrenamientos y partidos—, y exigir todas dejaría afuera
   * a quien tiene motivos legítimos para entrar.
   */
  permission?: string | string[];
  /**
   * Se muestra sólo a quien está cargado como jugador.
   *
   * Es lo único que sigue mirando el `role` del enum viejo, y a propósito: no
   * responde a "qué podés hacer" sino a "quién sos". No hay capacidad que diga
   * *soy jugador*, y no tendría que haberla — la ficha propia no es un permiso
   * sobre el club.
   */
  onlyForPlayers?: boolean;
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

const IconBriefcase = () => (
  <svg {...svg}>
    <rect width="20" height="14" x="2" y="7" rx="2" />
    <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
  </svg>
);

const IconDumbbell = () => (
  <svg {...svg}>
    <path d="M6 5v14M18 5v14M2 9v6M22 9v6M6 12h12" />
  </svg>
);

const IconLeaf = () => (
  <svg {...svg}>
    <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z" />
    <path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12" />
  </svg>
);

const IconCard = () => (
  <svg {...svg}>
    <rect width="20" height="14" x="2" y="5" rx="2" />
    <path d="M2 10h20" />
  </svg>
);

const IconTrophy = () => (
  <svg {...svg}>
    <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6M18 9h1.5a2.5 2.5 0 0 0 0-5H18M4 22h16M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22M18 2H6v7a6 6 0 0 0 12 0V2Z" />
  </svg>
);

const IconTable = () => (
  <svg {...svg}>
    <rect width="18" height="18" x="3" y="3" rx="2" />
    <path d="M3 9h18M3 15h18M9 3v18" />
  </svg>
);

const IconList = () => (
  <svg {...svg}>
    <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
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

const IconBell = () => (
  <svg {...svg}>
    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
    <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
  </svg>
);

const IconMegaphone = () => (
  <svg {...svg}>
    <path d="m3 11 18-5v12L3 14v-3z" />
    <path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" />
  </svg>
);

// ── Menú por rol ──────────────────────────────────────────────────────────────

const HOY: NavItem = { label: "Hoy", path: "/hoy", icon: <IconHome />, permission: ["asistencia.ver", "partido.ver", "plantel.ver"] };
const CALENDARIO: NavItem = { label: "Calendario", path: "/calendario", icon: <IconCalendar />, permission: ["entrenamiento.gestionar", "asistencia.ver", "partido.ver"] };
const PARTIDOS: NavItem = { label: "Partidos", path: "/tournaments", icon: <IconBall />, alias: ["/torneos"], permission: "partido.ver" };
const STATS: NavItem = { label: "Estadísticas de partidos", path: "/stats", icon: <IconChart />, permission: "partido.ver" };
const PLANTEL: NavItem = { label: "Plantel", path: "/squad", icon: <IconUsers />, permission: "plantel.ver" };
const ASISTENCIA: NavItem = { label: "Asistencia", path: "/trainings", icon: <IconClipboard />, permission: "asistencia.ver" };
const MEDICIONES: NavItem = { label: "Mediciones", path: "/mediciones", icon: <IconActivity />, alias: ["/performance"], permission: "mediciones.ver" };
const CONFIG: NavItem = { label: "Configuración", path: "/config", icon: <IconSettings />, permission: ["club.usuarios", "club.divisiones", "club.torneos", "club.rivales"] };
const SOCIOS: NavItem = { label: "Socios", path: "/socios", icon: <IconCard />, permission: "socios.ver_todas" };
const GIMNASIO: NavItem = { label: "Gimnasio", path: "/gimnasio", icon: <IconDumbbell />, permission: "gimnasio.ver" };
const BOLSA: NavItem = { label: "Bolsa de trabajo", path: "/bolsa", icon: <IconBriefcase />, permission: "bolsa.ver" };
const MI_CUOTA: NavItem = { label: "Mi cuota", path: "/mi-club", icon: <IconCard />, permission: "socios.ver_propia" };
const MI_FICHA: NavItem = { label: "Mi ficha", path: "/mi-ficha", icon: <IconUser />, onlyForPlayers: true };
//: Antes vivían como tabs invisibles adentro de "Mi ficha" — un click de más
//: para algo que un jugador mira todas las semanas. Mismo `/mi-ficha`, `?tab`
//: distinto: `PlayerPortal` lo lee al montar y cada vez que cambia.
const MIS_TESTS: NavItem = { label: "Tests", path: "/mi-ficha?tab=tests", icon: <IconClipboard />, onlyForPlayers: true };
const MI_FISICO: NavItem = { label: "Mediciones físicas", path: "/mi-ficha?tab=fisico", icon: <IconActivity />, onlyForPlayers: true };
const MI_GIMNASIO_PROPIO: NavItem = { label: "Gimnasio", path: "/mi-ficha?tab=gimnasio", icon: <IconDumbbell />, onlyForPlayers: true };
const MIS_ESTADISTICAS: NavItem = { label: "Mis estadísticas", path: "/mi-ficha?tab=estadisticas", icon: <IconChart />, onlyForPlayers: true };
const MI_TURNO_NUTRICION: NavItem = { label: "Turno de nutrición", path: "/mi-turno-nutricion", icon: <IconLeaf />, permission: "nutricion.turnos_reservar" };
const NUTRICION: NavItem = { label: "Nutrición", path: "/nutricion", icon: <IconLeaf />, permission: "nutricion.turnos_publicar" };
// Mismo permiso que Fixture/Tablas/Citados: es la misma pregunta ("¿cómo le
// va al club, y qué está pasando?") mirada desde otro ángulo. El backend no
// exige capacidad para *leer* comunicados (cualquier autenticado del club
// puede pedirlos), pero el ítem del menú sí, para no romper la regla de que
// sin capacidades el menú queda vacío.
const COMUNICADOS: NavItem = { label: "Comunicados", path: "/comunicados", icon: <IconMegaphone />, permission: "club.ver_competencia" };
const FIXTURE: NavItem = { label: "Fixture", path: "/fixture", icon: <IconTrophy />, permission: "club.ver_competencia" };
const TABLAS: NavItem = { label: "Tablas", path: "/tablas", icon: <IconTable />, permission: "club.ver_competencia" };
const CITADOS: NavItem = { label: "Citados", path: "/citados", icon: <IconList />, permission: "club.ver_competencia" };

/*
  El menú sale de las **capacidades**, no del `role` del enum viejo.

  Antes cada rol traía su lista fija y la capacidad sólo podía sacar ítems de
  esa lista. Con roles editables eso se rompe solo: un club que le da el rol
  Entrenador a alguien cargado como `player` le da las capacidades pero no la
  forma de llegar a las pantallas. El permiso existía y el menú no, que es la
  peor de las dos mitades — la app dice que no podés y el backend dice que sí.

  `superadmin` sigue aparte: tiene todas las capacidades pero ningún club, y
  estas pantallas necesitan uno.
*/
export const SUPERADMIN_NAV: NavGroup[] = [
  { title: "Administración", items: [{ label: "Clubes", path: "/clubs", icon: <IconBuilding /> }] },
];

/**
 * Menú de un usuario. Exportada porque es la única lógica del layout que se
 * puede —y conviene— probar sola: decide a qué llega cada persona.
 */
export function navFor(role: string | undefined, permissions: string[]): NavGroup[] {
  const granted = new Set(permissions);
  const isPlayer = role === "player";

  const visible = (item: NavItem): boolean => {
    if (item.onlyForPlayers) return isPlayer;
    if (!item.permission) return true;
    const needed = Array.isArray(item.permission) ? item.permission : [item.permission];
    return needed.some((p) => granted.has(p));
  };

  // `superadmin` va aparte: tiene todas las capacidades pero ningún club, y
  // estas pantallas necesitan uno.
  return (role === "superadmin" ? SUPERADMIN_NAV : NAV)
    .map((g) => ({ ...g, items: g.items.filter(visible) }))
    .filter((g) => g.items.length > 0);
}

export const NAV: NavGroup[] = [
  { title: "Día a día", items: [HOY, CALENDARIO] },
  { title: "Partido", items: [PARTIDOS, STATS] },
  { title: "Plantel", items: [PLANTEL, ASISTENCIA, MEDICIONES, GIMNASIO, NUTRICION] },
  // Los cuatro grupos siguientes son la vista de un jugador o un socio: datos
  // propios, entrenamiento propio, estadísticas propias, comunicación del
  // club. Antes vivían repartidos ("Mi cuenta" + mitad de "Club") o enterrados
  // como tabs de "Mi ficha" — acá cada uno es un click directo desde el nav.
  { title: "Datos", items: [MI_FICHA, MIS_TESTS, MI_FISICO, MI_CUOTA] },
  { title: "Entrenamiento", items: [MI_GIMNASIO_PROPIO, MI_TURNO_NUTRICION] },
  { title: "Estadísticas", items: [MIS_ESTADISTICAS] },
  { title: "Comunicación", items: [COMUNICADOS, FIXTURE, TABLAS, CITADOS, BOLSA] },
  { title: "Administración", items: [SOCIOS, CONFIG] },
];

const ROLE_LABEL: Record<string, string> = {
  superadmin: "Superadmin",
  club_admin: "Administrador",
  match_director: "Director de partido",
  analyst: "Analista",
  player: "Jugador",
};

// ── Campana de notificaciones ───────────────────────────────────────────────

const UNREAD_POLL_MS = 60_000;

/**
 * Recibir avisos propios no es un permiso sobre el club: se muestra a todo
 * usuario autenticado, sin filtrar por capacidad — a diferencia del resto
 * del menú, que sí filtra.
 */
function NotificationBell({ iconsOnly }: { iconsOnly: boolean }) {
  const navigate = useNavigate();
  const [count, setCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const poll = () => {
      api
        .get<{ count: number }>("/me/notifications/unread-count")
        .then(({ data }) => {
          if (!cancelled) setCount(data.count);
        })
        .catch(() => {});
    };
    poll();
    const id = setInterval(poll, UNREAD_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return (
    <button
      onClick={() => navigate("/notificaciones")}
      aria-label={count > 0 ? `Notificaciones, ${count} sin leer` : "Notificaciones"}
      title="Notificaciones"
      className={`pressable relative flex items-center gap-3 rounded-lg text-sm font-medium text-ink-soft hover:bg-surface-strong hover:text-ink transition-colors ${
        iconsOnly ? "justify-center px-0 py-2.5" : "px-3 py-2.5"
      }`}
    >
      <span className="relative shrink-0">
        <IconBell />
        {count > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[15px] h-[15px] px-[3px] rounded-full bg-danger text-white text-[9px] font-bold grid place-items-center leading-none">
            {count > 9 ? "9+" : count}
          </span>
        )}
      </span>
      {!iconsOnly && <span className="truncate">Notificaciones</span>}
    </button>
  );
}

// ── Layout ────────────────────────────────────────────────────────────────────

export default function Layout({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user);
  const branding = useBrandingStore((s) => s.branding);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();
  const location = useLocation();

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem(COLLAPSED_KEY) === "1"
  );

  const groups = navFor(user?.role, user?.permissions ?? []);

  // Navegar cierra el cajón: si quedara abierto taparía la pantalla recién abierta.
  useEffect(() => setDrawerOpen(false), [location.pathname]);

  // El service worker no puede navegar por su cuenta: si la app ya está
  // abierta en una pestaña, `notificationclick` la enfoca y le manda esto.
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === "notification-click" && event.data.url) {
        navigate(event.data.url);
      }
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [navigate]);

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

  // `item.path` puede traer un `?tab=...` propio (los deep-links a "Mi
  // ficha"): `location.pathname` nunca incluye el query string, así que sin
  // este chequeo aparte todos esos ítems compartirían el mismo pathname y
  // "Mi ficha" quedaría siempre marcado como activo, tab que se esté viendo.
  const isActive = (item: NavItem) => {
    const [itemPath, itemQuery] = item.path.split("?");
    const pathMatches = [itemPath, ...(item.alias ?? [])].some(
      (p) => location.pathname === p || location.pathname.startsWith(p + "/")
    );
    if (!pathMatches) return false;
    const wantedTab = itemQuery ? new URLSearchParams(itemQuery).get("tab") : null;
    const currentTab = new URLSearchParams(location.search).get("tab");
    return wantedTab === currentTab;
  };

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
      {branding?.logo_url && (
        <img
          src={branding.logo_url}
          alt={branding.name}
          className="h-7 w-7 rounded object-contain shrink-0"
        />
      )}
      {!iconsOnly && (
        <span className="font-bold text-ink text-sm truncate">
          {branding?.name ?? "Rugby Analisis"}
        </span>
      )}
      {iconsOnly && !branding?.logo_url && <span className="font-bold text-brand text-base">RA</span>}
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
        <div className={`shrink-0 py-2 ${collapsed ? "px-2" : "px-3"} border-b border-line`}>
          <NotificationBell iconsOnly={collapsed} />
        </div>
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
        <span className="font-bold text-ink text-sm truncate flex-1">
          {currentLabel ?? branding?.name ?? "Rugby Analisis"}
        </span>
        <NotificationBell iconsOnly />
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
              <span className="flex items-center gap-2 min-w-0">
                {branding?.logo_url && (
                  <img
                    src={branding.logo_url}
                    alt={branding.name}
                    className="h-7 w-7 rounded object-contain shrink-0"
                  />
                )}
                <span className="font-bold text-ink text-sm truncate">
                  {branding?.name ?? "Rugby Analisis"}
                </span>
              </span>
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
