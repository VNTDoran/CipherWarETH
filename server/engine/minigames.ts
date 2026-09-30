/**
 * Minigame generation and scoring.
 *
 * The server generates every challenge and scores every submission. Clients
 * send raw inputs (what was typed, which taps landed, which glyphs were
 * chosen) — never a score. That closes the obvious cheat of posting
 * `{ tier: "GOLD" }` straight at the socket.
 *
 * Honest limitation: Signal Trace and Frequency Lock must ship their target
 * to the client in order to be *rendered*, so a determined player reading the
 * websocket could beat them. Cipher Type is fully sound. Fixing the other two
 * would mean streaming frames instead of data, which is not worth it here —
 * but the score-injection hole, which is the one that actually matters, is
 * closed.
 */

import { randomUUID } from "node:crypto";
import { GLYPHS, MINIGAME_KEYS } from "../../shared/constants.js";
import type {
  MinigameChallenge,
  MinigameKey,
  MinigameSubmission,
  Tier,
} from "../../shared/types.js";

export interface MinigameTuning {
  key: MinigameKey;
  durationMs: number;
  silverAt: number;
  goldAt: number;
  weight: number;
  enabled: boolean;
}

/**
 * Fallback tuning if the DB has no MinigameConfig rows yet.
 *
 * Kept deliberately short: an intercept is an interruption to the board, and
 * eight seconds of it felt like a chore. Roughly five seconds plus a five
 * second cooldown gives a ten second attack cycle.
 */
export const DEFAULT_TUNING: MinigameTuning[] = [
  {
    key: "cipher_type",
    durationMs: 5000,
    silverAt: 55,
    goldAt: 80,
    weight: 1,
    enabled: true,
  },
  {
    key: "frequency_lock",
    durationMs: 4500,
    silverAt: 50,
    goldAt: 85,
    weight: 1,
    enabled: true,
  },
  {
    key: "signal_trace",
    durationMs: 4500,
    silverAt: 60,
    goldAt: 90,
    weight: 1,
    enabled: true,
  },
];

/** Short on purpose — these get typed on a phone, under time pressure. */
const CIPHER_WORDS = [
  "ANTENNE",
  "VERROU",
  "SILLAGE",
  "ARDOISE",
  "LANTERNE",
  "MERIDIAN",
  "OBSIDIAN",
  "CENDRE",
  "MIROIR",
  "PAVILLON",
  "SEXTANT",
  "VELIN",
];

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function weightedPick(tunings: MinigameTuning[]): MinigameTuning {
  const pool = tunings.filter((t) => t.enabled);
  const active = pool.length ? pool : DEFAULT_TUNING;
  const total = active.reduce((s, t) => s + Math.max(1, t.weight), 0);
  let roll = Math.random() * total;
  for (const t of active) {
    roll -= Math.max(1, t.weight);
    if (roll <= 0) return t;
  }
  return active[active.length - 1];
}

/** A pending challenge, held server-side until the player submits. */
export interface PendingMinigame {
  token: string;
  slot: number;
  messengerId: string;
  tuning: MinigameTuning;
  challenge: MinigameChallenge;
  issuedAt: number;
  /** Server-only answer key. */
  secret: { text?: string; sequence?: string[] };
}

export function createMinigame(
  slot: number,
  messengerId: string,
  tunings: MinigameTuning[],
): PendingMinigame {
  const tuning = weightedPick(tunings);
  const token = randomUUID();
  const issuedAt = Date.now();

  switch (tuning.key) {
    case "cipher_type": {
      // One word plus a 3-digit group: ~10 characters, typeable in a few
      // seconds on a phone. Two full words took most of the old 8s window.
      const text = `${pick(CIPHER_WORDS)}-${100 + Math.floor(Math.random() * 900)}`;
      return {
        token,
        slot,
        messengerId,
        tuning,
        issuedAt,
        secret: { text },
        challenge: { key: "cipher_type", durationMs: tuning.durationMs, text },
      };
    }
    case "frequency_lock": {
      const rounds = [0, 1, 2].map((i) => {
        // Band narrows and the needle speeds up each round. Faster sweeps
        // than before, so three rounds fit comfortably in 4.5s.
        const width = 50 - i * 12;
        const bandStart = Math.random() * (360 - width);
        return {
          bandStart: Math.round(bandStart),
          bandEnd: Math.round(bandStart + width),
          sweepDegPerSec: 260 + i * 90,
        };
      });
      return {
        token,
        slot,
        messengerId,
        tuning,
        issuedAt,
        secret: {},
        challenge: {
          key: "frequency_lock",
          durationMs: tuning.durationMs,
          rounds,
        },
      };
    }
    case "signal_trace": {
      const options = [...GLYPHS].sort(() => Math.random() - 0.5).slice(0, 6);
      // Four glyphs, flashed fast. Five at 2.2s was most of the round.
      const sequence = Array.from({ length: 4 }, () => pick(options));
      return {
        token,
        slot,
        messengerId,
        tuning,
        issuedAt,
        secret: { sequence },
        challenge: {
          key: "signal_trace",
          durationMs: tuning.durationMs,
          sequence,
          options,
          flashMs: 1400,
        },
      };
    }
  }
}

function tierFor(raw: number, t: MinigameTuning): Tier {
  if (raw >= t.goldAt) return "GOLD";
  if (raw >= t.silverAt) return "SILVER";
  return "BRONZE";
}

/** Longest common prefix ratio — rewards accuracy without punishing length. */
function typingAccuracy(target: string, typed: string): number {
  let correct = 0;
  for (let i = 0; i < Math.min(target.length, typed.length); i++) {
    if (target[i] === typed[i]) correct++;
  }
  const overshoot = Math.max(0, typed.length - target.length);
  return Math.max(0, (correct - overshoot) / target.length);
}

export function scoreMinigame(
  pending: PendingMinigame,
  submission: MinigameSubmission,
): { rawScore: number; tier: Tier } {
  let raw = 0;

  if (submission.key === "cipher_type" && pending.challenge.key === "cipher_type") {
    const target = pending.secret.text ?? "";
    const acc = typingAccuracy(target, submission.typed.toUpperCase().trim());
    // Trust the wall clock, not the client's stopwatch.
    const elapsed = Math.min(
      Math.max(200, Date.now() - pending.issuedAt),
      pending.tuning.durationMs,
    );
    const speed = 1 - elapsed / pending.tuning.durationMs; // 0..1
    raw = Math.round(acc * 70 + acc * speed * 30);
  } else if (
    submission.key === "frequency_lock" &&
    pending.challenge.key === "frequency_lock"
  ) {
    const hits = submission.hits.slice(0, 3).filter(Boolean).length;
    // Later rounds are harder, so weight them: 28 / 34 / 38.
    const weights = [28, 34, 38];
    raw = submission.hits
      .slice(0, 3)
      .reduce((s, hit, i) => s + (hit ? weights[i] : 0), 0);
    if (hits === 3) raw = 100;
  } else if (
    submission.key === "signal_trace" &&
    pending.challenge.key === "signal_trace"
  ) {
    const seq = pending.secret.sequence ?? [];
    let correct = 0;
    for (let i = 0; i < seq.length; i++) {
      if (submission.answer[i] === seq[i]) correct++;
    }
    raw = Math.round((correct / Math.max(1, seq.length)) * 100);
  }

  raw = Math.max(0, Math.min(100, raw));
  return { rawScore: raw, tier: tierFor(raw, pending.tuning) };
}

export function isKnownMinigame(k: string): k is MinigameKey {
  return (MINIGAME_KEYS as readonly string[]).includes(k);
}
