import { useEffect, useRef, useState } from "react";
import api from "../lib/axios";
import { parseApiError } from "../lib/errors";
import { useAuthStore } from "../store/authStore";
import Sparkline from "../components/Sparkline";
import CropModal from "../components/CropModal";
import { isPushSupported, isSubscribed, subscribeToPush, unsubscribeFromPush } from "../lib/push";
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
  phone: string | null;
  emergency_phone: string | null;
  email: string | null;
  obra_social: string | null;
  medical_clearance_date: string | null;
  medical_clearance_expires: string | null;
  clearance_expired: boolean;
  clearance_expiring: boolean;
}

interface DivisionHistoryEntry {
  division_id: string;
  division_name: string;
  from_date: string;
  to_date: string | null;
}

interface ClosedInjury {
  id: string;
  injury_date: string;
  body_zone: string | null;
  injury_type: string | null;
  severity: string;
  expected_return: string | null;
  actual_return: string | null;
  notes: string | null;
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

type Tab = "resumen" | "perfil" | "tests" | "fisico" | "gimnasio";

const DAY_NAMES = ["", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

interface GymExercise {
  id: string;
  name: string;
  sets: number | null;
  reps: string | null;
  load_type: string;
  load_value: number | null;
  load_test_label: string | null;
  resolved_load_kg: number | null;
  unresolved_reason: string | null;
  notes: string | null;
}

interface GymDay {
  id: string;
  week: number;
  day: number;
  name: string;
  exercises: GymExercise[];
}

interface GymPlan {
  id: string;
  name: string;
  weeks: number;
  days: GymDay[];
}

interface MyGymPlan {
  plan: GymPlan | null;
  completed_day_ids: string[];
}

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


// ── Gimnasio ──────────────────────────────────────────────────────────────────

function GimnasioTab({
  data,
  onLogged,
}: {
  data: MyGymPlan | null;
  onLogged: () => void;
}) {
  const [week, setWeek] = useState(1);
  const [saving, setSaving] = useState<string | null>(null);

  if (!data?.plan) {
    return (
      <p className="text-ink-muted text-sm bg-surface rounded-xl px-4 py-6 text-center">
        Tu división todavía no tiene un plan de gimnasio cargado.
      </p>
    );
  }

  const { plan, completed_day_ids } = data;
  const completed = new Set(completed_day_ids);
  const days = plan.days.filter((d) => d.week === week).sort((a, b) => a.day - b.day);

  const markDone = async (dayId: string) => {
    setSaving(dayId);
    try {
      await api.post("/me/gym-logs", { day_id: dayId });
      onLogged();
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-sm font-semibold text-ink">{plan.name}</p>

      {plan.weeks > 1 && (
        <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
          {Array.from({ length: plan.weeks }, (_, i) => i + 1).map((w) => (
            <button
              key={w}
              onClick={() => setWeek(w)}
              className={`pressable shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors duration-150 ${
                week === w ? "bg-brand text-white" : "bg-surface text-ink-muted"
              }`}
            >
              Sem {w}
            </button>
          ))}
        </div>
      )}

      {days.length === 0 ? (
        <p className="text-ink-muted text-sm bg-surface rounded-xl px-4 py-6 text-center">
          No hay sesiones cargadas para esta semana.
        </p>
      ) : (
        days.map((day) => {
          const done = completed.has(day.id);
          return (
            <section key={day.id} className="bg-surface rounded-xl overflow-hidden">
              <div className="flex items-center gap-3 px-4 py-3 border-b border-line">
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-medium text-ink truncate">{day.name}</span>
                  <span className="block text-[11px] text-ink-faint">
                    {DAY_NAMES[day.day] ?? `Día ${day.day}`}
                  </span>
                </span>
                <button
                  onClick={() => !done && markDone(day.id)}
                  disabled={done || saving === day.id}
                  className={`pressable text-[11px] font-semibold px-3 py-1.5 rounded-lg shrink-0 transition-colors duration-150 ${
                    done
                      ? "bg-brand-soft text-brand"
                      : "bg-surface-strong text-ink-soft hover:bg-surface-hover"
                  }`}
                >
                  {done ? "Hecha" : saving === day.id ? "..." : "Marcar hecha"}
                </button>
              </div>

              <ul className="divide-y divide-line">
                {day.exercises.map((e) => (
                  <li key={e.id} className="px-4 py-2.5">
                    <div className="flex items-center gap-3">
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm text-ink truncate">{e.name}</span>
                        <span className="block text-[11px] text-ink-faint">
                          {[e.sets && `${e.sets} series`, e.reps && `${e.reps} reps`]
                            .filter(Boolean)
                            .join(" · ") || "—"}
                        </span>
                      </span>
                      <span className="text-right shrink-0">
                        {e.resolved_load_kg != null ? (
                          <>
                            <span className="block text-sm font-bold text-ink tabular-nums">
                              {e.resolved_load_kg} kg
                            </span>
                            {e.load_type === "porcentaje_test" && (
                              <span className="block text-[10px] text-ink-faint">
                                {e.load_value}% de tu {e.load_test_label}
                              </span>
                            )}
                          </>
                        ) : e.unresolved_reason ? (
                          // Sin el test no se inventa un kilaje: el jugador lo levantaría.
                          <span className="block text-[11px] text-amber-700 max-w-[8rem]">
                            {e.unresolved_reason}
                          </span>
                        ) : (
                          <span className="block text-[11px] text-ink-faint">Sin carga</span>
                        )}
                      </span>
                    </div>
                    {e.notes && (
                      <p className="text-[11px] text-ink-muted mt-1">{e.notes}</p>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      )}

      <p className="text-[11px] text-ink-faint text-center">
        Los kilos salen de tus propios tests. Si te falta alguno, pedíselo al
        preparador físico.
      </p>
    </div>
  );
}

// ── Perfil ────────────────────────────────────────────────────────────────────

const SEVERITY_LABEL: Record<string, string> = {
  leve: "Leve",
  moderada: "Moderada",
  grave: "Grave",
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(`${iso}T00:00:00`).toLocaleDateString("es-AR", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function daysBetween(from: string, to: string): number {
  return Math.round(
    (new Date(`${to}T00:00:00`).getTime() - new Date(`${from}T00:00:00`).getTime()) / 86_400_000
  );
}

type ContactForm = { phone: string; emergency_phone: string; email: string };

/**
 * Opt-in de push, en contexto — no al entrar a la app.
 *
 * Pedir el permiso del navegador en el primer segundo de la sesión es la
 * forma más confiable de que lo rechace y el navegador no lo vuelva a
 * preguntar nunca más. Acá se explica primero qué va a avisar.
 */
function PushBanner() {
  const [status, setStatus] = useState<
    "loading" | "unsupported" | "on" | "off"
  >("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isPushSupported()) {
      setStatus("unsupported");
      return;
    }
    isSubscribed().then((yes) => setStatus(yes ? "on" : "off"));
  }, []);

  const activate = async () => {
    setBusy(true);
    setError("");
    try {
      await subscribeToPush();
      setStatus("on");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo activar");
    } finally {
      setBusy(false);
    }
  };

  const deactivate = async () => {
    setBusy(true);
    setError("");
    try {
      await unsubscribeFromPush();
      setStatus("off");
    } catch {
      setError("No se pudo desactivar");
    } finally {
      setBusy(false);
    }
  };

  if (status === "loading" || status === "unsupported") return null;

  return (
    <div className="mb-4">
      <div className="bg-brand-soft border border-brand-ring rounded-xl px-4 py-3 flex items-center gap-3">
        <span className="flex-1 text-sm text-ink">
          {status === "on"
            ? "Tenés los avisos activados: te avisamos apenas salga la formación."
            : "Activá los avisos para enterarte apenas salga la formación."}
        </span>
        <button
          onClick={status === "on" ? deactivate : activate}
          disabled={busy}
          className="pressable text-xs font-semibold text-brand hover:text-brand-hover disabled:opacity-50 shrink-0"
        >
          {busy ? "..." : status === "on" ? "Desactivar" : "Activar"}
        </button>
      </div>
      {error && <p className="text-xs text-red-600 mt-1.5">{error}</p>}
    </div>
  );
}

function PerfilTab({
  player,
  history,
  injuries,
  onUpdated,
}: {
  player: Player;
  history: DivisionHistoryEntry[];
  injuries: ClosedInjury[];
  onUpdated: (p: Player) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<ContactForm>({
    phone: player.phone ?? "",
    emergency_phone: player.emergency_phone ?? "",
    email: player.email ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const startEditing = () => {
    setForm({
      phone: player.phone ?? "",
      emergency_phone: player.emergency_phone ?? "",
      email: player.email ?? "",
    });
    setError("");
    setEditing(true);
  };

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      // Un campo vacío significa "no lo toques", no "bórralo": mandar un
      // email vacío rebota contra la validación de formato del backend.
      const { data } = await api.patch<Player>("/me/player", {
        phone: form.phone.trim() || undefined,
        emergency_phone: form.emergency_phone.trim() || undefined,
        email: form.email.trim() || undefined,
      });
      onUpdated(data);
      setEditing(false);
    } catch (err) {
      setError(parseApiError(err, "No se pudo guardar"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <PushBanner />

      <section>
        <p className="text-xs font-bold text-ink-muted uppercase tracking-wider mb-2">
          Apto médico
        </p>
        {player.medical_clearance_expires ? (
          <div
            className={`rounded-xl px-4 py-3 border ${
              player.clearance_expired
                ? "bg-red-50 border-red-200"
                : player.clearance_expiring
                  ? "bg-amber-50 border-amber-200"
                  : "bg-surface border-line"
            }`}
          >
            <p className="text-sm text-ink">
              Vence el {formatDate(player.medical_clearance_expires)}
            </p>
            {player.clearance_expired && (
              <p className="text-xs text-red-700 mt-1">
                Vencido — avisá al club para renovarlo.
              </p>
            )}
            {!player.clearance_expired && player.clearance_expiring && (
              <p className="text-xs text-amber-700 mt-1">Por vencer pronto.</p>
            )}
          </div>
        ) : (
          <p className="text-ink-muted text-sm bg-surface rounded-xl px-4 py-3">
            El club todavía no cargó tu apto médico.
          </p>
        )}
      </section>

      <section>
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-bold text-ink-muted uppercase tracking-wider">Contacto</p>
          {!editing && (
            <button
              onClick={startEditing}
              className="pressable text-xs text-brand hover:text-brand-hover transition-colors duration-150"
            >
              Editar
            </button>
          )}
        </div>

        {editing ? (
          <div className="bg-surface rounded-xl p-4 space-y-2.5">
            {(
              [
                ["phone", "Teléfono", "text"],
                ["emergency_phone", "Teléfono de emergencia", "text"],
                ["email", "Email", "email"],
              ] as const
            ).map(([key, label, type]) => (
              <div key={key}>
                <label className="block text-xs text-ink-muted mb-1">{label}</label>
                <input
                  type={type}
                  value={form[key]}
                  onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                  className="w-full bg-surface-strong text-ink text-sm rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-brand-ring"
                />
              </div>
            ))}
            {error && <p className="text-xs text-red-600">{error}</p>}
            <div className="flex gap-2 pt-1">
              <button
                onClick={save}
                disabled={saving}
                className="pressable text-sm bg-brand hover:bg-brand-hover disabled:opacity-50 text-white px-4 py-2 rounded-lg font-medium"
              >
                {saving ? "Guardando..." : "Guardar"}
              </button>
              <button
                onClick={() => setEditing(false)}
                className="pressable text-sm text-ink-muted hover:text-ink px-4 py-2 rounded-lg"
              >
                Cancelar
              </button>
            </div>
          </div>
        ) : (
          <dl className="bg-surface rounded-xl divide-y divide-line overflow-hidden">
            {(
              [
                ["Teléfono", player.phone],
                ["Tel. de emergencia", player.emergency_phone],
                ["Email", player.email],
                ["Obra social", player.obra_social],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="flex items-center justify-between px-4 py-2.5 gap-3">
                <dt className="text-sm text-ink-muted shrink-0">{label}</dt>
                <dd className="text-sm text-ink font-medium truncate text-right">
                  {value ?? "—"}
                </dd>
              </div>
            ))}
          </dl>
        )}
        <p className="text-[11px] text-ink-faint mt-2">
          DNI, obra social y posición los carga el club — cualquier corrección,
          hablá con ellos.
        </p>
      </section>

      <section>
        <p className="text-xs font-bold text-ink-muted uppercase tracking-wider mb-2">
          Historial de divisiones
        </p>
        {history.length === 0 ? (
          <p className="text-ink-muted text-sm bg-surface rounded-xl px-4 py-3">
            Sin cambios de división registrados.
          </p>
        ) : (
          <ul className="bg-surface rounded-xl divide-y divide-line overflow-hidden">
            {history.map((h) => (
              <li key={`${h.division_id}-${h.from_date}`} className="px-4 py-2.5">
                <p className="text-sm text-ink">{h.division_name}</p>
                <p className="text-xs text-ink-faint">
                  {formatDate(h.from_date)} – {h.to_date ? formatDate(h.to_date) : "actualidad"}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <p className="text-xs font-bold text-ink-muted uppercase tracking-wider mb-2">Lesiones</p>
        {injuries.length === 0 ? (
          <p className="text-ink-muted text-sm bg-surface rounded-xl px-4 py-3">
            Sin lesiones cerradas registradas.
          </p>
        ) : (
          <ul className="bg-surface rounded-xl divide-y divide-line overflow-hidden">
            {injuries.map((inj) => (
              <li key={inj.id} className="px-4 py-2.5">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm text-ink truncate">
                    {inj.body_zone ?? "Sin zona"}
                    {inj.injury_type && ` · ${inj.injury_type}`}
                  </p>
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-surface-strong text-ink-soft shrink-0">
                    {SEVERITY_LABEL[inj.severity] ?? inj.severity}
                  </span>
                </div>
                <p className="text-xs text-ink-faint mt-0.5">
                  {formatDate(inj.injury_date)}
                  {inj.actual_return &&
                    ` · volvió ${daysBetween(inj.injury_date, inj.actual_return)} días después`}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
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
  const [gym, setGym] = useState<MyGymPlan | null>(null);
  const [history, setHistory] = useState<DivisionHistoryEntry[]>([]);
  const [injuries, setInjuries] = useState<ClosedInjury[]>([]);
  const [tab, setTab] = useState<Tab>("resumen");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  // Separado de `error`: ese state dispara la pantalla completa de "no
  // encontramos tu ficha" cuando falla la carga inicial. Reusarlo acá haría
  // que un intento de foto fallido borrara todo el perfil ya cargado.
  const [photoError, setPhotoError] = useState("");
  const photoInputRef = useRef<HTMLInputElement>(null);

  const reloadGym = () => {
    api.get<MyGymPlan>("/me/gym-plan").then(({ data }) => setGym(data)).catch(() => {});
  };

  useEffect(() => {
    api
      .get<Player>("/me/player")
      .then(async ({ data }) => {
        setPlayer(data);
        const [a, s, t, m, g, h, i] = await Promise.all([
          api.get<AttendanceDetail>(`/players/${data.id}/attendance`).catch(() => null),
          api.get<SeasonStats>(`/players/${data.id}/season-stats`).catch(() => null),
          api.get<PhysicalTest[]>(`/players/${data.id}/tests`).catch(() => null),
          api.get<Measurement[]>(`/players/${data.id}/measurements`).catch(() => null),
          api.get<MyGymPlan>("/me/gym-plan").catch(() => null),
          api.get<DivisionHistoryEntry[]>("/me/player/division-history").catch(() => null),
          api.get<ClosedInjury[]>("/me/player/injuries").catch(() => null),
        ]);
        setAttendance(a?.data ?? null);
        setSeason(s?.data ?? null);
        setTests(t?.data ?? []);
        setMeasurements(m?.data ?? []);
        setGym(g?.data ?? null);
        setHistory(h?.data ?? []);
        setInjuries(i?.data ?? []);
      })
      .catch((err) => setError(parseApiError(err, "No se pudo cargar tu ficha")))
      .finally(() => setLoading(false));
  }, []);

  const handlePhotoFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    const reader = new FileReader();
    reader.onload = () => setCropSrc(reader.result as string);
    reader.readAsDataURL(file);
  };

  const handleCropConfirm = async (blob: Blob) => {
    setCropSrc(null);
    setUploadingPhoto(true);
    setPhotoError("");
    try {
      const formData = new FormData();
      formData.append("file", blob, "photo.png");
      const { data } = await api.post<Player>("/me/player/photo", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setPlayer(data);
    } catch (err) {
      setPhotoError(parseApiError(err, "No se pudo subir la foto"));
    } finally {
      setUploadingPhoto(false);
    }
  };

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
        <div className="relative w-14 h-14 shrink-0">
          {player.profile_photo_url ? (
            <img
              src={player.profile_photo_url}
              alt={player.name}
              className="w-14 h-14 rounded-full object-cover"
            />
          ) : (
            <div className="w-14 h-14 rounded-full bg-surface-strong grid place-items-center text-ink-soft font-bold text-lg">
              {player.name.charAt(0).toUpperCase()}
            </div>
          )}
          <button
            onClick={() => photoInputRef.current?.click()}
            disabled={uploadingPhoto}
            aria-label="Cambiar foto de perfil"
            className="pressable absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full bg-brand hover:bg-brand-hover text-white grid place-items-center text-[10px] shadow disabled:opacity-50"
          >
            {uploadingPhoto ? "…" : "✎"}
          </button>
          <input
            ref={photoInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={handlePhotoFileChange}
          />
        </div>
        <div className="min-w-0">
          <h1 className="text-lg font-bold text-ink truncate">{player.name}</h1>
          <p className="text-xs text-ink-muted">{player.position ?? "Sin posición"}</p>
        </div>
      </div>

      {photoError && (
        <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2 mb-4">{photoError}</p>
      )}

      {cropSrc && (
        <CropModal
          imageSrc={cropSrc}
          onConfirm={handleCropConfirm}
          onCancel={() => setCropSrc(null)}
        />
      )}

      <div className="flex gap-1 bg-surface p-1 rounded-xl mb-4">
        {([
          ["resumen", "Resumen"],
          ["perfil", "Perfil"],
          ["tests", "Tests"],
          ["fisico", "Físico"],
          ["gimnasio", "Gimnasio"],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex-1 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-colors duration-150 ${
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

      {tab === "perfil" && (
        <PerfilTab player={player} history={history} injuries={injuries} onUpdated={setPlayer} />
      )}
      {tab === "tests" && <TestsTab tests={tests} />}
      {tab === "fisico" && <FisicoTab measurements={measurements} />}
      {tab === "gimnasio" && <GimnasioTab data={gym} onLogged={reloadGym} />}

      <p className="text-[11px] text-ink-faint mt-6 text-center">
        {user?.full_name} · para corregir algo, hablá con el club
      </p>
    </div>
  );
}
