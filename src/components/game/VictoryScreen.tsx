"use client";

import Link from "next/link";
import { AGENCY_META, OPERATION_STEPS } from "../../../shared/constants";
import type { MatchView } from "../../../shared/types";
import { formatIntel } from "@/lib/intel";

const WHY: Record<string, string> = {
  OPERATION: "completed the operation",
  BLACKOUT: "blacked out the network",
  TIMEOUT: "led the board when time expired",
  FORFEIT: "won — every rival forfeited",
};

export default function VictoryScreen({ view }: { view: MatchView }) {
  const w = view.winner;
  const winner = view.players.find((p) => p.slot === w?.slot);
  const youWon = w?.slot === view.youSlot;

  const ranked = [...view.players].sort(
    (a, b) => Number(a.forfeited) - Number(b.forfeited) || b.step - a.step || b.cracksMade - a.cracksMade || b.intel - a.intel,
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-ink-900/96 p-5 backdrop-blur">
      <div className="panel w-full max-w-lg animate-slideUp p-6">
        <p className="stat text-center">transmission closed</p>
        <h1
          className="mt-2 text-center font-display text-3xl font-bold"
          style={{ color: winner ? AGENCY_META[winner.agency].color : "#cbd5e1" }}
        >
          {youWon ? "YOU WIN" : `${w?.name ?? "NOBODY"} WINS`}
        </h1>
        <p className="mt-1 text-center text-sm text-slate-300">
          {winner && `${AGENCY_META[winner.agency].name} `}
          {WHY[w?.winType ?? "TIMEOUT"]}.
        </p>
        {view.chain?.tournament && w && (
          <p className="mt-2 text-center font-mono text-xs text-gold">
            {youWon
              ? `you take the pot: ${formatIntel(view.chain.tournament.potWei)} INTEL`
              : `${w.name} takes the pot: ${formatIntel(view.chain.tournament.potWei)} INTEL`}
          </p>
        )}

        <div className="mt-6 space-y-1.5">
          {ranked.map((p, i) => {
            const meta = AGENCY_META[p.agency];
            return (
              <div
                key={p.slot}
                className="flex items-center gap-3 rounded-md border border-white/20 px-3 py-2"
                style={{ borderLeftColor: meta.color, borderLeftWidth: 3 }}
              >
                <span className="w-4 font-mono text-xs text-slate-300">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate font-display text-sm text-slate-200">
                  {p.name}
                  {p.slot === view.youSlot && <span className="ml-1.5 text-[10px] text-slate-300">you</span>}
                </span>
                <span className="font-mono text-[11px] text-slate-300">
                  {p.step}/{OPERATION_STEPS} steps
                </span>
                <span className="font-mono text-[11px] text-signal">{p.cracksMade}c</span>
                <span className="font-mono text-[11px] text-slate-300">{p.intel}⟡</span>
              </div>
            );
          })}
        </div>

        <div className="mt-6 flex gap-2">
          <Link href="/lobby" className="btn-primary flex-1 py-3">
            new match
          </Link>
          <Link href="/profile" className="btn-ghost flex-1 py-3">
            record
          </Link>
        </div>
      </div>
    </div>
  );
}
