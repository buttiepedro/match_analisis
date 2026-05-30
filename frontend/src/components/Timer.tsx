import { useEffect, useState } from "react";
import { TimerData } from "../store/sessionStore";
import { sessionWS } from "../lib/ws";

interface TimerProps {
  timer: TimerData | null;
  canControl: boolean;
  homeTeam: string;
  awayTeam: string;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0");
  const s = (seconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function useDisplayElapsed(timer: TimerData | null): number {
  const [elapsed, setElapsed] = useState(timer?.elapsed_seconds ?? 0);

  useEffect(() => {
    if (!timer) return;

    if (timer.status === "running") {
      const serverTs = new Date(timer.server_timestamp).getTime();
      const base = timer.elapsed_seconds;

      setElapsed(base + Math.floor((Date.now() - serverTs) / 1000));

      const id = setInterval(() => {
        setElapsed(base + Math.floor((Date.now() - serverTs) / 1000));
      }, 500);

      return () => clearInterval(id);
    }

    setElapsed(timer.elapsed_seconds);
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

export default function Timer({ timer, canControl, homeTeam, awayTeam }: TimerProps) {
  const elapsed = useDisplayElapsed(timer);
  const status = timer?.status ?? "stopped";
  const half = timer?.half ?? 1;

  const send = (action: string) => sessionWS.sendTimerControl(action);

  return (
    <div className="bg-gray-800 px-4 py-3 border-b border-gray-700">
      {/* Teams */}
      <div className="flex justify-between text-xs text-gray-400 mb-1">
        <span className="font-medium">{homeTeam}</span>
        <span className="font-medium">{awayTeam}</span>
      </div>

      {/* Timer row */}
      <div className="flex items-center justify-between">
        {/* Half + time */}
        <div className="flex items-baseline gap-2">
          <span className="text-xs font-bold text-gray-400 uppercase">
            {half === 1 ? "1T" : "2T"}
          </span>
          <span className={`text-3xl font-mono font-bold tabular-nums ${STATUS_COLOR[status]}`}>
            {formatTime(elapsed)}
          </span>
        </div>

        {/* Status pill */}
        <span className="text-xs text-gray-500 capitalize">{status}</span>

        {/* Controls — only for authorized users */}
        {canControl && (
          <div className="flex gap-2">
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
          </div>
        )}
      </div>
    </div>
  );
}

function CtrlBtn({
  onClick,
  label,
  color,
}: {
  onClick: () => void;
  label: string;
  color: string;
}) {
  const colors: Record<string, string> = {
    green: "bg-green-700 hover:bg-green-600",
    yellow: "bg-yellow-700 hover:bg-yellow-600",
    blue: "bg-blue-700 hover:bg-blue-600",
    red: "bg-red-700 hover:bg-red-600",
  };
  return (
    <button
      onClick={onClick}
      className={`${colors[color]} text-white text-xs font-bold px-3 py-1.5 rounded-lg transition-colors`}
    >
      {label}
    </button>
  );
}
