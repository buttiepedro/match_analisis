import { useState } from "react";
import api from "../../lib/axios";
import { parseApiError } from "../../lib/errors";
import { useSessionStore, countEvents, EventData } from "../../store/sessionStore";
import SubstitutionModal from "../SubstitutionModal";
import EventLog from "../EventLog";

type Flow = "try" | "penalty" | "error" | "yellow_card" | "red_card" | "drop" | null;
type Step = "team" | "penalty_reason" | "error_type" | "conversion";

interface ModalState {
  flow: Flow;
  step: Step;
  team: "home" | "away" | null;
  penaltyReason: string | null;
}

const CLOSED: ModalState = { flow: null, step: "team", team: null, penaltyReason: null };

function calcPoints(events: EventData[], team: "home" | "away"): number {
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

interface Props {
  sessionId: string;
  homeTeam: string;
  awayTeam: string;
  onEvent: () => void;
}

export default function Events({ sessionId, homeTeam, awayTeam, onEvent }: Props) {
  const events = useSessionStore((s) => s.events);
  const [modal, setModal] = useState<ModalState>(CLOSED);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showSub, setShowSub] = useState(false);

  const yellows = countEvents(events, ["yellow_card"]);
  const reds    = countEvents(events, ["red_card"]);
  const homePoints = calcPoints(events, "home");
  const awayPoints = calcPoints(events, "away");

  function open(flow: Flow) {
    setError("");
    setModal({ flow, step: "team", team: null, penaltyReason: null });
  }

  function close() {
    setModal(CLOSED);
    setError("");
  }

  function back() {
    setModal((m) => {
      if (m.step === "conversion" && m.flow === "penalty") {
        return { ...m, step: "penalty_reason", penaltyReason: null };
      }
      if (m.step === "penalty_reason" || m.step === "error_type" || m.step === "conversion") {
        return { ...m, step: "team", team: null };
      }
      return CLOSED;
    });
    setError("");
  }

  function selectTeam(team: "home" | "away") {
    const flow = modal.flow;
    if (flow === "yellow_card" || flow === "red_card" || flow === "drop") {
      setModal((m) => ({ ...m, team }));
      submitWithTeam(team, flow!);
      return;
    }
    setModal((m) => ({
      ...m,
      team,
      step: flow === "try" ? "conversion" : flow === "penalty" ? "penalty_reason" : "error_type",
    }));
  }

  function submitWithTeam(team: "home" | "away", event_type: string) {
    setLoading(true);
    setError("");
    api.post(`/sessions/${sessionId}/events`, { event_type, team })
      .then(() => { onEvent(); close(); })
      .catch((err) => setError(parseApiError(err, "Error al registrar el evento")))
      .finally(() => setLoading(false));
  }

  function selectPenaltyReason(reason: string) {
    if (reason === "a_los_palos") {
      setModal((m) => ({ ...m, penaltyReason: reason, step: "conversion" }));
    } else {
      const team = modal.team!;
      setModal((m) => ({ ...m, penaltyReason: reason }));
      setLoading(true);
      setError("");
      api.post(`/sessions/${sessionId}/events`, { event_type: "penalty", team, reason })
        .then(() => { onEvent(); close(); })
        .catch((err) => setError(parseApiError(err, "Error al registrar el evento")))
        .finally(() => setLoading(false));
    }
  }

  function selectErrorType(errorType: string) {
    const team = modal.team!;
    setLoading(true);
    setError("");
    api.post(`/sessions/${sessionId}/events`, { event_type: errorType, team })
      .then(() => { onEvent(); close(); })
      .catch((err) => setError(parseApiError(err, "Error al registrar el evento")))
      .finally(() => setLoading(false));
  }

  function selectConversion(converted: boolean) {
    const { flow, team, penaltyReason } = modal;
    if (!team) return;
    const body = flow === "try"
      ? { event_type: "try", team, metadata: { converted } }
      : { event_type: "penalty", team, reason: penaltyReason, metadata: { converted } };
    setLoading(true);
    setError("");
    api.post(`/sessions/${sessionId}/events`, body)
      .then(() => { onEvent(); close(); })
      .catch((err) => setError(parseApiError(err, "Error al registrar el evento")))
      .finally(() => setLoading(false));
  }

  const isOpen = modal.flow !== null;
  const teamName = (t: "home" | "away") => t === "home" ? homeTeam : awayTeam;

  const flowLabel: Record<NonNullable<Flow>, string> = {
    try: "Try",
    penalty: "Penal",
    error: "Error",
    yellow_card: "Amarilla",
    red_card: "Roja",
    drop: "Drop",
  };

  return (
    <div className="p-4 space-y-3">
      {/* Stats summary */}
      <div className="bg-gray-800 rounded-xl overflow-hidden">
        {/* Points row */}
        <div className="grid grid-cols-2 divide-x divide-gray-700">
          <div className="px-4 py-3 text-center">
            <p className="text-gray-400 text-xs truncate">{homeTeam}</p>
            <p className="text-white text-2xl font-bold">{homePoints}</p>
            <p className="text-gray-500 text-xs">pts</p>
          </div>
          <div className="px-4 py-3 text-center">
            <p className="text-gray-400 text-xs truncate">{awayTeam}</p>
            <p className="text-white text-2xl font-bold">{awayPoints}</p>
            <p className="text-gray-500 text-xs">pts</p>
          </div>
        </div>
        {/* Cards row */}
        <div className="border-t border-gray-700 px-4 py-2 space-y-1">
          <div className="flex justify-between text-xs">
            <span className="text-yellow-400 font-semibold">Amarillas</span>
            <span className="text-gray-300">{homeTeam} <span className="text-white font-bold">{yellows.home}</span></span>
            <span className="text-gray-300">{awayTeam} <span className="text-white font-bold">{yellows.away}</span></span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-red-400 font-semibold">Rojas</span>
            <span className="text-gray-300">{homeTeam} <span className="text-white font-bold">{reds.home}</span></span>
            <span className="text-gray-300">{awayTeam} <span className="text-white font-bold">{reds.away}</span></span>
          </div>
        </div>
      </div>

      {/* Main event buttons */}
      <button
        onClick={() => open("try")}
        className="w-full bg-green-700 active:bg-green-600 text-white font-semibold rounded-xl px-4 py-5 text-left text-base transition-colors"
      >
        Try
      </button>
      <button
        onClick={() => open("penalty")}
        className="w-full bg-blue-700 active:bg-blue-600 text-white font-semibold rounded-xl px-4 py-5 text-left text-base transition-colors"
      >
        Penal
      </button>
      <button
        onClick={() => open("error")}
        className="w-full bg-red-700 active:bg-red-600 text-white font-semibold rounded-xl px-4 py-5 text-left text-base transition-colors"
      >
        Error
      </button>
      <button
        onClick={() => open("drop")}
        className="w-full bg-purple-700 active:bg-purple-600 text-white font-semibold rounded-xl px-4 py-5 text-left text-base transition-colors"
      >
        Drop
      </button>

      {/* Disciplina */}
      <p className="text-xs font-bold text-gray-500 uppercase tracking-wider pt-1">Disciplina</p>
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => open("yellow_card")}
          className="bg-yellow-600 active:bg-yellow-500 text-white font-semibold rounded-xl px-4 py-4 text-base transition-colors"
        >
          Amarilla
        </button>
        <button
          onClick={() => open("red_card")}
          className="bg-red-600 active:bg-red-500 text-white font-semibold rounded-xl px-4 py-4 text-base transition-colors"
        >
          Roja
        </button>
      </div>

      <button
        onClick={() => setShowSub(true)}
        className="w-full bg-gray-700 hover:bg-gray-600 text-white font-semibold rounded-xl py-3 text-sm transition-colors"
      >
        Registrar Cambio
      </button>

      <EventLog
        sessionId={sessionId}
        types={["try", "penalty", "drop", "knock_on", "forward_pass", "lost_in_contact", "yellow_card", "red_card", "substitution"]}
      />

      {showSub && (
        <SubstitutionModal sessionId={sessionId} onClose={() => setShowSub(false)} />
      )}

      {/* Multi-step bottom-sheet modal */}
      {isOpen && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end">
          <div className="absolute inset-0 bg-black/60" onClick={close} />

          <div className="relative bg-gray-800 rounded-t-2xl p-5 space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between">
              <p className="text-white font-bold text-base">
                {modal.flow ? flowLabel[modal.flow] : ""}
                {modal.team && (
                  <span className="text-gray-400 font-normal text-sm ml-2">
                    · {teamName(modal.team)}
                  </span>
                )}
              </p>
              {error && <p className="text-red-400 text-sm">{error}</p>}
            </div>

            {/* Step: team selection */}
            {modal.step === "team" && (
              <div className="space-y-2">
                <button
                  onClick={() => selectTeam("home")}
                  disabled={loading}
                  className="w-full bg-blue-700 active:bg-blue-600 disabled:opacity-50 text-white font-semibold rounded-xl py-4 text-base transition-colors"
                >
                  De {homeTeam}
                </button>
                <button
                  onClick={() => selectTeam("away")}
                  disabled={loading}
                  className="w-full bg-orange-700 active:bg-orange-600 disabled:opacity-50 text-white font-semibold rounded-xl py-4 text-base transition-colors"
                >
                  De {awayTeam}
                </button>
              </div>
            )}

            {/* Step: penalty reason */}
            {modal.step === "penalty_reason" && (
              <div className="space-y-2">
                {[
                  { value: "line", label: "Line" },
                  { value: "scrum", label: "Scrum" },
                  { value: "juega", label: "Juega" },
                  { value: "a_los_palos", label: "A los palos" },
                ].map(({ value, label }) => (
                  <button
                    key={value}
                    onClick={() => selectPenaltyReason(value)}
                    disabled={loading}
                    className="w-full bg-gray-700 active:bg-gray-600 disabled:opacity-50 text-white font-semibold rounded-xl py-4 text-base transition-colors"
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}

            {/* Step: error type */}
            {modal.step === "error_type" && (
              <div className="space-y-2">
                {[
                  { value: "knock_on", label: "Knock-on" },
                  { value: "forward_pass", label: "Forward" },
                  { value: "lost_in_contact", label: "Perdida en contacto" },
                ].map(({ value, label }) => (
                  <button
                    key={value}
                    onClick={() => selectErrorType(value)}
                    disabled={loading}
                    className="w-full bg-gray-700 active:bg-gray-600 disabled:opacity-50 text-white font-semibold rounded-xl py-4 text-base transition-colors"
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}

            {/* Step: conversion */}
            {modal.step === "conversion" && (
              <div className="space-y-2">
                <button
                  onClick={() => selectConversion(true)}
                  disabled={loading}
                  className="w-full bg-green-600 active:bg-green-500 disabled:opacity-50 text-white font-semibold rounded-xl py-4 text-base transition-colors"
                >
                  Convertido
                </button>
                <button
                  onClick={() => selectConversion(false)}
                  disabled={loading}
                  className="w-full bg-gray-700 active:bg-gray-600 disabled:opacity-50 text-white font-semibold rounded-xl py-4 text-base transition-colors"
                >
                  No
                </button>
              </div>
            )}

            {/* Footer: back / cancel */}
            <div className="flex gap-3 pt-1">
              {modal.step !== "team" && (
                <button
                  onClick={back}
                  disabled={loading}
                  className="flex-1 bg-gray-700 text-gray-300 font-semibold rounded-xl py-3 disabled:opacity-50"
                >
                  ← Volver
                </button>
              )}
              <button
                onClick={close}
                disabled={loading}
                className="flex-1 bg-gray-700 text-gray-300 font-semibold rounded-xl py-3 disabled:opacity-50"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
