/**
 * CIPHER WAR — authoritative match state machine.
 *
 * The server owns every number that matters. Clients send intents ("attack
 * this messenger", "I typed this"), never outcomes. The real key index and
 * every rival's candidate pool are stripped in `viewFor`, so the information
 * a client needs to cheat never reaches it.
 */

import { randomBytes, randomUUID } from "node:crypto";
import {
  AGENCY_CODES,
  AGENCY_META,
  AMBIENT_CANDIDATES,
  AMBIENT_MAX_ALIVE,
  AMBIENT_PAYOUT,
  AMBIENT_SPAWN_MS,
  AMBIENT_TRANSIT_MS,
  ARRIVAL_BONUS,
  ATTACK_COOLDOWN_MS,
  BASE_CANDIDATES,
  BLACKOUT_CRACKS,
  CANDIDATES_PER_LEVEL,
  DECOY_COST,
  DECOY_PENALTY,
  DECOY_REWARD,
  DECOY_TRANSIT_MS,
  DIRECTIVES,
  ELIMINATIONS_BY_TIER,
  ENCRYPT_BONUS_KEYS,
  ENCRYPT_COST,
  ENCRYPT_MAX,
  ESCORT_COST,
  GLYPHS,
  MATCH_HARD_CAP_MS,
  OPERATION_STEPS,
  PASSIVE_INTEL,
  PASSIVE_INTEL_MS,
  REDISPATCH_RATIO,
  SPY_MAX,
  STARTING_INTEL,
  WRONG_COMMIT_COST,
  WRONG_COMMIT_LOCK_MS,
  FUEL_SECONDS_PER_UNIT,
  FUEL_UNITS_AT_DISPATCH,
  spyCost,
} from "../../shared/constants.js";
import type {
  AgencyCode,
  LogEntry,
  MatchStatus,
  MatchView,
  MessengerView,
  MinigameResult,
  MinigameSubmission,
  PlayerView,
  ShopItem,
  Tier,
  WinType,
} from "../../shared/types.js";
import {
  DEFAULT_TUNING,
  type MinigameTuning,
  type PendingMinigame,
  createMinigame,
  scoreMinigame,
} from "./minigames.js";
import { chain } from "../chain/client.js";

export interface DirectiveSpec {
  level: number;
  codename: string;
  dossierLine: string;
  transitMs: number;
  dispatchCost: number;
  crackPayout: number;
}

export interface OperationSpec {
  name: string;
  description: string;
  directives: DirectiveSpec[];
}

interface Player {
  id: string; // MatchPlayer row id, assigned when the match is persisted
  userId: string;
  name: string;
  slot: number;
  agency: AgencyCode;
  operation: OperationSpec;
  intel: number;
  step: number;
  spies: number;
  encrypt: number;
  escorts: number;
  cracksMade: number;
  timesCracked: number;
  decoysBaited: number;
  spent: number;
  connected: boolean;
  ready: boolean;
  inTransit: boolean;
  burned: Set<number>;
  dossier: string[];
  lastPassiveAt: number;
  /** Address this player pays boosters from, linked from the client. */
  wallet: string | null;
}

interface Messenger {
  id: string;
  ownerSlot: number | null;
  kind: "DIRECTIVE" | "DECOY" | "AMBIENT";
  level: number;
  codename: string;
  candidateCount: number;
  realKeyIndex: number;
  glyphs: string[];
  dispatchedAt: number;
  status: "IN_TRANSIT" | "ARRIVED" | "CRACKED";
  escorted: boolean;
  pools: Map<number, Set<number>>;
  cooldowns: Map<number, number>;
  locks: Map<number, number>;
  resolvedAt?: number;
  crackedBySlot?: number;

  // ── Travel, measured in fuel rather than wall clock ───────────────────
  // A courier used to have a fixed `arrivesAt`. With fuel it can freeze, so
  // progress is accumulated only while it is actually moving.
  /** Total travel time the route requires. */
  transitMs: number;
  /** Travel accumulated so far. Stops advancing while stalled. */
  travelledMs: number;
  /** Timestamp of the last tick that advanced (or considered) this courier. */
  lastMoveAt: number;
  /** Units paid for: at dispatch plus every booster. */
  paidUnits: number;
  /**
   * Units this courier demands in total, derived from its secret preimage.
   * Server-only — never serialised, because the bill is meant to be unknown
   * even to the courier's owner.
   */
  requiredUnits: number;
  boostCount: number;
  /** bytes32 id used on-chain, or null when running without a chain. */
  courierIdHex: string | null;
  /** Commit-reveal nonce, held until the courier resolves. */
  nonce: string | null;
  /** True while the on-chain anchor is still confirming; hidden from play. */
  pendingAnchor: boolean;
}

