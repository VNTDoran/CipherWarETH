/**
 * Measures the realtime layer under a real match: snapshot rate, payload size
 * and bandwidth per client, plus HTTP latency percentiles.
 *
 *   node scripts/perf-probe.mjs <CODE> [username] [seconds]
 */
import { io } from "socket.io-client";

const BASE = process.env.BASE ?? "http://localhost:3000";
const [code, username = "admin", secsArg = "10"] = process.argv.slice(2);
const SECONDS = Number(secsArg);

if (!code) {
  console.error("usage: node scripts/perf-probe.mjs <CODE> [username] [seconds]");
  process.exit(1);
}

const pct = (arr, p) => {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))];
};

async function login(user) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: user, password: "cipher123" }),
  });
  const raw = res.headers.getSetCookie?.() ?? [res.headers.get("set-cookie")];
  return raw.map((c) => c.split(";")[0]).join("; ");
}

// ── HTTP latency ─────────────────────────────────────────────────────────
async function httpLatency(path, cookie, n = 30) {
  const times = [];
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    await fetch(BASE + path, { headers: cookie ? { Cookie: cookie } : {} }).then((r) => r.arrayBuffer());
    times.push(performance.now() - t0);
  }
  return {
    path,
    p50: +pct(times, 0.5).toFixed(1),
    p95: +pct(times, 0.95).toFixed(1),
    max: +Math.max(...times).toFixed(1),
  };
}

const cookie = await login(username);

console.log("HTTP latency (30 requests each, warm):");
for (const p of ["/", "/lobby", "/leaderboard", "/api/auth/me"]) {
  const r = await httpLatency(p, cookie);
  console.log(`  ${r.path.padEnd(18)} p50 ${String(r.p50).padStart(6)}ms   p95 ${String(r.p95).padStart(6)}ms   max ${String(r.max).padStart(6)}ms`);
}

// ── Socket snapshot rate / payload ───────────────────────────────────────
const socket = io(BASE, {
  path: "/api/socket",
  transports: ["websocket"],
  extraHeaders: { Cookie: cookie },
});

let snapshots = 0;
let bytes = 0;
let maxBytes = 0;
const gaps = [];
let lastAt = 0;

socket.on("state", (v) => {
  const now = performance.now();
  if (lastAt) gaps.push(now - lastAt);
  lastAt = now;
  snapshots++;
  const size = Buffer.byteLength(JSON.stringify(v));
  bytes += size;
  if (size > maxBytes) maxBytes = size;
});

await new Promise((r) => socket.on("connect", r));
await new Promise((r) => socket.emit("join", { code }, r));

console.log("");
console.log(`Sampling the match socket for ${SECONDS}s…`);
const t0 = performance.now();
await new Promise((r) => setTimeout(r, SECONDS * 1000));
const elapsed = (performance.now() - t0) / 1000;

console.log("");
console.log("Realtime layer (per connected client):");
console.log(`  snapshots            ${snapshots} in ${elapsed.toFixed(1)}s  =  ${(snapshots / elapsed).toFixed(1)}/s`);
if (gaps.length) {
  console.log(`  interval             p50 ${pct(gaps, 0.5).toFixed(0)}ms   p95 ${pct(gaps, 0.95).toFixed(0)}ms`);
}
console.log(`  avg payload          ${(bytes / Math.max(1, snapshots) / 1024).toFixed(2)} KB   (peak ${(maxBytes / 1024).toFixed(2)} KB)`);
console.log(`  bandwidth            ${(bytes / elapsed / 1024).toFixed(1)} KB/s  ≈ ${((bytes / elapsed) * 8 / 1000).toFixed(0)} kbit/s`);
console.log(`  4 players            ≈ ${((bytes / elapsed) * 4 / 1024).toFixed(1)} KB/s total server egress`);

socket.disconnect();
process.exit(0);
