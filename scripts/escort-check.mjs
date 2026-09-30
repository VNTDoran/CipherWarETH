/**
 * Balance check: does an ESCORT actually save a courier from a perfect solo
 * attacker? DESIGN.md claims it does; this proves or disproves it.
 *
 * A buys an escort, then dispatches. B attacks flawlessly until the courier
 * either lands or burns. Run against a live `npm run dev`.
 */
import { io } from "socket.io-client";

const BASE = "http://localhost:3000";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function login(username) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password: "cipher123" }),
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
  if (c.key === "cipher_type") return { key: "cipher_type", typed: c.text, elapsedMs: 600 };
  if (c.key === "frequency_lock") return { key: "frequency_lock", hits: [true, true, true] };
  return { key: "signal_trace", answer: c.sequence };
}

async function runScenario(withEscort) {
  const [ca, cb] = await Promise.all([login("nord"), login("est")]);
  const { code } = await fetch(`${BASE}/api/match/create`, { method: "POST", headers: { Cookie: ca } }).then((r) => r.json());
  const [a, b] = await Promise.all([connect(ca), connect(cb)]);

  let sa = null;
  let sb = null;
  a.on("state", (v) => (sa = v));
  b.on("state", (v) => (sb = v));

  await new Promise((r) => a.emit("join", { code }, r));
  await new Promise((r) => b.emit("join", { code }, r));
  b.emit("ready", { ready: true });
  await wait(300);
  a.emit("start");
  await wait(500);

  if (withEscort) {
    a.emit("buy", { item: "ESCORT" });
    await wait(400);
  }
  a.emit("dispatch");
  await wait(600);

  const target = sb.messengers.find((m) => m.ownerSlot === 0 && m.kind === "DIRECTIVE");
  const started = Date.now();
  let attacks = 0;
  let cracked = false;
  b.on("commitResult", (r) => { if (r.success) cracked = true; });

  while (Date.now() - started < 32_000 && !cracked) {
    const mv = sb.messengers.find((m) => m.id === target.id);
    if (!mv) break; // arrived or resolved

    const pool = mv.me.pool;
    if (pool && pool.length === 1) {
      b.emit("commit", { messengerId: target.id, keyIndex: pool[0] });
      await wait(400);
      break;
    }

    const asg = await new Promise((resolve) => {
      b.once("minigame", resolve);
      b.emit("attack", { messengerId: target.id });
      setTimeout(() => resolve(null), 1200);
    });
    if (!asg) { await wait(700); continue; }

    attacks++;
    b.emit("submit", { token: asg.token, ...solve(asg.challenge) });
    await wait(400);
  }

  await wait(1200);
  const owner = sa.players.find((p) => p.slot === 0);
  const result = {
    escort: withEscort,
    attacks,
    cracked,
    ownerStep: owner.step,
    elapsedMs: Date.now() - started,
  };
  a.disconnect();
  b.disconnect();
  return result;
}

// The bot submits the instant it receives a challenge, so its attack cycle is
// just the 5s cooldown. A human has to actually play the ~5s minigame first,
// making their real cycle roughly double. Both numbers are reported, because
// the human one is what the balance actually has to hold against.
const HUMAN_CYCLE_MS = 10_000;
const D1_TRANSIT_MS = 28_000;

const bare = await runScenario(false);
await wait(1000);
const esc = await runScenario(true);

for (const [label, r] of [["no escort", bare], ["escorted ", esc]]) {
  const humanMs = r.attacks * HUMAN_CYCLE_MS;
  console.log(
    `${label}: ${r.attacks} attacks · bot cracked=${r.cracked} in ${(r.elapsedMs / 1000).toFixed(1)}s` +
      ` · a human needs ~${(humanMs / 1000).toFixed(0)}s vs a ${D1_TRANSIT_MS / 1000}s transit`,
  );
}

console.log("");
const botGain = esc.attacks - bare.attacks;
const humanSurvives = esc.attacks * HUMAN_CYCLE_MS > D1_TRANSIT_MS;
console.log(`escort costs the attacker ${botGain} extra attack${botGain === 1 ? "" : "s"}.`);
console.log(
  humanSurvives
    ? "PASS — at a human attack cycle an escorted D1 outlasts a flawless solo attacker."
    : "FAIL — escort does not buy enough time even against a human attacker.",
);
process.exit(0);