export interface MatchResultPlayer {
  slot: number;
  userId: string;
  finalIntel: number;
  directivesConfirmed: number;
  cracksMade: number;
  timesCracked: number;
  spiesRecruited: number;
  encryptLevel: number;
  decoysBaited: number;
  placement: number;
  isWinner: boolean;
}

const OPERATION_FALLBACK: OperationSpec = {
  name: "UNNAMED OPERATION",
  description: "Directive chain issued under emergency protocol.",
  directives: DIRECTIVES.map((d) => ({
    level: d.level,
    codename: `DIRECTIVE-${d.level}`,
    dossierLine: `Step ${d.level} confirmed by an unnamed handler.`,
    transitMs: d.transitMs,
    dispatchCost: d.dispatchCost,
    crackPayout: d.crackPayout,
  })),
};

function downgrade(tier: Tier): Tier {
  return tier === "GOLD" ? "SILVER" : "BRONZE";
}

export class Match {
  readonly code: string;
  dbId: string | null = null;
  /** bytes32 match id used by every contract. Null without a chain. */
  readonly matchIdHex: string | null;
  hostUserId: string;
  status: MatchStatus = "LOBBY";
  startedAt: number | null = null;
  endsAt: number | null = null;
  winner: { slot: number; name: string; winType: WinType } | null = null;

  private players = new Map<number, Player>();
  private messengers = new Map<string, Messenger>();
  private pending = new Map<string, PendingMinigame>();
  /** One live challenge per player at a time. */
  private activeToken = new Map<number, string>();
  private log: LogEntry[] = [];
  /** Couriers already announced as stalled, so the log says it once. */
  private stalledNotified = new Set<string>();
  private lastAmbientAt = 0;
  private operations: OperationSpec[] = [];
  private tunings: MinigameTuning[] = DEFAULT_TUNING;
  /** Set by the room when persistence finishes, so we can attach row ids. */
  onFinish?: (m: Match) => void;

  constructor(code: string, hostUserId: string) {
    this.code = code;
    this.hostUserId = hostUserId;
    this.matchIdHex = chain.enabled ? chain.idOf(`CIPHERWAR:${code}`) : null;
  }

  configure(operations: OperationSpec[], tunings: MinigameTuning[]) {
    if (operations.length) this.operations = operations;
    if (tunings.length) this.tunings = tunings;
  }

  // ───────────────────────────── Lobby ─────────────────────────────────

  get playerList(): Player[] {
    return [...this.players.values()].sort((a, b) => a.slot - b.slot);
  }

  get isFull(): boolean {
    return this.players.size >= 4;
  }

  findByUser(userId: string): Player | undefined {
    return this.playerList.find((p) => p.userId === userId);
  }

  addPlayer(userId: string, name: string): Player | null {
    const existing = this.findByUser(userId);
    if (existing) {
      existing.connected = true;
      return existing;
    }
    if (this.status !== "LOBBY" || this.isFull) return null;

    const taken = new Set(this.playerList.map((p) => p.slot));
    let slot = 0;
    while (taken.has(slot)) slot++;

    const player: Player = {
      id: "",
      userId,
      name,
      slot,
      agency: AGENCY_CODES[slot] as AgencyCode,
      operation: OPERATION_FALLBACK,
      intel: STARTING_INTEL,
      step: 0,
      spies: 0,
      encrypt: 0,
      escorts: 0,
      cracksMade: 0,
      timesCracked: 0,
      decoysBaited: 0,
      spent: 0,
      connected: true,
      ready: false,
      inTransit: false,
      burned: new Set(),
      dossier: [],
      lastPassiveAt: Date.now(),
      wallet: null,
    };
    this.players.set(slot, player);
    this.pushLog("info", slot, `${name} joined as ${AGENCY_META[player.agency].name}.`);
    return player;
  }

  setConnected(userId: string, connected: boolean) {
    const p = this.findByUser(userId);
    if (!p) return;
    p.connected = connected;
    if (!connected && this.status === "LOBBY") {
      this.players.delete(p.slot);
      this.pushLog("info", null, `${p.name} left the lobby.`);
    }
  }

  setReady(userId: string, ready: boolean) {
    const p = this.findByUser(userId);
    if (p) p.ready = ready;
  }

  canStart(userId: string): string | null {
    if (userId !== this.hostUserId) return "Only the host can start the match.";
    if (this.status !== "LOBBY") return "Match already started.";
    if (this.players.size < 2) return "Need at least 2 agencies.";
    if (this.playerList.some((p) => !p.ready && p.userId !== this.hostUserId))
      return "All agencies must be ready.";
    return null;
  }

