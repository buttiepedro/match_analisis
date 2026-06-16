import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAuthStore } from "../store/authStore";
import {
  useSquadStore,
  Measurement,
  PhysicalTest,
  TEST_TYPE_META,
  formatTestValue,
} from "../store/squadStore";
import api from "../lib/axios";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function delta(current: number | null, previous: number | null, inverse = false) {
  if (current == null || previous == null) return null;
  const diff = current - previous;
  if (diff === 0) return null;
  const positive = inverse ? diff < 0 : diff > 0;
  return { diff, positive };
}

function DeltaBadge({ diff, positive }: { diff: number; positive: boolean }) {
  const color = positive ? "text-green-400" : "text-red-400";
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
      <label className="text-xs text-gray-400 block mb-1">{label}</label>
      <input
        value={(form as any)[key]}
        onChange={f(key)}
        type="number"
        step="0.1"
        placeholder={placeholder}
        className="w-full bg-gray-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-green-500"
      />
    </div>
  );

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-end md:items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-gray-800 rounded-2xl w-full max-w-sm max-h-[90vh] overflow-y-auto p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-white">Nueva medición</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white"><IconX /></button>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="text-xs text-gray-400 block mb-1">Fecha *</label>
            <input
              type="date"
              value={form.measured_at}
              onChange={f("measured_at")}
              className="w-full bg-gray-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>
          {field("Peso (kg) *", "weight_kg", "82.5")}
          <div>
            {field("Altura (cm)", "height_cm", "181")}
            {bmi && (
              <p className="text-xs text-gray-400 mt-1">IMC estimado: <span className="text-white">{bmi}</span></p>
            )}
          </div>
          <p className="text-xs text-gray-500 pt-1">Pliegues cutáneos (mm)</p>
          {field("Tricipital", "fat_fold_tricep_mm", "12")}
          {field("Subescapular", "fat_fold_subscapular_mm", "15")}
          {field("Suprailíaco", "fat_fold_suprailiac_mm", "18")}
          {field("Abdominal", "fat_fold_abdominal_mm", "20")}
          <div>
            <label className="text-xs text-gray-400 block mb-1">Notas</label>
            <textarea
              value={form.notes}
              onChange={f("notes")}
              rows={2}
              className="w-full bg-gray-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-green-500 resize-none"
            />
          </div>
          {error && <p className="text-red-400 text-xs">{error}</p>}
          <button
            type="submit"
            disabled={saving}
            className="w-full bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white font-semibold py-2.5 rounded-xl text-sm transition-colors"
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
    <div className="fixed inset-0 bg-black/60 z-50 flex items-end md:items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-gray-800 rounded-2xl w-full max-w-sm p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-white">Nuevo test físico</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white"><IconX /></button>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="text-xs text-gray-400 block mb-1">Fecha *</label>
            <input
              type="date"
              value={testDate}
              onChange={(e) => setTestDate(e.target.value)}
              className="w-full bg-gray-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>
          <div>
            <label className="text-xs text-gray-400 block mb-1">Tipo de test *</label>
            <select
              value={testType}
              onChange={(e) => setTestType(e.target.value)}
              className="w-full bg-gray-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-green-500"
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
            <label className="text-xs text-gray-400 block mb-1">
              Resultado *{meta && <span className="ml-1 text-gray-500">({meta.unit === "seconds" ? "segundos" : meta.unit})</span>}
            </label>
            <input
              type="number"
              step="0.001"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={meta?.unit === "seconds" ? "ej. 295 (= 4:55)" : "ej. 95"}
              className="w-full bg-gray-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-green-500"
            />
            {meta?.unit === "seconds" && value && (
              <p className="text-xs text-gray-400 mt-1">
                = {formatTestValue(parseFloat(value), "seconds")}
              </p>
            )}
          </div>
          <div>
            <label className="text-xs text-gray-400 block mb-1">Notas</label>
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full bg-gray-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>
          {error && <p className="text-red-400 text-xs">{error}</p>}
          <button
            type="submit"
            disabled={saving}
            className="w-full bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white font-semibold py-2.5 rounded-xl text-sm transition-colors"
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
        <div key={label} className="bg-gray-800 rounded-xl px-4 py-3">
          <p className="text-xs text-gray-400">{label}</p>
          <p className="text-white font-medium mt-0.5">{value}</p>
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
      <div key={label} className="flex items-center justify-between py-2 border-b border-gray-700 last:border-0">
        <span className="text-sm text-gray-400">{label}</span>
        <span className="text-sm text-white font-medium">
          {current} {unit}
          {d && <DeltaBadge diff={d.diff} positive={d.positive} />}
        </span>
      </div>
    );
  };

  return (
    <div className="py-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-300">
          {latest ? `Última medición: ${latest.measured_at}` : "Sin mediciones"}
        </h3>
        {canEdit && (
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-1 text-green-400 hover:text-green-300 text-sm font-medium"
          >
            <IconPlus /> Nueva
          </button>
        )}
      </div>

      {latest && (
        <div className="bg-gray-800 rounded-xl px-4 py-2">
          {statRow("Peso", latest.weight_kg, prev?.weight_kg, "kg")}
          {statRow("Altura", latest.height_cm, prev?.height_cm, "cm")}
          {statRow("IMC", latest.bmi, prev?.bmi, "", false)}
          {latest.fat_fold_tricep_mm != null && (
            <>
              <div className="py-2 border-b border-gray-700">
                <span className="text-xs text-gray-500">Pliegues cutáneos</span>
              </div>
              {statRow("Tricipital", latest.fat_fold_tricep_mm, prev?.fat_fold_tricep_mm, "mm", true)}
              {statRow("Subescapular", latest.fat_fold_subscapular_mm, prev?.fat_fold_subscapular_mm, "mm", true)}
              {statRow("Suprailíaco", latest.fat_fold_suprailiac_mm, prev?.fat_fold_suprailiac_mm, "mm", true)}
              {statRow("Abdominal", latest.fat_fold_abdominal_mm, prev?.fat_fold_abdominal_mm, "mm", true)}
              {statRow("% Grasa", latest.body_fat_percent, prev?.body_fat_percent, "%", true)}
            </>
          )}
        </div>
      )}

      {data.length > 1 && (
        <>
          <h3 className="text-sm font-semibold text-gray-300">Historial</h3>
          <div className="space-y-2">
            {data.slice(1).map((m) => (
              <div key={m.id} className="bg-gray-800 rounded-xl px-4 py-3 flex items-center justify-between">
                <div>
                  <p className="text-white text-sm">{m.measured_at}</p>
                  <p className="text-gray-400 text-xs">
                    {m.weight_kg != null && `${m.weight_kg} kg`}
                    {m.bmi != null && ` · IMC ${m.bmi}`}
                    {m.body_fat_percent != null && ` · ${m.body_fat_percent}% grasa`}
                  </p>
                </div>
                {canEdit && (
                  <button
                    onClick={() => deleteMeasurement(playerId, m.id)}
                    className="text-gray-600 hover:text-red-400 transition-colors"
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
          <p className="text-gray-500 text-sm">No hay mediciones registradas</p>
          {canEdit && (
            <button
              onClick={() => setShowForm(true)}
              className="mt-3 text-green-400 hover:text-green-300 text-sm font-medium"
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
        <h3 className="text-sm font-semibold text-gray-300">Tests físicos</h3>
        {canEdit && (
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-1 text-green-400 hover:text-green-300 text-sm font-medium"
          >
            <IconPlus /> Nuevo
          </button>
        )}
      </div>

      {grouped.length === 0 && (
        <div className="text-center py-8">
          <p className="text-gray-500 text-sm">No hay tests registrados</p>
          {canEdit && (
            <button
              onClick={() => setShowForm(true)}
              className="mt-3 text-green-400 hover:text-green-300 text-sm font-medium"
            >
              + Registrar primer test
            </button>
          )}
        </div>
      )}

      {grouped.length > 0 && (
        <div className="bg-gray-800 rounded-xl px-4 py-2 space-y-0 divide-y divide-gray-700">
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
                  <p className="text-sm text-white font-medium">{meta?.label ?? type}</p>
                  <p className="text-xs text-gray-500">{test.test_date}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-white font-semibold">
                    {formatTestValue(Number(test.value), test.unit)}
                    {d && <DeltaBadge diff={d.diff} positive={d.positive} />}
                  </span>
                  {canEdit && (
                    <button
                      onClick={() => deletePhysicalTest(playerId, test.id)}
                      className="text-gray-600 hover:text-red-400 transition-colors ml-1"
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
          <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-300 list-none text-center py-2">
            Ver historial completo ({data.length} entradas)
          </summary>
          <div className="mt-2 space-y-1.5">
            {data.map((t) => (
              <div key={t.id} className="bg-gray-800 rounded-xl px-4 py-2.5 flex items-center justify-between">
                <div>
                  <p className="text-sm text-white">{TEST_TYPE_META[t.test_type]?.label ?? t.test_type}</p>
                  <p className="text-xs text-gray-500">{t.test_date}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-300">{formatTestValue(Number(t.value), t.unit)}</span>
                  {canEdit && (
                    <button
                      onClick={() => deletePhysicalTest(playerId, t.id)}
                      className="text-gray-600 hover:text-red-400 transition-colors"
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
        <p className="text-center text-gray-500 text-sm py-8">Sin historial de divisiones</p>
      )}
      {data.map((entry, i) => (
        <div key={entry.id} className="bg-gray-800 rounded-xl px-4 py-3">
          <div className="flex items-center justify-between">
            <p className="text-white font-medium text-sm">{entry.division_name}</p>
            {i === 0 && !entry.to_date && (
              <span className="bg-green-900/50 text-green-400 text-xs px-2 py-0.5 rounded-full">Actual</span>
            )}
          </div>
          <p className="text-xs text-gray-400 mt-0.5">
            Desde {entry.from_date}
            {entry.to_date ? ` hasta ${entry.to_date}` : ""}
          </p>
        </div>
      ))}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

type Tab = "datos" | "fisico" | "tests" | "historial";

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
    { key: "historial", label: "Historial" },
  ];

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Header */}
      <div className="px-4 pt-4 pb-0">
        <div className="flex items-center gap-3 mb-4">
          <button onClick={() => navigate("/squad")} className="text-gray-400 hover:text-white">
            <IconBack />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-bold text-white truncate">{player?.name ?? "Jugador"}</h1>
            <p className="text-xs text-gray-400">
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
            <div className="w-12 h-12 rounded-full bg-gray-700 flex items-center justify-center text-gray-400 font-bold shrink-0">
              {player?.name?.charAt(0)?.toUpperCase() ?? "?"}
            </div>
          )}
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-700">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`flex-1 pb-2.5 text-sm font-medium transition-colors ${
                activeTab === t.key
                  ? "text-green-400 border-b-2 border-green-400"
                  : "text-gray-500 hover:text-gray-300"
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
        {activeTab === "historial" && id && (
          <TabHistorial playerId={id} />
        )}
      </div>
    </div>
  );
}
