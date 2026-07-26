import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../store/authStore";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const login = useAuthStore((s) => s.login);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(email, password);
      navigate("/tournaments");
    } catch {
      setError("Email o contrasena incorrectos");
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
          Estadisticas de Rugby
        </p>

        <form
          onSubmit={handleSubmit}
          className="bg-surface rounded-2xl p-6 space-y-4"
        >
          <div>
            <label className="block text-sm text-ink-soft mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              className="w-full bg-surface-strong text-ink rounded-xl px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-brand-ring"
            />
          </div>

          <div>
            <label className="block text-sm text-ink-soft mb-1">
              Contrasena
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              className="w-full bg-surface-strong text-ink rounded-xl px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-brand-ring"
            />
          </div>

          {error && (
            <p className="text-red-600 text-sm text-center">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="pressable w-full bg-brand hover:bg-brand-hover disabled:bg-green-800 text-white font-semibold rounded-xl py-3 text-base transition-colors duration-150"
          >
            {loading ? "Ingresando..." : "Ingresar"}
          </button>
        </form>
      </div>
    </div>
  );
}
