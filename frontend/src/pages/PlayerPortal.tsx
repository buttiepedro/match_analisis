import { useEffect, useState } from "react";
import api from "../lib/axios";
import { parseApiError } from "../lib/errors";
import { useAuthStore } from "../store/authStore";
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

interface SeasonStats {
  matches: number;
  minutes: number;
  tries: number;
  tackles: number;
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .get<Player>("/me/player")
      .then(async ({ data }) => {
        setPlayer(data);
        const [a, s] = await Promise.all([
          api.get<AttendanceDetail>(`/players/${data.id}/attendance`).catch(() => null),
          api.get<SeasonStats>(`/players/${data.id}/season-stats`).catch(() => null),
        ]);
        setAttendance(a?.data ?? null);
        setSeason(s?.data ?? null);
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
    <div className="p-4 md:p-6 max-w-md mx-auto pb-24">
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

      {player.availability !== "disponible" && (
        <p className="text-xs text-orange-700 bg-orange-50 border border-orange-200 rounded-lg px-3 py-2 mb-4">
          Figurás como <strong>{player.availability.replace("_", " ")}</strong>.
        </p>
      )}

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

      <p className="text-[11px] text-ink-faint mt-6 text-center">
        {user?.full_name} · para corregir algo, hablá con el club
      </p>
    </div>
  );
}
