/**
 * End-to-end test of the chain integration against a running game server.
 *
 *   BASE=http://localhost:3100 node scripts/chain-playtest.mjs
 *
 * Requires: `npx hardhat node` + a deploy, and the game started with the
 * CHAIN_* variables set. Drives the full loop — dispatch anchors on-chain, the
 * courier runs dry and freezes, a booster paid from the player's own key
 * unfreezes it, and the preimage is revealed when it resolves.
 */
import { io } from "socket.io-client";
import { Contract, JsonRpcProvider, Wallet } from "ethers";

const BASE = process.env.BASE ?? "http://localhost:3100";
const RPC = process.env.CHAIN_RPC_URL ?? "http://127.0.0.1:8545";

// Hardhat accounts #1 and #2 — the players.
const PLAYER_KEYS = [
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
];

const FUEL_ABI = [
  "function boost(bytes32 matchId, bytes32 courierId) payable",
  "function quote(uint32 units) view returns (uint256)",
  "function unitsOutstanding(bytes32 matchId, bytes32 courierId) view returns (uint32)",
  "function getCourier(bytes32 matchId, bytes32 courierId) view returns (tuple(address owner, uint32 unitsAtDispatch, uint32 unitsBoosted, uint32 requiredUnits, uint32 boostCount, bool registered, bool landed))",
];
const CR_ABI = ["function statusOf(bytes32 matchId, bytes32 courierId) view returns (uint8)"];

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const STATUS = ["Inconnu", "Engagé", "Révélé et prouvé", "Défaillant"];

async function login(username) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password: "cipher123" }),
  });
  if (!res.ok) throw new Error(`login ${username} failed (${res.status})`);
  const raw = res.headers.getSetCookie?.() ?? [res.headers.get("set-cookie")];
  return raw.map((c) => c.split(";")[0]).join("; ");
}

function connect(cookie) {
  return new Promise((resolve, reject) => {
    const s = io(BASE, { path: "/api/socket", transports: ["websocket"], extraHeaders: { Cookie: cookie } });
    s.on("connect", () => resolve(s));
    s.on("connect_error", reject);
  });
}

