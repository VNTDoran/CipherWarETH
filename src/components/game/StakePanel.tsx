"use client";

import clsx from "clsx";
import { useEffect, useState } from "react";
import type { MatchView } from "../../../shared/types";
import { formatIntel } from "@/lib/intel";
import type { WalletApi } from "@/lib/useWallet";

/**
 * The buy-in. Every seat in a staked match is paid for with INTEL put into the
 * escrow contract, and the winner takes the whole pot — forfeiting, or losing,
 * leaves your stake with them.
 *
 * Shown in the lobby only: the stake has to be in before the match starts, and
 * the contract refuses new stakes once the table is locked.
 */
export default function StakePanel({
  view,
  wallet,
}: {
  view: MatchView;
  wallet: WalletApi;
}) {
  const t = view.chain?.tournament;
  // Between the transaction confirming and the server pushing the verified
  // state there is a beat; showing the button again there reads as a failure.
  const [submitted, setSubmitted] = useState(false);

  const me = view.players.find((p) => p.slot === view.youSlot);
  const staked = !!me?.staked;

  useEffect(() => {
    if (staked) {
      setSubmitted(false);
      return;
    }
    if (!submitted) return;
    // If the server never confirms, hand the button back rather than hang.
    const t = setTimeout(() => setSubmitted(false), 20_000);
    return () => clearTimeout(t);
  }, [staked, submitted]);

  if (!t) return null;
  const short =
    wallet.intelBalance !== null && wallet.intelBalance < BigInt(t.stakeWei);

  let blocker: string | null = null;
  if (submitted) blocker = "stake sent — confirming…";
  else if (!t.ready) blocker = "opening the escrow…";
  else if (!wallet.address) blocker = "link your wallet first";
  else if (wallet.wrongNetwork) blocker = "switch MetaMask to the game network";
  else if (short) blocker = "not enough INTEL";

  return (
    <div className={clsx("panel p-4", staked ? "border-signal/40" : "border-gold/40")}>
      <div className="flex items-center justify-between">
        <span className="stat">buy-in</span>
        <span
          className={clsx(
            "font-mono text-[10px] uppercase tracking-widest",
            staked ? "text-signal" : "text-gold",
          )}
        >
          {staked ? "staked" : "stake required"}
        </span>
      </div>

      <div className="mt-2 flex items-baseline justify-between">
        <span className="font-mono text-2xl font-bold text-slate-100">
          {formatIntel(t.stakeWei)} <span className="text-sm text-slate-300">INTEL</span>
        </span>
        <span className="font-mono text-[11px] text-slate-300">
          pot {formatIntel(t.potWei)} INTEL
        </span>
      </div>

      <p className="mt-2 text-xs leading-relaxed text-slate-300">
        Winner takes the whole pot. Forfeit, or lose, and your stake goes to them. Leaving the
        lobby after staking does not return it.
      </p>

      {wallet.intelBalance !== null && (
        <p className="mt-1 font-mono text-[10px] text-slate-300">
          your balance {formatIntel(wallet.intelBalance)} INTEL
        </p>
      )}

      {!staked && (
        <>
          <button
            type="button"
            className="btn-primary mt-3 w-full py-2.5 text-sm"
            disabled={!!blocker || wallet.busy}
            onClick={async () => {
              const err = await wallet.stake();
              if (!err) setSubmitted(true);
            }}
          >
            {wallet.busy
              ? "confirm in MetaMask…"
              : (blocker ?? `stake ${formatIntel(t.stakeWei)} INTEL`)}
          </button>
          <p className="mt-1.5 text-center font-mono text-[10px] text-slate-300">
            MetaMask asks twice: approve, then join.
          </p>
        </>
      )}

      {wallet.error && (
        <p className="mt-2 font-mono text-[10px] text-alert">{wallet.error}</p>
      )}
    </div>
  );
}
