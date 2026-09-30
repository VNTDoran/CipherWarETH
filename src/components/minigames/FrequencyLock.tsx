"use client";

import clsx from "clsx";
import { useEffect, useRef, useState } from "react";
import type { FrequencyLockChallenge } from "../../../shared/types";

function polar(cx: number, cy: number, r: number, deg: number) {
  const rad = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)] as const;
}

function arc(cx: number, cy: number, r: number, from: number, to: number) {
  const [x0, y0] = polar(cx, cy, r, from);
  const [x1, y1] = polar(cx, cy, r, to);
  const large = to - from > 180 ? 1 : 0;
  return `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`;
}

export default function FrequencyLock({
  challenge,
  onDone,
}: {
  challenge: FrequencyLockChallenge;
  onDone: (payload: { hits: boolean[] }) => void;
}) {
  const [round, setRound] = useState(0);
  const [hits, setHits] = useState<boolean[]>([]);
  const [angle, setAngle] = useState(0);
  const [flash, setFlash] = useState<"hit" | "miss" | null>(null);
  const startedAt = useRef(Date.now());
  const raf = useRef(0);
  const done = useRef(false);
  const hitsRef = useRef<boolean[]>([]);

  const finish = (final: boolean[]) => {
    if (done.current) return;
    done.current = true;
    onDone({ hits: [final[0] ?? false, final[1] ?? false, final[2] ?? false] });
  };

  useEffect(() => {
    const loop = () => {
      const r = challenge.rounds[Math.min(round, challenge.rounds.length - 1)];
      const elapsed = (Date.now() - startedAt.current) / 1000;
      setAngle((elapsed * r.sweepDegPerSec) % 360);
      raf.current = requestAnimationFrame(loop);
    };
    raf.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf.current);
  }, [challenge.rounds, round]);

  useEffect(() => {
    const t = setTimeout(() => finish(hitsRef.current), challenge.durationMs);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const current = challenge.rounds[Math.min(round, challenge.rounds.length - 1)];

  function tap() {
    if (done.current || round >= challenge.rounds.length) return;
    const hit = angle >= current.bandStart && angle <= current.bandEnd;
    const next = [...hitsRef.current, hit];
    hitsRef.current = next;
    setHits(next);
    setFlash(hit ? "hit" : "miss");
    setTimeout(() => setFlash(null), 180);

    if (next.length >= challenge.rounds.length) finish(next);
    else {
      // Reset the sweep phase so the next band isn't instantly under the needle.
      startedAt.current = Date.now();
      setRound(next.length);
    }
  }

  const [nx, ny] = polar(50, 50, 38, angle);

  return (
    <div className="w-full">
      <p className="stat text-center">
        lock the carrier · round {Math.min(round + 1, 3)} of {challenge.rounds.length}
      </p>

      <button
        type="button"
        onClick={tap}
        aria-label="Lock the frequency now"
        className={clsx(
          "mx-auto mt-4 block w-full max-w-[280px] rounded-full transition",
          flash === "hit" && "bg-signal/10",
          flash === "miss" && "bg-alert/10",
        )}
      >
        <svg viewBox="0 0 100 100" className="w-full">
          <circle cx="50" cy="50" r="38" fill="none" stroke="rgba(148,163,184,0.18)" strokeWidth="6" />
          <path
            d={arc(50, 50, 38, current.bandStart, current.bandEnd)}
            fill="none"
            stroke="#4ade80"
            strokeWidth="6"
            strokeLinecap="butt"
          />
          <line x1="50" y1="50" x2={nx} y2={ny} stroke="#fbbf24" strokeWidth="1.6" strokeLinecap="round" />
          <circle cx="50" cy="50" r="3" fill="#fbbf24" />
          <text
            x="50"
            y="72"
            textAnchor="middle"
            fontSize="7"
            className="font-mono"
            fill="rgba(203,213,225,0.7)"
          >
            TAP
          </text>
        </svg>
      </button>

      <div className="mt-4 flex justify-center gap-2">
        {challenge.rounds.map((_, i) => (
          <span
            key={i}
            className={clsx(
              "h-1.5 w-8 rounded-full",
              hits[i] === true && "bg-signal",
              hits[i] === false && "bg-alert",
              hits[i] === undefined && "bg-white/15",
            )}
          />
        ))}
      </div>

      <p className="mt-3 text-center font-mono text-[10px] uppercase tracking-widest text-slate-300">
        the band narrows each round
      </p>
    </div>
  );
}
