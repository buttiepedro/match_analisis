import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../store/authStore";

export default function Dashboard() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white p-4">
      <div className="max-w-xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-bold">match_analisis</h1>
          <button
            onClick={handleLogout}
            className="text-sm text-gray-400 hover:text-white transition-colors"
          >
            Salir
          </button>
        </div>

        <div className="bg-gray-800 rounded-2xl p-6 mb-4">
          <p className="text-gray-400 text-sm mb-1">Bienvenido,</p>
          <p className="text-white font-semibold text-lg">{user?.full_name}</p>
          <span className="inline-block mt-2 text-xs bg-green-900 text-green-300 rounded-full px-3 py-1">
            {user?.role}
          </span>
        </div>

        <p className="text-gray-500 text-center text-sm mt-8">
          Selecciona un partido para comenzar a registrar estadisticas
        </p>
      </div>
    </div>
  );
}
