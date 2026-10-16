"use client";

import Link from "next/link";
import GameBoard from "@/components/game/GameBoard";
import LobbyRoom from "@/components/game/LobbyRoom";
import { useMatch } from "@/lib/useMatch";
import { useWallet } from "@/lib/useWallet";

export default function PlayClient({ code }: { code: string }) {
  const { view, status, fatal, toasts, minigame, actions } = useMatch(code);
  // Boosters are paid by the player, so the browser needs its own signer.
  const wallet = useWallet(view?.chain ?? null, actions.linkWallet);

  if (status === "error" || (!view && status !== "connecting")) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-5 text-center">
        <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-alert">
          channel closed
        </p>
        <p className="text-sm text-slate-300">{fatal ?? "That match is no longer available."}</p>
        <Link href="/lobby" className="btn-primary px-5 py-2.5">
          back to lobby
        </Link>
      </main>
    );
  }

  if (!view) {
    return (
      <main className="flex min-h-dvh items-center justify-center">
        <p className="animate-flicker font-mono text-[11px] uppercase tracking-[0.4em] text-slate-300">
          establishing channel…
        </p>
      </main>
    );
  }

  if (view.status === "LOBBY") {
    return <LobbyRoom view={view} onReady={actions.ready} onStart={actions.start} />;
  }

  return (
    <GameBoard
      view={view}
      toasts={toasts}
      minigame={minigame}
      wallet={wallet}
      actions={{
        dispatch: actions.dispatch,
        decoy: actions.decoy,
        buy: actions.buy,
        attack: actions.attack,
        submit: actions.submit,
        commit: actions.commit,
      }}
    />
  );
}
