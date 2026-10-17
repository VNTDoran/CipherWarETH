"use client";

import clsx from "clsx";
import type { MatchView } from "../../../shared/types";
import type { WalletState } from "@/lib/useWallet";

/**
 * Wallet linking.
 *
 * Shown in the lobby as well as in the match, because the link has to happen
 * BEFORE you dispatch: the server records the courier's owner on-chain at
 * dispatch time, and a player with no wallet gets a courier nobody can refuel
 * — so it is given unlimited fuel and never stalls. Offering this only once
 * the match is running would mean the first directive quietly skips the whole
 * mechanic.
 */
export default function WalletCard({
  chain,
  wallet,
  onConnect,
  compact,
}: {
  chain: MatchView["chain"];
  wallet: WalletState & { switchNetwork?: () => void };
  onConnect: () => void;
  compact?: boolean;
}) {
  if (!chain) return null;

  const linked = !!wallet.address;

  return (
    <div
      className={clsx(
        "panel",
        compact ? "p-3" : "p-4",
        !linked && "border-gold/50",
        wallet.wrongNetwork && "border-alert/60",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="stat">wallet</span>
        <span
          className={clsx(
            "font-mono text-[10px] uppercase tracking-widest",
            linked ? "text-signal" : "text-gold",
          )}
        >
          {linked ? "linked" : "not linked"}
        </span>
      </div>

      {linked ? (
        <>
          <code className="mt-1 block text-[11px]">
            {wallet.address!.slice(0, 10)}…{wallet.address!.slice(-6)}
          </code>
          {wallet.wrongNetwork && (
            <p className="mt-2 rounded border border-alert/40 bg-alert/10 px-2 py-1 font-mono text-[10px] text-alert">
              Wrong network — MetaMask is on chain {wallet.walletChainId ?? "?"}, switch to chain {chain.chainId}.
              <button type="button" className="btn-ghost mt-1 block px-2 py-1" onClick={wallet.switchNetwork}>
                switch network
              </button>
            </p>
          )}
          {wallet.error && (
            <p className="mt-1.5 font-mono text-[10px] text-alert">{wallet.error}</p>
          )}
        </>
      ) : (
        <>
          <p className="mt-1 text-xs leading-relaxed text-slate-300">
            {wallet.available
              ? "Your couriers run out of fuel mid-flight and freeze while rivals keep attacking them. Link a wallet now so you can restart them — without one, this match runs with the chain off for you."
              : "No wallet detected. Install MetaMask to refuel your couriers. The match stays fully playable without one."}
          </p>
          {wallet.available && (
            <button
              type="button"
              className="btn-primary mt-2 w-full py-2"
              onClick={onConnect}
              disabled={wallet.busy}
            >
              {wallet.busy ? "connecting…" : "connect MetaMask"}
            </button>
          )}
          {wallet.error && (
            <p className="mt-1.5 font-mono text-[10px] text-alert">{wallet.error}</p>
          )}
        </>
      )}
    </div>
  );
}
