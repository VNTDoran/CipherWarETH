"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { type Socket, io } from "socket.io-client";
import type {
  LogEntry,
  MatchView,
  MinigameAssignment,
  MinigameResult,
  MinigameSubmission,
  ShopItem,
} from "../../shared/types";

export interface Toast {
  id: number;
  text: string;
  tone: "info" | "bad" | "good";
}

export interface CommitOutcome {
  messengerId: string;
  success: boolean;
  keyIndex: number;
  payout: number;
}

let toastId = 0;

/**
 * Owns the socket for one match. The server pushes a personalised `state`
 * snapshot; everything else here is transient UI feedback layered on top.
 */
export function useMatch(code: string) {
  const socketRef = useRef<Socket | null>(null);
  /** The server sends only a short tail; the full log is rebuilt here. */
  const logRef = useRef<LogEntry[]>([]);
  const [view, setView] = useState<MatchView | null>(null);
  const [status, setStatus] = useState<"connecting" | "joined" | "error">("connecting");
  const [fatal, setFatal] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [minigame, setMinigame] = useState<MinigameAssignment | null>(null);
  const [lastResult, setLastResult] = useState<MinigameResult | null>(null);
  const [commitOutcome, setCommitOutcome] = useState<CommitOutcome | null>(null);

  const pushToast = useCallback((text: string, tone: Toast["tone"] = "info") => {
    const id = ++toastId;
    setToasts((t) => [...t.slice(-3), { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  }, []);

  useEffect(() => {
    logRef.current = [];
    const socket = io({ path: "/api/socket", transports: ["websocket", "polling"] });
    socketRef.current = socket;

    socket.on("connect", () => {
      socket.emit("join", { code }, (res: { ok: boolean; error?: string }) => {
        if (res?.ok) setStatus("joined");
        else {
          setStatus("error");
          setFatal(res?.error ?? "Could not join that match.");
        }
      });
    });

    socket.on("connect_error", (err: Error) => {
      setStatus("error");
      setFatal(
        err.message === "unauthenticated"
          ? "Your session expired. Sign in again."
          : "Cannot reach the game server.",
      );
    });

    socket.on("state", (v: MatchView) => {
      // Merge the incoming tail into the accumulated log by entry id. Ids are
      // unique per entry, so a dropped or duplicated snapshot cannot corrupt
      // the transcript — it just resyncs on the next one.
      if (v.log.length) {
        const seen = new Set(logRef.current.map((e) => e.id));
        const fresh = v.log.filter((e) => !seen.has(e.id));
        if (fresh.length) {
          logRef.current = [...logRef.current, ...fresh].slice(-40);
        }
      }
      setView({ ...v, log: logRef.current });
    });
    socket.on("errorMsg", (m: { message: string }) => {
      pushToast(m.message, "bad");
      // A rejected submission would otherwise leave the overlay up forever and
      // soft-lock the player behind a minigame the server has already dropped.
      setMinigame(null);
    });
    socket.on("minigame", (a: MinigameAssignment) => {
      setLastResult(null);
      setMinigame(a);
      // Backstop: if the result never arrives (dropped packet, messenger
      // resolved mid-game), close the overlay rather than trapping the player.
      const grace = a.challenge.durationMs + 6000;
      window.setTimeout(() => {
        setMinigame((cur) => (cur?.token === a.token ? null : cur));
      }, grace);
    });
    socket.on("minigameResult", (r: MinigameResult) => {
      setMinigame(null);
      setLastResult(r);
      pushToast(
        `${r.tier} — ${r.eliminated} key${r.eliminated === 1 ? "" : "s"} eliminated, ${r.poolAfter} left`,
        r.tier === "BRONZE" ? "info" : "good",
      );
      setTimeout(() => setLastResult(null), 2600);
    });
    socket.on("commitResult", (r: CommitOutcome) => {
      setCommitOutcome(r);
      pushToast(
        r.success
          ? `Message decrypted — ${r.payout >= 0 ? "+" : ""}${r.payout} intel`
          : "Wrong key. Channel locked.",
        r.success ? "good" : "bad",
      );
      setTimeout(() => setCommitOutcome(null), 2600);
    });

    return () => {
      socket.emit("leave");
      socket.disconnect();
      socketRef.current = null;
    };
  }, [code, pushToast]);

  const emit = useCallback((event: string, payload?: unknown) => {
    socketRef.current?.emit(event, payload as never);
  }, []);

  return {
    view,
    status,
    fatal,
    toasts,
    minigame,
    lastResult,
    commitOutcome,
    actions: {
      ready: (ready: boolean) => emit("ready", { ready }),
      start: () => emit("start"),
      dispatch: () => emit("dispatch"),
      decoy: () => emit("decoy"),
      buy: (item: ShopItem) => emit("buy", { item }),
      attack: (messengerId: string) => emit("attack", { messengerId }),
      submit: (s: MinigameSubmission) => emit("submit", s),
      commit: (messengerId: string, keyIndex: number) =>
        emit("commit", { messengerId, keyIndex }),
      linkWallet: (address: string | null) => emit("linkWallet", { address }),
    },
  };
}
