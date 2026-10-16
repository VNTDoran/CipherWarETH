/**
 * The game server's wallet.
 *
 * Holds one signer (the `gameServer` address baked into every contract) and
 * exposes the handful of calls the engine needs. Everything here is optional:
 * without `CHAIN_ENABLED` the module reports `enabled === false` and the engine
 * runs exactly as it did before, with couriers that never stall.
 *
 * Writes are deliberately fire-and-forget with logging rather than awaited in
 * the game loop. A 10 Hz tick cannot block on a block confirmation, and a
 * failed anchor must never desync a live match — the chain is the audit trail,
 * not the source of truth for gameplay.
 */

import {
  Contract,
  JsonRpcProvider,
  NonceManager,
  Wallet,
  keccak256,
  solidityPacked,
  toUtf8Bytes,
} from "ethers";
import {
  FUEL_MAX_REQUIRED_UNITS,
  FUEL_MIN_REQUIRED_UNITS,
} from "../../shared/constants.js";

const COMMIT_REVEAL_ABI = [
  "function commitCourier(bytes32 matchId, bytes32 courierId, bytes32 commitment, uint8 candidateCount, uint64 revealWindowSeconds)",
  "function revealCourier(bytes32 matchId, bytes32 courierId, uint8 keyIndex, bytes32 nonce)",
  "function statusOf(bytes32 matchId, bytes32 courierId) view returns (uint8)",
];

const FUEL_ABI = [
  "function registerCourier(bytes32 matchId, bytes32 courierId, address owner, uint32 unitsAtDispatch, uint32 requiredUnits)",
  "function markLanded(bytes32 matchId, bytes32 courierId)",
  "function payBounty(bytes32 matchId, address winner)",
  "function unitsOutstanding(bytes32 matchId, bytes32 courierId) view returns (uint32)",
  "function FUEL_UNIT_PRICE() view returns (uint256)",
  "function MAX_UNITS_PER_BOOST() view returns (uint32)",
  "event CourierBoosted(bytes32 indexed matchId, bytes32 indexed courierId, address indexed payer, uint256 amount, uint32 unitsAdded, uint32 totalUnits, uint32 stillOwed)",
];

const MATCH_REGISTRY_ABI = [
  "function finalizeMatch(bytes32 matchId, uint8 winnerSlot, uint8 winType, uint32 durationSeconds, (address player, uint8 slot, uint8 directivesConfirmed, uint8 cracksMade, uint32 finalIntel)[] results)",
];

export interface BoostEvent {
  matchIdHex: string;
  courierIdHex: string;
  payer: string;
  unitsAdded: number;
  totalUnits: number;
  stillOwed: number;
}

export type BoostListener = (e: BoostEvent) => void;

class ChainClient {
  // Read in init(), not in the constructor: this module is imported by the
  // engine, so its import is hoisted above the .env load in server/index.ts.
  // A constructor that read process.env would always see it empty.
  enabled = false;
  rpcUrl = "http://127.0.0.1:8545";
  chainId = 31337;
  fuelAddress = "";

  private provider?: JsonRpcProvider;
  /** NonceManager keeps a monotonic local counter, which is what a
   *  single-signer server needs; the queue below keeps the order. */
  private wallet?: NonceManager;
  private address = "";
  private commitReveal?: Contract;
  private fuel?: Contract;
  private matchRegistry?: Contract;
  private listeners = new Set<BoostListener>();

  /** Cached on-chain constants, read once at startup. */
  unitPriceWei = "1000000000000000";
  maxUnitsPerBoost = 6;

  /**
   * Every write goes out through this chain of promises.
   *
   * The server signs from a single externally-owned account, and several of
   * its writes are fire-and-forget (reveal, markLanded, payBounty). Letting two
   * of them be built concurrently means both read the same account nonce and
   * the second is rejected with NONCE_EXPIRED — which is exactly what happened
   * the first time a courier tried to anchor. Serialising is the fix; the game
   * loop never waits on it, so the ordering costs nothing.
   */
  private queue: Promise<unknown> = Promise.resolve();

