/**
 * CIPHER WAR — tuning constants.
 * Single source of truth, shared by the server engine and the UI.
 * These are the knobs to turn during playtesting (see DESIGN.md §9).
 */

export const OPERATION_STEPS = 5;
export const BASE_CANDIDATES = 10;
/** Later directives are fatter targets: +1 candidate key per level above 1. */
export const CANDIDATES_PER_LEVEL = 1;

/**
 * Per-directive pacing. Index 0 = directive 1.
 *
 * Transit scales with the attack cycle (minigame + cooldown ≈ 10 s), so each
 * courier still offers roughly 3–6 intercept windows. Shortening the cycle
 * without shortening these would have made interception trivially easy.
 */
export const DIRECTIVES = [
  { level: 1, transitMs: 28_000, dispatchCost: 0, crackPayout: 55 },
  { level: 2, transitMs: 32_000, dispatchCost: 40, crackPayout: 80 },
  { level: 3, transitMs: 38_000, dispatchCost: 70, crackPayout: 105 },
  { level: 4, transitMs: 45_000, dispatchCost: 110, crackPayout: 130 },
  { level: 5, transitMs: 54_000, dispatchCost: 160, crackPayout: 155 },
] as const;

/** Burned directives are cheaper to re-send than the original dispatch. */
export const REDISPATCH_RATIO = 0.5;

export const SPY_COSTS = [60, 110, 180, 270] as const;
export const SPY_MAX = SPY_COSTS.length;

export const ENCRYPT_COST = 90;
export const ENCRYPT_MAX = 3;
export const ENCRYPT_BONUS_KEYS = 2;

export const ESCORT_COST = 50;

export const DECOY_COST = 35;
export const DECOY_PENALTY = 40; // attacker loses this for cracking bait
export const DECOY_REWARD = 25; // owner gains this when the bait lands
export const DECOY_TRANSIT_MS = 36_000;

export const AMBIENT_PAYOUT = 15;
export const AMBIENT_SPAWN_MS = 9_000;
export const AMBIENT_TRANSIT_MS = 24_000;
export const AMBIENT_MAX_ALIVE = 3;
export const AMBIENT_CANDIDATES = 7;

export const ARRIVAL_BONUS = 20;

export const PASSIVE_INTEL = 4;
export const PASSIVE_INTEL_MS = 10_000;
export const STARTING_INTEL = 60;

export const ATTACK_COOLDOWN_MS = 5_000;
export const WRONG_COMMIT_LOCK_MS = 7_000;
export const WRONG_COMMIT_COST = 15;

export const BLACKOUT_CRACKS = 6;
export const MATCH_HARD_CAP_MS = 15 * 60 * 1000;

export const TICK_MS = 100;
export const BROADCAST_MS = 300;

export const ELIMINATIONS_BY_TIER = { BRONZE: 1, SILVER: 2, GOLD: 3 } as const;

export const AGENCY_CODES = ["NORD", "EST", "SUD", "OUEST"] as const;

export const AGENCY_META: Record<
  string,
  { name: string; country: string; color: string; sigil: string; motto: string }
> = {
  NORD: {
    name: "Direction Nord",
    country: "Verhalen",
    color: "#38bdf8",
    sigil: "N",
    motto: "Le silence est une arme",
  },
  EST: {
    name: "Bureau Est",
    country: "Kaldera",
    color: "#f472b6",
    sigil: "E",
    motto: "Nous lisons tout",
  },
  SUD: {
    name: "Section Sud",
    country: "Marenne",
    color: "#4ade80",
    sigil: "S",
    motto: "Patience, puis frappe",
  },
  OUEST: {
    name: "Cellule Ouest",
    country: "Tarsis",
    color: "#fb923c",
    sigil: "O",
    motto: "Rien n'est perdu",
  },
};

/** Glyph alphabet used for key candidates and the Signal Trace minigame. */
export const GLYPHS = "ΑΒΓΔΕΖΗΘΛΞΠΣΦΨΩ".split("");

export const MINIGAME_KEYS = [
  "cipher_type",
  "frequency_lock",
  "signal_trace",
] as const;

export function spyCost(owned: number): number | null {
  return owned >= SPY_MAX ? null : SPY_COSTS[owned];
}

export function dispatchCost(level: number, burnedBefore: boolean): number {
  const base = DIRECTIVES[level - 1]?.dispatchCost ?? 0;
  return burnedBefore ? Math.round(base * REDISPATCH_RATIO) : base;
}

// ──────────────────────── Courier fuel (chain mode) ─────────────────────
// Only active when CHAIN_ENABLED is set. Without it a courier carries enough
// fuel for its whole trip and never stalls, so the original game is unchanged.

/** Seconds of travel bought by one fuel unit. Mirrors CourierFuel.sol. */
export const FUEL_SECONDS_PER_UNIT = 5;

/** Units a courier leaves with, before any booster. */
export const FUEL_UNITS_AT_DISPATCH = 3;

/** Hidden demand range, derived from the courier's secret preimage. */
export const FUEL_MIN_REQUIRED_UNITS = 4;
export const FUEL_MAX_REQUIRED_UNITS = 15;

/** Price of one unit in wei, as a decimal string (0.001 ETH). */
export const FUEL_UNIT_PRICE_WEI = "1000000000000000";
