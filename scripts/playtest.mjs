/**
 * Headless end-to-end playtest: two agents join a real match, one dispatches,
 * the other intercepts through the actual minigame -> eliminate -> commit loop.
 * Verifies the engine over the wire, not in isolation.
 */
import { io } from "socket.io-client";
import { BASE } from "./base.mjs";

const log = (...a) => console.log(...a);

async function login(username) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password: "cipher123" }),
  });
  if (!res.ok) throw new Error(`login ${username} failed`);
  const raw = res.headers.getSetCookie?.() ?? [res.headers.get("set-cookie")];
  return raw.map((c) => c.split(";")[0]).join("; ");
}

function connect(cookie) {
  return new Promise((resolve, reject) => {
    const s = io(BASE, {
      path: "/api/socket",
      transports: ["websocket"],
      extraHeaders: { Cookie: cookie },
    });
    s.on("connect", () => resolve(s));
    s.on("connect_error", reject);
  });
}

function join(socket, code) {
  return new Promise((resolve) => socket.emit("join", { code }, resolve));
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Answer whatever challenge arrives. Deliberately plays well, to test GOLD. */
function solve(challenge) {
  switch (challenge.key) {
    case "cipher_type":
      return { key: "cipher_type", typed: challenge.text, elapsedMs: 900 };
    case "frequency_lock":
      // Can't actually time the needle headlessly; claim two hits.
      return { key: "frequency_lock", hits: [true, true, false] };
    case "signal_trace":
      return { key: "signal_trace", answer: challenge.sequence };
  }
}

async function main() {
  const [cookieA, cookieB] = await Promise.all([login("nord"), login("est")]);

  const created = await fetch(`${BASE}/api/match/create`, {
    method: "POST",
    headers: { Cookie: cookieA },
  }).then((r) => r.json());
  const code = created.code;
  log(`match ${code} created`);

  const [a, b] = await Promise.all([connect(cookieA), connect(cookieB)]);

  let stateA = null;
  let stateB = null;
  a.on("state", (v) => (stateA = v));
  b.on("state", (v) => (stateB = v));
  a.on("errorMsg", (m) => log("  [A error]", m.message));
  b.on("errorMsg", (m) => log("  [B error]", m.message));

  log("join:", await join(a, code), await join(b, code));

  b.emit("ready", { ready: true });
  await wait(300);
  a.emit("start");
  await wait(500);

  if (stateA?.status !== "ACTIVE") throw new Error(`match did not start: ${stateA?.status}`);
  log(`match ACTIVE · A=${stateA.players[0].name} op=${stateA.players[0].operationName}`);

  // ── A dispatches directive 1 ────────────────────────────────────────────
  a.emit("dispatch");
  await wait(600);
  const target = stateB.messengers.find((m) => m.ownerSlot === 0 && m.kind === "DIRECTIVE");
  if (!target) throw new Error("no directive messenger visible to B");
  log(`A dispatched ${target.codename} · ${target.candidateCount} candidate keys`);

  // ── B grinds the intercept ──────────────────────────────────────────────
  let lastResult = null;
  b.on("minigameResult", (r) => (lastResult = r));

  let commitOutcome = null;
  b.on("commitResult", (r) => (commitOutcome = r));

  for (let round = 1; round <= 12; round++) {
    const mv = stateB.messengers.find((m) => m.id === target.id);
    if (!mv) {
      log("  messenger resolved before B finished");
      break;
    }
    const pool = mv.me.pool;
    if (pool && pool.length === 1) {
      log(`  pool narrowed to 1 after ${round - 1} attacks — committing`);
      b.emit("commit", { messengerId: target.id, keyIndex: pool[0] });
      await wait(500);
      break;
    }

    const challenge = await new Promise((resolve) => {
      b.once("minigame", (asg) => resolve(asg));
      b.emit("attack", { messengerId: target.id });
      setTimeout(() => resolve(null), 2000);
    });
    if (!challenge) {
      log("  no minigame issued (cooldown) — waiting");
      await wait(1500);
      continue;
    }

    const answer = solve(challenge.challenge);
    await wait(150);
    b.emit("submit", { token: challenge.token, ...answer });
    await wait(400);
    log(
      `  attack ${round}: ${challenge.challenge.key} -> ${lastResult?.tier} ` +
        `(-${lastResult?.eliminated} keys, ${lastResult?.poolAfter} left)`,
    );

    // Respect the 6s cooldown.
    await wait(6100);
  }

  await wait(800);
  log("");
  if (commitOutcome?.success) {
    log(`CRACKED — B gained ${commitOutcome.payout} intel`);
  } else if (commitOutcome) {
    log(`wrong key — B lost ${Math.abs(commitOutcome.payout)} intel (expected if gambling)`);
  } else {
    log("no commit resolved within the window");
  }

  const pa = stateA.players.find((p) => p.slot === 0);
  const pb = stateB.players.find((p) => p.slot === 1);
  log(`A: step=${pa.step} intel=${pa.intel} burned=${pa.timesCracked}`);
  log(`B: step=${pb.step} intel=${pb.intel} cracks=${pb.cracksMade}`);

  // ── Economy + guard checks ──────────────────────────────────────────────
  log("");
  log("guard checks:");
  await new Promise((r) => {
    b.once("errorMsg", (m) => {
      log(`  bad messenger id rejected: "${m.message}"`);
      r();
    });
    b.emit("attack", { messengerId: "does-not-exist" });
    setTimeout(r, 1200);
  });

  a.emit("buy", { item: "SPY" });
  await wait(400);
  log(`  A spies after recruit: ${stateA.players[0].spies}`);

  a.emit("decoy");
  await wait(400);
  const decoySeen = stateB.messengers.filter((m) => m.ownerSlot === 0).length;
  log(`  decoy visible to B as a normal directive: ${decoySeen > 0 ? "yes" : "no"}`);

  log("");
  log("log tail:");
  for (const e of stateB.log.slice(-6)) log(`  [${e.kind}] ${e.text}`);

  a.disconnect();
  b.disconnect();
  process.exit(0);
}

main().catch((e) => {
  console.error("PLAYTEST FAILED:", e.message);
  process.exit(1);
});
