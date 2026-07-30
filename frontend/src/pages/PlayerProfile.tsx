import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAuthStore } from "../store/authStore";
import {
  useSquadStore,
  PhysicalTest,
  TEST_TYPE_META,
  formatTestValue,
} from "../store/squadStore";
import api from "../lib/axios";
import { parseApiError } from "../lib/errors";
import {
  AttendanceStatus,
  STATUS_CLASS,
  STATUS_LABEL,
  TRAINING_TYPE_LABEL,
  TrainingType,
  formatShortDate,
  percentColor,
} from "../lib/attendance";

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Traduce el método guardado por el backend (ej. `dw4c/M*/20-29`) a algo legible.
// El asterisco marca un dato asumido por falta de sexo o fecha de nacimiento en
// la ficha — importa mostrarlo, porque cambia el resultado.
function describeBodyFatMethod(method: string): string {
  const [foldSet, sexPart = "", bandPart = ""] = method.split("/");
  const sexAssumed = sexPart.includes("*");
  const bandAssumed = bandPart.includes("*");
  const sex = sexPart.replace("*", "") === "F" ? "femenino" : "masculino";
  const band = bandPart.replace("*", "");

  const folds =
    foldSet === "dw4c"
      ? "pliegues bíceps/tríceps/subescapular/suprailíaco"
      : "abdominal en lugar de bíceps";

  const caveats = [
    sexAssumed ? "sexo asumido" : null,
    bandAssumed ? "edad asumida" : null,
  ].filter(Boolean);

  return (
    `Durnin-Womersley · ${folds} · ${sex}, ${band} años` +
    (caveats.length ? ` — ${caveats.join(" y ")}: completá la ficha del jugador` : "")
  );
}

function delta(current: number | null, previous: number | null, inverse = false) {
  if (current == null || previous == null) return null;
  const diff = current - previous;
  if (diff === 0) return null;
  const positive = inverse ? diff < 0 : diff > 0;
  return { diff, positive };
}

