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
export type WinType = "OPERATION" | "BLACKOUT" | "TIMEOUT";
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
  arrivesAt: number;
  escorted: boolean;
  /** Progress 0..1 along the route — the client interpolates from this. */
  progress: number;
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
  buy: (p: { item: ShopItem }) => void;
  attack: (p: { messengerId: string }) => void;
  submit: (p: MinigameSubmission) => void;
  commit: (p: { messengerId: string; keyIndex: number }) => void;
  leave: () => void;
}
