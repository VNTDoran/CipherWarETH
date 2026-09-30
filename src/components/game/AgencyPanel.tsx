"use client";

import clsx from "clsx";
import { AGENCY_META, ENCRYPT_MAX, OPERATION_STEPS, SPY_MAX } from "../../../shared/constants";
import type { PlayerView } from "../../../shared/types";

function Pips({ value, max, color }: { value: number; max: number; color: string }) {
  return (
    <div className="flex gap-[3px]">
      {Array.from({ length: max }, (_, i) => (
        <span
          key={i}
          className="h-[7px] w-3 rounded-[1px] border"
          style={{
            borderColor: i < value ? color : "rgba(148,163,184,0.25)",
            background: i < value ? color : "transparent",
          }}
        />
      ))}
    </div>
  );
}

function Dots({ value, max, color }: { value: number; max: number; color: string }) {
  return (
    <span className="inline-flex gap-[3px]">
      {Array.from({ length: max }, (_, i) => (
        <span
          key={i}
          className="h-[5px] w-[5px] rounded-full"
          style={{ background: i < value ? color : "rgba(148,163,184,0.22)" }}
        />
      ))}
    </span>
  );
}

export default function AgencyPanel({
  player,
  isYou,
  leading,
}: {
  player: PlayerView;
  isYou: boolean;
  leading: boolean;
}) {
  const meta = AGENCY_META[player.agency];
  const color = meta.color;

  return (
    <div
      className={clsx(
        "relative flex flex-col justify-between overflow-hidden rounded-md border p-2.5 transition sm:p-3",
        isYou ? "border-white/25 bg-white/[0.04]" : "border-white/20 bg-ink-800/50",
        !player.connected && "opacity-45",
      )}
    >
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[2px]"
        style={{ background: color, opacity: isYou ? 1 : 0.4 }}
      />

      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span
              className="grid h-5 w-5 shrink-0 place-items-center rounded-sm font-mono text-[11px] font-bold text-ink-900"
              style={{ background: color }}
            >
              {meta.sigil}
            </span>
            <span className="truncate font-display text-sm font-semibold text-slate-100">
              {player.name}
            </span>
            {leading && <span className="text-[10px] text-gold" title="Leading">★</span>}
          </div>
          <div className="stat mt-0.5 truncate">{meta.name}</div>
        </div>

        <div className="shrink-0 text-right">
          <div className="font-mono text-base font-bold leading-none" style={{ color }}>
            {player.intel}
            {!isYou && <span className="text-[9px] opacity-50">~</span>}
          </div>
          <div className="stat">intel</div>
        </div>
      </div>

      <div className="mt-2.5 space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <Pips value={player.step} max={OPERATION_STEPS} color={color} />
          <span className="stat">
            {player.step}/{OPERATION_STEPS}
          </span>
        </div>

        {/* Detail row costs ~40px per panel; on a phone that space is better
            spent on the ether, and the same numbers are one tap away. */}
        <div className="hidden flex-wrap items-center gap-x-3 gap-y-1 sm:flex">
          <span className="stat flex items-center gap-1">
            spies <Dots value={player.spies} max={SPY_MAX} color={color} />
          </span>
          <span className="stat flex items-center gap-1">
            enc <Dots value={player.encrypt} max={ENCRYPT_MAX} color={color} />
          </span>
          <span
            className="stat"
            title={`${player.cracksMade} cracks made · ${player.timesCracked} directives burned`}
          >
            <span className="text-signal">{player.cracksMade}</span> crk ·{" "}
            <span className="text-alert">{player.timesCracked}</span> brn
          </span>
        </div>

        {player.inTransit && (
          <div
            className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest animate-flicker"
            style={{ color }}
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
            in transit
          </div>
        )}
        {!player.connected && (
          <div className="font-mono text-[10px] uppercase tracking-widest text-alert">
            disconnected
          </div>
        )}
      </div>
    </div>
  );
}
