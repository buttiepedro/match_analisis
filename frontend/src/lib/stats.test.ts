import { describe, expect, it } from "vitest";
import type { EventData } from "../store/sessionStore";
import {
  calcPoints,
  countAttack,
  countCards,
  countDrops,
  countPenalties,
  countPossession,
  countSetpiece,
  countTackles,
  countTries,
} from "./stats";

let seq = 0;
function ev(partial: Partial<EventData> & { event_type: string }): EventData {
  return {
    id: `e${seq++}`,
    half: 1,
    timer_seconds: 0,
    team: "user",
    ...partial,
  } as EventData;
}

describe("calcPoints", () => {
  it("cuenta 5 por try sin conversión y 7 con conversión", () => {
    const events = [
      ev({ event_type: "try", metadata: { converted: false } }),
      ev({ event_type: "try", metadata: { converted: true } }),
    ];
    expect(calcPoints(events, "user")).toBe(12);
  });

  it("cuenta 3 sólo por penal a los palos convertido", () => {
    const events = [
      ev({ event_type: "penalty", reason: "a_los_palos", metadata: { converted: true } }),
      ev({ event_type: "penalty", reason: "a_los_palos", metadata: { converted: false } }),
      ev({ event_type: "penalty", reason: "juega", metadata: { converted: true } }),
      ev({ event_type: "penalty", reason: "line" }),
    ];
    expect(calcPoints(events, "user")).toBe(3);
  });

  it("cuenta 3 por drop", () => {
    expect(calcPoints([ev({ event_type: "drop" })], "user")).toBe(3);
  });

  it("no mezcla los puntos de los dos equipos", () => {
    const events = [
      ev({ event_type: "try", team: "user", metadata: { converted: true } }),
      ev({ event_type: "drop", team: "rival" }),
    ];
    expect(calcPoints(events, "user")).toBe(7);
    expect(calcPoints(events, "rival")).toBe(3);
  });

  it("ignora eventos que no suman puntos", () => {
    const events = [
      ev({ event_type: "tackle_effective" }),
      ev({ event_type: "yellow_card" }),
      ev({ event_type: "lineout_favor", metadata: { obtained: true } }),
    ];
    expect(calcPoints(events, "user")).toBe(0);
  });

  it("un try sin metadata cuenta 5 y no rompe", () => {
    expect(calcPoints([ev({ event_type: "try" })], "user")).toBe(5);
  });

  it("marcador de un partido completo", () => {
    const events = [
      ev({ event_type: "try", metadata: { converted: true } }),      // 7
      ev({ event_type: "try", metadata: { converted: false } }),     // 5
      ev({ event_type: "penalty", reason: "a_los_palos", metadata: { converted: true } }), // 3
      ev({ event_type: "drop" }),                                     // 3
      ev({ event_type: "try", team: "rival", metadata: { converted: true } }),
    ];
    expect(calcPoints(events, "user")).toBe(18);
    expect(calcPoints(events, "rival")).toBe(7);
  });
});

describe("contadores por tipo", () => {
  it("countTries separa convertidos", () => {
    const events = [
      ev({ event_type: "try", metadata: { converted: true } }),
      ev({ event_type: "try", metadata: { converted: false } }),
      ev({ event_type: "try", team: "rival", metadata: { converted: true } }),
    ];
    expect(countTries(events, "user")).toEqual({ total: 2, converted: 1 });
  });

  it("countPenalties sólo mira los que van a los palos", () => {
    const events = [
      ev({ event_type: "penalty", reason: "a_los_palos", metadata: { converted: true } }),
      ev({ event_type: "penalty", reason: "scrum" }),
    ];
    expect(countPenalties(events, "user")).toEqual({ total: 1, converted: 1 });
  });

  it("countDrops y countCards", () => {
    const events = [
      ev({ event_type: "drop" }),
      ev({ event_type: "yellow_card" }),
      ev({ event_type: "yellow_card" }),
      ev({ event_type: "red_card" }),
      ev({ event_type: "red_card", team: "rival" }),
    ];
    expect(countDrops(events, "user")).toBe(1);
    expect(countCards(events, "user")).toEqual({ yellow: 2, red: 1 });
    expect(countCards(events, "rival")).toEqual({ yellow: 0, red: 1 });
  });

  it("countTackles y countAttack", () => {
    const events = [
      ev({ event_type: "tackle_effective" }),
      ev({ event_type: "tackle_effective" }),
      ev({ event_type: "tackle_missed" }),
      ev({ event_type: "tackle_positive" }),
      ev({ event_type: "line_break" }),
      ev({ event_type: "offload" }),
    ];
    expect(countTackles(events)).toEqual({ effective: 2, missed: 1, positive: 1 });
    expect(countAttack(events)).toEqual({ line_break: 1, offload: 1 });
  });

  it("countPossession agrupa por motivo y deja los no usados en cero", () => {
    const events = [
      ev({ event_type: "possession_lost", reason: "ruck" }),
      ev({ event_type: "possession_lost", reason: "ruck" }),
      ev({ event_type: "possession_lost", reason: "knock_on" }),
      ev({ event_type: "ball_won", reason: "pesca" }),
    ];
    const { lost, won } = countPossession(events);
    expect(lost.ruck).toBe(2);
    expect(lost.knock_on).toBe(1);
    expect(lost.maul).toBe(0);
    expect(won.pesca).toBe(1);
  });

  it("countSetpiece cruza a favor/en contra con obtención", () => {
    const events = [
      ev({ event_type: "lineout_favor", metadata: { obtained: true } }),
      ev({ event_type: "lineout_favor", metadata: { obtained: true } }),
      ev({ event_type: "lineout_favor", metadata: { obtained: false } }),
      ev({ event_type: "lineout_against", metadata: { obtained: true } }),
      ev({ event_type: "scrum_favor", metadata: { obtained: true } }),
    ];
    expect(countSetpiece(events, "lineout")).toEqual({
      favor_con: 2,
      favor_sin: 1,
      contra_con: 1,
      contra_sin: 0,
    });
    expect(countSetpiece(events, "scrum").favor_con).toBe(1);
  });
});