  start() {
    const now = Date.now();
    this.status = "ACTIVE";
    this.startedAt = now;
    this.endsAt = now + MATCH_HARD_CAP_MS;
    this.lastAmbientAt = now;

    // Deal a distinct operation to each agency where possible.
    const deck = [...this.operations].sort(() => Math.random() - 0.5);
    this.playerList.forEach((p, i) => {
      p.operation = deck[i % Math.max(1, deck.length)] ?? OPERATION_FALLBACK;
      p.lastPassiveAt = now;
    });
    this.pushLog("info", null, "Transmissions open. All agencies are live.");
  }

  // ─────────────────────────── Player actions ──────────────────────────

  dispatch(userId: string): string | null {
    const p = this.requireActive(userId);
    if (typeof p === "string") return p;
    if (p.inTransit) return "A directive is already in the ether.";
    if (p.step >= OPERATION_STEPS) return "Operation already complete.";

    const level = p.step + 1;
    const spec = p.operation.directives.find((d) => d.level === level);
    if (!spec) return "No directive available.";

    const burned = p.burned.has(level);
    const cost = burned
      ? Math.round(spec.dispatchCost * REDISPATCH_RATIO)
      : spec.dispatchCost;
    if (p.intel < cost) return `Need ${cost} intel to dispatch.`;

    p.intel -= cost;
    p.spent += cost;
    p.inTransit = true;

    const escorted = p.escorts > 0;
    if (escorted) p.escorts -= 1;

    this.spawnMessenger({
      ownerSlot: p.slot,
      kind: "DIRECTIVE",
      level,
      codename: spec.codename,
      candidateCount: this.candidatesFor(p, level),
      transitMs: spec.transitMs,
      escorted,
    });

    this.pushLog(
      "info",
      p.slot,
      `${AGENCY_META[p.agency].name} dispatched ${spec.codename}${escorted ? " under escort" : ""}.`,
    );
    return null;
  }

  decoy(userId: string): string | null {
    const p = this.requireActive(userId);
    if (typeof p === "string") return p;
    if (p.intel < DECOY_COST) return `Need ${DECOY_COST} intel for a decoy.`;

    p.intel -= DECOY_COST;
    p.spent += DECOY_COST;

    // Wears the level it *would* have been, so rivals can't tell it apart.
    const level = Math.min(OPERATION_STEPS, p.step + 1);
    const spec = p.operation.directives.find((d) => d.level === level);

    this.spawnMessenger({
      ownerSlot: p.slot,
      kind: "DECOY",
      level,
      codename: spec?.codename ?? `DIRECTIVE-${level}`,
      candidateCount: this.candidatesFor(p, level),
      transitMs: DECOY_TRANSIT_MS,
      escorted: false,
    });
    this.pushLog("decoy", p.slot, `${AGENCY_META[p.agency].name} opened a second channel.`);
    return null;
  }

  buy(userId: string, item: ShopItem): string | null {
    const p = this.requireActive(userId);
    if (typeof p === "string") return p;

    if (item === "SPY") {
      const cost = spyCost(p.spies);
      if (cost === null) return `Spy network is at capacity (${SPY_MAX}).`;
      if (p.intel < cost) return `Need ${cost} intel to recruit.`;
      p.intel -= cost;
      p.spent += cost;
      p.spies += 1;
      this.pushLog("buy", p.slot, `${AGENCY_META[p.agency].name} recruited a spy (${p.spies}/${SPY_MAX}).`);
      return null;
    }

    if (item === "ENCRYPT") {
      if (p.encrypt >= ENCRYPT_MAX) return "Encryption already maxed.";
      if (p.intel < ENCRYPT_COST) return `Need ${ENCRYPT_COST} intel.`;
      p.intel -= ENCRYPT_COST;
      p.spent += ENCRYPT_COST;
      p.encrypt += 1;
      this.pushLog("buy", p.slot, `${AGENCY_META[p.agency].name} rotated its cipher (L${p.encrypt}).`);
      return null;
    }

    if (item === "ESCORT") {
      if (p.intel < ESCORT_COST) return `Need ${ESCORT_COST} intel.`;
      p.intel -= ESCORT_COST;
      p.spent += ESCORT_COST;
      p.escorts += 1;
      this.pushLog("buy", p.slot, `${AGENCY_META[p.agency].name} assigned an escort.`);
      return null;
    }
    return "Unknown item.";
  }

