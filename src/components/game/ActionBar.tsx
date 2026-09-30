"use client";

import clsx from "clsx";
import {
  DECOY_COST,
  ENCRYPT_COST,
  ENCRYPT_MAX,
  ESCORT_COST,
  SPY_MAX,
  spyCost,
} from "../../../shared/constants";
import type { MatchView, ShopItem } from "../../../shared/types";

function Action({
  label,
  cost,
  hint,
  disabled,
  tone = "ghost",
  onClick,
}: {
  label: string;
  cost: number | null;
  hint: string;
  disabled: boolean;
  tone?: "ghost" | "primary";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={hint}
      className={clsx(
        "flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-md border px-2 py-2 transition",
        "disabled:cursor-not-allowed disabled:opacity-40",
        tone === "primary"
          ? "border-signal/60 bg-signal/20 text-signal hover:enabled:bg-signal/30"
          : "border-white/25 text-slate-100 hover:enabled:border-white/50 hover:enabled:bg-white/10",
      )}
    >
      <span className="font-mono text-[10px] uppercase tracking-[0.15em]">{label}</span>
      <span className="font-mono text-[10px] opacity-75">{cost === null ? "max" : `${cost}⟡`}</span>
    </button>
  );
}

export default function ActionBar({
  view,
  onDispatch,
  onDecoy,
  onBuy,
}: {
  view: MatchView;
  onDispatch: () => void;
  onDecoy: () => void;
  onBuy: (item: ShopItem) => void;
}) {
  const me = view.players.find((p) => p.slot === view.youSlot);
  if (!me) return null;

  const nextSpy = spyCost(me.spies);
  const d = view.nextDispatch;

  return (
    <div className="flex items-stretch gap-1.5">
      <Action
        label={d ? `dispatch d${d.level}` : "complete"}
        cost={d?.cost ?? null}
        tone="primary"
        hint={
          me.inTransit
            ? "One directive in the ether at a time."
            : "Send the next confirmation to your capital."
        }
        disabled={!d || !d.affordable}
        onClick={onDispatch}
      />
      <Action
        label="recruit"
        cost={nextSpy}
        hint={`Spies pre-eliminate one candidate key per intercept (${me.spies}/${SPY_MAX}).`}
        disabled={nextSpy === null || me.intel < nextSpy}
        onClick={() => onBuy("SPY")}
      />
      <Action
        label="encrypt"
        cost={me.encrypt >= ENCRYPT_MAX ? null : ENCRYPT_COST}
        hint={`Adds 2 candidate keys to your own couriers (${me.encrypt}/${ENCRYPT_MAX}).`}
        disabled={me.encrypt >= ENCRYPT_MAX || me.intel < ENCRYPT_COST}
        onClick={() => onBuy("ENCRYPT")}
      />
      <Action
        label={me.escorts > 0 ? `escort ·${me.escorts}` : "escort"}
        cost={ESCORT_COST}
        hint="Your next dispatch downgrades every attacker's result by one tier."
        disabled={me.intel < ESCORT_COST}
        onClick={() => onBuy("ESCORT")}
      />
      <Action
        label="decoy"
        cost={DECOY_COST}
        hint="A fake courier. Whoever cracks it loses intel and gains a poisoned dossier."
        disabled={me.intel < DECOY_COST}
        onClick={onDecoy}
      />
    </div>
  );
}