function DeltaBadge({ diff, positive }: { diff: number; positive: boolean }) {
  const color = positive ? "text-brand" : "text-red-600";
  const arrow = positive ? "↑" : "↓";
  return (
    <span className={`text-xs font-semibold ml-1 ${color}`}>
      {arrow} {Math.abs(diff).toFixed(1)}
    </span>
  );
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function IconBack() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

function IconPlus() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function IconX() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

// ─── Measurement form ─────────────────────────────────────────────────────────

function MeasurementForm({
  playerId,
  onClose,
}: {
  playerId: string;
  onClose: () => void;
}) {
  const { addMeasurement } = useSquadStore();
  const [form, setForm] = useState({
    measured_at: new Date().toISOString().split("T")[0],
    weight_kg: "",
    height_cm: "",
    fat_fold_tricep_mm: "",
    fat_fold_subscapular_mm: "",
    fat_fold_suprailiac_mm: "",
    fat_fold_abdominal_mm: "",
    fat_fold_biceps_mm: "",
    notes: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const f = (key: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((p) => ({ ...p, [key]: e.target.value }));

  const bmi =
    form.weight_kg && form.height_cm
      ? (parseFloat(form.weight_kg) / Math.pow(parseFloat(form.height_cm) / 100, 2)).toFixed(1)
      : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.measured_at || !form.weight_kg) {
      setError("Fecha y peso son obligatorios");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await addMeasurement(playerId, {
        ...form,
        weight_kg: parseFloat(form.weight_kg) as any,
        height_cm: form.height_cm ? (parseFloat(form.height_cm) as any) : undefined,
        fat_fold_tricep_mm: form.fat_fold_tricep_mm ? (parseFloat(form.fat_fold_tricep_mm) as any) : undefined,
        fat_fold_subscapular_mm: form.fat_fold_subscapular_mm ? (parseFloat(form.fat_fold_subscapular_mm) as any) : undefined,
        fat_fold_suprailiac_mm: form.fat_fold_suprailiac_mm ? (parseFloat(form.fat_fold_suprailiac_mm) as any) : undefined,
        fat_fold_abdominal_mm: form.fat_fold_abdominal_mm ? (parseFloat(form.fat_fold_abdominal_mm) as any) : undefined,
        fat_fold_biceps_mm: form.fat_fold_biceps_mm ? (parseFloat(form.fat_fold_biceps_mm) as any) : undefined,
        notes: form.notes || undefined,
      } as any);
      onClose();
    } catch {
      setError("Error al guardar medición");
    } finally {
      setSaving(false);
    }
  };

  const field = (label: string, key: string, placeholder = "") => (
    <div>
      <label className="text-xs text-ink-muted block mb-1">{label}</label>
      <input
        value={(form as any)[key]}
        onChange={f(key)}
        type="number"
        step="0.1"
        placeholder={placeholder}
        className="w-full bg-surface-strong rounded-lg px-3 py-2 text-sm text-ink outline-none focus:ring-2 focus:ring-brand-ring"
      />
    </div>
  );

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-end md:items-center justify-center p-4 animate-overlay" onClick={onClose}>
      <div
        className="bg-surface rounded-2xl w-full max-w-sm max-h-[90vh] overflow-y-auto p-6 space-y-4 animate-sheet md:animate-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-ink">Nueva medición</h3>
          <button onClick={onClose} className="text-ink-muted hover:text-ink"><IconX /></button>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="text-xs text-ink-muted block mb-1">Fecha *</label>
            <input
              type="date"
              value={form.measured_at}
              onChange={f("measured_at")}
              className="w-full bg-surface-strong rounded-lg px-3 py-2 text-sm text-ink outline-none focus:ring-2 focus:ring-brand-ring"
            />
          </div>
          {field("Peso (kg) *", "weight_kg", "82.5")}
          <div>
            {field("Altura (cm)", "height_cm", "181")}
            {bmi && (
              <p className="text-xs text-ink-muted mt-1">IMC estimado: <span className="text-ink">{bmi}</span></p>
            )}
          </div>
          <p className="text-xs text-ink-muted pt-1">Pliegues cutáneos (mm)</p>
          {field("Tricipital", "fat_fold_tricep_mm", "12")}
          {field("Subescapular", "fat_fold_subscapular_mm", "15")}
          {field("Suprailíaco", "fat_fold_suprailiac_mm", "18")}
          {field("Bicipital", "fat_fold_biceps_mm", "8")}
          {field("Abdominal", "fat_fold_abdominal_mm", "20")}
          <p className="text-[11px] text-ink-muted leading-snug">
            El % de grasa usa Durnin-Womersley con la edad y el sexo del jugador. Con el
            pliegue bicipital cargado se aplica el juego de pliegues original del método;
            sin él se usa el abdominal como reemplazo.
          </p>
          <div>
            <label className="text-xs text-ink-muted block mb-1">Notas</label>
            <textarea
              value={form.notes}
              onChange={f("notes")}
              rows={2}
              className="w-full bg-surface-strong rounded-lg px-3 py-2 text-sm text-ink outline-none focus:ring-2 focus:ring-brand-ring resize-none"
            />
          </div>
          {error && <p className="text-red-600 text-xs">{error}</p>}
          <button
            type="submit"
            disabled={saving}
            className="pressable w-full bg-brand hover:bg-brand-hover disabled:opacity-50 text-white font-semibold py-2.5 rounded-xl text-sm transition-colors duration-150"
          >
            {saving ? "Guardando..." : "Guardar medición"}
          </button>
        </form>
      </div>
    </div>
  );
}

// ─── Physical test form ────────────────────────────────────────────────────────

const TEST_CATEGORIES = Array.from(
  new Set(Object.values(TEST_TYPE_META).map((t) => t.category))
);

function PhysicalTestForm({
  playerId,
  onClose,
}: {
  playerId: string;
  onClose: () => void;
}) {
  const { addPhysicalTest } = useSquadStore();
  const [testType, setTestType] = useState("");
  const [testDate, setTestDate] = useState(new Date().toISOString().split("T")[0]);
  const [value, setValue] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const meta = testType ? TEST_TYPE_META[testType] : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!testType || !value || !testDate) {
      setError("Tipo, fecha y resultado son obligatorios");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await addPhysicalTest(playerId, {
        test_type: testType,
        test_date: testDate,
        value: parseFloat(value) as any,
        notes: notes || undefined,
      } as any);
      onClose();
    } catch {
      setError("Error al guardar test");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-end md:items-center justify-center p-4 animate-overlay" onClick={onClose}>
      <div
        className="bg-surface rounded-2xl w-full max-w-sm p-6 space-y-4 animate-sheet md:animate-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-ink">Nuevo test físico</h3>
          <button onClick={onClose} className="text-ink-muted hover:text-ink"><IconX /></button>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="text-xs text-ink-muted block mb-1">Fecha *</label>
            <input
              type="date"
              value={testDate}
              onChange={(e) => setTestDate(e.target.value)}
              className="w-full bg-surface-strong rounded-lg px-3 py-2 text-sm text-ink outline-none focus:ring-2 focus:ring-brand-ring"
            />
          </div>
          <div>
            <label className="text-xs text-ink-muted block mb-1">Tipo de test *</label>
            <select
              value={testType}
              onChange={(e) => setTestType(e.target.value)}
              className="w-full bg-surface-strong rounded-lg px-3 py-2 text-sm text-ink outline-none focus:ring-2 focus:ring-brand-ring"
            >
              <option value="">Seleccionar...</option>
              {TEST_CATEGORIES.map((cat) => (
                <optgroup key={cat} label={cat}>
                  {Object.entries(TEST_TYPE_META)
                    .filter(([, m]) => m.category === cat)
                    .map(([key, m]) => (
                      <option key={key} value={key}>{m.label}</option>
                    ))}
                </optgroup>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-ink-muted block mb-1">
              Resultado *{meta && <span className="ml-1 text-ink-muted">({meta.unit === "seconds" ? "segundos" : meta.unit})</span>}
            </label>
            <input
              type="number"
              step="0.001"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={meta?.unit === "seconds" ? "ej. 295 (= 4:55)" : "ej. 95"}
              className="w-full bg-surface-strong rounded-lg px-3 py-2 text-sm text-ink outline-none focus:ring-2 focus:ring-brand-ring"
            />
            {meta?.unit === "seconds" && value && (
              <p className="text-xs text-ink-muted mt-1">
                = {formatTestValue(parseFloat(value), "seconds")}
              </p>
            )}
          </div>
          <div>
            <label className="text-xs text-ink-muted block mb-1">Notas</label>
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full bg-surface-strong rounded-lg px-3 py-2 text-sm text-ink outline-none focus:ring-2 focus:ring-brand-ring"
            />
          </div>
          {error && <p className="text-red-600 text-xs">{error}</p>}
          <button
            type="submit"
            disabled={saving}
            className="pressable w-full bg-brand hover:bg-brand-hover disabled:opacity-50 text-white font-semibold py-2.5 rounded-xl text-sm transition-colors duration-150"
          >
            {saving ? "Guardando..." : "Guardar test"}
          </button>
        </form>
      </div>
    </div>
  );
}

// ─── Sub-tab: Datos ────────────────────────────────────────────────────────────

function TabDatos({ player }: { player: any }) {
  const fields = [
    { label: "Nombre", value: player?.name },
    { label: "Posición", value: player?.position ?? "—" },
    { label: "DNI", value: player?.dni ?? "—" },
  ];
  return (
    <div className="space-y-3 py-4">
      {fields.map(({ label, value }) => (
        <div key={label} className="bg-surface rounded-xl px-4 py-3">
          <p className="text-xs text-ink-muted">{label}</p>
          <p className="text-ink font-medium mt-0.5">{value}</p>
        </div>
      ))}
    </div>
  );
}

// ─── Sub-tab: Físico ──────────────────────────────────────────────────────────

function TabFisico({ playerId, canEdit }: { playerId: string; canEdit: boolean }) {
  const { measurements, fetchMeasurements, deleteMeasurement } = useSquadStore();
  const [showForm, setShowForm] = useState(false);
  const data = measurements[playerId] ?? [];

  useEffect(() => {
    fetchMeasurements(playerId);
  }, [playerId]);

  const latest = data[0] ?? null;
  const prev = data[1] ?? null;

  const statRow = (
    label: string,
    current: number | null | undefined,
    previous: number | null | undefined,
    unit: string,
    inverseGood = false
  ) => {
    if (current == null) return null;
    const d = delta(current, previous ?? null, inverseGood);
    return (
      <div key={label} className="flex items-center justify-between py-2 border-b border-line last:border-0">
        <span className="text-sm text-ink-muted">{label}</span>
        <span className="text-sm text-ink font-medium">
          {current} {unit}
          {d && <DeltaBadge diff={d.diff} positive={d.positive} />}
        </span>
      </div>
    );
  };

  return (
    <div className="py-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-ink-soft">
          {latest ? `Última medición: ${latest.measured_at}` : "Sin mediciones"}
        </h3>
        {canEdit && (
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-1 text-brand hover:text-brand text-sm font-medium"
          >
            <IconPlus /> Nueva
          </button>
        )}
      </div>

      {latest && (
        <div className="bg-surface rounded-xl px-4 py-2">
          {statRow("Peso", latest.weight_kg, prev?.weight_kg, "kg")}
          {statRow("Altura", latest.height_cm, prev?.height_cm, "cm")}
          {statRow("IMC", latest.bmi, prev?.bmi, "", false)}
          {latest.fat_fold_tricep_mm != null && (
            <>
              <div className="py-2 border-b border-line">
                <span className="text-xs text-ink-muted">Pliegues cutáneos</span>
              </div>
              {statRow("Tricipital", latest.fat_fold_tricep_mm, prev?.fat_fold_tricep_mm, "mm", true)}
              {statRow("Subescapular", latest.fat_fold_subscapular_mm, prev?.fat_fold_subscapular_mm, "mm", true)}
              {statRow("Suprailíaco", latest.fat_fold_suprailiac_mm, prev?.fat_fold_suprailiac_mm, "mm", true)}
              {latest.fat_fold_biceps_mm != null &&
                statRow("Bicipital", latest.fat_fold_biceps_mm, prev?.fat_fold_biceps_mm, "mm", true)}
              {statRow("Abdominal", latest.fat_fold_abdominal_mm, prev?.fat_fold_abdominal_mm, "mm", true)}
              {statRow("% Grasa", latest.body_fat_percent, prev?.body_fat_percent, "%", true)}
              {latest.body_fat_method && (
                <p className="text-[11px] text-ink-muted pt-2">
                  {describeBodyFatMethod(latest.body_fat_method)}
                </p>
              )}
            </>
          )}
        </div>
      )}

      {data.length > 1 && (
        <>
          <h3 className="text-sm font-semibold text-ink-soft">Historial</h3>
          <div className="space-y-2">
            {data.slice(1).map((m) => (
              <div key={m.id} className="bg-surface rounded-xl px-4 py-3 flex items-center justify-between">
                <div>
                  <p className="text-ink text-sm">{m.measured_at}</p>
                  <p className="text-ink-muted text-xs">
                    {m.weight_kg != null && `${m.weight_kg} kg`}
                    {m.bmi != null && ` · IMC ${m.bmi}`}
                    {m.body_fat_percent != null && ` · ${m.body_fat_percent}% grasa`}
                  </p>
                </div>
                {canEdit && (
                  <button
                    onClick={() => deleteMeasurement(playerId, m.id)}
                    className="text-ink-faint hover:text-red-600 transition-colors"
                  >
                    <IconX />
                  </button>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {!latest && (
        <div className="text-center py-8">
          <p className="text-ink-muted text-sm">No hay mediciones registradas</p>
          {canEdit && (
            <button
              onClick={() => setShowForm(true)}
              className="mt-3 text-brand hover:text-brand text-sm font-medium"
            >
              + Registrar primera medición
            </button>
          )}
        </div>
      )}

      {showForm && (
        <MeasurementForm playerId={playerId} onClose={() => setShowForm(false)} />
      )}
    </div>
  );
}

// ─── Sub-tab: Tests ────────────────────────────────────────────────────────────

function TabTests({ playerId, canEdit }: { playerId: string; canEdit: boolean }) {
  const { physicalTests, fetchPhysicalTests, deletePhysicalTest } = useSquadStore();
  const [showForm, setShowForm] = useState(false);
  const data = physicalTests[playerId] ?? [];

  useEffect(() => {
    fetchPhysicalTests(playerId);
  }, [playerId]);

  // Group by test_type, keep latest per type
  const latestPerType: Record<string, PhysicalTest> = {};
  for (const t of data) {
    if (!latestPerType[t.test_type]) latestPerType[t.test_type] = t;
  }

  const grouped = Object.entries(latestPerType).sort(([a], [b]) => {
    const catA = TEST_TYPE_META[a]?.category ?? "";
    const catB = TEST_TYPE_META[b]?.category ?? "";
    return catA.localeCompare(catB) || a.localeCompare(b);
  });

  return (
    <div className="py-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-ink-soft">Tests físicos</h3>
        {canEdit && (
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-1 text-brand hover:text-brand text-sm font-medium"
          >
            <IconPlus /> Nuevo
          </button>
        )}
      </div>

      {grouped.length === 0 && (
        <div className="text-center py-8">
          <p className="text-ink-muted text-sm">No hay tests registrados</p>
          {canEdit && (
            <button
              onClick={() => setShowForm(true)}
              className="mt-3 text-brand hover:text-brand text-sm font-medium"
            >
              + Registrar primer test
            </button>
          )}
        </div>
      )}

      {grouped.length > 0 && (
        <div className="bg-surface rounded-xl px-4 py-2 space-y-0 divide-y divide-line">
          {grouped.map(([type, test]) => {
            const meta = TEST_TYPE_META[type];
            // Find previous result of same type
            const prev = data.find((t) => t.test_type === type && t.id !== test.id);
            const timeUnit = meta?.unit === "seconds";
            const d = prev
              ? delta(
                  Number(test.value),
                  Number(prev.value),
                  timeUnit // lower is better for time
                )
              : null;
            if (d && timeUnit) d.positive = !d.positive; // invert: lower time = better

            return (
              <div key={type} className="flex items-center justify-between py-2.5">
                <div>
                  <p className="text-sm text-ink font-medium">{meta?.label ?? type}</p>
                  <p className="text-xs text-ink-muted">{test.test_date}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-ink font-semibold">
                    {formatTestValue(Number(test.value), test.unit)}
                    {d && <DeltaBadge diff={d.diff} positive={d.positive} />}
                  </span>
                  {canEdit && (
                    <button
                      onClick={() => deletePhysicalTest(playerId, test.id)}
                      className="text-ink-faint hover:text-red-600 transition-colors ml-1"
                    >
                      <IconX />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Full history */}
      {data.length > grouped.length && (
        <details className="group">
          <summary className="text-xs text-ink-muted cursor-pointer hover:text-ink-soft list-none text-center py-2">
            Ver historial completo ({data.length} entradas)
          </summary>
          <div className="mt-2 space-y-1.5">
            {data.map((t) => (
              <div key={t.id} className="bg-surface rounded-xl px-4 py-2.5 flex items-center justify-between">
                <div>
                  <p className="text-sm text-ink">{TEST_TYPE_META[t.test_type]?.label ?? t.test_type}</p>
                  <p className="text-xs text-ink-muted">{t.test_date}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-ink-soft">{formatTestValue(Number(t.value), t.unit)}</span>
                  {canEdit && (
                    <button
                      onClick={() => deletePhysicalTest(playerId, t.id)}
                      className="text-ink-faint hover:text-red-600 transition-colors"
                    >
                      <IconX />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </details>
      )}

      {showForm && (
        <PhysicalTestForm playerId={playerId} onClose={() => setShowForm(false)} />
      )}
    </div>
  );
}

// ─── Sub-tab: Historial de división ───────────────────────────────────────────

function TabHistorial({ playerId }: { playerId: string }) {
  const { divisionHistory, fetchDivisionHistory } = useSquadStore();
  const data = divisionHistory[playerId] ?? [];

  useEffect(() => {
    fetchDivisionHistory(playerId);
  }, [playerId]);

  return (
    <div className="py-4 space-y-2">
      {data.length === 0 && (
        <p className="text-center text-ink-muted text-sm py-8">Sin historial de divisiones</p>
      )}
      {data.map((entry, i) => (
        <div key={entry.id} className="bg-surface rounded-xl px-4 py-3">
          <div className="flex items-center justify-between">
            <p className="text-ink font-medium text-sm">{entry.division_name}</p>
            {i === 0 && !entry.to_date && (
              <span className="bg-brand-soft text-brand text-xs px-2 py-0.5 rounded-full">Actual</span>
            )}
          </div>
          <p className="text-xs text-ink-muted mt-0.5">
            Desde {entry.from_date}
            {entry.to_date ? ` hasta ${entry.to_date}` : ""}
          </p>
        </div>
      ))}
    </div>
  );
}

// ─── Sub-tab: Temporada ───────────────────────────────────────────────────────

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

interface SeasonMatchLine {
  session_id: string;
  label: string;
  jersey_number: number;
  minutes: number;
  tries: number;
  tackles: number;
  yellow_cards: number;
  red_cards: number;
}

interface SeasonStats {
  matches: number;
  minutes: number;
  tries: number;
  tackles: number;
  yellow_cards: number;
  red_cards: number;
  matches_detail: SeasonMatchLine[];
}

function TabTemporada({ playerId }: { playerId: string }) {
  const [attendance, setAttendance] = useState<AttendanceDetail | null>(null);
  const [season, setSeason] = useState<SeasonStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.get<AttendanceDetail>(`/players/${playerId}/attendance`).catch(() => null),
      api.get<SeasonStats>(`/players/${playerId}/season-stats`).catch(() => null),
    ])
      .then(([aRes, sRes]) => {
        setAttendance(aRes?.data ?? null);
        setSeason(sRes?.data ?? null);
      })
      .finally(() => setLoading(false));
  }, [playerId]);

  if (loading) {
    return <p className="text-center text-ink-muted text-sm py-8">Cargando...</p>;
  }

  const noData = !attendance || attendance.records.length === 0;

  /**
   * El cruce que un club no puede hacer en papel: juega mucho y entrena poco.
   * Requiere las dos series cargadas — con una sola no hay nada que cruzar.
   */
  const playsMoreThanTrains =
    !noData &&
    attendance!.records.length >= 3 &&
    (season?.matches ?? 0) > 0 &&
    attendance!.percent_90 < 60;

  return (
    <div className="py-4 space-y-5">
      {playsMoreThanTrains && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          Jugó <span className="font-semibold">{season!.matches}</span> partido(s) y{" "}
          <span className="font-semibold">{season!.minutes}′</span> con{" "}
          <span className="font-semibold">{attendance!.percent_90}%</span> de asistencia a 90
          días.
        </p>
      )}
      {/* Partidos y minutos: el dato que ya estaba en la base y nadie podía ver. */}
      <div>
        <p className="text-xs font-bold text-ink-muted uppercase tracking-wider mb-2">Partidos</p>
        {!season || season.matches === 0 ? (
          <p className="text-ink-muted text-sm bg-surface rounded-xl px-4 py-3">
            Todavía no jugó ningún partido.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-4 gap-2">
              {[
                { label: "Partidos", value: season.matches },
                { label: "Minutos", value: season.minutes },
                { label: "Tries", value: season.tries },
                { label: "Tackles", value: season.tackles },
              ].map((stat) => (
                <div key={stat.label} className="bg-surface rounded-xl px-2 py-3 text-center">
                  <p className="text-xl font-bold text-ink tabular-nums">{stat.value}</p>
                  <p className="text-[11px] text-ink-muted mt-0.5">{stat.label}</p>
                </div>
              ))}
            </div>

            <ul className="bg-surface/70 rounded-xl divide-y divide-line mt-3 overflow-hidden">
              {season.matches_detail
                .filter((m) => m.minutes > 0)
                .slice(0, 10)
                .map((m) => (
                  <li key={m.session_id} className="flex items-center gap-3 px-4 py-2.5">
                    <span className="w-7 h-6 shrink-0 grid place-items-center rounded bg-surface-strong text-[11px] font-bold text-ink-soft tabular-nums">
                      {m.jersey_number}
                    </span>
                    <span className="flex-1 text-sm text-ink-soft truncate">{m.label}</span>
                    {m.tries > 0 && (
                      <span className="text-[11px] text-brand shrink-0">{m.tries}T</span>
                    )}
                    {m.yellow_cards > 0 && (
                      <span className="text-[11px] text-yellow-600 shrink-0">
                        {m.yellow_cards}A
                      </span>
                    )}
                    {m.red_cards > 0 && (
                      <span className="text-[11px] text-red-600 shrink-0">{m.red_cards}R</span>
                    )}
                    <span className="text-xs text-ink-muted tabular-nums shrink-0">
                      {m.minutes}′
                    </span>
                  </li>
                ))}
            </ul>
          </>
        )}
      </div>

      <div>
        <p className="text-xs font-bold text-ink-muted uppercase tracking-wider mb-2">Asistencia</p>
        {noData ? (
          <p className="text-ink-muted text-sm bg-surface rounded-xl px-4 py-3">
            Sin entrenamientos registrados todavía.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: "30 días", value: attendance!.percent_30 },
                { label: "90 días", value: attendance!.percent_90 },
                { label: "Temporada", value: attendance!.percent_season },
              ].map((stat) => (
                <div key={stat.label} className="bg-surface rounded-xl px-3 py-3 text-center">
                  <p className={`text-xl font-bold tabular-nums ${percentColor(stat.value)}`}>
                    {stat.value}%
                  </p>
                  <p className="text-[11px] text-ink-muted mt-0.5">{stat.label}</p>
                </div>
              ))}
            </div>

            {attendance!.current_absence_streak >= 3 && (
              <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mt-2">
                {attendance!.current_absence_streak} ausencias seguidas — conviene hablar con el jugador.
              </p>
            )}

            <ul className="bg-surface/70 rounded-xl divide-y divide-line mt-3 overflow-hidden">
              {attendance!.records.slice(0, 15).map((r) => (
                <li key={r.training_id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="text-xs text-ink-muted tabular-nums w-11">
                    {formatShortDate(r.date)}
                  </span>
                  <span className="flex-1 text-sm text-ink-soft capitalize truncate">
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
      </div>
    </div>
  );
}

// ─── Sub-tab: Lesiones ────────────────────────────────────────────────────────

interface Injury {
  id: string;
  injury_date: string;
  body_zone: string | null;
  injury_type: string | null;
  severity: string;
  expected_return: string | null;
  actual_return: string | null;
  notes: string | null;
}

const SEVERITY_CLASS: Record<string, string> = {
  leve: "bg-yellow-100 text-yellow-300",
  moderada: "bg-orange-100 text-orange-700",
  grave: "bg-red-100 text-red-700",
};

const EMPTY_INJURY = {
  injury_date: "",
  body_zone: "",
  severity: "leve",
  expected_return: "",
};

function TabLesiones({ playerId, canEdit }: { playerId: string; canEdit: boolean }) {
  const [injuries, setInjuries] = useState<Injury[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(EMPTY_INJURY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = () => {
    api
      .get<Injury[]>(`/players/${playerId}/injuries`)
      .then(({ data }) => setInjuries(data))
      .catch(() => setInjuries([]))
      .finally(() => setLoading(false));
  };

  useEffect(load, [playerId]);

  const submit = async () => {
    if (!form.injury_date) return;
    setSaving(true);
    setError("");
    try {
      await api.post(`/players/${playerId}/injuries`, {
        injury_date: form.injury_date,
        body_zone: form.body_zone || null,
        severity: form.severity,
        expected_return: form.expected_return || null,
      });
      setAdding(false);
      setForm(EMPTY_INJURY);
      load();
    } catch (err) {
      setError(parseApiError(err, "No se pudo guardar la lesión"));
    } finally {
      setSaving(false);
    }
  };

  const close = async (injury: Injury) => {
    const today = new Date().toISOString().slice(0, 10);
    try {
      await api.patch(`/injuries/${injury.id}`, { actual_return: today });
      load();
    } catch (err) {
      setError(parseApiError(err, "No se pudo cerrar la lesión"));
    }
  };

  if (loading) {
    return <p className="text-center text-ink-muted text-sm py-8">Cargando...</p>;
  }

  return (
    <div className="py-4 space-y-3">
      {canEdit && (
        adding ? (
          <div className="bg-surface rounded-xl p-4 space-y-3">
            <p className="text-sm font-semibold text-ink">Nueva lesión</p>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-ink-muted block mb-1">Fecha</label>
                <input
                  type="date"
                  value={form.injury_date}
                  onChange={(e) => setForm((f) => ({ ...f, injury_date: e.target.value }))}
                  className="w-full bg-surface-strong text-ink text-sm rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-brand-ring"
                />
              </div>
              <div>
                <label className="text-xs text-ink-muted block mb-1">Gravedad</label>
                <select
                  value={form.severity}
                  onChange={(e) => setForm((f) => ({ ...f, severity: e.target.value }))}
                  className="w-full bg-surface-strong text-ink text-sm rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-brand-ring"
                >
                  <option value="leve">Leve</option>
                  <option value="moderada">Moderada</option>
                  <option value="grave">Grave</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-ink-muted block mb-1">Zona</label>
                <input
                  type="text"
                  placeholder="rodilla, hombro..."
                  value={form.body_zone}
                  onChange={(e) => setForm((f) => ({ ...f, body_zone: e.target.value }))}
                  className="w-full bg-surface-strong text-ink text-sm rounded-lg px-3 py-2 placeholder-ink-faint outline-none focus:ring-1 focus:ring-brand-ring"
                />
              </div>
              <div>
                <label className="text-xs text-ink-muted block mb-1">Alta estimada</label>
                <input
                  type="date"
                  value={form.expected_return}
                  onChange={(e) => setForm((f) => ({ ...f, expected_return: e.target.value }))}
                  className="w-full bg-surface-strong text-ink text-sm rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-brand-ring"
                />
              </div>
            </div>
            {error && <p className="text-red-600 text-xs">{error}</p>}
            <div className="flex gap-2">
              <button
                onClick={submit}
                disabled={saving || !form.injury_date}
                className="pressable text-sm bg-brand hover:bg-brand-hover disabled:opacity-50 text-white px-4 py-2 rounded-lg font-medium"
              >
                {saving ? "Guardando..." : "Guardar"}
              </button>
              <button
                onClick={() => { setAdding(false); setError(""); }}
                className="pressable text-sm text-ink-muted hover:text-ink px-4 py-2 rounded-lg"
              >
                Cancelar
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setAdding(true)}
            className="pressable w-full bg-surface hover:bg-surface-strong text-ink text-sm font-semibold py-2.5 rounded-xl transition-colors duration-150"
          >
            + Registrar lesión
          </button>
        )
      )}

      {injuries.length === 0 ? (
        <p className="text-center text-ink-muted text-sm py-8">Sin lesiones registradas</p>
      ) : (
        injuries.map((injury) => {
          const open = !injury.actual_return;
          return (
            <div key={injury.id} className="bg-surface rounded-xl px-4 py-3">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sm text-ink font-medium capitalize truncate flex-1">
                  {injury.body_zone || "Sin zona"}
                </span>
                <span
                  className={`text-[11px] px-2 py-0.5 rounded-full shrink-0 ${SEVERITY_CLASS[injury.severity] ?? ""}`}
                >
                  {injury.severity}
                </span>
                {open && (
                  <span className="text-[11px] bg-red-100 text-red-700 px-2 py-0.5 rounded-full shrink-0">
                    activa
                  </span>
                )}
              </div>
              <p className="text-xs text-ink-muted">
                Desde {injury.injury_date}
                {injury.actual_return
                  ? ` · alta ${injury.actual_return}`
                  : injury.expected_return
                    ? ` · alta estimada ${injury.expected_return}`
                    : ""}
              </p>
              {open && canEdit && (
                <button
                  onClick={() => close(injury)}
                  className="pressable mt-2 text-xs text-brand hover:text-brand bg-brand-soft px-3 py-1.5 rounded-lg transition-colors duration-150"
                >
                  Dar de alta
                </button>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

type Tab = "datos" | "fisico" | "tests" | "temporada" | "lesiones" | "historial";

export default function PlayerProfile() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const { players, divisions, fetchDivisions, fetchAllPlayers } = useSquadStore();
  const [activeTab, setActiveTab] = useState<Tab>("datos");

  const canEdit = user?.role === "club_admin" || user?.role === "match_director";

  useEffect(() => {
    if (!user?.club_id) return;
    if (players.length === 0) {
      fetchDivisions(user.club_id);
      fetchAllPlayers(user.club_id);
    }
  }, [user?.club_id]);

  const player = players.find((p) => p.id === id);
  const division = player ? divisions.find((d) => d.id === player.division_id) : null;

  const tabs: { key: Tab; label: string }[] = [
    { key: "datos", label: "Datos" },
    { key: "fisico", label: "Físico" },
    { key: "tests", label: "Tests" },
    { key: "temporada", label: "Temporada" },
    { key: "lesiones", label: "Lesiones" },
    { key: "historial", label: "Historial" },
  ];

  return (
    <div className="min-h-screen bg-white text-ink">
      {/* Header */}
      <div className="px-4 pt-4 pb-0">
        <div className="flex items-center gap-3 mb-4">
          <button onClick={() => navigate("/squad")} className="text-ink-muted hover:text-ink">
            <IconBack />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-bold text-ink truncate">{player?.name ?? "Jugador"}</h1>
            <p className="text-xs text-ink-muted">
              {player?.position ?? "Sin posición"}
              {division && ` · ${division.name}`}
            </p>
          </div>
          {player?.profile_photo_url ? (
            <img
              src={player.profile_photo_url}
              alt={player.name}
              className="w-12 h-12 rounded-full object-cover shrink-0"
            />
          ) : (
            <div className="w-12 h-12 rounded-full bg-surface-strong flex items-center justify-center text-ink-muted font-bold shrink-0">
              {player?.name?.charAt(0)?.toUpperCase() ?? "?"}
            </div>
          )}
        </div>

        {/* Tabs — scrollable: con 5 solapas no entran repartidas a 360px */}
        <div className="flex border-b border-line overflow-x-auto no-scrollbar">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`shrink-0 px-4 pb-2.5 text-sm font-medium transition-colors duration-150 ${
                activeTab === t.key
                  ? "text-brand border-b-2 border-green-400"
                  : "text-ink-muted hover:text-ink-soft"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div className="px-4">
        {activeTab === "datos" && <TabDatos player={player} />}
        {activeTab === "fisico" && id && (
          <TabFisico playerId={id} canEdit={canEdit} />
        )}
        {activeTab === "tests" && id && (
          <TabTests playerId={id} canEdit={canEdit} />
        )}
        {activeTab === "temporada" && id && (
          <TabTemporada playerId={id} />
        )}
        {activeTab === "lesiones" && id && (
          <TabLesiones playerId={id} canEdit={canEdit} />
        )}
        {activeTab === "historial" && id && (
          <TabHistorial playerId={id} />
        )}
      </div>
    </div>
  );
}