  /** Opens an attack: validates, seeds the candidate pool, issues a minigame. */
  attack(userId: string, messengerId: string): PendingMinigame | string {
    const p = this.requireActive(userId);
    if (typeof p === "string") return p;

    const m = this.messengers.get(messengerId);
    if (!m || m.status !== "IN_TRANSIT") return "That messenger is gone.";
    if (m.ownerSlot === p.slot) return "You cannot attack your own courier.";

    this.expireStaleChallenge(p.slot);
    if (this.activeToken.has(p.slot)) return "Finish your current intercept first.";

    const now = Date.now();
    const locked = m.locks.get(p.slot) ?? 0;
    if (locked > now) return `Locked out for ${Math.ceil((locked - now) / 1000)}s.`;
    const cd = m.cooldowns.get(p.slot) ?? 0;
    if (cd > now) return `Cooling down for ${Math.ceil((cd - now) / 1000)}s.`;

    if (!m.pools.has(p.slot)) {
      const pool = new Set<number>(
        Array.from({ length: m.candidateCount }, (_, i) => i),
      );
      // Spies are passive key-stealers: they pre-eliminate on engagement.
      this.eliminate(m, pool, p.spies);
      m.pools.set(p.slot, pool);
    }

    const challenge = createMinigame(p.slot, m.id, this.tunings);
    this.pending.set(challenge.token, challenge);
    this.activeToken.set(p.slot, challenge.token);
    return challenge;
  }

  submit(
    userId: string,
    submission: MinigameSubmission,
  ): MinigameResult | string {
    const p = this.requireActive(userId);
    if (typeof p === "string") return p;

    const pendingGame = this.pending.get(submission.token);
    if (!pendingGame || pendingGame.slot !== p.slot) return "No active intercept.";
    this.pending.delete(submission.token);
    this.activeToken.delete(p.slot);

    const m = this.messengers.get(pendingGame.messengerId);
    if (!m || m.status !== "IN_TRANSIT") return "That messenger is gone.";

    const { rawScore, tier: rawTier } = scoreMinigame(pendingGame, submission);
    const tier = m.escorted ? downgrade(rawTier) : rawTier;
    const wanted = ELIMINATIONS_BY_TIER[tier];

    const pool = m.pools.get(p.slot) ?? new Set<number>();
    const eliminated = this.eliminate(m, pool, wanted);
    m.pools.set(p.slot, pool);
    m.cooldowns.set(p.slot, Date.now() + ATTACK_COOLDOWN_MS);

    return {
      tier,
      rawScore,
      eliminated,
      poolAfter: pool.size,
      messengerId: m.id,
    };
  }

  commit(userId: string, messengerId: string, keyIndex: number) {
    const p = this.requireActive(userId);
    if (typeof p === "string") return { error: p };

    const m = this.messengers.get(messengerId);
    if (!m || m.status !== "IN_TRANSIT") return { error: "That messenger is gone." };
    if (m.ownerSlot === p.slot) return { error: "That is your own courier." };

    const now = Date.now();
    if ((m.locks.get(p.slot) ?? 0) > now) return { error: "You are locked out." };

    const pool = m.pools.get(p.slot);
    if (!pool || !pool.has(keyIndex)) return { error: "That key is not in your set." };

    if (keyIndex !== m.realKeyIndex) {
      p.intel = Math.max(0, p.intel - WRONG_COMMIT_COST);
      m.locks.set(p.slot, now + WRONG_COMMIT_LOCK_MS);
      pool.delete(keyIndex); // a failed try is still information
      return { success: false, keyIndex, payout: -WRONG_COMMIT_COST };
    }

    return { success: true, keyIndex, payout: this.resolveCrack(m, p) };
  }

  /**
   * Opens the envelope on-chain once a courier is resolved, whichever way it
   * went. Fire-and-forget: the match has already moved on, and the contract
   * rejects a mismatching preimage anyway, so there is nothing to await.
   */
  private revealOnChain(m: Messenger): void {
    if (!chain.enabled || !this.matchIdHex || !m.courierIdHex || m.nonce === null) return;
    chain.revealCourier(this.matchIdHex, m.courierIdHex, m.realKeyIndex, m.nonce);
    chain.markLanded(this.matchIdHex, m.courierIdHex);
  }

  /** Links the wallet a player will pay boosters from. */
  setWallet(userId: string, address: string | null): void {
    const p = this.findByUser(userId);
    if (p) p.wallet = address;
  }

  /**
   * A booster landed on-chain. Credits the fuel and unfreezes the courier.
   *
   * Driven by the contract event rather than by the client, so a player cannot
   * claim fuel they did not pay for — the money has to have actually moved.
   */
  applyBoost(courierIdHex: string, totalUnits: number): boolean {
    const target = [...this.messengers.values()].find(
      (m) => m.courierIdHex?.toLowerCase() === courierIdHex.toLowerCase(),
    );
    if (!target || target.status !== "IN_TRANSIT") return false;

    target.paidUnits = totalUnits;
    target.boostCount += 1;
    this.stalledNotified.delete(target.id);
    // Resume from now, so time spent stalled is not retroactively credited.
    target.lastMoveAt = Date.now();

    const owner = target.ownerSlot === null ? null : this.players.get(target.ownerSlot);
    this.pushLog(
      "buy",
      target.ownerSlot,
      `${owner ? AGENCY_META[owner.agency].name : "An agency"} refuelled ${target.codename}.`,
    );
    return true;
  }

