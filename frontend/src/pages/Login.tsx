import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../store/authStore";

interface ClubOption {
  slug: string;
  name: string;
}

export default function Login() {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  /** Sólo aparece si el mismo DNI existe en más de un club. */
  const [clubs, setClubs] = useState<ClubOption[]>([]);
  const [clubSlug, setClubSlug] = useState("");
  const login = useAuthStore((s) => s.login);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(identifier, password, clubSlug || undefined);
      navigate("/");
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      if (err?.response?.status === 409 && detail?.clubs) {
        setClubs(detail.clubs);
        setClubSlug(detail.clubs[0]?.slug ?? "");
        setError(detail.message ?? "Elegí tu club");
      } else {
        setError("Usuario o contraseña incorrectos");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-white flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-bold text-ink text-center mb-1">
          Rugby Analisis
        </h1>
        <p className="text-ink-muted text-center mb-8 text-sm">
          Estadísticas y gestión del club
        </p>

        <form
          onSubmit={handleSubmit}
          className="bg-surface rounded-2xl p-6 space-y-4"
        >
          <div>
            <label className="block text-sm text-ink-soft mb-1">
              Email o DNI
            </label>
            <input
              type="text"
              inputMode="text"
              value={identifier}
              onChange={(e) => { setIdentifier(e.target.value); setClubs([]); setClubSlug(""); }}
              required
              autoComplete="username"
              className="w-full bg-surface-strong text-ink rounded-xl px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-brand-ring"
            />
            <p className="text-xs text-ink-faint mt-1">
              Si sos socio, ingresá con tu DNI sin puntos.
            </p>
          </div>

          <div>
            <label className="block text-sm text-ink-soft mb-1">Contraseña</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              className="w-full bg-surface-strong text-ink rounded-xl px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-brand-ring"
            />
          </div>

          {clubs.length > 0 && (
            <div>
              <label className="block text-sm text-ink-soft mb-1">Club</label>
              <select
                value={clubSlug}
                onChange={(e) => setClubSlug(e.target.value)}
                className="w-full bg-surface-strong text-ink rounded-xl px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-brand-ring"
              >
                {clubs.map((c) => (
                  <option key={c.slug} value={c.slug}>{c.name}</option>
                ))}
              </select>
            </div>
          )}

          {error && <p className="text-red-600 text-sm text-center">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="pressable w-full bg-brand hover:bg-brand-hover disabled:opacity-60 text-white font-semibold rounded-xl py-3 text-base transition-colors duration-150"
          >
            {loading ? "Ingresando..." : "Ingresar"}
          </button>
        </form>
      </div>
    </div>
  );
}
