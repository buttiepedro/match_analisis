import { useEffect, useState } from "react";
import api from "../lib/axios";
import { parseApiError } from "../lib/errors";
import { useAuthStore } from "../store/authStore";

interface Division {
  id: string;
  name: string;
}

interface Announcement {
  id: string;
  title: string;
  body: string;
  division_id: string | null;
  division_name: string | null;
  created_by: string;
  author_name: string;
  created_at: string;
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleDateString("es-AR", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Novedades del club: comunicados de texto simple, del club entero o de una
 * división puntual. Primer MVP — sin adjuntos ni moderación, eso ya lo
 * cubre la Bolsa de trabajo para su propio caso de uso.
 */
export default function Comunicados() {
  const user = useAuthStore((s) => s.user);
  const permissions = user?.permissions ?? [];
  const canPublish = permissions.includes("club.comunicados_publicar");
  const canModerate = permissions.includes("club.usuarios");

  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [composing, setComposing] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [divisionId, setDivisionId] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = () => {
    if (!user?.club_id) return;
    api
      .get<Announcement[]>(`/clubs/${user.club_id}/announcements`)
      .then(({ data }) => setAnnouncements(data))
      .catch((err) => setError(parseApiError(err, "No se pudieron cargar los comunicados")))
      .finally(() => setLoading(false));
  };

  useEffect(load, [user?.club_id]);

  useEffect(() => {
    if (!user?.club_id || !canPublish) return;
    api
      .get<Division[]>(`/clubs/${user.club_id}/divisions`)
      .then(({ data }) => setDivisions(data))
      .catch(() => setDivisions([]));
  }, [user?.club_id, canPublish]);

  const publish = async () => {
    if (!title.trim() || !body.trim() || !user?.club_id) return;
    setSubmitting(true);
    setError("");
    try {
      await api.post(`/clubs/${user.club_id}/announcements`, {
        title: title.trim(),
        body: body.trim(),
        division_id: divisionId || undefined,
      });
      setTitle("");
      setBody("");
      setDivisionId("");
      setComposing(false);
      load();
    } catch (err) {
      setError(parseApiError(err, "No se pudo publicar el comunicado"));
    } finally {
      setSubmitting(false);
    }
  };

  const remove = async (id: string) => {
    if (!user?.club_id) return;
    setError("");
    try {
      await api.delete(`/clubs/${user.club_id}/announcements/${id}`);
      setAnnouncements((prev) => prev.filter((a) => a.id !== id));
    } catch (err) {
      setError(parseApiError(err, "No se pudo borrar el comunicado"));
    }
  };

  if (loading) {
    return <div className="p-6"><p className="text-ink-muted text-sm">Cargando...</p></div>;
  }

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto pb-10">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-bold text-ink">Comunicados</h1>
        {canPublish && !composing && (
          <button
            onClick={() => setComposing(true)}
            className="pressable text-sm font-semibold text-brand hover:text-brand-hover"
          >
            + Nuevo
          </button>
        )}
      </div>

      {error && (
        <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2 mb-3">{error}</p>
      )}

      {composing && (
        <section className="bg-surface rounded-xl p-4 mb-5 space-y-3">
          <input
            type="text"
            placeholder="Título"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full bg-surface-strong text-ink text-sm rounded-lg px-3 py-2 placeholder-ink-faint outline-none focus:ring-1 focus:ring-brand-ring"
          />
          <textarea
            placeholder="Texto del comunicado"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={4}
            className="w-full bg-surface-strong text-ink text-sm rounded-lg px-3 py-2 placeholder-ink-faint outline-none focus:ring-1 focus:ring-brand-ring resize-none"
          />
          {divisions.length > 0 && (
            <select
              value={divisionId}
              onChange={(e) => setDivisionId(e.target.value)}
              className="w-full bg-surface-strong text-ink text-sm rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-brand-ring"
            >
              <option value="">Todo el club</option>
              {divisions.map((d) => (
                <option key={d.id} value={d.id}>Sólo {d.name}</option>
              ))}
            </select>
          )}
          <div className="flex gap-2">
            <button
              onClick={publish}
              disabled={!title.trim() || !body.trim() || submitting}
              className="pressable text-sm bg-brand hover:bg-brand-hover disabled:opacity-50 text-white px-4 py-2 rounded-lg font-medium"
            >
              {submitting ? "Publicando..." : "Publicar"}
            </button>
            <button
              onClick={() => setComposing(false)}
              className="pressable text-sm text-ink-muted hover:text-ink px-4 py-2 rounded-lg"
            >
              Cancelar
            </button>
          </div>
        </section>
      )}

      {announcements.length === 0 ? (
        <p className="text-ink-muted text-sm bg-surface rounded-xl px-4 py-6 text-center">
          Todavía no hay comunicados.
        </p>
      ) : (
        <ul className="space-y-3">
          {announcements.map((a) => (
            <li key={a.id} className="bg-surface rounded-xl p-4">
              <div className="flex items-start justify-between gap-2 mb-1.5">
                <h2 className="text-[15px] font-bold text-ink leading-snug">{a.title}</h2>
                {a.division_name && (
                  <span className="shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide bg-brand-soft text-brand">
                    {a.division_name}
                  </span>
                )}
              </div>
              <p className="text-sm text-ink-soft leading-relaxed whitespace-pre-wrap">{a.body}</p>
              <div className="flex items-center gap-2 mt-3 pt-3 border-t border-line">
                <span className="flex-1 min-w-0 text-[11px] text-ink-faint truncate">
                  {a.author_name} · {formatWhen(a.created_at)}
                </span>
                {(a.created_by === user?.id || canModerate) && (
                  <button
                    onClick={() => remove(a.id)}
                    className="pressable text-xs text-ink-faint hover:text-red-600 transition-colors duration-150 shrink-0"
                  >
                    Borrar
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