  // ────────────────────────────── Tick ─────────────────────────────────

  tick(): boolean {
    if (this.status !== "ACTIVE") return false;
    const now = Date.now();
    let changed = false;

    // Advance each courier by the time it actually spent moving. A courier
    // whose fuel has run out burns no distance at all — it sits frozen in the
    // ether, still attackable, until a booster lands.
    for (const m of this.messengers.values()) {
      if (m.status !== "IN_TRANSIT") continue;

      const dt = Math.max(0, now - m.lastMoveAt);
      m.lastMoveAt = now;

      // Still waiting for its on-chain anchor: not in play yet, cannot move.
      if (m.pendingAnchor) continue;

      const fuelMs = m.paidUnits >= Number.MAX_SAFE_INTEGER
        ? Number.MAX_SAFE_INTEGER
        : m.paidUnits * FUEL_SECONDS_PER_UNIT * 1000;

      if (m.travelledMs >= fuelMs) {
        // Out of fuel. Frozen, but the attack clock keeps running for rivals.
        if (!this.stalledNotified.has(m.id)) {
          this.stalledNotified.add(m.id);
          const owner = m.ownerSlot === null ? null : this.players.get(m.ownerSlot);
          if (owner) {
            this.pushLog("info", m.ownerSlot, `${m.codename} has run out of fuel.`);
          }
          changed = true;
        }
        continue;
      }

      // Never travel further than the fuel paid for in this step.
      m.travelledMs = Math.min(m.travelledMs + dt, fuelMs);

      if (m.travelledMs >= m.transitMs) {
        this.resolveArrival(m);
        changed = true;
      }
    }

    // Retire resolved messengers after a short beat so the UI can animate.
    for (const [id, m] of this.messengers) {
      if (m.status !== "IN_TRANSIT" && m.resolvedAt && now - m.resolvedAt > 3500) {
        this.messengers.delete(id);
        changed = true;
      }
    }

    for (const p of this.players.values()) {
      while (now - p.lastPassiveAt >= PASSIVE_INTEL_MS) {
        p.intel += PASSIVE_INTEL;
        p.lastPassiveAt += PASSIVE_INTEL_MS;
        changed = true;
      }
    }

    const ambientAlive = [...this.messengers.values()].filter(
      (m) => m.kind === "AMBIENT" && m.status === "IN_TRANSIT",
    ).length;
    if (now - this.lastAmbientAt >= AMBIENT_SPAWN_MS && ambientAlive < AMBIENT_MAX_ALIVE) {
      this.lastAmbientAt = now;
      this.spawnMessenger({
        ownerSlot: null,
        kind: "AMBIENT",
        level: 0,
        codename: "TRAFIC",
        candidateCount: AMBIENT_CANDIDATES,
        transitMs: AMBIENT_TRANSIT_MS,
        escorted: false,
      });
      changed = true;
    }

    if (this.endsAt && now >= this.endsAt && !this.winner) {
      this.finishByTimeout();
      changed = true;
    }

    return changed;
  }

  // ───────────────────────────── Internals ─────────────────────────────

  /**
   * A player who opens an intercept and never submits — closed the tab, lost
   * the connection, watched the courier land mid-game — would otherwise hold
   * their one challenge slot forever and never be able to attack again.
   */
  private expireStaleChallenge(slot: number) {
    const token = this.activeToken.get(slot);
    if (!token) return;
    const game = this.pending.get(token);
    if (!game) {
      this.activeToken.delete(slot);
      return;
    }
    if (Date.now() - game.issuedAt > game.tuning.durationMs + 5_000) {
      this.pending.delete(token);
      this.activeToken.delete(slot);
    }
  }

  /**
   * Key-space size for one courier. Later directives are both slower *and*
   * fatter, so the endgame is a gauntlet rather than a formality. The owner's
   * encryption purchases stack on top of that.
   */
  private candidatesFor(p: Player, level: number): number {
    return (
      BASE_CANDIDATES +
      Math.max(0, level - 1) * CANDIDATES_PER_LEVEL +
      p.encrypt * ENCRYPT_BONUS_KEYS
    );
  }

  private requireActive(userId: string): Player | string {
    if (this.status !== "ACTIVE") return "Match is not running.";
    const p = this.findByUser(userId);
    if (!p) return "You are not in this match.";
    return p;
  }

