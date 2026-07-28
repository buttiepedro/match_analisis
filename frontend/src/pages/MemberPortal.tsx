import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import api from "../lib/axios";
import { useAuthStore } from "../store/authStore";

interface Membership {
  full_name: string;
  member_number: string | null;
  category: string | null;
  dues_up_to_date: boolean;
  dues_synced_at: string;
  is_active: boolean;
}

/** "hace 3 días" dice más que una fecha para juzgar si el dato está fresco. */
function sinceLabel(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "actualizado hoy";
  if (days === 1) return "actualizado ayer";
  if (days < 7) return `actualizado hace ${days} días`;
  if (days < 30) return `actualizado hace ${Math.floor(days / 7)} semana(s)`;
  return `actualizado hace más de un mes`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("es-AR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/**
 * Lo que ve el socio: si está al día y **de cuándo es ese dato**.
 *
 * La fecha no es decoración. El estado lo produce el sistema contable del club y
 * llega por una importación que puede tener días: un socio que pagó ayer y ve
 * "no estás al día" sin fecha llama al club enojado; con fecha, entiende.
 */
export default function MemberPortal() {
  const user = useAuthStore((s) => s.user);
  const [data, setData] = useState<Membership | null>(null);
  const [loading, setLoading] = useState(true);
  const [notMember, setNotMember] = useState(false);

  useEffect(() => {
    api
      .get<Membership>("/me/membership")
      .then(({ data }) => setData(data))
      .catch(() => setNotMember(true))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="p-6"><p className="text-ink-muted text-sm">Cargando...</p></div>;
  }

  // Un jugador invitado al portal no es socio: su pantalla es la otra.
  if (notMember) return <Navigate to="/mi-ficha" replace />;
  if (!data) return null;

  const upToDate = data.dues_up_to_date;

  return (
    <div className="p-4 md:p-6 max-w-md mx-auto">
      <p className="text-xs text-ink-muted uppercase tracking-wider">Mi cuota</p>
      <h1 className="text-lg font-bold text-ink mb-5">{data.full_name}</h1>

      <div
        className={`rounded-2xl px-5 py-6 text-center border ${
          upToDate
            ? "bg-brand-soft border-brand-ring"
            : "bg-red-50 border-red-200"
        }`}
      >
        <p
          className={`text-2xl font-bold ${upToDate ? "text-brand" : "text-red-700"}`}
        >
          {upToDate ? "Estás al día" : "Tenés la cuota pendiente"}
        </p>
        <p className="text-xs text-ink-muted mt-2">
          Según el último dato del club, {formatDate(data.dues_synced_at)}
        </p>
        <p className="text-[11px] text-ink-faint mt-0.5">
          {sinceLabel(data.dues_synced_at)}
        </p>
      </div>

      {!upToDate && (
        <p className="text-xs text-ink-muted mt-3 text-center">
          Si ya pagaste después de esa fecha, el dato todavía no llegó a la app.
          Cualquier duda, consultá en la secretaría del club.
        </p>
      )}

      <dl className="bg-surface rounded-xl divide-y divide-line mt-5 overflow-hidden">
        {[
          ["Socio N°", data.member_number ?? "—"],
          ["Categoría", data.category ?? "—"],
          ["DNI", user?.document_id ?? "—"],
        ].map(([label, value]) => (
          <div key={label} className="flex items-center justify-between px-4 py-3">
            <dt className="text-sm text-ink-muted">{label}</dt>
            <dd className="text-sm text-ink font-medium">{value}</dd>
          </div>
        ))}
      </dl>

      <p className="text-[11px] text-ink-faint mt-6 text-center">
        La app muestra lo que informa la administración del club; no procesa pagos.
      </p>
    </div>
  );
}
