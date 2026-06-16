// ─── Rugby positions ──────────────────────────────────────────────────────────
// Canonical list used for imports, player profiles and lineup forms.
// Format: "NN - Nombre" matching the UAR numbering convention.

export const RUGBY_POSITIONS: string[] = [
  "01 - Pilar izquierdo",
  "02 - Hooker",
  "03 - Pilar derecho",
  "04 - Segundo línea",
  "05 - Segundo línea",
  "06 - Ala",
  "07 - Ala",
  "08 - Octavo",
  "09 - Medio scrum",
  "10 - Apertura",
  "11 - Wing izquierdo",
  "12 - Centro",
  "13 - Centro",
  "14 - Wing derecho",
  "15 - Full back",
];

/** Returns the standard position string for a jersey number (1-15), or "". */
export function positionByJersey(n: number): string {
  if (n >= 1 && n <= 15) return RUGBY_POSITIONS[n - 1];
  return "";
}
