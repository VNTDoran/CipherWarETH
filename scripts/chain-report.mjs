/**
 * What the chain actually recorded, per match. Read-only.
 *
 *   node scripts/chain-report.mjs [rpcUrl]
 *
 * Reads addresses from .env, so run it from the project root.
 */
import fs from "node:fs";
import { Contract, JsonRpcProvider, formatEther } from "ethers";

const env = Object.fromEntries(
  fs
    .readFileSync(".env", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")];
    }),
);
const provider = new JsonRpcProvider(process.argv[2] ?? "http://127.0.0.1:8545");

const escrow = new Contract(
  env.CHAIN_TOURNAMENT_ESCROW_ADDRESS,
  [
    "event TournamentCreated(bytes32 indexed matchId, uint256 stake, uint8 maxPlayers, uint64 settleDeadline)",
    "event PlayerJoined(bytes32 indexed matchId, address indexed player, uint256 stake, uint256 pot)",
    "event TournamentLocked(bytes32 indexed matchId, uint8 playerCount, uint256 pot)",
    "event TournamentSettled(bytes32 indexed matchId, address indexed winner, uint256 payout)",
  ],
  provider,
);
const registry = new Contract(
  env.CHAIN_COMMIT_REVEAL_ADDRESS,
  [
    "event CourierCommitted(bytes32 indexed matchId, bytes32 indexed courierId, bytes32 commitment, uint8 candidateCount, uint64 revealDeadline)",
    "event CourierRevealed(bytes32 indexed matchId, bytes32 indexed courierId, uint8 keyIndex, bytes32 nonce)",
  ],
  provider,
);
const matches = new Contract(
  env.CHAIN_MATCH_REGISTRY_ADDRESS,
  ["event MatchFinalized(bytes32 indexed matchId, address indexed winner, uint8 winnerSlot, uint8 winType, uint32 durationSeconds)"],
  provider,
);

const byMatch = new Map();
const m = (id) => {
  if (!byMatch.has(id)) byMatch.set(id, { block: 0, staked: [], locked: false, settled: null, committed: 0, revealed: 0, finalized: null });
  return byMatch.get(id);
};

for (const e of await escrow.queryFilter("TournamentCreated")) m(e.args.matchId).block = e.blockNumber;
for (const e of await escrow.queryFilter("PlayerJoined")) m(e.args.matchId).staked.push(e.args.player);
for (const e of await escrow.queryFilter("TournamentLocked")) m(e.args.matchId).locked = true;
for (const e of await escrow.queryFilter("TournamentSettled"))
  m(e.args.matchId).settled = `${e.args.winner} +${formatEther(e.args.payout)} INTEL`;
for (const e of await registry.queryFilter("CourierCommitted")) m(e.args.matchId).committed++;
for (const e of await registry.queryFilter("CourierRevealed")) m(e.args.matchId).revealed++;
for (const e of await matches.queryFilter("MatchFinalized"))
  m(e.args.matchId).finalized = `winner ${e.args.winner}, winType ${e.args.winType}, ${e.args.durationSeconds}s`;

const recent = [...byMatch.entries()].sort((a, b) => b[1].block - a[1].block).slice(0, 6);
for (const [id, v] of recent) {
  console.log(`\nmatch ${id.slice(0, 12)}…  (block ${v.block})`);
  console.log(`  staked      : ${v.staked.length}  locked: ${v.locked}`);
  console.log(`  couriers    : ${v.committed} committed, ${v.revealed} revealed${v.committed > v.revealed ? "   <-- UNREVEALED" : ""}`);
  console.log(`  anchored    : ${v.finalized ?? "NO"}`);
  console.log(`  pot paid    : ${v.settled ?? "NO"}`);
}
