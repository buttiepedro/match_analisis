/**
 * Paleta portada de `frontend/tailwind.config.ts` — mismos nombres, mismos
 * valores por defecto. No hay marca por club en la v1 de la app móvil (un
 * solo binario para todos los clubes, ver [[app-movil]]): a diferencia del
 * frontend web, acá NO se leen de una variable CSS en runtime.
 */
export const colors = {
  brand: "#211E67",
  brandHover: "#2D2A85",
  brandSoft: "#ECEBF5",
  brandRing: "#C9C7E4",
  danger: "#FF1B20",
  dangerSoft: "#FFECEC",
  surface: "#F4F5FA",
  surfaceStrong: "#E8EAF4",
  line: "#E2E4F0",
  ink: "#1A1830",
  inkSoft: "#43425C",
  inkMuted: "#6B6A85",
  inkFaint: "#9A99AE",
  white: "#FFFFFF",
  amber: "#B45309",
  amberSoft: "#FFFBEB",
  sky: "#0369A1",
  skySoft: "#E0F2FE",
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
};

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  full: 999,
};
