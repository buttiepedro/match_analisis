export function parseApiError(err: unknown, fallback = "Error inesperado"): string {
  const detail = (err as any)?.response?.data?.detail;
  if (Array.isArray(detail)) {
    return detail.map((d: any) => `${d.loc?.at(-1)}: ${d.msg}`).join(" · ");
  }
  return typeof detail === "string" ? detail : fallback;
}