  /**
   * Removes up to `count` candidates, never the real key — so a pool of size 1
   * always *is* the answer, and the race is deterministic in its endpoint.
   */
  private eliminate(m: Messenger, pool: Set<number>, count: number): number {
    const fakes = [...pool].filter((i) => i !== m.realKeyIndex);
    let removed = 0;
    for (let i = 0; i < count && fakes.length; i++) {
      const at = Math.floor(Math.random() * fakes.length);
      pool.delete(fakes[at]);
      fakes.splice(at, 1);
      removed++;
    }
    return removed;
  }

  private spawnMessenger(opts: {
    ownerSlot: number | null;
    kind: "DIRECTIVE" | "DECOY" | "AMBIENT";
    level: number;
    codename: string;
    candidateCount: number;
    transitMs: number;
    escorted: boolean;
  }) {
    const now = Date.now();
    const count = opts.candidateCount;
    const m: Messenger = {
      id: randomUUID(),
      ownerSlot: opts.ownerSlot,
      kind: opts.kind,
      level: opts.level,
      codename: opts.codename,
      candidateCount: count,
      realKeyIndex: Math.floor(Math.random() * count),
      glyphs: Array.from(
        { length: count },
        (_, i) => GLYPHS[(i + Math.floor(Math.random() * GLYPHS.length)) % GLYPHS.length],
      ),
      dispatchedAt: now,
      status: "IN_TRANSIT",
      escorted: opts.escorted,
      pools: new Map(),
      cooldowns: new Map(),
      locks: new Map(),
      transitMs: opts.transitMs,
      travelledMs: 0,
      lastMoveAt: now,
      // Without a chain the courier carries fuel for the whole trip, so it
      // never stalls and the original game is untouched.
      paidUnits: chain.enabled ? FUEL_UNITS_AT_DISPATCH : Number.MAX_SAFE_INTEGER,
      requiredUnits: 0,
      boostCount: 0,
      courierIdHex: null,
      nonce: null,
      pendingAnchor: false,
    };

    // Ambient traffic and decoys are not anchored: they carry no directive, so
    // there is nothing to prove and no reason to spend gas on them.
    if (chain.enabled && this.matchIdHex && opts.kind === "DIRECTIVE" && opts.ownerSlot !== null) {
      this.anchorCourier(m, opts.ownerSlot);
    } else if (chain.enabled) {
      m.paidUnits = Number.MAX_SAFE_INTEGER;
    }

    this.messengers.set(m.id, m);
  }

  /**
   * Publishes the commitment and the fuel bill, then releases the courier.
   *
   * The commitment MUST land before the courier can be attacked, otherwise the
   * server would keep a window in which to pick the key after the fact — which
   * would void the whole guarantee. So the courier is held back until both
   * transactions confirm, and dropped entirely if either fails.
   */
  private anchorCourier(m: Messenger, ownerSlot: number) {
    const owner = this.players.get(ownerSlot);
    const wallet = owner?.wallet;
    if (!owner || !wallet) {
      // No wallet linked: fall back to unlimited fuel rather than stranding a
      // courier nobody can refuel.
      m.paidUnits = Number.MAX_SAFE_INTEGER;
      return;
    }

    const courierIdHex = chain.idOf(`${this.code}:${m.id}`);
    const nonce = `0x${randomBytes(32).toString("hex")}`;
    const required = chain.requiredUnitsOf(
      this.matchIdHex!,
      courierIdHex,
      m.realKeyIndex,
      nonce,
    );

    m.courierIdHex = courierIdHex;
    m.nonce = nonce;
    m.requiredUnits = required;
    m.status = "IN_TRANSIT";
    // Held out of play until the anchor confirms.
    m.pendingAnchor = true;

    const commitment = chain.commitmentOf(this.matchIdHex!, courierIdHex, m.realKeyIndex, nonce);
    const windowSeconds = Math.ceil(m.transitMs / 1000) + 600;

    void (async () => {
      const committed = await chain.commitCourier(
        this.matchIdHex!,
        courierIdHex,
        commitment,
        m.candidateCount,
        windowSeconds,
      );
      const registered = committed
        ? await chain.registerCourier(
            this.matchIdHex!,
            courierIdHex,
            wallet,
            FUEL_UNITS_AT_DISPATCH,
            required,
          )
        : false;

      if (!committed || !registered) {
        this.messengers.delete(m.id);
        if (m.kind === "DIRECTIVE") owner.inTransit = false;
        this.pushLog("info", ownerSlot, `${m.codename} could not be anchored on-chain — dispatch cancelled.`);
        return;
      }
      m.pendingAnchor = false;
      m.lastMoveAt = Date.now();
      this.pushLog(
        "info",
        ownerSlot,
        `${m.codename} anchored on-chain with ${FUEL_UNITS_AT_DISPATCH} fuel units.`,
      );
    })();
  }

