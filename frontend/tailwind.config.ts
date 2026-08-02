import type { Config } from "tailwindcss";

/*
  Paleta del club. Se usa **por nombre**, nunca por hexadecimal suelto: el pasaje
  de tema oscuro a claro obligó a tocar veinte archivos, y no debería volver a
  pasar si mañana cambia la marca.

  `brand.*` sale de `--brand` (definida en `index.css`, pisable en runtime por
  `lib/branding.ts` con el `primary_color` del club — ver
  [[add-club-subdominios-y-marca]]), y el resto de la familia se deriva con
  `color-mix()` en vez de guardar una variable por tono: un club que
  personaliza su marca cambia **un** color, no cuatro.

  Los tonos de `ink` están elegidos para pasar contraste AA sobre blanco, que es
  el error típico al pasar de oscuro a claro: el gris que se leía bien sobre
  negro desaparece sobre blanco.
*/
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: "var(--brand)",
          hover: "color-mix(in srgb, var(--brand) 88%, white)", // más claro, no más oscuro: es el hover, no el pressed
          soft: "color-mix(in srgb, var(--brand) 8%, white)", // fondo de chip/estado sobre blanco
          ring: "color-mix(in srgb, var(--brand) 25%, white)",
        },
        "club-secondary": "var(--club-secondary)",
        danger: {
          DEFAULT: "#FF1B20",
          hover: "#E30B10",
          soft: "#FFECEC",
        },
        surface: {
          DEFAULT: "#F4F5FA", // tarjetas sobre el blanco de la página
          strong: "#E8EAF4", // inputs y botones secundarios
          hover: "#DFE2F0",
        },
        line: "#E2E4F0",
        ink: {
          DEFAULT: "#1A1830", // texto principal
          soft: "#43425C", // secundario — AA sobre blanco
          muted: "#6B6A85", // terciario — AA sobre blanco
          faint: "#9A99AE", // decorativo: no pasa AA para texto chico
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
