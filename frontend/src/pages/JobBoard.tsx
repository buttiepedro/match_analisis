import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Composer from "../components/Composer";
import api from "../lib/axios";
import { parseApiError } from "../lib/errors";
import { KIND_LABEL, STATUS_CLASS, daysLeft, type JobPost } from "../lib/jobBoard";
import { useAuthStore } from "../store/authStore";

/*
  El feed de la bolsa.

  Tarjeta y página aparte. Antes el aviso entero vivía en la lista, y eso obliga
  a elegir entre dos cosas malas: recortar el texto y perder lo que el aviso
  dice, o mostrarlo completo y que el tercer aviso ya quede fuera de la pantalla.
  Con resumen y página, la lista sirve para elegir y la página para leer.
*/

type View = "bolsa" | "mios" | "moderar";

const EMPTY = {
  kind: "busca" as "busca" | "ofrece",
  title: "",
  description: "",
  contact: "",
  category: "",
};

function Avatar({ initials }: { initials: string }) {
  return (
    <span className="w-9 h-9 shrink-0 rounded-full bg-brand-soft text-brand text-xs font-bold flex items-center justify-center">
      {initials}
    </span>
  );
}

function Card({ post }: { post: JobPost }) {
  return (
    <Link
      to={`/bolsa/${post.id}`}
      className="block bg-surface rounded-2xl overflow-hidden hover:bg-surface-hover transition-colors duration-150"
    >
      {post.cover_image_url && (
        <img
          src={post.cover_image_url}
          alt=""
          loading="lazy"
          className="w-full aspect-[16/9] object-cover"
        />
      )}

      <div className="p-4">
        <div className="flex items-center gap-2 mb-2">
          <span
            className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide ${
              post.kind === "ofrece"
                ? "bg-brand-soft text-brand"
                : "bg-surface-strong text-ink-muted"
            }`}
          >
            {KIND_LABEL[post.kind]}
          </span>
          {post.status !== "publicado" && (
            <span
              className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${STATUS_CLASS[post.status]}`}
            >
              {post.status}
            </span>
          )}
        </div>

        <h2 className="text-[15px] font-bold text-ink leading-snug mb-1">{post.title}</h2>
        {post.excerpt && (
          <p className="text-sm text-ink-soft leading-relaxed">{post.excerpt}</p>
        )}

        <div className="flex items-center gap-2 mt-3 pt-3 border-t border-line">
          <Avatar initials={post.author_initials} />
          <span className="flex-1 min-w-0">
            <span className="block text-xs font-medium text-ink truncate">
              {post.author_name}
            </span>
            <span className="block text-[11px] text-ink-faint">
              {post.expires_on ? daysLeft(post.expires_on) : "sin publicar"}
              {post.attachments.length > 0 &&
                ` · ${post.attachments.length} archivo${post.attachments.length > 1 ? "s" : ""}`}
            </span>
          </span>
          <span className="text-xs font-semibold text-brand shrink-0">Ver aviso →</span>
        </div>
      </div>
    </Link>
  );
}

export default function JobBoard() {
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();
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

  const crear = async () => {
    if (!clubId) return;
    setBusy(true);
    setError("");
    try {
      const { data } = await api.post<JobPost>(`/clubs/${clubId}/job-posts`, {
        ...form,
        category: form.category || null,
      });
      setForm(EMPTY);
      setComposing(false);
      // Directo a su página: ahí se le agrega la imagen y los archivos. Mandarlo
      // a la lista lo obligaría a buscar el aviso que acaba de escribir.
      navigate(`/bolsa/${data.id}`);
    } catch (err) {
      setError(parseApiError(err, "No se pudo crear el aviso"));
    } finally {
      setBusy(false);
    }
  };

  if (!clubId) return null;

  const views: [View, string][] = [
    ["bolsa", "Avisos"],
    ...(canPost ? ([["mios", "Mis avisos"]] as [View, string][]) : []),
    ...(canModerate ? ([["moderar", "A revisar"]] as [View, string][]) : []),
  ];

  const listo = form.title.trim() && form.description.trim() && form.contact.trim();

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto pb-10">
      <h1 className="text-xl font-bold text-ink mb-1">Bolsa de trabajo</h1>
      <p className="text-xs text-ink-muted mb-4">
        Sólo para socios del club. Los avisos se revisan antes de publicarse y vencen a
        los 30 días, renovables.
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
          <div className="bg-surface rounded-2xl p-4 space-y-2.5 mb-4">
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
              className="w-full bg-surface-strong text-ink text-sm font-medium rounded-lg px-3 py-2 placeholder-ink-faint outline-none focus:ring-1 focus:ring-brand-ring"
            />

            <Composer
              value={form.description}
              onChange={(description) => setForm((f) => ({ ...f, description }))}
              placeholder={
                "Contá de qué se trata.\n\nCon los botones de arriba podés poner subtítulos, negrita, listas y emojis."
              }
            />

            <input
              placeholder="Cómo te contactan — teléfono o mail"
              value={form.contact}
              onChange={(e) => setForm((f) => ({ ...f, contact: e.target.value }))}
              className="w-full bg-surface-strong text-ink text-sm rounded-lg px-3 py-2 placeholder-ink-faint outline-none focus:ring-1 focus:ring-brand-ring"
            />
            <p className="text-[11px] text-ink-faint">
              Tu contacto lo van a ver los demás socios mientras el aviso esté publicado.
              Podés bajarlo cuando quieras. La imagen y los archivos se agregan en el paso
              siguiente.
            </p>

            <div className="flex gap-2">
              <button
                onClick={crear}
                disabled={busy || !listo}
                className="pressable text-sm bg-brand hover:bg-brand-hover disabled:opacity-50 text-white px-4 py-2 rounded-lg font-medium transition-colors duration-150"
              >
                {busy ? "Creando..." : "Continuar"}
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
            className="pressable w-full bg-surface hover:bg-surface-hover text-ink text-sm font-semibold py-3 rounded-2xl mb-4 transition-colors duration-150 flex items-center justify-center gap-2"
          >
            <span className="text-brand text-lg leading-none">+</span>
            Publicar un aviso
          </button>
        )
      )}

      {loading ? (
        <p className="text-ink-muted text-sm py-8 text-center">Cargando...</p>
      ) : posts.length === 0 ? (
        <div className="bg-surface/70 rounded-2xl px-4 py-10 text-center">
          <p className="text-3xl mb-2">💼</p>
          <p className="text-ink-muted text-sm">
            {view === "moderar"
              ? "No hay avisos esperando revisión."
              : view === "mios"
                ? "Todavía no publicaste ningún aviso."
                : "Todavía no hay avisos publicados."}
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {posts.map((post) => (
            <li key={post.id}>
              <Card post={post} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