  private resolveCrack(m: Messenger, cracker: Player): number {
    m.status = "CRACKED";
    m.resolvedAt = Date.now();
    m.crackedBySlot = cracker.slot;
    this.revealOnChain(m);

    if (m.kind === "AMBIENT") {
      cracker.intel += AMBIENT_PAYOUT;
      this.pushLog("crack", cracker.slot, `${cracker.name} skimmed routine traffic (+${AMBIENT_PAYOUT}).`);
      return AMBIENT_PAYOUT;
    }

    const owner = m.ownerSlot !== null ? this.players.get(m.ownerSlot) : undefined;

    if (m.kind === "DECOY") {
      // Taking the bait is the punishment for attacking on reflex.
      cracker.intel = Math.max(0, cracker.intel - DECOY_PENALTY);
      cracker.dossier.push(`[CORRUPTED] ${m.codename} — contents were forged.`);
      if (owner) {
        owner.intel += DECOY_REWARD;
        owner.decoysBaited += 1;
      }
      this.pushLog(
        "decoy",
        cracker.slot,
        `${cracker.name} cracked a decoy and lost ${DECOY_PENALTY} intel.`,
      );
      return -DECOY_PENALTY;
    }

    // Real directive: it burns.
    const spec = owner?.operation.directives.find((d) => d.level === m.level);
    const payout = spec?.crackPayout ?? 30 + 25 * m.level;
    cracker.intel += payout;
    cracker.cracksMade += 1;
    if (owner) {
      owner.timesCracked += 1;
      owner.inTransit = false;
      owner.burned.add(m.level);
      cracker.dossier.push(`${owner.operation.name} · ${spec?.dossierLine ?? m.codename}`);
      this.pushLog(
        "burn",
        cracker.slot,
        `${cracker.name} cracked ${m.codename} — ${AGENCY_META[owner.agency].name} loses step ${m.level} (+${payout}).`,
      );
    }

    if (cracker.cracksMade >= BLACKOUT_CRACKS) {
      this.declareWinner(cracker, "BLACKOUT");
    }
    return payout;
  }

  private resolveArrival(m: Messenger) {
    m.status = "ARRIVED";
    m.resolvedAt = Date.now();
    this.revealOnChain(m);
    if (m.ownerSlot === null) return;
    const owner = this.players.get(m.ownerSlot);
    if (!owner) return;

    if (m.kind === "DECOY") return; // an untaken bluff is simply spent intel

    owner.inTransit = false;
    owner.step += 1;
    owner.burned.delete(m.level);
    owner.intel += ARRIVAL_BONUS;
    this.pushLog(
      "arrive",
      owner.slot,
      `${m.codename} reached ${AGENCY_META[owner.agency].country}. Step ${owner.step}/${OPERATION_STEPS}.`,
    );

    if (owner.step >= OPERATION_STEPS) this.declareWinner(owner, "OPERATION");
  }

  private declareWinner(p: Player, winType: WinType) {
    if (this.winner) return;
    this.winner = { slot: p.slot, name: p.name, winType };
    this.status = "FINISHED";
    this.endsAt = Date.now();
    this.pushLog(
      "win",
      p.slot,
      winType === "BLACKOUT"
        ? `BLACKOUT — ${p.name} exposed the network.`
        : `${p.name} completed ${p.operation.name}.`,
    );
    this.onFinish?.(this);
  }

  private finishByTimeout() {
    // Deterministic tiebreak: steps -> cracks -> intel.
    const ranked = [...this.playerList].sort(
      (a, b) =>
        b.step - a.step || b.cracksMade - a.cracksMade || b.intel - a.intel,
    );
    const top = ranked[0];
    if (top) {
      this.winner = { slot: top.slot, name: top.name, winType: "TIMEOUT" };
      this.pushLog("win", top.slot, `Time expired — ${top.name} leads the board.`);
    }
    this.status = "FINISHED";
    this.onFinish?.(this);
  }

  private pushLog(kind: LogEntry["kind"], slot: number | null, text: string) {
    this.log.push({ id: randomUUID(), at: Date.now(), kind, slot, text });
    if (this.log.length > 60) this.log.splice(0, this.log.length - 60);
  }

  // ─────────────────────────── Serialisation ───────────────────────────

  results(): MatchResultPlayer[] {
    const ranked = [...this.playerList].sort(
      (a, b) =>
        b.step - a.step || b.cracksMade - a.cracksMade || b.intel - a.intel,
    );
    return ranked.map((p, i) => ({
      slot: p.slot,
      userId: p.userId,
      finalIntel: p.intel,
      directivesConfirmed: p.step,
      cracksMade: p.cracksMade,
      timesCracked: p.timesCracked,
      spiesRecruited: p.spies,
      encryptLevel: p.encrypt,
      decoysBaited: p.decoysBaited,
      placement: i + 1,
      isWinner: this.winner?.slot === p.slot,
    }));
  }

