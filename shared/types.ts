/**
 * Wire protocol between the Socket.IO server and the game client.
 *
 * Everything the client receives is a *view*: the server strips the real key
 * index and every other player's candidate pool before serialising. A client
 * physically cannot see which key is real, which is what makes the authority
 * model hold.
 */

export type AgencyCode = "NORD" | "EST" | "SUD" | "OUEST";
export type MessengerKind = "DIRECTIVE" | "DECOY" | "AMBIENT";
export type Tier = "BRONZE" | "SILVER" | "GOLD";
export type MinigameKey = "cipher_type" | "frequency_lock" | "signal_trace";
export type MatchStatus = "LOBBY" | "ACTIVE" | "FINISHED";
export type WinType = "OPERATION" | "BLACKOUT" | "TIMEOUT" | "FORFEIT";
export type ShopItem = "SPY" | "ENCRYPT" | "ESCORT";

export interface PlayerView {
  id: string;
  userId: string;
  name: string;
  slot: number;
  agency: AgencyCode;
  operationName: string;
  intel: number;
  /** Directives confirmed, 0..5. */
  step: number;
  spies: number;
  encrypt: number;
  escorts: number;
  cracksMade: number;
  timesCracked: number;
  connected: boolean;
  /** Gave up mid-match: out of play, ranked below everyone still in. */
  forfeited: boolean;
  /** Has put their stake into the escrow. Always false without staking. */
  staked: boolean;
  ready: boolean;
  isHost: boolean;
  /** True while one of this player's directive messengers is in the ether. */
  inTransit: boolean;
  /** Dossier lines this player has learned. Only sent to the owner. */
  dossier?: string[];
}

export interface MessengerView {
  id: string;
  ownerSlot: number | null;
  /** Ambient traffic is labelled honestly; decoys deliberately are not. */
  kind: "DIRECTIVE" | "AMBIENT";
  level: number;
  codename: string;
  candidateCount: number;
  dispatchedAt: number;
  /** Projected arrival if it keeps moving. Meaningless while stalled. */
  arrivesAt: number;
  escorted: boolean;
  /** Progress 0..1 along the route — the client interpolates from this. */
  progress: number;
  /** Total travel time the route requires, for client-side interpolation. */
  transitMs: number;
  /**
   * True when the courier has run out of fuel. It freezes in place — still
   * fully attackable — until its owner pays a booster on-chain. The amount
   * owed is deliberately NOT sent: the bill is unknown even to its owner, who
   * discovers it by paying until the courier moves again.
   */
  stalled: boolean;
  /** Boosters paid so far. Public — it is on-chain anyway. */
  boostCount: number;
  /**
   * bytes32 id needed to call `boost`. Sent only to the courier's owner, since
   * only they may refuel it. Null without a chain, or for anyone else.
   */
  courierIdHex: string | null;
  /** The viewing player's own state on this messenger. */
  me: {
    pool: number[] | null;
    engaged: boolean;
    cooldownUntil: number;
    lockedUntil: number;
    committed: boolean;
  };
  /** How many rivals are currently working this messenger (tension signal). */
  contenders: number;
}

export interface LogEntry {
  id: string;
  at: number;
  kind: "info" | "crack" | "arrive" | "burn" | "buy" | "decoy" | "win";
  slot: number | null;
  text: string;
}

export interface MatchView {
  code: string;
  status: MatchStatus;
  now: number;
  startedAt: number | null;
  endsAt: number | null;
  youSlot: number;
  players: PlayerView[];
  messengers: MessengerView[];
  log: LogEntry[];
  winner: { slot: number; name: string; winType: WinType } | null;
  /** Cost of this player's next dispatch, or null if nothing to dispatch. */
  nextDispatch: { level: number; cost: number; affordable: boolean } | null;
  /** Null when the server runs without a chain, so the UI hides wallet bits. */
  chain: {
    rpcUrl: string;
    chainId: number;
    courierFuelAddress: string;
    unitPriceWei: string;
    maxUnitsPerBoost: number;
    /** The on-chain match id, as 0x-prefixed bytes32. */
    matchIdHex: string;
    /** Null when this match is free to play. */
    tournament: {
      /** Per-player stake, wei of INTEL. */
      stakeWei: string;
      /** Everything staked so far, wei of INTEL. The winner takes all of it. */
      potWei: string;
      tokenAddress: string;
      escrowAddress: string;
      /** The escrow tournament exists on-chain, so stakes can be accepted. */
      ready: boolean;
    } | null;
  } | null;
}

// ───────────────────────────── Minigames ─────────────────────────────────
// The server generates the challenge and scores the submitted inputs. The
// client never reports its own score.

export interface CipherTypeChallenge {
  key: "cipher_type";
  durationMs: number;
  text: string;
}

export interface FrequencyLockChallenge {
  key: "frequency_lock";
  durationMs: number;
  /** Three rounds; band is a [start, end] arc in degrees, sweep in deg/sec. */
  rounds: { bandStart: number; bandEnd: number; sweepDegPerSec: number }[];
}

export interface SignalTraceChallenge {
  key: "signal_trace";
  durationMs: number;
  /** Shown for `flashMs`, then the player reproduces it. */
  sequence: string[];
  options: string[];
  flashMs: number;
}

export type MinigameChallenge =
  | CipherTypeChallenge
  | FrequencyLockChallenge
  | SignalTraceChallenge;

export interface MinigameAssignment {
  token: string;
  messengerId: string;
  challenge: MinigameChallenge;
}

export type MinigameSubmission =
  | { token: string; key: "cipher_type"; typed: string; elapsedMs: number }
  | { token: string; key: "frequency_lock"; hits: boolean[] }
  | { token: string; key: "signal_trace"; answer: string[] };

export interface MinigameResult {
  tier: Tier;
  rawScore: number;
  eliminated: number;
  poolAfter: number;
  messengerId: string;
}

// ───────────────────────── Socket event maps ─────────────────────────────

export interface ServerToClient {
  state: (view: MatchView) => void;
  event: (entry: LogEntry) => void;
  minigame: (assignment: MinigameAssignment) => void;
  minigameResult: (result: MinigameResult) => void;
  commitResult: (r: {
    messengerId: string;
    success: boolean;
    keyIndex: number;
    payout: number;
  }) => void;
  errorMsg: (m: { message: string }) => void;
  kicked: (m: { reason: string }) => void;
}

export interface ClientToServer {
  join: (
    p: { code: string },
    ack: (r: { ok: boolean; error?: string; slot?: number }) => void,
  ) => void;
  ready: (p: { ready: boolean }) => void;
  start: () => void;
  dispatch: () => void;
  decoy: () => void;
  forfeit: () => void;
  buy: (p: { item: ShopItem }) => void;
  attack: (p: { messengerId: string }) => void;
  submit: (p: MinigameSubmission) => void;
  commit: (p: { messengerId: string; keyIndex: number }) => void;
  /** Tells the server which address this player will pay boosters from. */
  linkWallet: (p: { address: string | null }) => void;
  /** "I just staked" — the server confirms it against the chain, never trusts it. */
  checkStake: () => void;
  leave: () => void;
}
