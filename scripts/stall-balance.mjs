/**
 * Measures what a stall costs the defender, now that a frozen courier stays
 * attackable.
 *
 *   BASE=http://localhost:3100 node scripts/stall-balance.mjs
 *
 * A dispatches, B attacks flawlessly on cooldown throughout. Run twice: once
 * where A refuels the instant it stalls, once where A takes a human beat to
 * react. The gap between them is the real price of the mechanic.
 */
import { io } from "socket.io-client";
import { Contract, JsonRpcProvider, Wallet } from "ethers";
import { BASE } from "./base.mjs";

const RPC = process.env.CHAIN_RPC_URL ?? "http://127.0.0.1:8545";
const A_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const B_KEY = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a";

const FUEL_ABI = [
  "function boost(bytes32 matchId, bytes32 courierId) payable",
  "function quote(uint32 units) view returns (uint256)",
  "function unitsOutstanding(bytes32 matchId, bytes32 courierId) view returns (uint32)",
];

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function login(u) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: u, password: "cipher123" }),
  });
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

function solve(c) {
  if (c.key === "cipher_type") return { key: "cipher_type", typed: c.text, elapsedMs: 500 };
  if (c.key === "frequency_lock") return { key: "frequency_lock", hits: [true, true, true] };
  return { key: "signal_trace", answer: c.sequence };
}

/** @param reactionMs how long A waits before paying once it stalls */
async function run(reactionMs) {
  const provider = new JsonRpcProvider(RPC);
  const wA = new Wallet(A_KEY, provider);
  const wB = new Wallet(B_KEY, provider);

  const [cA, cB] = await Promise.all([login("nord"), login("est")]);
  const { code } = await fetch(`${BASE}/api/match/create`, { method: "POST", headers: { Cookie: cA } })
    .then((r) => r.json());
  const [a, b] = await Promise.all([connect(cA), connect(cB)]);

  let sa = null;
  let sb = null;
  a.on("state", (v) => (sa = v));
  b.on("state", (v) => (sb = v));

  await new Promise((r) => a.emit("join", { code }, r));
  await new Promise((r) => b.emit("join", { code }, r));
  a.emit("linkWallet", { address: wA.address });
  b.emit("linkWallet", { address: wB.address });
  await wait(400);
  b.emit("ready", { ready: true });
  await wait(300);
  a.emit("start");
  await wait(600);
  if (!sa?.chain) throw new Error("chain is off - set the CHAIN_* vars");

  const fuel = new Contract(sa.chain.courierFuelAddress, FUEL_ABI, wA);

  a.emit("dispatch");
  let courier = null;
  for (let i = 0; i < 40 && !courier; i++) {
    await wait(400);
    courier = sa.messengers.find((m) => m.ownerSlot === 0 && m.kind === "DIRECTIVE");
  }
  if (!courier) throw new Error("anchoring failed");

  let cracked = false;
  let attacks = 0;
  let stallMs = 0;
  let refuelling = false;
  b.on("commitResult", (r) => { if (r.success) cracked = true; });

  // A reacts to its own stall on a timer, as a player would.
  const watchA = setInterval(async () => {
    const m = sa?.messengers.find((x) => x.id === courier.id);
    if (!m || !m.stalled || refuelling || cracked) return;
    refuelling = true;
    stallMs += reactionMs;
    await wait(reactionMs);
    try {
      let owed = Number(await fuel.unitsOutstanding(sa.chain.matchIdHex, courier.courierIdHex));
      while (owed > 0 && !cracked) {
        const units = Math.min(owed, sa.chain.maxUnitsPerBoost);
        const tx = await fuel.boost(sa.chain.matchIdHex, courier.courierIdHex, {
          value: await fuel.quote(units),
        });
        await tx.wait();
        owed = Number(await fuel.unitsOutstanding(sa.chain.matchIdHex, courier.courierIdHex));
      }
    } catch { /* courier may have resolved mid-payment */ }
    refuelling = false;
  }, 500);

  // B grinds the intercept for as long as the courier exists.
  const started = Date.now();
  while (Date.now() - started < 90_000 && !cracked) {
    const mv = sb?.messengers.find((m) => m.id === courier.id);
    if (!mv) break;
    const pool = mv.me.pool;
    if (pool && pool.length === 1) {
      b.emit("commit", { messengerId: courier.id, keyIndex: pool[0] });
      await wait(500);
      break;
    }
    const asg = await new Promise((resolve) => {
      b.once("minigame", resolve);
      b.emit("attack", { messengerId: courier.id });
      setTimeout(() => resolve(null), 900);
    });
    if (!asg) { await wait(600); continue; }
    attacks++;
    b.emit("submit", { token: asg.token, ...solve(asg.challenge) });
    await wait(400);
  }

  clearInterval(watchA);
  await wait(800);
  const step = sa?.players.find((p) => p.slot === 0)?.step ?? 0;
  a.disconnect();
  b.disconnect();
  return { reactionMs, attacks, cracked, step, elapsed: Date.now() - started };
}

const fast = await run(1000);
console.log(`reaction 1s : ${fast.attacks} attacks - ${fast.cracked ? "CRACKED" : "landed"} - step ${fast.step}`);
await wait(1500);
const slow = await run(9000);
console.log(`reaction 9s : ${slow.attacks} attacks - ${slow.cracked ? "CRACKED" : "landed"} - step ${slow.step}`);
console.log("");
console.log(`A slow reaction cost ${slow.attacks - fast.attacks} extra attack window(s).`);
process.exit(0);
