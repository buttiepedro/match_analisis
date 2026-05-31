import { useState } from "react";
import api from "../../lib/axios";
import { parseApiError } from "../../lib/errors";
import EventLog from "../EventLog";

type Flow = "try" | "penalty" | "error" | "yellow_card" | "red_card" | null;
type Step = "team" | "penalty_reason" | "error_type" | "conversion";

interface ModalState {
  flow: Flow;
  step: Step;
  team: "home" | "away" | null;
  penaltyReason: string | null;
}

const CLOSED: ModalState = { flow: null, step: "team", team: null, penaltyReason: null };

interface Props {
  sessionId: string;
  homeTeam: string;
  awayTeam: string;
  onEvent: () => void;
}

export default function Events({ sessionId, homeTeam, awayTeam, onEvent }: Props) {
  const [modal, setModal] = useState<ModalState>(CLOSED);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

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
    if (flow === "yellow_card" || flow === "red_card") {
      setModal((m) => ({ ...m, team }));
      submit_with_team(team, flow);
      return;
    }
    setModal((m) => ({
      ...m,
      team,
      step: flow === "try" ? "conversion" : flow === "penalty" ? "penalty_reason" : "error_type",
    }));
  }

  function submit_with_team(team: "home" | "away", event_type: string) {
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
    if (flow === "try") {
      setLoading(true);
      setError("");
      api.post(`/sessions/${sessionId}/events`, {
        event_type: "try",
        team,
        metadata: { converted },
      })
        .then(() => { onEvent(); close(); })
        .catch((err) => setError(parseApiError(err, "Error al registrar el evento")))
        .finally(() => setLoading(false));
    } else if (flow === "penalty") {
      setLoading(true);
      setError("");
      api.post(`/sessions/${sessionId}/events`, {
        event_type: "penalty",
        team,
        reason: penaltyReason,
        metadata: { converted },
      })
        .then(() => { onEvent(); close(); })
        .catch((err) => setError(parseApiError(err, "Error al registrar el evento")))
        .finally(() => setLoading(false));
    }
  }

  const isOpen = modal.flow !== null;
  const teamName = (t: "home" | "away") => t === "home" ? homeTeam : awayTeam;

  const flowLabel: Record<NonNullable<Flow>, string> = {
    try: "Try",
    penalty: "Penal",
    error: "Error",
    yellow_card: "Amarilla",
    red_card: "Roja",
  };

  return (
    <div className="p-4 space-y-3">
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

      <EventLog
        sessionId={sessionId}
        types={["try", "penalty", "knock_on", "forward_pass", "lost_in_contact", "yellow_card", "red_card"]}
      />

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
