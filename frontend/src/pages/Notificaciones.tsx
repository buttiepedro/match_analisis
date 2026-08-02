import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../lib/axios";
import { parseApiError } from "../lib/errors";

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  data: { url?: string; [key: string]: unknown };
  read_at: string | null;
  created_at: string;
}

function timeAgo(iso: string): string {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "recién";
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `hace ${days} día(s)`;
  return new Date(iso).toLocaleDateString("es-AR", { day: "numeric", month: "short" });
}

/**
 * La bandeja: el canal primario, no un respaldo del push. Lo que llega acá es
 * lo mismo que se intentó empujar, se haya recibido el push o no.
 */
export default function Notificaciones() {
  const navigate = useNavigate();
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .get<Notification[]>("/me/notifications")
      .then(({ data }) => setItems(data))
      .catch((err) => setError(parseApiError(err, "No se pudieron cargar las notificaciones")))
      .finally(() => setLoading(false));
  }, []);

  const open = async (n: Notification) => {
    if (!n.read_at) {
      setItems((prev) =>
        prev.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x))
      );
      api.post(`/me/notifications/${n.id}/read`).catch(() => {});
    }
    if (n.data?.url) navigate(n.data.url as string);
  };

  if (loading) {
    return <div className="p-6"><p className="text-ink-muted text-sm">Cargando...</p></div>;
  }

  return (
    <div className="p-4 md:p-6 max-w-md mx-auto pb-10">
      <h1 className="text-lg font-bold text-ink mb-4">Notificaciones</h1>

      {error && (
        <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2 mb-3">{error}</p>
      )}

      {items.length === 0 ? (
        <p className="text-ink-muted text-sm py-8 text-center">
          Todavía no tenés notificaciones.
        </p>
      ) : (
        <ul className="bg-surface rounded-xl divide-y divide-line overflow-hidden">
          {items.map((n) => (
            <li key={n.id}>
              <button
                onClick={() => open(n)}
                className={`pressable w-full flex items-start gap-3 px-4 py-3 text-left transition-colors duration-150 ${
                  n.read_at ? "hover:bg-surface-hover" : "bg-brand-soft/60 hover:bg-brand-soft"
                }`}
              >
                {!n.read_at && (
                  <span className="w-2 h-2 rounded-full bg-brand mt-1.5 shrink-0" aria-hidden />
                )}
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-semibold text-ink truncate">{n.title}</span>
                  <span className="block text-xs text-ink-soft mt-0.5">{n.body}</span>
                  <span className="block text-[11px] text-ink-faint mt-1">
                    {timeAgo(n.created_at)}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
