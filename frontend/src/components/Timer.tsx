import { useEffect, useState } from "react";
import { TimerData } from "../store/sessionStore";
import { currentElapsed, formatTime } from "../lib/timer";
import { sessionWS } from "../lib/ws";

interface TimerProps {
  timer: TimerData | null;
  canControl: boolean;
  homeTeam: string;
  awayTeam: string;
  halfDurationMinutes: number;
}

function useDisplayElapsed(timer: TimerData | null): number {
  const [elapsed, setElapsed] = useState(() => currentElapsed(timer));

  useEffect(() => {
    setElapsed(currentElapsed(timer));
    if (timer?.status !== "running") return;

    const id = setInterval(() => setElapsed(currentElapsed(timer)), 500);
    return () => clearInterval(id);
  }, [timer]);

  return elapsed;
}

const STATUS_COLOR: Record<string, string> = {
  running: "text-green-400",
  paused: "text-yellow-400",
  halftime: "text-blue-400",
  finished: "text-red-400",
  stopped: "text-gray-400",
};

export default function Timer({
  timer,
  canControl,
  homeTeam,
  awayTeam,
  halfDurationMinutes,
}: TimerProps) {
  const elapsed = useDisplayElapsed(timer);
  const status = timer?.status ?? "stopped";
  const half = timer?.half ?? 1;

  // El reloj no se detiene solo: sigue corriendo hasta que el director toca HT
  // o Finalizar. Lo que marcamos es que el tiempo reglamentario ya se cumplió.
  const regulationSeconds = Math.max(0, halfDurationMinutes) * 60;
  const overtime = regulationSeconds > 0 ? elapsed - regulationSeconds : 0;
  const pastRegulation =
    overtime >= 0 && (status === "running" || status === "paused");

  const [correcting, setCorrecting] = useState(false);
  const [corrMm, setCorrMm] = useState("00");
  const [corrSs, setCorrSs] = useState("00");

  const canCorrect = canControl && (status === "paused" || status === "stopped" || status === "finished");

  useEffect(() => {
    if (!canCorrect) setCorrecting(false);
  }, [canCorrect]);

  const send = (action: string, extras?: Record<string, unknown>) =>
    sessionWS.sendTimerControl(action, extras);

  const openCorrect = () => {
    const cur = timer?.elapsed_seconds ?? 0;
    setCorrMm(String(Math.floor(cur / 60)).padStart(2, "0"));
    setCorrSs(String(cur % 60).padStart(2, "0"));
    setCorrecting(true);
  };

  const applyCorrection = () => {
    const mm = Math.max(0, parseInt(corrMm) || 0);
    const ss = Math.min(59, Math.max(0, parseInt(corrSs) || 0));
    send("set", { seconds: mm * 60 + ss });
    setCorrecting(false);
  };

  return (
    <div className="bg-gray-800 px-4 py-3 border-b border-gray-700">
      {/* Teams */}
      <div className="flex justify-between text-xs text-gray-400 mb-1">
        <span className="font-medium">{homeTeam}</span>
        {pastRegulation && (
          <span className="font-bold text-amber-400 uppercase tracking-wide">
            Tiempo cumplido ({halfDurationMinutes}′)
          </span>
        )}
        <span className="font-medium">{awayTeam}</span>
      </div>

      {/* Timer row */}
      <div className="flex items-center justify-between">
        <div className="flex items-baseline gap-2">
          <span className="text-xs font-bold text-gray-400 uppercase">
            {half === 1 ? "1T" : "2T"}
          </span>
          <span
            className={`text-3xl font-mono font-bold tabular-nums ${
              pastRegulation ? "text-amber-400" : STATUS_COLOR[status]
            }`}
          >
            {formatTime(elapsed)}
          </span>
          {pastRegulation && (
            <span className="text-xs font-bold text-amber-400 tabular-nums animate-pulse">
              +{formatTime(overtime)}
            </span>
          )}
        </div>

        <span className="text-xs text-gray-500 capitalize">{status}</span>

        {canControl && (
          <div className="flex gap-2 items-center">
            {status === "stopped" && (
              <CtrlBtn onClick={() => send("start")} label="▶" color="green" />
            )}
            {status === "running" && half === 1 && (
              <>
                <CtrlBtn onClick={() => send("pause")} label="⏸" color="yellow" />
                <CtrlBtn onClick={() => send("halftime")} label="HT" color="blue" />
              </>
            )}
            {status === "running" && half === 2 && (
              <>
                <CtrlBtn onClick={() => send("pause")} label="⏸" color="yellow" />
                <CtrlBtn onClick={() => send("finish")} label="⏹" color="red" />
              </>
            )}
            {status === "paused" && (
              <>
                <CtrlBtn onClick={() => send("resume")} label="▶" color="green" />
                <CtrlBtn onClick={() => send("finish")} label="⏹" color="red" />
              </>
            )}
            {status === "halftime" && (
              <CtrlBtn onClick={() => send("start")} label="2T ▶" color="green" />
            )}

            {/* Reset */}
            {canCorrect && (elapsed > 0 || status === "paused" || status === "finished") && (
              <CtrlBtn onClick={() => send("reset")} label="↺" color="gray" />
            )}
            {/* Set time — opens correction form */}
            {canCorrect && (
              <CtrlBtn onClick={correcting ? () => setCorrecting(false) : openCorrect} label="⏱" color="gray" />
            )}
          </div>
        )}
      </div>

      {/* Correction form — appears below when ⏱ is active */}
      {correcting && (
        <div className="flex items-center gap-2 mt-2 pt-2 border-t border-gray-700">
          <span className="text-xs text-gray-400 shrink-0">Ir a:</span>
          <input
            type="number"
            min="0"
            max="99"
            value={corrMm}
            onChange={(e) => setCorrMm(e.target.value.padStart(2, "0").slice(-2))}
            className="w-12 bg-gray-700 text-white text-sm text-center rounded px-2 py-1 outline-none"
          />
          <span className="text-gray-400 font-bold">:</span>
          <input
            type="number"
            min="0"
            max="59"
            value={corrSs}
            onChange={(e) => setCorrSs(e.target.value.padStart(2, "0").slice(-2))}
            className="w-12 bg-gray-700 text-white text-sm text-center rounded px-2 py-1 outline-none"
          />
          <button
            onClick={applyCorrection}
            className="pressable text-xs bg-green-700 hover:bg-green-600 text-white px-3 py-1 rounded transition-colors duration-150"
          >
            OK
          </button>
          <button
            onClick={() => setCorrecting(false)}
            className="text-xs text-gray-400 hover:text-white transition-colors"
          >
            Cancelar
          </button>
        </div>
      )}
    </div>
  );
}

function CtrlBtn({ onClick, label, color }: { onClick: () => void; label: string; color: string }) {
  const colors: Record<string, string> = {
    green: "bg-green-700 hover:bg-green-600",
    yellow: "bg-yellow-700 hover:bg-yellow-600",
    blue: "bg-blue-700 hover:bg-blue-600",
    red: "bg-red-700 hover:bg-red-600",
    gray: "bg-gray-600 hover:bg-gray-500",
  };
  return (
    <button
      onClick={onClick}
      className={`pressable ${colors[color]} text-white text-xs font-bold px-3 py-1.5 rounded-lg transition-colors duration-150`}
    >
      {label}
    </button>
  );
}
