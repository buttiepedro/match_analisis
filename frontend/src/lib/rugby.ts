export const RUGBY_POSITIONS = [
  { number: 1,  name: "Pilar Izquierdo" },
  { number: 2,  name: "Hooker" },
  { number: 3,  name: "Pilar Derecho" },
  { number: 4,  name: "Segunda Linea" },
  { number: 5,  name: "Segunda Linea" },
  { number: 6,  name: "Ala" },
  { number: 7,  name: "Ala" },
  { number: 8,  name: "Ocho" },
  { number: 9,  name: "Medio Scrum" },
  { number: 10, name: "Apertura" },
  { number: 11, name: "Wing" },
  { number: 12, name: "Primer Centro" },
  { number: 13, name: "Segundo Centro" },
  { number: 14, name: "Wing" },
  { number: 15, name: "Fullback" },
] as const;

export function positionByJersey(n: number): string {
  return RUGBY_POSITIONS.find((p) => p.number === n)?.name ?? "";
}