  viewFor(userId: string): MatchView {
    const me = this.findByUser(userId);
    const mySlot = me?.slot ?? -1;
    const now = Date.now();

    const players: PlayerView[] = this.playerList.map((p) => ({
      id: p.id,
      userId: p.userId,
      name: p.name,
      slot: p.slot,
      agency: p.agency,
      // An operation's name is public; its contents are not.
      operationName: p.operation.name,
      intel: p.slot === mySlot ? p.intel : Math.round(p.intel / 5) * 5,
      step: p.step,
      spies: p.spies,
      encrypt: p.encrypt,
      escorts: p.slot === mySlot ? p.escorts : 0,
      cracksMade: p.cracksMade,
      timesCracked: p.timesCracked,
      connected: p.connected,
      ready: p.ready,
      isHost: p.userId === this.hostUserId,
      inTransit: p.inTransit,
      dossier: p.slot === mySlot ? p.dossier : undefined,
    }));

    const messengers: MessengerView[] = [...this.messengers.values()]
      // A courier whose anchor has not confirmed is not in play yet.
      .filter((m) => !m.pendingAnchor)
      .filter((m) => m.status === "IN_TRANSIT" || (m.resolvedAt ?? 0) > now - 3500)
      .map((m) => {
        const pool = m.pools.get(mySlot);
        const isMine = m.ownerSlot === mySlot;
        const fuelMs = m.paidUnits >= Number.MAX_SAFE_INTEGER
          ? Number.MAX_SAFE_INTEGER
          : m.paidUnits * FUEL_SECONDS_PER_UNIT * 1000;
        const stalled = m.status === "IN_TRANSIT" && m.travelledMs >= fuelMs;
        const remainingMs = Math.max(0, m.transitMs - m.travelledMs);
        return {
          id: m.id,
          ownerSlot: m.ownerSlot,
          // Decoys masquerade as directives to everyone but their owner.
          kind: m.kind === "AMBIENT" ? "AMBIENT" : "DIRECTIVE",
          level: m.level,
          codename: isMine && m.kind === "DECOY" ? "LEURRE" : m.codename,
          candidateCount: m.candidateCount,
          dispatchedAt: m.dispatchedAt,
          // Projected, not fixed: a stall pushes it back indefinitely.
          arrivesAt: now + remainingMs,
          escorted: m.escorted,
          progress: Math.min(1, Math.max(0, m.travelledMs / Math.max(1, m.transitMs))),
          transitMs: m.transitMs,
          stalled,
          boostCount: m.boostCount,
          // Only the owner can refuel, so only the owner needs the handle.
          courierIdHex: isMine ? m.courierIdHex : null,
          me: {
            pool: pool ? [...pool].sort((a, b) => a - b) : null,
            engaged: !!pool,
            cooldownUntil: m.cooldowns.get(mySlot) ?? 0,
            lockedUntil: m.locks.get(mySlot) ?? 0,
            committed: m.status === "CRACKED" && m.crackedBySlot === mySlot,
          },
          contenders: [...m.pools.keys()].filter((s) => s !== mySlot).length,
        } satisfies MessengerView;
      });

    let nextDispatch: MatchView["nextDispatch"] = null;
    if (me && me.step < OPERATION_STEPS) {
      const level = me.step + 1;
      const spec = me.operation.directives.find((d) => d.level === level);
      const base = spec?.dispatchCost ?? DIRECTIVES[level - 1].dispatchCost;
      const cost = me.burned.has(level) ? Math.round(base * REDISPATCH_RATIO) : base;
      nextDispatch = { level, cost, affordable: me.intel >= cost && !me.inTransit };
    }

    return {
      code: this.code,
      status: this.status,
      now,
      startedAt: this.startedAt,
      endsAt: this.endsAt,
      youSlot: mySlot,
      players,
      messengers,
      // Only the recent tail goes over the wire. The client accumulates by
      // entry id, so resending 24 lines of text 3x a second is pure waste —
      // that was ~60% of every snapshot.
      log: this.log.slice(-6),
      winner: this.winner,
      nextDispatch,
      chain:
        chain.enabled && this.matchIdHex
          ? {
              rpcUrl: chain.rpcUrl,
              chainId: chain.chainId,
              courierFuelAddress: chain.fuelAddress,
              unitPriceWei: chain.unitPriceWei,
              maxUnitsPerBoost: chain.maxUnitsPerBoost,
              matchIdHex: this.matchIdHex,
            }
          : null,
    };
  }

  /** Attach persisted MatchPlayer row ids after the match is written. */
  bindRowIds(map: Record<string, string>) {
    for (const p of this.players.values()) {
      if (map[p.userId]) p.id = map[p.userId];
    }
  }
}
