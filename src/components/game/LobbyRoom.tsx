"use client";

import Link from "next/link";
import { useState } from "react";
import { AGENCY_META } from "../../../shared/constants";
import type { MatchView } from "../../../shared/types";
import type { WalletApi } from "@/lib/useWallet";
import StakePanel from "./StakePanel";
import WalletCard from "./WalletCard";

export default function LobbyRoom({
  view,
  wallet,
  onConnectWallet,
  onReady,
  onStart,
}: {
  view: MatchView;
  wallet: WalletApi;
  onConnectWallet: () => void;
  onReady: (ready: boolean) => void;
  onStart: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const me = view.players.find((p) => p.slot === view.youSlot);
  const isHost = !!me?.isHost;
  const others = view.players.filter((p) => !p.isHost);
  const allReady = others.every((p) => p.ready);
  const enough = view.players.length >= 2;
  const tournament = view.chain?.tournament ?? null;
  const allStaked = !tournament || view.players.every((p) => p.staked);

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(view.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard is blocked on insecure origins — the code is on screen anyway.
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col px-5 py-8">
      <Link
        href="/lobby"
        className="font-mono text-[11px] uppercase tracking-[0.3em] text-slate-300 hover:text-slate-300"
      >
        ← leave
      </Link>

      <div className="panel mt-6 p-6 text-center">
        <p className="stat">join code</p>
        <button
          type="button"
          onClick={copyCode}
          className="mt-2 font-mono text-5xl font-bold tracking-[0.25em] text-signal transition hover:opacity-80 sm:text-6xl"
          title="Copy to clipboard"
        >
          {view.code}
        </button>
        <p className="mt-2 font-mono text-[10px] uppercase tracking-widest text-slate-300">
          {copied ? "copied" : "tap to copy · share with 3 others"}
        </p>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {Array.from({ length: 4 }, (_, slot) => {
          const p = view.players.find((x) => x.slot === slot);
          if (!p) {
            return (
              <div
                key={slot}
                className="flex items-center justify-center rounded-md border border-dashed border-white/20 p-5"
              >
                <span className="stat">awaiting agency</span>
              </div>
            );
          }
          const meta = AGENCY_META[p.agency];
          return (
            <div
              key={slot}
              className="flex items-center gap-3 rounded-md border border-white/20 bg-ink-800/60 p-4"
              style={{ borderLeftColor: meta.color, borderLeftWidth: 3 }}
            >
              <span
                className="grid h-9 w-9 shrink-0 place-items-center rounded-sm font-mono text-sm font-bold text-ink-900"
                style={{ background: meta.color }}
              >
                {meta.sigil}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate font-display text-sm font-semibold text-slate-100">
                  {p.name}
                  {p.isHost && <span className="ml-1.5 text-[10px] text-gold">HOST</span>}
                </div>
                <div className="stat truncate">{meta.name}</div>
              </div>
              <span
                className={`font-mono text-[10px] uppercase tracking-widest ${
                  p.isHost || p.ready ? "text-signal" : "text-slate-300"
                }`}
              >
                {p.isHost ? "ready" : p.ready ? "ready" : "waiting"}
              </span>
              {tournament && (
                <span
                  className={`font-mono text-[10px] uppercase tracking-widest ${
                    p.staked ? "text-signal" : "text-gold"
                  }`}
                >
                  {p.staked ? "staked" : "no stake"}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {view.chain && (
        <div className="mt-4">
          <WalletCard chain={view.chain} wallet={wallet} onConnect={onConnectWallet} />
        </div>
      )}
      {tournament && (
        <div className="mt-4">
          <StakePanel view={view} wallet={wallet} />
        </div>
      )}

      <div className="mt-6 space-y-3">
        {isHost ? (
          <>
            <button
              type="button"
              className="btn-primary w-full py-3.5 text-sm"
              disabled={!enough || !allStaked || !allReady}
              onClick={onStart}
            >
              {!enough
                ? "need at least 2 agencies"
                : !allStaked
                  ? "waiting for every stake"
                  : !allReady
                  ? "waiting for all agencies"
                  : `open transmissions · ${view.players.length} agencies`}
            </button>
            <p className="text-center text-xs text-slate-300">
              2–4 players. Missing slots simply stay empty — the match is symmetric
              either way.
            </p>
          </>
        ) : (
          <button
            type="button"
            className={me?.ready ? "btn-ghost w-full py-3.5 text-sm" : "btn-primary w-full py-3.5 text-sm"}
            disabled={!me?.ready && !!tournament && !me?.staked}
            onClick={() => onReady(!me?.ready)}
          >
            {me?.ready ? "stand down" : tournament && !me?.staked ? "stake to ready up" : "ready"}
          </button>
        )}
      </div>

      <div className="panel mt-6 p-5">
        <h2 className="stat">briefing</h2>
        <ul className="mt-3 space-y-2 text-sm leading-relaxed text-slate-300">
          <li>
            <span className="text-slate-200">Five directives win.</span> Dispatch a
            courier for each; it must reach your capital.
          </li>
          <li>
            <span className="text-slate-200">Attacks eliminate keys.</span> Bronze
            crosses off 1, Silver 2, Gold 3 — from your own candidate set.
          </li>
          <li>
            <span className="text-slate-200">Commit when you are sure.</span> One
            candidate left means a certain crack. Fewer than that is a gamble.
          </li>
          <li>
            <span className="text-slate-200">Six enemy cracks also wins.</span> Going
            loud is a real strategy.
          </li>
        </ul>
      </div>
    </main>
  );
}
