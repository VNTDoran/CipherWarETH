"use client";

import clsx from "clsx";
import { useEffect, useState } from "react";
import { AGENCY_META, GLYPHS } from "../../../shared/constants";
import type { MatchView, MessengerView } from "../../../shared/types";

/**
 * Key labels are derived from the messenger id, not sent by the server — the
 * server has no reason to ship anything that could hint at which index is
 * real. Same id in, same glyphs out, on every client.
 */
function glyphFor(messengerId: string, index: number): string {
  // Everything stays unsigned: `>>` would sign-extend past 2^31 and produce
  // labels like "Θ-55".
  let h = (index * 2654435761) >>> 0;
  for (let i = 0; i < messengerId.length; i++) {
    h = (Math.imul(h, 31) + messengerId.charCodeAt(i)) >>> 0;
  }
  const g = GLYPHS[h % GLYPHS.length];
  const n = ((h >>> 5) % 90) + 10;
  return `${g}${n}`;
}

function secondsLeft(at: number, now: number) {
  return Math.max(0, Math.ceil((at - now) / 1000));
}

export default function KeyRack({
  view,
  messenger,
  onAttack,
  onCommit,
  busy,
}: {
  view: MatchView;
  messenger: MessengerView | null;
  onAttack: (id: string) => void;
  onCommit: (id: string, keyIndex: number) => void;
  busy: boolean;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [armed, setArmed] = useState<number | null>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);

  useEffect(() => setArmed(null), [messenger?.id]);

  if (!messenger) {
    return (
      <div className="panel flex h-full flex-col items-center justify-center p-4 text-center">
        <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-slate-300">
          no channel selected
        </p>
        <p className="mt-2 max-w-[22ch] text-xs leading-relaxed text-slate-300">
          Tap a courier in the ether to open its key set.
        </p>
      </div>
    );
  }

  const owner = view.players.find((p) => p.slot === messenger.ownerSlot);
  const color = owner ? AGENCY_META[owner.agency].color : "#64748b";
  const mine = messenger.ownerSlot === view.youSlot;
  const remaining = secondsLeft(messenger.arrivesAt, now);
  const cooling = secondsLeft(messenger.me.cooldownUntil, now);
  const locked = secondsLeft(messenger.me.lockedUntil, now);
  const pool = messenger.me.pool;
  const poolSize = pool?.length ?? messenger.candidateCount;
  const odds = pool ? Math.round((1 / Math.max(1, pool.length)) * 100) : 0;

  return (
    <div className="panel flex h-full flex-col p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-display text-sm font-semibold" style={{ color }}>
            {messenger.codename}
          </div>
          <div className="stat mt-0.5 truncate">
            {mine ? "your courier" : owner ? AGENCY_META[owner.agency].name : "routine traffic"}
            {messenger.escorted && " · escorted"}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div
            className={clsx(
              "font-mono text-lg font-bold leading-none",
              remaining <= 8 ? "text-alert" : "text-slate-200",
            )}
          >
            {remaining}s
          </div>
          <div className="stat">to arrival</div>
        </div>
      </div>

      {mine ? (
        <p className="mt-4 text-xs leading-relaxed text-slate-300">
          You cannot intercept your own transmission. Keep it alive and this
          directive confirms.
        </p>
      ) : (
        <>
          <div className="mt-3 grid grid-cols-5 gap-1.5">
            {Array.from({ length: messenger.candidateCount }, (_, i) => {
              const alive = !pool || pool.includes(i);
              const isArmed = armed === i;
              return (
                <button
                  key={i}
                  type="button"
                  disabled={!pool || !alive || locked > 0 || busy}
                  onClick={() => setArmed(isArmed ? null : i)}
                  className={clsx(
                    "rounded-sm border py-1.5 font-mono text-[10px] transition",
                    // Eliminated keys must read as gone at a glance — that
                    // contrast gap is the core feedback of the whole mechanic.
                    !alive && "border-white/10 text-slate-500 line-through opacity-50",
                    alive && !isArmed && "border-white/30 text-slate-100 hover:border-white/60",
                    isArmed && "border-gold bg-gold/15 text-gold",
                    !pool && "opacity-50",
                  )}
                >
                  {glyphFor(messenger.id, i)}
                </button>
              );
            })}
          </div>

          <div className="mt-2 flex items-center justify-between font-mono text-[10px] uppercase tracking-widest">
            <span className="text-slate-300">
              {pool ? `${poolSize} candidates` : `${messenger.candidateCount} keys · not engaged`}
            </span>
            {pool && (
              <span className={odds === 100 ? "text-signal" : odds >= 50 ? "text-gold" : "text-slate-300"}>
                {odds}% if you commit
              </span>
            )}
          </div>

          <div className="mt-auto space-y-2 pt-3">
            {locked > 0 ? (
              <div className="rounded-md border border-alert/30 bg-alert/10 py-2 text-center font-mono text-[11px] uppercase tracking-widest text-alert">
                locked · {locked}s
              </div>
            ) : (
              <button
                type="button"
                className="btn-primary w-full py-2.5"
                disabled={cooling > 0 || busy}
                onClick={() => onAttack(messenger.id)}
              >
                {cooling > 0 ? `cooling ${cooling}s` : pool ? "attack again" : "attack"}
              </button>
            )}

            <button
              type="button"
              className={clsx("w-full py-2.5", odds === 100 ? "btn-primary" : "btn-danger")}
              disabled={armed === null || locked > 0 || busy}
              onClick={() => {
                if (armed !== null) onCommit(messenger.id, armed);
                setArmed(null);
              }}
            >
              {armed === null
                ? "select a key to commit"
                : odds === 100
                  ? `commit ${glyphFor(messenger.id, armed)}`
                  : `gamble ${glyphFor(messenger.id, armed)} · ${odds}%`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
