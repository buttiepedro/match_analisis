/**
 * Sparkline en SVG, sin librería.
 *
 * ECharts pesa 1.1 MB y el portal es la pantalla que un jugador abre en el
 * celular, muchas veces con mala señal. Traer todo eso para dibujar seis puntos
 * desharía el trabajo de code splitting.
 */
export default function Sparkline({
  values,
  lowerIsBetter = false,
  width = 120,
  height = 32,
}: {
  /** Del más viejo al más nuevo. */
  values: number[];
  /** En tiempos, bajar es mejorar; en cargas, subir. */
  lowerIsBetter?: boolean;
  width?: number;
  height?: number;
}) {
  if (values.length < 2) {
    return (
      <span className="text-[11px] text-ink-faint">
        {values.length === 1 ? "una sola medición" : "sin datos"}
      </span>
    );
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  // Con todos los valores iguales el rango es 0: sin esto la línea se iría al borde.
  const range = max - min || 1;
  const padding = 3;
  const usableHeight = height - padding * 2;

  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * width;
    const y = padding + usableHeight - ((v - min) / range) * usableHeight;
    return [x, y] as const;
  });

  const path = points
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`)
    .join(" ");

  const first = values[0];
  const last = values[values.length - 1];
  const improved = lowerIsBetter ? last < first : last > first;
  const flat = last === first;
  const stroke = flat ? "#9A99AE" : improved ? "#15803d" : "#dc2626";

  const [lastX, lastY] = points[points.length - 1];

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="overflow-visible shrink-0"
      role="img"
      aria-label={
        flat
          ? "Sin cambios"
          : improved
            ? "Mejorando"
            : "Empeorando"
      }
    >
      <path d={path} fill="none" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={lastX} cy={lastY} r="2.5" fill={stroke} />
    </svg>
  );
}
