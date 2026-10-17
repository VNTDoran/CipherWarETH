/**
 * Staking end-to-end, against a running server and a running Hardhat node.
 *
 *   node scripts/stake-playtest.mjs [baseUrl]
 *
 * Two demo accounts (nord, est) are paired with Hardhat accounts #1 and #2.
 * Each stakes for real (approve + join), the match starts, `est` forfeits, and
 * the script checks the pot actually moved to `nord` on-chain.
 */
import { Contract, JsonRpcProvider, NonceManager, Wallet, formatEther } from "ethers";
import { io } from "socket.io-client";

const BASE = process.argv[2] ?? "http://localhost:3100";
const RPC = process.env.CHAIN_RPC_URL ?? "http://127.0.0.1:8545";

// Hardhat's public default keys for accounts #1 and #2.
const KEYS = {
  nord: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  est: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
};

const TOKEN_ABI = [
  "function approve(address,uint256) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
];
const ESCROW_ABI = ["function join(bytes32)"];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const check = (ok, msg) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`);
  if (!ok) process.exitCode = 1;
};

async function login(username) {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password: "cipher123" }),
  });
  return r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}

function connect(cookie) {
  const s = io(BASE, { path: "/api/socket", extraHeaders: { cookie }, transports: ["websocket"] });
  const st = { view: null, errors: [] };
  s.on("state", (v) => (st.view = v));
  s.on("errorMsg", (m) => st.errors.push(m.message));
  return { s, st };
}

const emitAck = (s, ev, p) => new Promise((res) => s.emit(ev, p, res));

const provider = new JsonRpcProvider(RPC);
const base = { nord: new Wallet(KEYS.nord, provider), est: new Wallet(KEYS.est, provider) };
const wallets = { nord: new NonceManager(base.nord), est: new NonceManager(base.est) };
const addr = { nord: base.nord.address, est: base.est.address };

const cookies = { nord: await login("nord"), est: await login("est") };
const { code } = await (await fetch(`${BASE}/api/match/create`, { method: "POST", headers: { cookie: cookies.nord } })).json();
console.log("match", code);

const nord = connect(cookies.nord);
const est = connect(cookies.est);
await sleep(500);
check((await emitAck(nord.s, "join", { code })).ok, "nord joined lobby");
check((await emitAck(est.s, "join", { code })).ok, "est joined lobby");
await sleep(2500); // let the escrow tournament open

const t = nord.st.view?.chain?.tournament;
check(!!t, "lobby reports a tournament");
check(t?.ready === true, "tournament is open on-chain");
if (!t) process.exit(1);

nord.s.emit("linkWallet", { address: addr.nord });
est.s.emit("linkWallet", { address: addr.est });
await sleep(500);

// Unstaked players cannot ready up or start.
est.s.emit("ready", { ready: true });
await sleep(300);
check(est.st.view.players.find((p) => p.userId === est.st.view.players[1].userId).ready === false, "cannot ready without a stake");
nord.s.emit("start");
await sleep(500);
check(nord.st.errors.some((e) => /stake/i.test(e)), "host cannot start before everyone stakes");

const stake = BigInt(t.stakeWei);
const matchId = nord.st.view.chain.matchIdHex;
const before = {};
for (const name of ["nord", "est"]) {
  const token = new Contract(t.tokenAddress, TOKEN_ABI, provider);
  before[name] = await token.balanceOf(addr[name]);
}

for (const name of ["nord", "est"]) {
  const token = new Contract(t.tokenAddress, TOKEN_ABI, wallets[name]);
  await (await token.approve(t.escrowAddress, stake)).wait();
  await (await new Contract(t.escrowAddress, ESCROW_ABI, wallets[name]).join(matchId)).wait();
}
// The browser pings the server right after its join confirms; the server
// then checks the contract itself. No waiting on the event poll.
nord.s.emit("checkStake");
est.s.emit("checkStake");
await sleep(1500);

const staked = nord.st.view.players.filter((p) => p.staked).length;
check(staked === 2, `both players show as staked (${staked}/2)`);
check(BigInt(nord.st.view.chain.tournament.potWei) === stake * 2n, "pot is two stakes");

est.s.emit("ready", { ready: true });
await sleep(400);
nord.s.emit("start");
await sleep(4000); // lock tx
check(nord.st.view.status === "ACTIVE", "match started after the tournament locked");

// A courier in flight when the match ends must still be opened on-chain,
// or the audit would read it as the server failing to prove its key draw.
nord.s.emit("dispatch");
await sleep(4000); // commit + register
est.s.emit("forfeit");
await sleep(5000); // settle tx
check(nord.st.view.status === "FINISHED" && nord.st.view.winner?.winType === "FORFEIT", "nord wins by forfeit");

const token = new Contract(t.tokenAddress, TOKEN_ABI, provider);
const after = {
  nord: await token.balanceOf(addr.nord),
  est: await token.balanceOf(addr.est),
};
console.log(`nord: ${formatEther(before.nord)} -> ${formatEther(after.nord)}`);
console.log(`est : ${formatEther(before.est)} -> ${formatEther(after.est)}`);
check(after.nord === before.nord + stake, "winner is up exactly one stake");
check(after.est === before.est - stake, "forfeiter is down exactly one stake");

await sleep(3000); // reveal + markLanded + settle
const { execFileSync } = await import("node:child_process");
const report = execFileSync("node", ["scripts/chain-report.mjs", RPC], { encoding: "utf8" });
const latest = report.split("\n\n").find((b) => b.includes(matchId.slice(0, 12))) ?? "";
console.log(latest);
const m = latest.match(/(\d+) committed, (\d+) revealed/);
check(!!m && Number(m[1]) >= 1 && m[1] === m[2], "every courier was revealed on-chain");

nord.s.close();
est.s.close();
process.exit(process.exitCode ?? 0);
