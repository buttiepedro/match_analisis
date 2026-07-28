import { useEffect, useState } from "react";
import api from "../lib/axios";
import { parseApiError } from "../lib/errors";
import { useAuthStore } from "../store/authStore";
import Sparkline from "../components/Sparkline";
import {
  TEST_TYPE_META,
  formatTestValue,
  testsByCategory,
  Measurement,
  PhysicalTest,
} from "../store/squadStore";
import {
  AttendanceStatus,
  STATUS_CLASS,
  STATUS_LABEL,
  TRAINING_TYPE_LABEL,
  TrainingType,
  formatShortDate,
  percentColor,
} from "../lib/attendance";

interface Player {
  id: string;
  name: string;
  position: string | null;
  profile_photo_url: string | null;
  availability: string;
  medical_clearance_expires: string | null;
}

interface AttendanceRecord {
  training_id: string;
  date: string;
  type: string;
  status: string;
}

interface AttendanceDetail {
  percent_30: number;
  percent_90: number;
  percent_season: number;
  current_absence_streak: number;
  records: AttendanceRecord[];
}

type Tab = "resumen" | "tests" | "fisico";

/** En tiempos bajar es mejorar; en cargas y saltos, subir. */
function lowerIsBetter(testType: string): boolean {
  return TEST_TYPE_META[testType]?.unit === "seconds";
}

interface SeasonStats {
  matches: number;
  minutes: number;
  tries: number;
  tackles: number;
}


// ── Tests ─────────────────────────────────────────────────────────────────────

