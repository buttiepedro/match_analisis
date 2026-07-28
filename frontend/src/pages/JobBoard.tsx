import { useEffect, useState } from "react";
import api from "../lib/axios";
import { parseApiError } from "../lib/errors";
import { useAuthStore } from "../store/authStore";

interface JobPost {
  id: string;
  kind: "ofrece" | "busca";
  title: string;
  description: string;
  contact: string | null;
  category: string | null;
  status: "pendiente" | "publicado" | "rechazado" | "vencido";
  moderation_note: string | null;
  author_name: string;
  is_mine: boolean;
  expires_on: string | null;
}

type View = "bolsa" | "mios" | "moderar";

const KIND_LABEL: Record<string, string> = {
  ofrece: "Ofrece trabajo",
  busca: "Busca trabajo",
};

const STATUS_CLASS: Record<string, string> = {
  pendiente: "bg-amber-100 text-amber-700",
  publicado: "bg-brand-soft text-brand",
  rechazado: "bg-red-100 text-red-700",
  vencido: "bg-surface-strong text-ink-muted",
};

const EMPTY = {
  kind: "busca" as "busca" | "ofrece",
  title: "",
  description: "",
  contact: "",
  category: "",
};

function daysLeft(expires: string | null): string | null {
  if (!expires) return null;
  const diff = Math.ceil((new Date(expires).getTime() - Date.now()) / 86_400_000);
  if (diff < 0) return "vencido";
  if (diff === 0) return "vence hoy";
  if (diff === 1) return "vence mañana";
  return `vence en ${diff} días`;
}

