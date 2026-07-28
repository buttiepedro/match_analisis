import { useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../lib/axios";
import { parseApiError } from "../lib/errors";
import { useAuthStore } from "../store/authStore";

/**
 * Cambio de contraseña, obligatorio en el primer ingreso del socio.
 *
 * Es la pantalla que cierra la ventana entre el import del padrón y el primer
 * ingreso: hasta que se pasa por acá, la contraseña es la misma para todos los
 * socios que entraron en esa importación.
 */
export default function ChangePassword() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const markPasswordChanged = useAuthStore((s) => s.markPasswordChanged);

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const forced = Boolean(user?.must_change_password);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next !== repeat) {
      setError("Las dos contraseñas nuevas no coinciden");
      return;
    }
    setLoading(true);
    setError("");
    try {
      await api.post("/auth/change-password", {
        current_password: current,
        new_password: next,
      });
      markPasswordChanged();
      navigate("/");
    } catch (err) {
      setError(parseApiError(err, "No se pudo cambiar la contraseña"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-white flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <h1 className="text-xl font-bold text-ink text-center mb-1">
          {forced ? "Elegí tu contraseña" : "Cambiar contraseña"}
        </h1>
        {forced && (
          <p className="text-ink-muted text-center mb-6 text-sm">
            Es tu primer ingreso. Cambiá la contraseña que te dio el club por una
            tuya.
          </p>
        )}

        <form onSubmit={submit} className="bg-surface rounded-2xl p-6 space-y-4">
          <div>
            <label className="block text-sm text-ink-soft mb-1">
              {forced ? "Contraseña que te dio el club" : "Contraseña actual"}
            </label>
            <input
              type="password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              required
              autoComplete="current-password"
              className="w-full bg-surface-strong text-ink rounded-xl px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-brand-ring"
            />
          </div>

          <div>
            <label className="block text-sm text-ink-soft mb-1">Nueva contraseña</label>
            <input
              type="password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
              className="w-full bg-surface-strong text-ink rounded-xl px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-brand-ring"
            />
            <p className="text-xs text-ink-faint mt-1">Mínimo 8 caracteres.</p>
          </div>

          <div>
            <label className="block text-sm text-ink-soft mb-1">Repetila</label>
            <input
              type="password"
              value={repeat}
              onChange={(e) => setRepeat(e.target.value)}
              required
              autoComplete="new-password"
              className="w-full bg-surface-strong text-ink rounded-xl px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-brand-ring"
            />
          </div>

          {error && <p className="text-red-600 text-sm text-center">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="pressable w-full bg-brand hover:bg-brand-hover disabled:opacity-60 text-white font-semibold rounded-xl py-3 text-base transition-colors duration-150"
          >
            {loading ? "Guardando..." : "Guardar"}
          </button>
        </form>
      </div>
    </div>
  );
}
