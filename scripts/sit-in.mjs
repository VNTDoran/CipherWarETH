/**
 * Joins a lobby as a demo account and stays connected, optionally dispatching
 * and attacking on a timer. Useful for eyeballing the board with one browser.
 *
 *   node scripts/sit-in.mjs <CODE> [username] [--play]
 */
import { io } from "socket.io-client";

const BASE = "http://localhost:3000";
const [code, username = "est", ...flags] = process.argv.slice(2);
const play = flags.includes("--play");

if (!code) {
  console.error("usage: node scripts/sit-in.mjs <CODE> [username] [--play]");
  process.exit(1);
}

const res = await fetch(`${BASE}/api/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ username, password: "cipher123" }),
});
const cookie = (res.headers.getSetCookie?.() ?? [res.headers.get("set-cookie")])
  .map((c) => c.split(";")[0])
  .join("; ");

const socket = io(BASE, {
  path: "/api/socket",
  transports: ["websocket"],
  extraHeaders: { Cookie: cookie },
});

let state = null;
socket.on("state", (v) => (state = v));
socket.on("errorMsg", (m) => console.log("  err:", m.message));

socket.on("connect", () => {
  socket.emit("join", { code }, (r) => {
    console.log(`${username} joined:`, r);
    socket.emit("ready", { ready: true });
  });
});

if (play) {
  // Dispatch as soon as the match starts, then keep the ether busy.
  setInterval(() => {
    if (state?.status !== "ACTIVE") return;
    const me = state.players.find((p) => p.slot === state.youSlot);
    if (me && !me.inTransit && state.nextDispatch?.affordable) {
      socket.emit("dispatch");
      console.log(`${username} dispatched D${state.nextDispatch.level}`);
    }
  }, 4000);
}

process.on("SIGINT", () => {
  socket.disconnect();
  process.exit(0);
});
console.log(`${username} sitting in on ${code}${play ? " (playing)" : ""}…`);
