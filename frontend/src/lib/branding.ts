import api from "./axios";

export interface ClubBranding {
  name: string;
  slug: string;
  logo_url: string | null;
  primary_color: string | null;
  secondary_color: string | null;
}

const FAVICON_ID = "club-favicon";

/**
 * Aplica la marca del club a la página: variables CSS que `tailwind.config.ts`
 * ya sabe leer (`brand.*` sale de `--brand`), título y favicon.
 *
 * Sin marca configurada (`branding` es `null` — instancia de plataforma, o un
 * club que no subió nada) no toca nada: se ve exactamente como el tema por
 * defecto, que es lo que ya hay en `:root` vía CSS. Es opt-in, no un paso
 * obligatorio para poder usar la app.
 */
export function applyClubBranding(branding: ClubBranding | null): void {
  if (!branding) return;

  const root = document.documentElement.style;
  if (branding.primary_color) {
    root.setProperty("--brand", branding.primary_color);
  }
  if (branding.secondary_color) {
    root.setProperty("--club-secondary", branding.secondary_color);
  }

  if (branding.name) {
    document.title = branding.name;
  }

  if (branding.logo_url) {
    let link = document.getElementById(FAVICON_ID) as HTMLLinkElement | null;
    if (!link) {
      link = document.createElement("link");
      link.id = FAVICON_ID;
      link.rel = "icon";
      document.head.appendChild(link);
    }
    link.href = branding.logo_url;
  }
}

/** No autenticado: se puede pedir antes del login. 404 = sin club propio (instancia de plataforma). */
export async function fetchClubBranding(): Promise<ClubBranding | null> {
  try {
    const { data } = await api.get<ClubBranding>("/public/club-branding");
    return data;
  } catch {
    return null;
  }
}
