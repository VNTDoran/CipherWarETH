"use client";

import { useEffect, useState } from "react";
import type { MinigameAssignment, MinigameSubmission } from "../../../shared/types";
import CipherType from "./CipherType";
import FrequencyLock from "./FrequencyLock";
import SignalTrace from "./SignalTrace";

const TITLE: Record<string, string> = {
  cipher_type: "CIPHER TYPE",
  frequency_lock: "FREQUENCY LOCK",
  signal_trace: "SIGNAL TRACE",
};

/**
 * Full-screen overlay for one intercept. The clock is cosmetic — the server
 * holds the real deadline and scores from the inputs submitted here.
 */
export default function MinigameHost({
  assignment,
  onSubmit,
}: {
  assignment: MinigameAssignment;
  onSubmit: (s: MinigameSubmission) => void;
}) {
  const { challenge, token } = assignment;
  // Signal Trace spends its first stretch flashing the sequence, and only then
  // starts the answer window — so the bar has to cover both or it hits zero
  // while the player is still legitimately answering.
  const total =
    challenge.key === "signal_trace"
      ? challenge.durationMs + challenge.flashMs
      : challenge.durationMs;
  const [left, setLeft] = useState(total);

  useEffect(() => {
    const started = Date.now();
    const t = setInterval(() => setLeft(Math.max(0, total - (Date.now() - started))), 60);
    return () => clearInterval(t);
  }, [total, token]);

  const pct = Math.max(0, Math.min(100, (left / total) * 100));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/95 p-5 backdrop-blur-sm">
      <div className="panel w-full max-w-md animate-popIn p-5">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[11px] uppercase tracking-[0.3em] text-signal">
            {TITLE[challenge.key] ?? "INTERCEPT"}
          </span>
          <span className="font-mono text-xs text-slate-300">{(left / 1000).toFixed(1)}s</span>
        </div>

        <div className="mt-2 h-[3px] w-full overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-signal transition-[width] duration-75 ease-linear"
            style={{ width: `${pct}%` }}
          />
        </div>

        <div className="mt-6">
          {challenge.key === "cipher_type" && (
            <CipherType
              challenge={challenge}
              onDone={(p) => onSubmit({ token, key: "cipher_type", ...p })}
            />
          )}
          {challenge.key === "frequency_lock" && (
            <FrequencyLock
              challenge={challenge}
              onDone={(p) => onSubmit({ token, key: "frequency_lock", ...p })}
            />
          )}
          {challenge.key === "signal_trace" && (
            <SignalTrace
              challenge={challenge}
              onDone={(p) => onSubmit({ token, key: "signal_trace", ...p })}
            />
          )}
        </div>

        <p className="mt-6 text-center font-mono text-[10px] uppercase tracking-[0.2em] text-slate-300">
          bronze 1 key · silver 2 · gold 3
        </p>
      </div>
    </div>
  );
}
