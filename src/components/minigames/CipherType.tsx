"use client";

import clsx from "clsx";
import { useEffect, useRef, useState } from "react";
import type { CipherTypeChallenge } from "../../../shared/types";

export default function CipherType({
  challenge,
  onDone,
}: {
  challenge: CipherTypeChallenge;
  onDone: (payload: { typed: string; elapsedMs: number }) => void;
}) {
  const [typed, setTyped] = useState("");
  const startedAt = useRef(Date.now());
  const inputRef = useRef<HTMLInputElement>(null);
  const done = useRef(false);

  const finish = (value: string) => {
    if (done.current) return;
    done.current = true;
    onDone({ typed: value, elapsedMs: Date.now() - startedAt.current });
  };

  useEffect(() => {
    inputRef.current?.focus();
    const t = setTimeout(() => finish(inputRef.current?.value ?? ""), challenge.durationMs);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Finishing the string ends the round immediately — speed is the whole point.
  useEffect(() => {
    if (typed.toUpperCase() === challenge.text) finish(typed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typed]);

  return (
    <div className="w-full">
      <p className="stat text-center">transcribe the intercept</p>

      <div className="mt-4 flex flex-wrap justify-center gap-[3px] font-mono text-xl sm:text-2xl">
        {challenge.text.split("").map((ch, i) => {
          const t = typed[i]?.toUpperCase();
          const state = t === undefined ? "pending" : t === ch ? "ok" : "bad";
          return (
            <span
              key={i}
              className={clsx(
                "min-w-[0.75em] border-b-2 px-[1px] text-center transition-colors",
                state === "pending" && "border-white/25 text-slate-400",
                state === "ok" && "border-signal text-signal",
                state === "bad" && "border-alert bg-alert/10 text-alert",
                i === typed.length && "border-gold",
              )}
            >
              {ch}
            </span>
          );
        })}
      </div>

      <input
        ref={inputRef}
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        className="field mt-6 text-center text-lg tracking-[0.2em]"
        autoCapitalize="characters"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        aria-label="Type the intercepted string"
      />

      <p className="mt-3 text-center font-mono text-[10px] uppercase tracking-widest text-slate-300">
        accuracy first · speed second
      </p>
    </div>
  );
}