function TestsTab({ tests }: { tests: PhysicalTest[] }) {
  // La API los devuelve del más nuevo al más viejo; el sparkline necesita el
  // orden cronológico.
  const byType: Record<string, PhysicalTest[]> = {};
  tests.forEach((t) => {
    (byType[t.test_type] ??= []).push(t);
  });
  Object.values(byType).forEach((list) =>
    list.sort((a, b) => a.test_date.localeCompare(b.test_date))
  );

  const groups = testsByCategory()
    .map(({ category, types }) => ({
      category,
      types: types.filter((t) => byType[t]?.length),
    }))
    .filter((g) => g.types.length > 0);

  if (groups.length === 0) {
    return (
      <p className="text-ink-muted text-sm bg-surface rounded-xl px-4 py-6 text-center">
        Todavía no tenés tests cargados.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {groups.map(({ category, types }) => (
        <section key={category}>
          <p className="text-xs font-bold text-ink-muted uppercase tracking-wider mb-2">
            {category}
          </p>
          <ul className="bg-surface rounded-xl divide-y divide-line overflow-hidden">
            {types.map((type) => {
              const history = byType[type];
              const latest = history[history.length - 1];
              const meta = TEST_TYPE_META[type];
              return (
                <li key={type} className="flex items-center gap-3 px-4 py-3">
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm text-ink truncate">{meta.label}</span>
                    <span className="block text-[11px] text-ink-faint">
                      {latest.test_date} · {history.length} medición(es)
                    </span>
                  </span>
                  <Sparkline
                    values={history.map((h) => Number(h.value))}
                    lowerIsBetter={lowerIsBetter(type)}
                    width={72}
                    height={26}
                  />
                  <span className="text-sm font-semibold text-ink tabular-nums shrink-0 w-16 text-right">
                    {formatTestValue(Number(latest.value), latest.unit)}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      <p className="text-[11px] text-ink-faint text-center">
        La línea muestra tu evolución: verde si vas mejorando.
      </p>
    </div>
  );
}

// ── Físico ────────────────────────────────────────────────────────────────────

function FisicoTab({ measurements }: { measurements: Measurement[] }) {
  if (measurements.length === 0) {
    return (
      <p className="text-ink-muted text-sm bg-surface rounded-xl px-4 py-6 text-center">
        Todavía no tenés mediciones cargadas.
      </p>
    );
  }

  // Llegan del más nuevo al más viejo.
  const chronological = [...measurements].reverse();
  const latest = measurements[0];

  const series = [
    {
      label: "Peso",
      unit: "kg",
      values: chronological.map((m) => m.weight_kg).filter((v): v is number => v != null),
      current: latest.weight_kg,
      // Bajar de peso no es "mejor" en rugby: depende del puesto y del plan.
      lowerIsBetter: false,
    },
    {
      label: "% de grasa",
      unit: "%",
      values: chronological
        .map((m) => m.body_fat_percent)
        .filter((v): v is number => v != null),
      current: latest.body_fat_percent,
      lowerIsBetter: true,
    },
  ].filter((s) => s.values.length > 0);

  return (
    <div className="space-y-3">
      {series.map((s) => (
        <div key={s.label} className="bg-surface rounded-xl px-4 py-3 flex items-center gap-3">
          <span className="flex-1 min-w-0">
            <span className="block text-sm text-ink">{s.label}</span>
            <span className="block text-[11px] text-ink-faint">
              {s.values.length} medición(es) · última {latest.measured_at}
            </span>
          </span>
          <Sparkline values={s.values} lowerIsBetter={s.lowerIsBetter} width={72} height={26} />
          <span className="text-sm font-semibold text-ink tabular-nums shrink-0 w-16 text-right">
            {s.current != null ? `${s.current} ${s.unit}` : "—"}
          </span>
        </div>
      ))}

      {latest.bmi != null && (
        <div className="bg-surface rounded-xl px-4 py-3 flex items-center justify-between">
          <span className="text-sm text-ink">IMC</span>
          <span className="text-sm font-semibold text-ink tabular-nums">{latest.bmi}</span>
        </div>
      )}

      <p className="text-[11px] text-ink-faint text-center">
        Las mediciones las carga el cuerpo técnico. Si algo no coincide, hablá con ellos.
      </p>
    </div>
  );
}

/**
 * Portal del jugador: sólo su ficha, sin nada del club.
 *
 * Es de lectura a propósito. Lo que el jugador puede cambiar de su propia ficha
 * es una decisión del club, no un default.
 */
export default function PlayerPortal() {
  const user = useAuthStore((s) => s.user);
  const [player, setPlayer] = useState<Player | null>(null);
  const [attendance, setAttendance] = useState<AttendanceDetail | null>(null);
  const [season, setSeason] = useState<SeasonStats | null>(null);
  const [tests, setTests] = useState<PhysicalTest[]>([]);
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [tab, setTab] = useState<Tab>("resumen");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .get<Player>("/me/player")
      .then(async ({ data }) => {
        setPlayer(data);
        const [a, s, t, m] = await Promise.all([
          api.get<AttendanceDetail>(`/players/${data.id}/attendance`).catch(() => null),
          api.get<SeasonStats>(`/players/${data.id}/season-stats`).catch(() => null),
          api.get<PhysicalTest[]>(`/players/${data.id}/tests`).catch(() => null),
          api.get<Measurement[]>(`/players/${data.id}/measurements`).catch(() => null),
        ]);
        setAttendance(a?.data ?? null);
        setSeason(s?.data ?? null);
        setTests(t?.data ?? []);
        setMeasurements(m?.data ?? []);
      })
      .catch((err) => setError(parseApiError(err, "No se pudo cargar tu ficha")))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="p-6"><p className="text-ink-muted text-sm">Cargando...</p></div>;
  }

  if (error || !player) {
    return (
      <div className="p-6 max-w-md mx-auto">
        <p className="text-sm text-ink-soft bg-surface rounded-xl px-4 py-3">
          {error || "No encontramos tu ficha."}
        </p>
        <p className="text-xs text-ink-muted mt-2">
          Si creés que es un error, hablá con el club.
        </p>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-md mx-auto pb-10">
      <div className="flex items-center gap-3 mb-5">
        {player.profile_photo_url ? (
          <img
            src={player.profile_photo_url}
            alt={player.name}
            className="w-14 h-14 rounded-full object-cover shrink-0"
          />
        ) : (
          <div className="w-14 h-14 rounded-full bg-surface-strong grid place-items-center text-ink-soft font-bold text-lg shrink-0">
            {player.name.charAt(0).toUpperCase()}
          </div>
        )}
        <div className="min-w-0">
          <h1 className="text-lg font-bold text-ink truncate">{player.name}</h1>
          <p className="text-xs text-ink-muted">{player.position ?? "Sin posición"}</p>
        </div>
      </div>

      <div className="flex gap-1 bg-surface p-1 rounded-xl mb-4">
        {([
          ["resumen", "Resumen"],
          ["tests", "Tests"],
          ["fisico", "Físico"],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors duration-150 ${
              tab === key ? "bg-brand text-white" : "text-ink-muted hover:text-ink"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {player.availability !== "disponible" && (
        <p className="text-xs text-orange-700 bg-orange-50 border border-orange-200 rounded-lg px-3 py-2 mb-4">
          Figurás como <strong>{player.availability.replace("_", " ")}</strong>.
        </p>
      )}

      {tab === "resumen" && (
        <>
      {season && season.matches > 0 && (
        <section className="mb-5">
          <p className="text-xs font-bold text-ink-muted uppercase tracking-wider mb-2">
            Tu temporada
          </p>
          <div className="grid grid-cols-4 gap-2">
            {[
              { label: "Partidos", value: season.matches },
              { label: "Minutos", value: season.minutes },
              { label: "Tries", value: season.tries },
              { label: "Tackles", value: season.tackles },
            ].map((s) => (
              <div key={s.label} className="bg-surface rounded-xl px-2 py-3 text-center">
                <p className="text-xl font-bold text-ink tabular-nums">{s.value}</p>
                <p className="text-[11px] text-ink-muted mt-0.5">{s.label}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <p className="text-xs font-bold text-ink-muted uppercase tracking-wider mb-2">
          Tu asistencia
        </p>
        {!attendance || attendance.records.length === 0 ? (
          <p className="text-ink-muted text-sm bg-surface rounded-xl px-4 py-3">
            Todavía no hay entrenamientos registrados.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: "30 días", value: attendance.percent_30 },
                { label: "90 días", value: attendance.percent_90 },
                { label: "Temporada", value: attendance.percent_season },
              ].map((s) => (
                <div key={s.label} className="bg-surface rounded-xl px-3 py-3 text-center">
                  <p className={`text-xl font-bold tabular-nums ${percentColor(s.value)}`}>
                    {s.value}%
                  </p>
                  <p className="text-[11px] text-ink-muted mt-0.5">{s.label}</p>
                </div>
              ))}
            </div>

            <ul className="bg-surface/70 rounded-xl divide-y divide-line mt-3 overflow-hidden">
              {attendance.records.slice(0, 12).map((r) => (
                <li key={r.training_id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="text-xs text-ink-muted tabular-nums w-11">
                    {formatShortDate(r.date)}
                  </span>
                  <span className="flex-1 text-sm text-ink-soft truncate">
                    {TRAINING_TYPE_LABEL[r.type as TrainingType] ?? r.type}
                  </span>
                  <span
                    className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${STATUS_CLASS[r.status as AttendanceStatus]}`}
                  >
                    {STATUS_LABEL[r.status as AttendanceStatus]}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

        </>
      )}

      {tab === "tests" && <TestsTab tests={tests} />}
      {tab === "fisico" && <FisicoTab measurements={measurements} />}

      <p className="text-[11px] text-ink-faint mt-6 text-center">
        {user?.full_name} · para corregir algo, hablá con el club
      </p>
    </div>
  );
}
