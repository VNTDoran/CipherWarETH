"use client";

import clsx from "clsx";
import { useEffect, useRef } from "react";
import { AGENCY_META } from "../../../shared/constants";
import type { MatchView } from "../../../shared/types";

const TONE: Record<string, string> = {
  info: "text-slate-400",
  buy: "text-slate-400",
  crack: "text-signal",
  burn: "text-alert",
  arrive: "text-gold",
  decoy: "text-fuchsia-400",
  win: "text-gold font-semibold",
};

export default function EventLog({ view }: { view: MatchView }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: "smooth" });
  }, [view.log.length]);

  return (
    <div className="panel flex h-full min-h-0 flex-col">
      <div className="border-b border-white/20 px-3 py-1.5">
        <span className="stat">signals intercepted</span>
      </div>
      <div ref={ref} className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 py-2">
        {view.log.length === 0 && (
          <p className="font-mono text-[11px] text-slate-300">Channel quiet.</p>
        )}
        {view.log.map((e) => {
          const p = e.slot === null ? null : view.players.find((x) => x.slot === e.slot);
          return (
            <div key={e.id} className="flex items-baseline gap-1.5 font-mono text-[11px] leading-snug">
              {p && (
                <span
                  className="mt-[3px] h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ background: AGENCY_META[p.agency].color }}
                />
              )}
              <span className={clsx("min-w-0", TONE[e.kind] ?? "text-slate-300")}>{e.text}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
