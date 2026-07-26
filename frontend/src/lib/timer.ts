import type { TimerData } from "../store/sessionStore";

export function formatTime(seconds: number): string {
  const safe = Math.max(0, seconds);
  const m = Math.floor(safe / 60).toString().padStart(2, "0");
  const s = (safe % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

/**
 * Tiempo de partido en este instante. Cuando el timer corre, interpola desde el
 * último snapshot del servidor para no depender de la llegada de cada tick.
 */
export function currentElapsed(timer: TimerData | null): number {
  if (!timer) return 0;
  if (timer.status !== "running") return timer.elapsed_seconds;

  const serverTs = new Date(timer.server_timestamp).getTime();
  if (Number.isNaN(serverTs)) return timer.elapsed_seconds;

  return timer.elapsed_seconds + Math.max(0, Math.floor((Date.now() - serverTs) / 1000));
}

/** Sello de tiempo de partido para un evento registrado en este momento. */
export function timerStamp(timer: TimerData | null): { timer_seconds: number; half: number } {
  return { timer_seconds: currentElapsed(timer), half: timer?.half ?? 1 };
}
