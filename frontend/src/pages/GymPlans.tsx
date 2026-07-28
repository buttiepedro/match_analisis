import { useEffect, useMemo, useState } from "react";
import api from "../lib/axios";
import { parseApiError } from "../lib/errors";
import { useAuthStore } from "../store/authStore";
import { TEST_TYPE_META, testsByCategory } from "../store/squadStore";

interface Division {
  id: string;
  name: string;
}

interface PlanSummary {
  id: string;
  name: string;
  weeks: number;
  is_active: boolean;
  days: number;
}

type LoadType = "libre" | "absoluta" | "porcentaje_test";

interface Exercise {
  name: string;
  sets: number | null;
  reps: string | null;
  load_type: LoadType;
  load_value: number | null;
  load_test_type: string | null;
  notes: string | null;
}

interface Day {
  week: number;
  day: number;
  name: string;
  exercises: Exercise[];
}

const DAY_NAMES = ["", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

const EMPTY_EXERCISE: Exercise = {
  name: "",
  sets: null,
  reps: null,
  load_type: "libre",
  load_value: null,
  load_test_type: null,
  notes: null,
};

/**
 * Editor de planes de gimnasio.
 *
 * Toda la estructura se edita en memoria y se guarda de una: es lo que espera el
 * `PUT` del backend, y es como trabaja un PF — escribe la semana entera de una
 * sentada, no ejercicio por ejercicio.
 */
export default function GymPlans() {
  const clubId = useAuthStore((s) => s.user?.club_id);
  const canEdit = (useAuthStore((s) => s.user?.permissions) ?? []).includes("gimnasio.editar");

  const [divisions, setDivisions] = useState<Division[]>([]);
  const [divisionId, setDivisionId] = useState("");
  const [plans, setPlans] = useState<PlanSummary[]>([]);
  const [planId, setPlanId] = useState("");
  const [weeks, setWeeks] = useState(4);
  const [days, setDays] = useState<Day[]>([]);
  const [savedDays, setSavedDays] = useState<Day[]>([]);
  const [week, setWeek] = useState(1);

  /** Cuántos jugadores tienen cargado cada test, por tipo. */
  const [testCoverage, setTestCoverage] = useState<Record<string, number>>({});
  const [squadSize, setSquadSize] = useState(0);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [creating, setCreating] = useState(false);
  const [newPlan, setNewPlan] = useState({ name: "", weeks: 4 });

  useEffect(() => {
    if (!clubId) return;
    api
      .get<Division[]>(`/clubs/${clubId}/divisions`)
      .then(({ data }) => {
        setDivisions(data);
        setDivisionId((c) => c || data[0]?.id || "");
      })
      .catch((err) => setError(parseApiError(err, "No se pudieron cargar las divisiones")))
      .finally(() => setLoading(false));
  }, [clubId]);

  useEffect(() => {
    if (!divisionId) return;
    setPlanId("");
    setDays([]);
    setSavedDays([]);
    api
      .get<PlanSummary[]>(`/divisions/${divisionId}/gym-plans`)
      .then(({ data }) => {
        setPlans(data);
        const active = data.find((p) => p.is_active) ?? data[0];
        if (active) setPlanId(active.id);
      })
      .catch(() => setPlans([]));

    // Cuántos jugadores tienen cada test: sin esto el PF escribe un plan con
    // porcentajes y media división termina viendo "te falta el test".
    api
      .get<{ id: string }[]>(`/divisions/${divisionId}/players`)
      .then(({ data }) => setSquadSize(data.length))
      .catch(() => setSquadSize(0));
  }, [divisionId]);

  useEffect(() => {
    if (!planId) return;
    api.get(`/gym-plans/${planId}`).then(({ data }) => {
      setWeeks(data.weeks);
      const loaded: Day[] = data.days.map((d: any) => ({
        week: d.week,
        day: d.day,
        name: d.name,
        exercises: d.exercises.map((e: any) => ({
          name: e.name,
          sets: e.sets,
          reps: e.reps,
          load_type: e.load_type,
          load_value: e.load_value,
          load_test_type: e.load_test_type,
          notes: e.notes,
        })),
      }));
      setDays(loaded);
      setSavedDays(loaded);
      setWeek(1);
    });
  }, [planId]);

  /** Se consulta sólo para los tests que el plan realmente usa. */
  useEffect(() => {
    if (!divisionId) return;
    const used = new Set(
      days.flatMap((d) =>
        d.exercises.filter((e) => e.load_test_type).map((e) => e.load_test_type as string)
      )
    );
    used.forEach((type) => {
      if (type in testCoverage) return;
      api
        .get<unknown[]>(`/divisions/${divisionId}/tests/ranking`, { params: { test_type: type } })
        .then(({ data }) => setTestCoverage((prev) => ({ ...prev, [type]: data.length })))
        .catch(() => setTestCoverage((prev) => ({ ...prev, [type]: 0 })));
    });
  }, [days, divisionId, testCoverage]);

  const dirty = useMemo(
    () => JSON.stringify(days) !== JSON.stringify(savedDays),
    [days, savedDays]
  );

  const weekDays = days.filter((d) => d.week === week).sort((a, b) => a.day - b.day);

  const mutate = (fn: (draft: Day[]) => void) => {
    setDays((prev) => {
      const draft = JSON.parse(JSON.stringify(prev)) as Day[];
      fn(draft);
      return draft;
    });
    setNotice("");
  };

  const addDay = () => {
    const taken = new Set(weekDays.map((d) => d.day));
    const next = [1, 2, 3, 4, 5, 6, 7].find((d) => !taken.has(d));
    if (!next) return;
    mutate((draft) => {
      draft.push({ week, day: next, name: "Nueva sesión", exercises: [] });
    });
  };

  const indexOf = (day: Day) => days.findIndex((d) => d.week === day.week && d.day === day.day);

  const createPlan = async () => {
    if (!divisionId || !newPlan.name.trim()) return;
    setError("");
    try {
      const { data } = await api.post(`/divisions/${divisionId}/gym-plans`, {
        name: newPlan.name.trim(),
        weeks: newPlan.weeks,
      });
      const { data: list } = await api.get<PlanSummary[]>(`/divisions/${divisionId}/gym-plans`);
      setPlans(list);
      setPlanId(data.id);
      setCreating(false);
      setNewPlan({ name: "", weeks: 4 });
    } catch (err) {
      setError(parseApiError(err, "No se pudo crear el plan"));
    }
  };

  const save = async () => {
    if (!planId) return;
    setSaving(true);
    setError("");
    try {
      await api.put(`/gym-plans/${planId}/structure`, { days });
      setSavedDays(days);
      setNotice("Plan guardado.");
    } catch (err) {
      // El backend explica qué ejercicio está mal y con qué motivo.
      setError(parseApiError(err, "No se pudo guardar el plan"));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="p-6"><p className="text-ink-muted text-sm">Cargando...</p></div>;
  }

  if (divisions.length === 0) {
    return (
      <div className="p-6">
        <h1 className="text-lg font-bold text-ink mb-2">Gimnasio</h1>
        <p className="text-ink-muted text-sm">No hay divisiones cargadas todavía.</p>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto pb-28">
      <h1 className="text-lg font-bold text-ink mb-1">Gimnasio</h1>
      <p className="text-xs text-ink-muted mb-4">
        La carga puede ser en kilos o un porcentaje de un test. Con el porcentaje,
        cada jugador ve sus propios kilos.
      </p>

      <div className="grid grid-cols-2 gap-2 mb-4">
        <select
          value={divisionId}
          onChange={(e) => setDivisionId(e.target.value)}
          className="bg-surface text-ink text-sm rounded-xl px-3 py-2.5 outline-none focus:ring-2 focus:ring-brand-ring"
        >
          {divisions.map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>

        <select
          value={planId}
          onChange={(e) => setPlanId(e.target.value)}
          disabled={plans.length === 0}
          className="bg-surface text-ink text-sm rounded-xl px-3 py-2.5 outline-none focus:ring-2 focus:ring-brand-ring disabled:opacity-50"
        >
          {plans.length === 0 && <option>Sin planes</option>}
          {plans.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}{p.is_active ? " · activo" : ""}
            </option>
          ))}
        </select>
      </div>

      {canEdit && (
        creating ? (
          <div className="bg-surface rounded-xl p-4 space-y-2 mb-4">
            <input
              autoFocus
              placeholder="Nombre del plan"
              value={newPlan.name}
              onChange={(e) => setNewPlan((p) => ({ ...p, name: e.target.value }))}
              className="w-full bg-surface-strong text-ink text-sm rounded-lg px-3 py-2 placeholder-ink-faint outline-none focus:ring-1 focus:ring-brand-ring"
            />
            <label className="flex items-center gap-2 text-xs text-ink-muted">
              Semanas
              <input
                type="number"
                min={1}
                max={24}
                value={newPlan.weeks}
                onChange={(e) => setNewPlan((p) => ({ ...p, weeks: Number(e.target.value) }))}
                className="w-16 bg-surface-strong text-ink text-sm rounded-lg px-2 py-1 outline-none"
              />
            </label>
            <p className="text-[11px] text-ink-faint">
              El plan nuevo queda activo y reemplaza al anterior: el jugador tiene que
              ver uno, no elegir.
            </p>
            <div className="flex gap-2">
              <button
                onClick={createPlan}
                disabled={!newPlan.name.trim()}
                className="pressable text-sm bg-brand hover:bg-brand-hover disabled:opacity-50 text-white px-4 py-2 rounded-lg font-medium transition-colors duration-150"
              >
                Crear
              </button>
              <button
                onClick={() => setCreating(false)}
                className="pressable text-sm text-ink-muted hover:text-ink px-4 py-2 rounded-lg"
              >
                Cancelar
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setCreating(true)}
            className="pressable w-full bg-surface hover:bg-surface-hover text-ink text-sm font-semibold py-2.5 rounded-xl mb-4 transition-colors duration-150"
          >
            + Nuevo plan
          </button>
        )
      )}

      {error && (
        <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2 mb-3">{error}</p>
      )}
      {notice && (
        <p className="text-xs text-brand bg-brand-soft rounded-lg px-3 py-2 mb-3">{notice}</p>
      )}

      {!planId ? (
        <p className="text-ink-muted text-sm bg-surface/70 rounded-xl px-4 py-8 text-center">
          Creá un plan para esta división.
        </p>
      ) : (
        <>
          {weeks > 1 && (
            <div className="flex gap-1.5 overflow-x-auto no-scrollbar mb-3">
              {Array.from({ length: weeks }, (_, i) => i + 1).map((w) => (
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

          <div className="space-y-3">
            {weekDays.map((day) => {
              const di = indexOf(day);
              return (
                <section key={`${day.week}-${day.day}`} className="bg-surface rounded-xl overflow-hidden">
                  <div className="flex items-center gap-2 px-4 py-3 border-b border-line">
                    <select
                      value={day.day}
                      onChange={(e) =>
                        mutate((d) => { d[di].day = Number(e.target.value); })
                      }
                      className="bg-surface-strong text-ink text-xs rounded-lg px-2 py-1.5 outline-none"
                    >
                      {[1, 2, 3, 4, 5, 6, 7].map((n) => (
                        <option key={n} value={n}>{DAY_NAMES[n]}</option>
                      ))}
                    </select>
                    <input
                      value={day.name}
                      onChange={(e) => mutate((d) => { d[di].name = e.target.value; })}
                      className="flex-1 bg-transparent text-sm text-ink font-medium outline-none min-w-0"
                    />
                    <button
                      onClick={() => mutate((d) => { d.splice(di, 1); })}
                      className="pressable text-xs text-red-600 hover:text-red-700 px-2 shrink-0"
                      aria-label="Eliminar sesión"
                    >
                      ✕
                    </button>
                  </div>

                  <ul className="divide-y divide-line">
                    {day.exercises.map((exercise, ei) => (
                      <li key={ei} className="px-4 py-3 space-y-2">
                        <div className="flex gap-2">
                          <input
                            placeholder="Ejercicio"
                            value={exercise.name}
                            onChange={(e) =>
                              mutate((d) => { d[di].exercises[ei].name = e.target.value; })
                            }
                            className="flex-1 bg-surface-strong text-ink text-sm rounded-lg px-3 py-2 placeholder-ink-faint outline-none min-w-0"
                          />
                          <button
                            onClick={() => mutate((d) => { d[di].exercises.splice(ei, 1); })}
                            className="pressable text-xs text-ink-faint hover:text-red-600 px-1 shrink-0"
                            aria-label="Quitar ejercicio"
                          >
                            ✕
                          </button>
                        </div>

                        <div className="grid grid-cols-3 gap-2">
                          <input
                            type="number"
                            min={1}
                            placeholder="Series"
                            value={exercise.sets ?? ""}
                            onChange={(e) =>
                              mutate((d) => {
                                d[di].exercises[ei].sets = e.target.value ? Number(e.target.value) : null;
                              })
                            }
                            className="bg-surface-strong text-ink text-sm rounded-lg px-2 py-1.5 placeholder-ink-faint outline-none"
                          />
                          <input
                            placeholder="Reps"
                            value={exercise.reps ?? ""}
                            onChange={(e) =>
                              mutate((d) => { d[di].exercises[ei].reps = e.target.value || null; })
                            }
                            className="bg-surface-strong text-ink text-sm rounded-lg px-2 py-1.5 placeholder-ink-faint outline-none"
                          />
                          <select
                            value={exercise.load_type}
                            onChange={(e) =>
                              mutate((d) => {
                                const type = e.target.value as LoadType;
                                d[di].exercises[ei].load_type = type;
                                if (type !== "porcentaje_test") d[di].exercises[ei].load_test_type = null;
                                if (type === "libre") d[di].exercises[ei].load_value = null;
                              })
                            }
                            className="bg-surface-strong text-ink text-sm rounded-lg px-2 py-1.5 outline-none"
                          >
                            <option value="libre">Sin carga</option>
                            <option value="absoluta">Kilos</option>
                            <option value="porcentaje_test">% de test</option>
                          </select>
                        </div>

                        {exercise.load_type !== "libre" && (
                          <div className="grid grid-cols-3 gap-2">
                            <input
                              type="number"
                              min={0}
                              placeholder={exercise.load_type === "absoluta" ? "kg" : "%"}
                              value={exercise.load_value ?? ""}
                              onChange={(e) =>
                                mutate((d) => {
                                  d[di].exercises[ei].load_value = e.target.value
                                    ? Number(e.target.value)
                                    : null;
                                })
                              }
                              className="bg-surface-strong text-ink text-sm rounded-lg px-2 py-1.5 placeholder-ink-faint outline-none"
                            />
                            {exercise.load_type === "porcentaje_test" && (
                              <select
                                value={exercise.load_test_type ?? ""}
                                onChange={(e) =>
                                  mutate((d) => {
                                    d[di].exercises[ei].load_test_type = e.target.value || null;
                                  })
                                }
                                className="col-span-2 bg-surface-strong text-ink text-sm rounded-lg px-2 py-1.5 outline-none"
                              >
                                <option value="">— Test —</option>
                                {testsByCategory().map((g) => (
                                  <optgroup key={g.category} label={g.category}>
                                    {g.types.map((t) => (
                                      <option key={t} value={t}>{TEST_TYPE_META[t].label}</option>
                                    ))}
                                  </optgroup>
                                ))}
                              </select>
                            )}
                          </div>
                        )}

                        {exercise.load_type === "porcentaje_test" &&
                          exercise.load_test_type &&
                          squadSize > 0 &&
                          testCoverage[exercise.load_test_type] !== undefined &&
                          testCoverage[exercise.load_test_type] < squadSize && (
                            <p className="text-[11px] text-amber-700">
                              {testCoverage[exercise.load_test_type]} de {squadSize} jugadores
                              tienen este test. Al resto le va a aparecer que le falta.
                            </p>
                          )}
                      </li>
                    ))}
                  </ul>

                  <button
                    onClick={() =>
                      mutate((d) => { d[di].exercises.push({ ...EMPTY_EXERCISE }); })
                    }
                    className="pressable w-full text-xs text-ink-muted hover:text-ink py-2.5 transition-colors duration-150"
                  >
                    + Ejercicio
                  </button>
                </section>
              );
            })}
          </div>

          {canEdit && weekDays.length < 7 && (
            <button
              onClick={addDay}
              className="pressable w-full bg-surface hover:bg-surface-hover text-ink text-sm font-semibold py-2.5 rounded-xl mt-3 transition-colors duration-150"
            >
              + Sesión
            </button>
          )}

          {weekDays.length === 0 && (
            <p className="text-ink-muted text-sm py-6 text-center">
              Sin sesiones en la semana {week}.
            </p>
          )}
        </>
      )}

      {canEdit && planId && (
        <div className="fixed bottom-0 inset-x-0 md:left-56 bg-white/95 backdrop-blur border-t border-line px-4 py-3">
          <div className="max-w-2xl mx-auto flex items-center gap-3">
            <p className="text-xs text-ink-muted flex-1">
              {days.length} sesión(es) en el plan
              {dirty && <span className="text-amber-600"> · sin guardar</span>}
            </p>
            <button
              onClick={save}
              disabled={saving || !dirty}
              className="pressable bg-brand hover:bg-brand-hover disabled:opacity-40 text-white text-sm font-semibold px-6 py-2.5 rounded-xl transition-colors duration-150"
            >
              {saving ? "Guardando..." : "Guardar"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
