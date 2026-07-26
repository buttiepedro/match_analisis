import { useEffect, useState } from "react";
import { useAuthStore } from "../store/authStore";
import { useSquadStore, TEST_TYPE_META, formatTestValue } from "../store/squadStore";
import api from "../lib/axios";

interface RankingEntry {
  player_id: string;
  player_name: string;
  value: number;
  unit: string;
  test_date: string;
  rank: number;
}

const TEST_CATEGORIES = Array.from(
  new Set(Object.values(TEST_TYPE_META).map((t) => t.category))
);

function BarRow({
  entry,
  max,
  isTime,
}: {
  entry: RankingEntry;
  max: number;
  isTime: boolean;
}) {
  const pct = isTime
    ? ((max - entry.value + (max * 0.1)) / (max * 1.1)) * 100
    : (entry.value / max) * 100;
  const clampedPct = Math.max(5, Math.min(100, pct));

  const rankColors: Record<number, string> = {
    1: "bg-yellow-400",
    2: "bg-gray-300",
    3: "bg-amber-600",
  };
  const barColor = rankColors[entry.rank] ?? "bg-brand";

  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-line last:border-0">
      <span className="w-5 text-center text-xs font-bold text-ink-muted shrink-0">
        {entry.rank}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-ink font-medium truncate">{entry.player_name}</p>
        <div className="mt-1 h-1.5 bg-surface-strong rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full ${barColor} transition-[width] duration-500`}
            style={{ width: `${clampedPct}%` }}
          />
        </div>
      </div>
      <span className="text-sm font-semibold text-ink shrink-0">
        {formatTestValue(entry.value, entry.unit)}
      </span>
    </div>
  );
}

export default function Performance() {
  const user = useAuthStore((s) => s.user);
  const { divisions, fetchDivisions } = useSquadStore();

  const [activeDivId, setActiveDivId] = useState<string>("");
  const [activeTestType, setActiveTestType] = useState<string>("bronco");
  const [ranking, setRanking] = useState<RankingEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user?.club_id) return;
    fetchDivisions(user.club_id);
  }, [user?.club_id]);

  useEffect(() => {
    if (divisions.length > 0 && !activeDivId) {
      setActiveDivId(divisions[0].id);
    }
  }, [divisions]);

  useEffect(() => {
    if (!activeDivId || !activeTestType) return;
    setLoading(true);
    setError("");
    api
      .get(`/divisions/${activeDivId}/tests/ranking`, {
        params: { test_type: activeTestType },
      })
      .then(({ data }) => setRanking(data))
      .catch(() => setError("Error cargando ranking"))
      .finally(() => setLoading(false));
  }, [activeDivId, activeTestType]);

  const isTime = TEST_TYPE_META[activeTestType]?.unit === "seconds";
  const maxValue = ranking.length > 0 ? Math.max(...ranking.map((r) => r.value)) : 1;
  const testMeta = TEST_TYPE_META[activeTestType];
  const divisionName = divisions.find((d) => d.id === activeDivId)?.name ?? "";

  const avgValue =
    ranking.length > 0
      ? ranking.reduce((sum, r) => sum + r.value, 0) / ranking.length
      : null;

  return (
    <div className="min-h-screen bg-white text-ink">
      {/* Header */}
      <div className="px-4 pt-4 pb-3">
        <h1 className="text-xl font-bold">Rendimiento</h1>
        <p className="text-xs text-ink-muted mt-0.5">Ranking por división y test</p>
      </div>

      {/* Division pills */}
      <div className="flex gap-2 px-4 pb-3 overflow-x-auto scrollbar-none">
        {divisions.map((d) => (
          <button
            key={d.id}
            onClick={() => setActiveDivId(d.id)}
            className={`shrink-0 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              activeDivId === d.id
                ? "bg-brand text-white"
                : "bg-surface-strong text-ink-soft hover:bg-surface-hover"
            }`}
          >
            {d.name}
          </button>
        ))}
      </div>

      {/* Test type selector */}
      <div className="px-4 pb-4">
        <div className="space-y-2">
          {TEST_CATEGORIES.map((cat) => {
            const types = Object.entries(TEST_TYPE_META).filter(
              ([, m]) => m.category === cat
            );
            return (
              <div key={cat}>
                <p className="text-xs text-ink-muted mb-1.5 uppercase tracking-wider">{cat}</p>
                <div className="flex flex-wrap gap-2">
                  {types.map(([key, meta]) => (
                    <button
                      key={key}
                      onClick={() => setActiveTestType(key)}
                      className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                        activeTestType === key
                          ? "bg-brand text-white"
                          : "bg-surface text-ink-muted hover:bg-surface-strong hover:text-ink"
                      }`}
                    >
                      {meta.label}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Ranking card */}
      <div className="px-4 pb-6">
        <div className="bg-surface rounded-2xl p-4">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h2 className="font-semibold text-ink">
                {testMeta?.label ?? activeTestType}
              </h2>
              <p className="text-xs text-ink-muted">{divisionName}</p>
            </div>
            {avgValue != null && (
              <div className="text-right">
                <p className="text-xs text-ink-muted">Promedio</p>
                <p className="text-sm font-semibold text-brand">
                  {formatTestValue(avgValue, testMeta?.unit ?? "")}
                </p>
              </div>
            )}
          </div>

          {loading && (
            <div className="text-center py-8 text-ink-muted text-sm">Cargando ranking...</div>
          )}
          {error && (
            <div className="text-center py-8 text-red-600 text-sm">{error}</div>
          )}
          {!loading && !error && ranking.length === 0 && (
            <div className="text-center py-8">
              <p className="text-ink-muted text-sm">No hay resultados para este test en {divisionName}</p>
              <p className="text-xs text-ink-faint mt-2">
                Registra tests desde el perfil de cada jugador en la sección Plantel
              </p>
            </div>
          )}
          {!loading && ranking.length > 0 && (
            <div>
              {ranking.map((entry) => (
                <BarRow
                  key={entry.player_id}
                  entry={entry}
                  max={maxValue}
                  isTime={isTime}
                />
              ))}
            </div>
          )}
        </div>

        {/* Legend for time tests */}
        {isTime && ranking.length > 0 && (
          <p className="text-xs text-ink-faint text-center mt-3">
            Menor tiempo = mejor resultado · Las barras se ajustan en consecuencia
          </p>
        )}
      </div>
    </div>
  );
}