async function main() {
  const provider = new JsonRpcProvider(RPC);
  const wallets = PLAYER_KEYS.map((k) => new Wallet(k, provider));

  const [cA, cB] = await Promise.all([login("nord"), login("est")]);
  const { code } = await fetch(`${BASE}/api/match/create`, {
    method: "POST",
    headers: { Cookie: cA },
  }).then((r) => r.json());
  console.log(`match ${code}`);

  const [a, b] = await Promise.all([connect(cA), connect(cB)]);
  let sa = null;
  let sb = null;
  a.on("state", (v) => (sa = v));
  b.on("state", (v) => (sb = v));
  a.on("errorMsg", (m) => console.log("  [A]", m.message));
  b.on("errorMsg", (m) => console.log("  [B]", m.message));

  await new Promise((r) => a.emit("join", { code }, r));
  await new Promise((r) => b.emit("join", { code }, r));

  // Link the wallets players will pay boosters from.
  a.emit("linkWallet", { address: wallets[0].address });
  b.emit("linkWallet", { address: wallets[1].address });
  await wait(400);

  b.emit("ready", { ready: true });
  await wait(300);
  a.emit("start");
  await wait(600);

  if (sa?.status !== "ACTIVE") throw new Error("match did not start");
  if (!sa.chain) throw new Error("server reports no chain — are the CHAIN_* vars set?");
  console.log(`chain actif · matchIdHex ${sa.chain.matchIdHex.slice(0, 18)}…`);
  console.log(`fuel contract ${sa.chain.courierFuelAddress}\n`);

  const fuel = new Contract(sa.chain.courierFuelAddress, FUEL_ABI, wallets[0]);
  const registry = new Contract(
    process.env.CHAIN_COMMIT_REVEAL_ADDRESS ?? sa.chain.courierFuelAddress,
    CR_ABI,
    provider,
  );

  // ── Dispatch: must anchor before the courier appears in play ───────────
  console.log("1) A dispatche — attente de l'ancrage on-chain…");
  a.emit("dispatch");
  let courier = null;
  for (let i = 0; i < 40 && !courier; i++) {
    await wait(500);
    courier = sa.messengers.find((m) => m.ownerSlot === 0 && m.kind === "DIRECTIVE");
  }
  if (!courier) throw new Error("courier never appeared — anchoring failed");
  console.log(`   ${courier.codename} en vol, courierIdHex ${courier.courierIdHex?.slice(0, 18)}…`);

  const onChain = await fuel.getCourier(sa.chain.matchIdHex, courier.courierIdHex);
  console.log(`   on-chain : ${onChain.unitsAtDispatch} au départ, facture ${onChain.requiredUnits}`);
  console.log(`   (le joueur ne voit PAS la facture dans l'état du jeu)\n`);

  // ── Stall ─────────────────────────────────────────────────────────────
  console.log("2) Attente de la panne sèche…");
  let stalledAt = null;
  for (let i = 0; i < 60; i++) {
    await wait(500);
    const m = sa.messengers.find((x) => x.id === courier.id);
    if (!m) break;
    if (m.stalled) {
      stalledAt = m.progress;
      console.log(`   EN PANNE à ${Math.round(m.progress * 100)}% du trajet`);
      break;
    }
  }
  if (stalledAt === null) throw new Error("courier never stalled");

  // Confirm it really is frozen, not just flagged.
  const p1 = sa.messengers.find((x) => x.id === courier.id)?.progress;
  await wait(3000);
  const p2 = sa.messengers.find((x) => x.id === courier.id)?.progress;
  console.log(`   progression figée : ${Math.round(p1 * 100)}% → ${Math.round(p2 * 100)}% après 3 s`);
  if (Math.abs(p2 - p1) > 0.01) throw new Error("a stalled courier is still moving");

  // ── Boost from the player's own wallet ────────────────────────────────
  console.log("\n3) A paie des boosters depuis son propre portefeuille…");
  let boosts = 0;
  for (let i = 0; i < 8; i++) {
    const owed = Number(await fuel.unitsOutstanding(sa.chain.matchIdHex, courier.courierIdHex));
    if (owed === 0) break;
    const units = Math.min(owed, sa.chain.maxUnitsPerBoost);
    const value = await fuel.quote(units);
    const tx = await fuel.boost(sa.chain.matchIdHex, courier.courierIdHex, { value });
    await tx.wait();
    boosts++;
    console.log(`   booster ${boosts} : +${units} unités`);
    await wait(2500); // give the server time to see the event
  }

  const resumed = sa.messengers.find((x) => x.id === courier.id);
  console.log(`   état du jeu : ${resumed?.stalled ? "TOUJOURS EN PANNE" : "reparti"} · ${resumed?.boostCount ?? 0} booster(s) comptés`);
  if (resumed?.stalled) throw new Error("boost did not clear the stall");

  // ── Arrival + reveal ──────────────────────────────────────────────────
  console.log("\n4) Attente de l'arrivée et de la révélation…");
  for (let i = 0; i < 80; i++) {
    await wait(500);
    const still = sa.messengers.find((x) => x.id === courier.id);
    if (!still || still.progress >= 1) break;
  }
  const playerA = sa.players.find((p) => p.slot === 0);
  console.log(`   étape de A : ${playerA.step}/5`);

  await wait(2500); // reveal is fire-and-forget
  try {
    const st = Number(await registry.statusOf(sa.chain.matchIdHex, courier.courierIdHex));
    console.log(`   statut on-chain : ${STATUS[st]}`);
  } catch {
    console.log("   (statut non lisible — CHAIN_COMMIT_REVEAL_ADDRESS non fourni au script)");
  }

  console.log("\nOK — ancrage, panne, booster et reprise fonctionnent de bout en bout.");
  a.disconnect();
  b.disconnect();
  process.exit(0);
}

main().catch((e) => {
  console.error("CHAIN PLAYTEST FAILED:", e.message);
  process.exit(1);
});
