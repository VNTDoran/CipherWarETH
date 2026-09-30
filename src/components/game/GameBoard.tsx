"use client";

import clsx from "clsx";
import { useEffect, useMemo, useState } from "react";
import { BLACKOUT_CRACKS, OPERATION_STEPS } from "../../../shared/constants";
import type { MatchView, MinigameSubmission, ShopItem } from "../../../shared/types";
import MinigameHost from "../minigames/MinigameHost";
import type { Toast } from "@/lib/useMatch";
import ActionBar from "./ActionBar";
import AgencyPanel from "./AgencyPanel";
import Ether from "./Ether";
import EventLog from "./EventLog";
import KeyRack from "./KeyRack";
import VictoryScreen from "./VictoryScreen";

function clock(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export default function GameBoard({
  view,
  toasts,
  minigame,
  actions,
}: {
  view: MatchView;
  toasts: Toast[];
  minigame: Parameters<typeof MinigameHost>[0]["assignment"] | null;
  actions: {
    dispatch: () => void;
    decoy: () => void;
    buy: (item: ShopItem) => void;
    attack: (id: string) => void;
    submit: (s: MinigameSubmission) => void;
    commit: (id: string, keyIndex: number) => void;
  };
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showLog, setShowLog] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);

  // Drop the selection once its courier resolves, so the panel never lies.
  useEffect(() => {
    if (selectedId && !view.messengers.some((m) => m.id === selectedId)) {
      setSelectedId(null);
    }
  }, [view.messengers, selectedId]);

  const selected = useMemo(
    () => view.messengers.find((m) => m.id === selectedId) ?? null,
    [view.messengers, selectedId],
  );

  const me = view.players.find((p) => p.slot === view.youSlot);
  const topStep = Math.max(...view.players.map((p) => p.step), 0);
  const remaining = view.endsAt ? view.endsAt - now : 0;

  return (
    // Phones stack into one tall column that cannot fit a fixed-height shell,
    // so small screens scroll and only wide ones lock to the viewport.
    <div className="flex min-h-dvh flex-col lg:h-dvh lg:overflow-hidden">
      <header className="sticky top-0 z-30 flex shrink-0 items-center gap-3 border-b border-white/20 bg-ink-900/90 px-3 py-2 backdrop-blur lg:static lg:bg-transparent lg:backdrop-blur-none">
        <span className="font-mono text-[11px] uppercase tracking-[0.3em] text-slate-300">
          {view.code}
        </span>
        <span
          className={clsx(
            "font-mono text-sm font-bold tabular-nums",
            remaining < 60_000 ? "text-alert" : "text-slate-300",
          )}
        >
          {clock(remaining)}
        </span>
        <div className="ml-auto flex items-center gap-3">
          {me && (
            <>
              <span className="font-mono text-[11px] text-slate-300">
                <span className="text-gold">{me.cracksMade}</span>/{BLACKOUT_CRACKS} blackout
              </span>
              <span className="font-mono text-sm font-bold text-signal">{me.intel}⟡</span>
            </>
          )}
          <button
            type="button"
            className="btn-ghost px-2 py-1 lg:hidden"
            onClick={() => setShowLog((s) => !s)}
          >
            log
          </button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 gap-2 p-2 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-h-0 flex-col gap-2">
          {/* 2x2 until there is genuinely room for four across, otherwise the
              agency names truncate to "Agent …" on mid-size screens. */}
          <div className="grid shrink-0 grid-cols-2 gap-2 xl:grid-cols-4">
            {view.players.map((p) => (
              <AgencyPanel
                key={p.slot}
                player={p}
                isYou={p.slot === view.youSlot}
                leading={p.step === topStep && topStep > 0}
              />
            ))}
          </div>

          <div className="panel relative aspect-square max-h-[52dvh] w-full flex-1 overflow-hidden sm:aspect-auto sm:min-h-[38dvh]">
            <Ether view={view} selectedId={selectedId} onSelect={setSelectedId} />
            {view.messengers.length === 0 && (
              <p className="pointer-events-none absolute inset-x-0 bottom-4 text-center font-mono text-[10px] uppercase tracking-[0.25em] text-slate-300">
                ether quiet · dispatch to begin
              </p>
            )}
          </div>
        </div>

        <div className="grid min-h-0 gap-2 lg:grid-rows-[minmax(0,1.15fr)_minmax(0,1fr)]">
          <KeyRack
            view={view}
            messenger={selected}
            onAttack={actions.attack}
            onCommit={actions.commit}
            busy={!!minigame}
          />
          <div className={clsx("min-h-[160px]", showLog ? "block" : "hidden lg:block")}>
            <EventLog view={view} />
          </div>
        </div>
      </div>

      <footer
        className="sticky bottom-0 z-30 shrink-0 border-t border-white/20 bg-ink-900/90 px-2 py-2 backdrop-blur lg:static lg:bg-transparent lg:backdrop-blur-none"
        style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}
      >
        <ActionBar
          view={view}
          onDispatch={actions.dispatch}
          onDecoy={actions.decoy}
          onBuy={actions.buy}
        />
        {me && me.step >= OPERATION_STEPS && (
          <p className="mt-1 text-center font-mono text-[10px] uppercase tracking-widest text-gold">
            operation complete
          </p>
        )}
      </footer>

      {/* Toasts */}
      <div className="pointer-events-none fixed inset-x-0 top-14 z-40 flex flex-col items-center gap-1.5 px-4">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={clsx(
              "animate-slideUp rounded-md border px-3 py-1.5 font-mono text-[11px] backdrop-blur",
              t.tone === "bad" && "border-alert/40 bg-alert/15 text-alert",
              t.tone === "good" && "border-signal/40 bg-signal/15 text-signal",
              t.tone === "info" && "border-white/25 bg-ink-800/90 text-slate-300",
            )}
          >
            {t.text}
          </div>
        ))}
      </div>

      {minigame && <MinigameHost assignment={minigame} onSubmit={actions.submit} />}
      {view.status === "FINISHED" && view.winner && <VictoryScreen view={view} />}
    </div>
  );
}
