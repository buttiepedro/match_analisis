import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../lib/axios";
import { Division, Measurement } from "../store/squadStore";

interface PlayerRow {
  id: string;
  name: string;
  position: string | null;
}

interface Row {
  player: PlayerRow;
  latest: Measurement | null;
  previous: Measurement | null;
}

/** Flecha de tendencia: baja es verde en grasa, neutra en peso. */
function Delta({
  current,
  previous,
  lowerIsBetter,
  unit,
}: {
  current: number | null;
  previous: number | null;
  lowerIsBetter: boolean;
  unit: string;
}) {
  if (current == null || previous == null) return <span className="text-ink-faint">—</span>;
  const diff = current - previous;
  if (Math.abs(diff) < 0.05) {
    return <span className="text-ink-faint text-xs">sin cambio</span>;
  }
  const good = lowerIsBetter ? diff < 0 : false;
  return (
    <span
      className={`text-xs font-semibold tabular-nums ${
        lowerIsBetter ? (good ? "text-green-700" : "text-red-600") : "text-ink-muted"
      }`}
    >
      {diff > 0 ? "+" : ""}
      {diff.toFixed(1)} {unit}
    </span>
  );
}

/**
 * Solapa de nutrición: antropometría del plantel de un vistazo.
 *
 * El trabajo del nutricionista es distinto al del preparador físico, y mezclarlos
 * en una sola pantalla obligaba a los dos a filtrar lo del otro.
 */
export default function NutritionTab({ divisions }: { divisions: Division[] }) {
  const navigate = useNavigate();
  const [divisionId, setDivisionId] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (divisions.length > 0 && !divisionId) setDivisionId(divisions[0].id);
  }, [divisions]);

  useEffect(() => {
    if (!divisionId) return;
    setLoading(true);
    api
      .get<PlayerRow[]>(`/divisions/${divisionId}/players`)
      .then(async ({ data }) => {
        const withMeasurements = await Promise.all(
          data.map(async (p) => {
            const list = await api
              .get<Measurement[]>(`/players/${p.id}/measurements`)
              .then(({ data }) => data)
              .catch(() => [] as Measurement[]);
            // La API los devuelve del más nuevo al más viejo.
            return { player: p, latest: list[0] ?? null, previous: list[1] ?? null };
          })
        );
        setRows(withMeasurements);
      })
      .finally(() => setLoading(false));
  }, [divisionId]);

  const measured = useMemo(() => rows.filter((r) => r.latest), [rows]);
  const pending = useMemo(() => rows.filter((r) => !r.latest), [rows]);

  return (
    <div className="px-4 pb-6">
      <div className="flex gap-2 pb-3 overflow-x-auto no-scrollbar">
        {divisions.map((d) => (
          <button
            key={d.id}
            onClick={() => setDivisionId(d.id)}
            className={`pressable shrink-0 px-3 py-1.5 rounded-full text-sm font-medium transition-colors duration-150 ${
              divisionId === d.id
                ? "bg-brand text-white"
                : "bg-surface-strong text-ink-soft hover:bg-surface-hover"
            }`}
          >
            {d.name}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-ink-muted text-sm py-8 text-center">Cargando mediciones...</p>
      ) : rows.length === 0 ? (
        <p className="text-ink-muted text-sm py-8 text-center">
          La división no tiene jugadores activos.
        </p>
      ) : (
        <>
          <div className="bg-surface rounded-2xl overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-2.5 border-b border-line text-[11px] font-bold text-ink-muted uppercase tracking-wider">
              <span className="flex-1">Jugador</span>
              <span className="w-16 text-right">Peso</span>
              <span className="w-14 text-right">% Grasa</span>
              <span className="w-20 text-right">Var. grasa</span>
            </div>

            {measured.map(({ player, latest, previous }) => (
              <button
                key={player.id}
                onClick={() => navigate(`/squad/${player.id}`)}
                className="w-full flex items-center gap-3 px-4 py-2.5 border-b border-line last:border-0 text-left hover:bg-surface-hover transition-colors duration-150"
              >
                <span className="flex-1 min-w-0">
                  <span className="block text-sm text-ink truncate">{player.name}</span>
                  <span className="block text-[11px] text-ink-faint">
                    {latest!.measured_at}
                  </span>
                </span>
                <span className="w-16 text-right text-sm text-ink tabular-nums">
                  {latest!.weight_kg != null ? `${latest!.weight_kg} kg` : "—"}
                </span>
                <span className="w-14 text-right text-sm text-ink tabular-nums">
                  {latest!.body_fat_percent != null ? `${latest!.body_fat_percent}%` : "—"}
                </span>
                <span className="w-20 text-right">
                  <Delta
                    current={latest!.body_fat_percent}
                    previous={previous?.body_fat_percent ?? null}
                    lowerIsBetter
                    unit="%"
                  />
                </span>
              </button>
            ))}

            {measured.length === 0 && (
              <p className="text-ink-muted text-sm px-4 py-6 text-center">
                Ninguna medición cargada en esta división.
              </p>
            )}
          </div>

          {pending.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-bold text-ink-muted uppercase tracking-wider mb-2">
                Sin medir ({pending.length})
              </p>
              <p className="text-xs text-ink-muted">
                {pending.map((r) => r.player.name).join(" · ")}
              </p>
            </div>
          )}

          <p className="text-xs text-ink-faint text-center mt-4">
            Las mediciones se cargan desde el perfil de cada jugador, solapa Físico.
          </p>
        </>
      )}
    </div>
  );
}
