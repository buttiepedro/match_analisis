import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import api from "../lib/axios";
import { parseApiError } from "../lib/errors";
import {
  KIND_LABEL,
  STATUS_CLASS,
  daysLeft,
  formatSize,
  type JobPost as Post,
} from "../lib/jobBoard";
import { RichText } from "../lib/richText";
import { useAuthStore } from "../store/authStore";

/*
  La página de un aviso.

  Es la mitad que faltaba: la lista sirve para elegir y ésta para leer. Acá el
  aviso se muestra completo —portada, texto con su jerarquía, archivos— y es
  donde el autor lo termina de armar después de escribirlo.
*/

function formatDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("es-AR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export default function JobPostPage() {
  const { postId } = useParams<{ postId: string }>();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const canModerate = (user?.permissions ?? []).includes("bolsa.moderar");

  const [post, setPost] = useState<Post | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const coverRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = () => {
    api
      .get<Post>(`/job-posts/${postId}`)
      .then(({ data }) => setPost(data))
      .catch((err) => setError(parseApiError(err, "No se encontró el aviso")))
      .finally(() => setLoading(false));
  };

  useEffect(load, [postId]);

  const subir = async (file: File, destino: "cover" | "attachments") => {
    setBusy(true);
    setError("");
    const form = new FormData();
    form.append("file", file);
    try {
      await api.post(`/job-posts/${postId}/${destino}`, form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      load();
    } catch (err) {
      setError(parseApiError(err, "No se pudo subir el archivo"));
    } finally {
      setBusy(false);
    }
  };

  const quitarPortada = async () => {
    setBusy(true);
    try {
      await api.delete(`/job-posts/${postId}/cover`);
      load();
    } catch (err) {
      setError(parseApiError(err, "No se pudo quitar la imagen"));
    } finally {
      setBusy(false);
    }
  };

  const quitarArchivo = async (attachmentId: string) => {
    setBusy(true);
    try {
      await api.delete(`/job-posts/${postId}/attachments/${attachmentId}`);
      load();
    } catch (err) {
      setError(parseApiError(err, "No se pudo quitar el archivo"));
    } finally {
      setBusy(false);
    }
  };

  const moderar = async (approve: boolean) => {
    const note = approve
      ? undefined
      : window.prompt("¿Por qué se rechaza? El autor va a ver este motivo.") ?? undefined;
    if (!approve && !note) return;
    setBusy(true);
    try {
      await api.post(`/job-posts/${postId}/moderate`, { approve, note });
      load();
    } catch (err) {
      setError(parseApiError(err, "No se pudo moderar el aviso"));
    } finally {
      setBusy(false);
    }
  };

  const renovar = async () => {
    setBusy(true);
    try {
      await api.post(`/job-posts/${postId}/renew`);
      load();
    } catch (err) {
      setError(parseApiError(err, "No se pudo renovar"));
    } finally {
      setBusy(false);
    }
  };

  const bajar = async () => {
    if (!post) return;
    if (!confirm(`¿Bajar "${post.title}"? Se borran también la imagen y los archivos.`)) return;
    setBusy(true);
    try {
      await api.delete(`/job-posts/${postId}`);
      navigate("/bolsa");
    } catch (err) {
      setError(parseApiError(err, "No se pudo bajar el aviso"));
      setBusy(false);
    }
  };

  if (loading) {
    return <p className="text-ink-muted text-sm py-16 text-center">Cargando...</p>;
  }

  if (!post) {
    return (
      <div className="p-4 md:p-6 max-w-2xl mx-auto">
        <Link to="/bolsa" className="text-sm font-semibold text-brand">
          ← Volver a la bolsa
        </Link>
        <p className="text-sm text-ink-muted mt-6">
          {error || "Este aviso no está disponible."}
        </p>
      </div>
    );
  }

  const imagenes = post.attachments.filter((a) => a.is_image);
  const documentos = post.attachments.filter((a) => !a.is_image);

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto pb-10">
      <Link
        to="/bolsa"
        className="inline-block text-sm font-semibold text-brand hover:text-brand-hover mb-4"
      >
        ← Volver a la bolsa
      </Link>

      {error && (
        <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2 mb-3">{error}</p>
      )}

      <article className="bg-surface rounded-2xl overflow-hidden">
        {post.cover_image_url && (
          <img
            src={post.cover_image_url}
            alt=""
            className="w-full max-h-80 object-cover"
          />
        )}

        <div className="p-4 md:p-6">
          <div className="flex items-center gap-2 mb-3">
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

          <h1 className="text-2xl font-bold text-ink leading-tight mb-3">{post.title}</h1>

          <div className="flex items-center gap-2.5 pb-4 mb-4 border-b border-line">
            <span className="w-11 h-11 shrink-0 rounded-full bg-brand-soft text-brand text-sm font-bold flex items-center justify-center">
              {post.author_initials}
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-ink truncate">
                {post.author_name}
              </span>
              <span className="block text-xs text-ink-faint">
                {post.published_at ? formatDate(post.published_at) : "Sin publicar"}
                {post.expires_on && ` · ${daysLeft(post.expires_on)}`}
              </span>
            </span>
          </div>

          <RichText text={post.description} className="text-[15px]" />

          {imagenes.length > 0 && (
            <div className="mt-5 grid grid-cols-2 gap-2">
              {imagenes.map((a) => (
                <a
                  key={a.id}
                  href={a.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block rounded-xl overflow-hidden"
                >
                  <img
                    src={a.url}
                    alt={a.filename}
                    loading="lazy"
                    className="w-full aspect-square object-cover hover:opacity-90 transition-opacity duration-150"
                  />
                </a>
              ))}
            </div>
          )}

          {documentos.length > 0 && (
            <ul className="mt-5 space-y-1.5">
              {documentos.map((a) => (
                <li key={a.id}>
                  <a
                    href={a.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 bg-surface-strong hover:bg-surface-hover rounded-xl px-3 py-2.5 transition-colors duration-150"
                  >
                    <span className="text-xl leading-none shrink-0">📄</span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-medium text-ink truncate">
                        {a.filename}
                      </span>
                      <span className="block text-[11px] text-ink-faint">
                        {formatSize(a.size_bytes)}
                      </span>
                    </span>
                    <span className="text-xs font-semibold text-brand shrink-0">Descargar</span>
                  </a>
                </li>
              ))}
            </ul>
          )}

          {post.moderation_note && (
            <p className="text-xs text-red-700 bg-red-50 rounded-xl px-3 py-2.5 mt-5">
              <strong className="font-semibold">Motivo del rechazo:</strong>{" "}
              {post.moderation_note}
            </p>
          )}

          {post.contact ? (
            <div className="mt-6 bg-brand-soft rounded-xl px-4 py-3">
              <p className="text-[11px] font-bold text-brand uppercase tracking-wider mb-0.5">
                Contacto
              </p>
              <p className="text-base font-semibold text-brand break-words">{post.contact}</p>
            </div>
          ) : (
            <p className="mt-6 text-xs text-ink-faint">
              El contacto se muestra mientras el aviso está publicado.
            </p>
          )}
        </div>
      </article>

      {/* El autor termina de armar su aviso acá. */}
      {post.is_mine && (
        <section className="bg-surface rounded-2xl p-4 mt-3 space-y-2">
          <p className="text-sm font-semibold text-ink">Imagen y archivos</p>
          <p className="text-[11px] text-ink-faint">
            Una imagen hace que el aviso se lea. Podés sumar hasta 5 archivos —el CV, un
            presupuesto, fotos de trabajos hechos—. Imágenes hasta 5 MB, documentos hasta
            10 MB.
          </p>

          <input
            ref={coverRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) subir(f, "cover");
              e.target.value = "";
            }}
          />
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,application/pdf,.doc,.docx,.xls,.xlsx,.txt"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) subir(f, "attachments");
              e.target.value = "";
            }}
          />

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => coverRef.current?.click()}
              disabled={busy}
              className="pressable text-sm bg-surface-strong hover:bg-surface-hover disabled:opacity-50 text-ink px-3 py-2 rounded-lg font-medium transition-colors duration-150"
            >
              {post.cover_image_url ? "Cambiar portada" : "Agregar portada"}
            </button>
            {post.cover_image_url && (
              <button
                onClick={quitarPortada}
                disabled={busy}
                className="pressable text-sm text-ink-muted hover:text-ink disabled:opacity-50 px-3 py-2 rounded-lg"
              >
                Quitar portada
              </button>
            )}
            <button
              onClick={() => fileRef.current?.click()}
              disabled={busy || post.attachments.length >= 5}
              className="pressable text-sm bg-surface-strong hover:bg-surface-hover disabled:opacity-50 text-ink px-3 py-2 rounded-lg font-medium transition-colors duration-150"
            >
              {post.attachments.length >= 5 ? "Máximo 5 archivos" : "+ Archivo"}
            </button>
          </div>

          {post.attachments.length > 0 && (
            <ul className="pt-1 space-y-1">
              {post.attachments.map((a) => (
                <li key={a.id} className="flex items-center gap-2 text-xs">
                  <span className="flex-1 min-w-0 text-ink-muted truncate">{a.filename}</span>
                  <button
                    onClick={() => quitarArchivo(a.id)}
                    disabled={busy}
                    className="pressable text-red-600 hover:text-red-700 font-semibold shrink-0"
                  >
                    Quitar
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* Acciones */}
      {(post.is_mine || canModerate) && (
        <section className="flex flex-wrap gap-2 mt-3">
          {canModerate && post.status === "pendiente" && (
            <>
              <button
                onClick={() => moderar(true)}
                disabled={busy}
                className="pressable text-sm bg-brand hover:bg-brand-hover disabled:opacity-50 text-white px-4 py-2 rounded-lg font-semibold transition-colors duration-150"
              >
                Publicar aviso
              </button>
              <button
                onClick={() => moderar(false)}
                disabled={busy}
                className="pressable text-sm bg-surface hover:bg-surface-hover disabled:opacity-50 text-red-600 px-4 py-2 rounded-lg font-semibold transition-colors duration-150"
              >
                Rechazar
              </button>
            </>
          )}
          {post.is_mine && post.status === "vencido" && (
            <button
              onClick={renovar}
              disabled={busy}
              className="pressable text-sm bg-brand hover:bg-brand-hover disabled:opacity-50 text-white px-4 py-2 rounded-lg font-semibold transition-colors duration-150"
            >
              Renovar 30 días
            </button>
          )}
          {(post.is_mine || canModerate) && (
            <button
              onClick={bajar}
              disabled={busy}
              className="pressable text-sm text-red-600 hover:text-red-700 disabled:opacity-50 px-4 py-2 rounded-lg font-semibold"
            >
              Bajar aviso
            </button>
          )}
        </section>
      )}
    </div>
  );
}