export default function JobBoard() {
  const user = useAuthStore((s) => s.user);
  const clubId = user?.club_id;
  const permissions = user?.permissions ?? [];
  const canPost = permissions.includes("bolsa.publicar");
  const canModerate = permissions.includes("bolsa.moderar");

  const [view, setView] = useState<View>("bolsa");
  const [posts, setPosts] = useState<JobPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [composing, setComposing] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);

  const load = () => {
    if (!clubId) return;
    setLoading(true);
    api
      .get<JobPost[]>(`/clubs/${clubId}/job-posts`, {
        params: { mine: view === "mios" || undefined, pending: view === "moderar" || undefined },
      })
      .then(({ data }) => setPosts(data))
      .catch((err) => setError(parseApiError(err, "No se pudo cargar la bolsa")))
      .finally(() => setLoading(false));
  };

  useEffect(load, [clubId, view]);

  const publish = async () => {
    if (!clubId) return;
    setBusy(true);
    setError("");
    try {
      await api.post(`/clubs/${clubId}/job-posts`, {
        ...form,
        category: form.category || null,
      });
      setForm(EMPTY);
      setComposing(false);
      setView("mios");
    } catch (err) {
      setError(parseApiError(err, "No se pudo publicar el aviso"));
    } finally {
      setBusy(false);
    }
  };

  const moderate = async (post: JobPost, approve: boolean) => {
    const note = approve
      ? undefined
      : window.prompt("¿Por qué se rechaza? El autor va a ver este motivo.") ?? undefined;
    if (!approve && !note) return;
    await api.post(`/job-posts/${post.id}/moderate`, { approve, note });
    load();
  };

  const renew = async (post: JobPost) => {
    await api.post(`/job-posts/${post.id}/renew`);
    load();
  };

  const remove = async (post: JobPost) => {
    if (!confirm(`¿Bajar "${post.title}"?`)) return;
    await api.delete(`/job-posts/${post.id}`);
    load();
  };

  if (!clubId) return null;

  const views: [View, string][] = [
    ["bolsa", "Avisos"],
    ...(canPost ? ([["mios", "Mis avisos"]] as [View, string][]) : []),
    ...(canModerate ? ([["moderar", "A revisar"]] as [View, string][]) : []),
  ];

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto pb-10">
      <h1 className="text-lg font-bold text-ink mb-1">Bolsa de trabajo</h1>
      <p className="text-xs text-ink-muted mb-4">
        Sólo para socios del club. Los avisos se revisan antes de publicarse y vencen
        a los 30 días, renovables.
      </p>

      {views.length > 1 && (
        <div className="flex gap-1 bg-surface p-1 rounded-xl mb-4">
          {views.map(([key, label]) => (
            <button
              key={key}
              onClick={() => setView(key)}
              className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors duration-150 ${
                view === key ? "bg-brand text-white" : "text-ink-muted hover:text-ink"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {error && (
        <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2 mb-3">{error}</p>
      )}

      {canPost && view !== "moderar" && (
        composing ? (
          <div className="bg-surface rounded-xl p-4 space-y-2 mb-4">
            <div className="flex gap-1 bg-surface-strong p-1 rounded-lg">
              {(["busca", "ofrece"] as const).map((k) => (
                <button
                  key={k}
                  onClick={() => setForm((f) => ({ ...f, kind: k }))}
                  className={`flex-1 py-1.5 rounded text-xs font-semibold transition-colors duration-150 ${
                    form.kind === k ? "bg-brand text-white" : "text-ink-muted"
                  }`}
                >
                  {KIND_LABEL[k]}
                </button>
              ))}
            </div>
            <input
              placeholder="Título — ej: Electricista matriculado"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              className="w-full bg-surface-strong text-ink text-sm rounded-lg px-3 py-2 placeholder-ink-faint outline-none focus:ring-1 focus:ring-brand-ring"
            />
            <textarea
              placeholder="Contá de qué se trata"
              rows={3}
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              className="w-full bg-surface-strong text-ink text-sm rounded-lg px-3 py-2 placeholder-ink-faint outline-none focus:ring-1 focus:ring-brand-ring resize-none"
            />
            <input
              placeholder="Cómo te contactan — teléfono o mail"
              value={form.contact}
              onChange={(e) => setForm((f) => ({ ...f, contact: e.target.value }))}
              className="w-full bg-surface-strong text-ink text-sm rounded-lg px-3 py-2 placeholder-ink-faint outline-none focus:ring-1 focus:ring-brand-ring"
            />
            <p className="text-[11px] text-ink-faint">
              Tu contacto lo van a ver los demás socios mientras el aviso esté
              publicado. Podés bajarlo cuando quieras.
            </p>
            <div className="flex gap-2">
              <button
                onClick={publish}
                disabled={busy || !form.title.trim() || !form.description.trim() || !form.contact.trim()}
                className="pressable text-sm bg-brand hover:bg-brand-hover disabled:opacity-50 text-white px-4 py-2 rounded-lg font-medium transition-colors duration-150"
              >
                {busy ? "Enviando..." : "Enviar a revisión"}
              </button>
              <button
                onClick={() => { setComposing(false); setForm(EMPTY); }}
                className="pressable text-sm text-ink-muted hover:text-ink px-4 py-2 rounded-lg"
              >
                Cancelar
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setComposing(true)}
            className="pressable w-full bg-surface hover:bg-surface-hover text-ink text-sm font-semibold py-2.5 rounded-xl mb-4 transition-colors duration-150"
          >
            + Publicar un aviso
          </button>
        )
      )}

      {loading ? (
        <p className="text-ink-muted text-sm py-8 text-center">Cargando...</p>
      ) : posts.length === 0 ? (
        <div className="bg-surface/70 rounded-xl px-4 py-8 text-center">
          <p className="text-ink-muted text-sm">
            {view === "moderar"
              ? "No hay avisos esperando revisión."
              : view === "mios"
                ? "Todavía no publicaste ningún aviso."
                : "Todavía no hay avisos publicados."}
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {posts.map((post) => (
            <li key={post.id} className="bg-surface rounded-xl px-4 py-3">
              <div className="flex items-start gap-2 mb-1">
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-medium text-ink">{post.title}</span>
                  <span className="block text-[11px] text-ink-faint">
                    {KIND_LABEL[post.kind]} · {post.author_name}
                    {post.expires_on && ` · ${daysLeft(post.expires_on)}`}
                  </span>
                </span>
                {post.status !== "publicado" && (
                  <span
                    className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${STATUS_CLASS[post.status]}`}
                  >
                    {post.status}
                  </span>
                )}
              </div>

              <p className="text-sm text-ink-soft whitespace-pre-line">{post.description}</p>

              {post.contact && (
                <p className="text-sm text-brand font-medium mt-1.5">{post.contact}</p>
              )}

              {post.moderation_note && (
                <p className="text-xs text-red-700 bg-red-50 rounded-lg px-3 py-2 mt-2">
                  {post.moderation_note}
                </p>
              )}

              {(post.is_mine || canModerate) && (
                <div className="flex gap-3 mt-2">
                  {view === "moderar" && (
                    <>
                      <button
                        onClick={() => moderate(post, true)}
                        className="pressable text-xs font-semibold text-brand hover:text-brand-hover"
                      >
                        Publicar
                      </button>
                      <button
                        onClick={() => moderate(post, false)}
                        className="pressable text-xs font-semibold text-red-600 hover:text-red-700"
                      >
                        Rechazar
                      </button>
                    </>
                  )}
                  {post.is_mine && post.status === "vencido" && (
                    <button
                      onClick={() => renew(post)}
                      className="pressable text-xs font-semibold text-brand hover:text-brand-hover"
                    >
                      Renovar 30 días
                    </button>
                  )}
                  {(post.is_mine || canModerate) && view !== "moderar" && (
                    <button
                      onClick={() => remove(post)}
                      className="pressable text-xs font-semibold text-red-600 hover:text-red-700"
                    >
                      Bajar aviso
                    </button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
