"use client";

import clsx from "clsx";
import { useEffect, useRef, useState } from "react";
import type { SignalTraceChallenge } from "../../../shared/types";

export default function SignalTrace({
  challenge,
  onDone,
}: {
  challenge: SignalTraceChallenge;
  onDone: (payload: { answer: string[] }) => void;
}) {
  const [phase, setPhase] = useState<"flash" | "recall">("flash");
  const [cursor, setCursor] = useState(0);
  const [answer, setAnswer] = useState<string[]>([]);
  const answerRef = useRef<string[]>([]);
  const done = useRef(false);

  const finish = (final: string[]) => {
    if (done.current) return;
    done.current = true;
    onDone({ answer: final });
  };

  // Flash the sequence one glyph at a time, then hand over to recall.
  useEffect(() => {
    const per = Math.max(260, challenge.flashMs / challenge.sequence.length);
    const timers: ReturnType<typeof setTimeout>[] = [];
    challenge.sequence.forEach((_, i) => {
      timers.push(setTimeout(() => setCursor(i), i * per));
    });
    timers.push(
      setTimeout(() => {
        setPhase("recall");
        setCursor(0);
      }, challenge.sequence.length * per),
    );
    return () => timers.forEach(clearTimeout);
  }, [challenge]);

  useEffect(() => {
    const t = setTimeout(() => finish(answerRef.current), challenge.durationMs + challenge.flashMs);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function choose(glyph: string) {
    if (phase !== "recall" || done.current) return;
    const next = [...answerRef.current, glyph];
    answerRef.current = next;
    setAnswer(next);
    if (next.length >= challenge.sequence.length) finish(next);
  }

  return (
    <div className="w-full">
      <p className="stat text-center">
        {phase === "flash" ? "memorise the burst" : "reproduce the sequence"}
      </p>

      <div className="mt-5 flex min-h-[64px] items-center justify-center gap-2">
        {phase === "flash"
          ? challenge.sequence.map((g, i) => (
              <span
                key={i}
                className={clsx(
                  "grid h-12 w-12 place-items-center rounded-md border font-mono text-xl transition-all",
                  i === cursor
                    ? "scale-110 border-signal bg-signal/15 text-signal"
                    : "border-white/20 text-slate-500",
                )}
              >
                {i === cursor ? g : "·"}
              </span>
            ))
          : challenge.sequence.map((_, i) => (
              <span
                key={i}
                className={clsx(
                  "grid h-12 w-12 place-items-center rounded-md border font-mono text-xl",
                  answer[i]
                    ? "border-gold/50 bg-gold/10 text-gold"
                    : i === answer.length
                      ? "border-gold/60 text-slate-400"
                      : "border-white/20 text-slate-500",
                )}
              >
                {answer[i] ?? "·"}
              </span>
            ))}
      </div>

      <div className="mx-auto mt-6 grid max-w-[300px] grid-cols-3 gap-2">
        {challenge.options.map((g) => (
          <button
            key={g}
            type="button"
            disabled={phase !== "recall"}
            onClick={() => choose(g)}
            className="rounded-md border border-white/25 py-4 font-mono text-xl text-slate-200
                       transition enabled:hover:border-signal/60 enabled:hover:bg-signal/10
                       enabled:active:scale-95 disabled:opacity-25"
          >
            {g}
          </button>
        ))}
      </div>
    </div>
  );
}
