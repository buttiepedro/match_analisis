import { afterEach, describe, expect, it, vi } from "vitest";
import type { TimerData } from "../store/sessionStore";
import { currentElapsed, formatTime, timerStamp } from "./timer";

const NOW = new Date("2026-07-25T15:00:30.000Z").getTime();

function timer(partial: Partial<TimerData>): TimerData {
  return {
    half: 1,
    status: "running",
    elapsed_seconds: 0,
    server_timestamp: "2026-07-25T15:00:00.000Z",
    ...partial,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

function freezeClock() {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
}

describe("formatTime", () => {
  it("formatea mm:ss con relleno", () => {
    expect(formatTime(0)).toBe("00:00");
    expect(formatTime(65)).toBe("01:05");
    expect(formatTime(2400)).toBe("40:00");
  });

  it("no colapsa a horas: el rugby se mide en minutos corridos", () => {
    expect(formatTime(4830)).toBe("80:30");
  });

  it("trata los negativos como cero", () => {
    expect(formatTime(-10)).toBe("00:00");
  });
});

describe("currentElapsed", () => {
  it("interpola desde el último snapshot mientras corre", () => {
    freezeClock();
    // 30s desde el snapshot del servidor, sobre una base de 100s.
    expect(currentElapsed(timer({ elapsed_seconds: 100 }))).toBe(130);
  });

  it("no interpola si el timer está en pausa", () => {
    freezeClock();
    expect(currentElapsed(timer({ status: "paused", elapsed_seconds: 100 }))).toBe(100);
  });

  it("no interpola si el partido terminó", () => {
    freezeClock();
    expect(currentElapsed(timer({ status: "finished", elapsed_seconds: 2400 }))).toBe(2400);
  });

  it("devuelve 0 sin timer", () => {
    expect(currentElapsed(null)).toBe(0);
  });

  it("cae al valor del servidor si el timestamp es inválido", () => {
    expect(
      currentElapsed(timer({ elapsed_seconds: 100, server_timestamp: "no-es-fecha" }))
    ).toBe(100);
  });

  it("nunca retrocede si el reloj del cliente está atrasado", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-25T14:59:00.000Z").getTime());
    expect(currentElapsed(timer({ elapsed_seconds: 100 }))).toBe(100);
  });
});

describe("timerStamp", () => {
  it("sella el evento con el tiempo y el período actuales", () => {
    freezeClock();
    expect(timerStamp(timer({ elapsed_seconds: 600, half: 2 }))).toEqual({
      timer_seconds: 630,
      half: 2,
    });
  });

  it("sin timer asume primer tiempo en cero", () => {
    expect(timerStamp(null)).toEqual({ timer_seconds: 0, half: 1 });
  });
});