  private enqueue<T>(label: string, op: () => Promise<T>): Promise<T | null> {
    const run = this.queue
      .then(async () => {
        return op();
      })
      .catch((err) => {
        console.error(`[chain] ${label} failed`, err);
        return null;
      });
    // Keep the chain alive even when a link rejects.
    this.queue = run.catch(() => undefined);
    return run as Promise<T | null>;
  }

  async init(): Promise<void> {
    this.enabled = process.env.CHAIN_ENABLED === "true";
    this.rpcUrl = process.env.CHAIN_RPC_URL ?? "http://127.0.0.1:8545";
    this.chainId = Number(process.env.CHAIN_ID ?? 31337);
    this.fuelAddress = process.env.CHAIN_COURIER_FUEL_ADDRESS ?? "";

    if (!this.enabled) {
      console.log("[chain] disabled (set CHAIN_ENABLED=true to anchor matches)");
      return;
    }
    const key = process.env.CHAIN_SERVER_PRIVATE_KEY;
    if (!key || !this.fuelAddress) {
      console.warn("[chain] CHAIN_ENABLED is set but addresses/key are missing — staying off");
      this.enabled = false;
      return;
    }

    try {
      this.provider = new JsonRpcProvider(this.rpcUrl);
      // Events are polled, and the default 4s would leave a player staring at
      // a frozen courier for seconds after they already paid. One second is
      // the slowest this can be without feeling broken.
      this.provider.pollingInterval = 1000;
      const signer = new Wallet(key, this.provider);
      this.address = signer.address;
      this.wallet = new NonceManager(signer);
      this.commitReveal = new Contract(
        process.env.CHAIN_COMMIT_REVEAL_ADDRESS!,
        COMMIT_REVEAL_ABI,
        this.wallet,
      );
      this.fuel = new Contract(this.fuelAddress, FUEL_ABI, this.wallet);
      this.matchRegistry = new Contract(
        process.env.CHAIN_MATCH_REGISTRY_ADDRESS!,
        MATCH_REGISTRY_ABI,
        this.wallet,
      );

      const net = await this.provider.getNetwork();
      this.unitPriceWei = (await this.fuel.FUEL_UNIT_PRICE()).toString();
      this.maxUnitsPerBoost = Number(await this.fuel.MAX_UNITS_PER_BOOST());

      // Players pay boosters from their own wallets, so the only way the game
      // learns about a payment is by watching the chain.
      await this.fuel.on(
        "CourierBoosted",
        (matchId, courierId, payer, _amount, unitsAdded, totalUnits, stillOwed) => {
          const e: BoostEvent = {
            matchIdHex: String(matchId).toLowerCase(),
            courierIdHex: String(courierId).toLowerCase(),
            payer: String(payer),
            unitsAdded: Number(unitsAdded),
            totalUnits: Number(totalUnits),
            stillOwed: Number(stillOwed),
          };
          console.log(
            `[chain] boost received: +${e.unitsAdded} units (total ${e.totalUnits}, ${e.stillOwed} owed)`,
          );
          for (const l of this.listeners) {
            try {
              l(e);
            } catch (err) {
              console.error("[chain] boost listener failed", err);
            }
          }
        },
      );

      console.log(
        `[chain] connected to ${this.rpcUrl} (chainId ${net.chainId}) as ${this.address}`,
      );
    } catch (err) {
      console.error("[chain] init failed, continuing without a chain:", err);
      this.enabled = false;
    }
  }

