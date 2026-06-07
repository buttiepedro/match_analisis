import type { EventData } from "../store/sessionStore";

export function calcPoints(events: EventData[], team: "user" | "rival"): number {
  return events.filter((e) => e.team === team).reduce((pts, e) => {
    if (e.event_type === "try") {
      pts += 5;
      if (e.metadata?.converted === true) pts += 2;
    }
    if (e.event_type === "penalty" && e.reason === "a_los_palos" && e.metadata?.converted === true) {
      pts += 3;
    }
    if (e.event_type === "drop") pts += 3;
    return pts;
  }, 0);
}

export function countTries(events: EventData[], team: "user" | "rival") {
  const evs = events.filter((e) => e.event_type === "try" && e.team === team);
  return {
    total: evs.length,
    converted: evs.filter((e) => e.metadata?.converted === true).length,
  };
}

export function countPenalties(events: EventData[], team: "user" | "rival") {
  const palos = events.filter(
    (e) => e.event_type === "penalty" && e.team === team && e.reason === "a_los_palos"
  );
  return {
    total: palos.length,
    converted: palos.filter((e) => e.metadata?.converted === true).length,
  };
}

export function countDrops(events: EventData[], team: "user" | "rival") {
  return events.filter((e) => e.event_type === "drop" && e.team === team).length;
}

export function countCards(events: EventData[], team: "user" | "rival") {
  return {
    yellow: events.filter((e) => e.event_type === "yellow_card" && e.team === team).length,
    red:    events.filter((e) => e.event_type === "red_card"    && e.team === team).length,
  };
}

export function countTackles(events: EventData[]) {
  return {
    effective: events.filter((e) => e.event_type === "tackle_effective").length,
    missed:    events.filter((e) => e.event_type === "tackle_missed").length,
    positive:  events.filter((e) => e.event_type === "tackle_positive").length,
  };
}

export function countAttack(events: EventData[]) {
  return {
    line_break: events.filter((e) => e.event_type === "line_break").length,
    offload:    events.filter((e) => e.event_type === "offload").length,
  };
}

export function countPossession(events: EventData[]) {
  const MOTIVOS = ["ruck", "maul", "contacto", "pesca", "patada", "knock_on"];
  const lost: Record<string, number> = {};
  const won:  Record<string, number> = {};
  MOTIVOS.forEach((m) => { lost[m] = 0; won[m] = 0; });
  events.forEach((e) => {
    if (e.event_type === "possession_lost" && e.reason) lost[e.reason] = (lost[e.reason] ?? 0) + 1;
    if (e.event_type === "ball_won"        && e.reason) won[e.reason]  = (won[e.reason]  ?? 0) + 1;
  });
  return { lost, won };
}

export function countSetpiece(events: EventData[], type: "lineout" | "scrum" | "exit") {
  const favor   = events.filter((e) => e.event_type === `${type}_favor`);
  const against = events.filter((e) => e.event_type === `${type}_against`);
  return {
    favor_con:    favor.filter((e)   => e.metadata?.obtained === true).length,
    favor_sin:    favor.filter((e)   => e.metadata?.obtained === false).length,
    contra_con:   against.filter((e) => e.metadata?.obtained === true).length,
    contra_sin:   against.filter((e) => e.metadata?.obtained === false).length,
  };
}
