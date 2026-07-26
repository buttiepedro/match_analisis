/** Vocabulario compartido de asistencia: lo usan la planilla y las métricas. */

export type AttendanceStatus =
  | "presente"
  | "ausente"
  | "justificado"
  | "lesionado"
  | "tarde";

export const ATTENDANCE_STATUSES: AttendanceStatus[] = [
  "presente",
  "ausente",
  "justificado",
  "lesionado",
  "tarde",
];

/**
 * Sin registro cargado la planilla asume `presente`: en un club normal la
 * mayoría asiste, así que se marca la excepción y no la regla.
 */
export const DEFAULT_STATUS: AttendanceStatus = "presente";

/** `tarde` cuenta como asistencia efectiva; llegó, aunque tarde. */
export const ATTENDED: AttendanceStatus[] = ["presente", "tarde"];

export const STATUS_LABEL: Record<AttendanceStatus, string> = {
  presente: "Presente",
  ausente: "Ausente",
  justificado: "Justificado",
  lesionado: "Lesionado",
  tarde: "Tarde",
};

/** Abreviatura para el chip de cada renglón, donde no entra la palabra entera. */
export const STATUS_SHORT: Record<AttendanceStatus, string> = {
  presente: "P",
  ausente: "A",
  justificado: "J",
  lesionado: "L",
  tarde: "T",
};

export const STATUS_CLASS: Record<AttendanceStatus, string> = {
  presente: "bg-green-600 text-white",
  ausente: "bg-red-600/90 text-white",
  justificado: "bg-amber-600/90 text-white",
  lesionado: "bg-orange-700/90 text-white",
  tarde: "bg-sky-600/90 text-white",
};

export const TRAINING_TYPES = [
  "entrenamiento",
  "gimnasio",
  "fisico",
  "amistoso",
  "otro",
] as const;

export type TrainingType = (typeof TRAINING_TYPES)[number];

export const TRAINING_TYPE_LABEL: Record<TrainingType, string> = {
  entrenamiento: "Entrenamiento",
  gimnasio: "Gimnasio",
  fisico: "Físico",
  amistoso: "Amistoso",
  otro: "Otro",
};

/** dd/mm sin año — el año ya lo da el contexto de la pantalla. */
export function formatShortDate(iso: string): string {
  const [, month, day] = iso.split("-");
  return `${day}/${month}`;
}

export function formatLongDate(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("es-AR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

/** Verde arriba de 75, ámbar entre 50 y 75, rojo abajo. Tonos legibles sobre blanco. */
export function percentColor(percent: number): string {
  if (percent >= 75) return "text-green-700";
  if (percent >= 50) return "text-amber-600";
  return "text-red-600";
}