  onBoost(listener: BoostListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // ───────────────────────────── Derivation ──────────────────────────────

  /** Match/courier ids become bytes32 the same way `ethers.id()` does. */
  idOf(value: string): string {
    return keccak256(toUtf8Bytes(value));
  }

  commitmentOf(matchIdHex: string, courierIdHex: string, keyIndex: number, nonce: string): string {
    return keccak256(
      solidityPacked(
        ["bytes32", "bytes32", "uint8", "bytes32"],
        [matchIdHex, courierIdHex, keyIndex, nonce],
      ),
    );
  }

  /**
   * The hidden fuel bill. Mirrors `CourierFuel.deriveRequiredUnits` exactly —
   * if these two ever disagree the contract rejects the registration, so the
   * packing order here is load-bearing.
   */
  requiredUnitsOf(
    matchIdHex: string,
    courierIdHex: string,
    keyIndex: number,
    nonce: string,
  ): number {
    const h = BigInt(
      keccak256(
        solidityPacked(
          ["string", "bytes32", "bytes32", "uint8", "bytes32"],
          ["FUEL", matchIdHex, courierIdHex, keyIndex, nonce],
        ),
      ),
    );
    const span = BigInt(FUEL_MAX_REQUIRED_UNITS - FUEL_MIN_REQUIRED_UNITS + 1);
    return Number(BigInt(FUEL_MIN_REQUIRED_UNITS) + (h % span));
  }

  // ──────────────────────────────── Writes ───────────────────────────────
  // All of these are serialised through enqueue(). Callers may ignore the
  // result; nothing here ever throws into the game loop.

  async commitCourier(
    matchIdHex: string,
    courierIdHex: string,
    commitment: string,
    candidateCount: number,
    revealWindowSeconds: number,
  ): Promise<boolean> {
    if (!this.enabled || !this.commitReveal) return false;
    const r = await this.enqueue("commitCourier", async () => {
      const tx = await this.commitReveal!.commitCourier(
        matchIdHex,
        courierIdHex,
        commitment,
        candidateCount,
        revealWindowSeconds,
      );
      await tx.wait();
      return true;
    });
    return r === true;
  }

  async registerCourier(
    matchIdHex: string,
    courierIdHex: string,
    owner: string,
    unitsAtDispatch: number,
    requiredUnits: number,
  ): Promise<boolean> {
    if (!this.enabled || !this.fuel) return false;
    const r = await this.enqueue("registerCourier", async () => {
      const tx = await this.fuel!.registerCourier(
        matchIdHex,
        courierIdHex,
        owner,
        unitsAtDispatch,
        requiredUnits,
      );
      await tx.wait();
      return true;
    });
    return r === true;
  }

  revealCourier(matchIdHex: string, courierIdHex: string, keyIndex: number, nonce: string): void {
    if (!this.enabled || !this.commitReveal) return;
    void this.enqueue("revealCourier", async () => {
      const tx = await this.commitReveal!.revealCourier(matchIdHex, courierIdHex, keyIndex, nonce);
      await tx.wait();
    });
  }

  markLanded(matchIdHex: string, courierIdHex: string): void {
    if (!this.enabled || !this.fuel) return;
    void this.enqueue("markLanded", async () => {
      const tx = await this.fuel!.markLanded(matchIdHex, courierIdHex);
      await tx.wait();
    });
  }

  finalizeMatch(
    matchIdHex: string,
    winnerSlot: number,
    winType: number,
    durationSeconds: number,
    results: {
      player: string;
      slot: number;
      directivesConfirmed: number;
      cracksMade: number;
      finalIntel: number;
    }[],
  ): void {
    if (!this.enabled || !this.matchRegistry) return;
    void this.enqueue("finalizeMatch", async () => {
      const tx = await this.matchRegistry!.finalizeMatch(
        matchIdHex,
        winnerSlot,
        winType,
        durationSeconds,
        results,
      );
      await tx.wait();
    });
  }

  payBounty(matchIdHex: string, winner: string): void {
    if (!this.enabled || !this.fuel) return;
    // NothingToPay is normal when no booster was ever bought, so this one is
    // expected to fail sometimes and enqueue() already swallows it.
    void this.enqueue("payBounty", async () => {
      const tx = await this.fuel!.payBounty(matchIdHex, winner);
      await tx.wait();
    });
  }
}

export const chain = new ChainClient();
