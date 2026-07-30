/**
 * Tipos y etiquetas de la bolsa, compartidos por el feed y la página del aviso.
 *
 * Estaban dentro de la pantalla, que era la única. Con dos, duplicarlos significa
 * que un día el estado dice "vencido" en una y "expirado" en la otra.
 */

export interface JobAttachment {
  id: string;
  url: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  is_image: boolean;
}

export interface JobPost {
  id: string;
  kind: "ofrece" | "busca";
  title: string;
  description: string;
  /** Arranque del texto sin marcas de formato: lo que se lee en la tarjeta. */
  excerpt: string;
  cover_image_url: string | null;
  attachments: JobAttachment[];
  contact: string | null;
  category: string | null;
  status: "pendiente" | "publicado" | "rechazado" | "vencido";
  moderation_note: string | null;
  author_name: string;
  author_initials: string;
  is_mine: boolean;
  published_at: string | null;
  expires_on: string | null;
}

export const KIND_LABEL: Record<string, string> = {
  ofrece: "Ofrece trabajo",
  busca: "Busca trabajo",
};

export const STATUS_CLASS: Record<string, string> = {
  pendiente: "bg-amber-100 text-amber-700",
  publicado: "bg-brand-soft text-brand",
  rechazado: "bg-red-100 text-red-700",
  vencido: "bg-surface-strong text-ink-muted",
};

export function daysLeft(expires: string | null): string | null {
  if (!expires) return null;
  const diff = Math.ceil((new Date(expires).getTime() - Date.now()) / 86_400_000);
  if (diff < 0) return "vencido";
  if (diff === 0) return "vence hoy";
  if (diff === 1) return "vence mañana";
  return `vence en ${diff} días`;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
