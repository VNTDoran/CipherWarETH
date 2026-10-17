/**
 * CIPHER WAR — combined Next.js + Socket.IO server.
 *
 * One process serves the PWA and holds authoritative match state. The game
 * loop ticks at 10 Hz; personalised state snapshots go out at 2 Hz plus
 * immediately after anything interesting happens. Clients interpolate courier
 * positions from `dispatchedAt`/`arrivesAt`, so no position data is sent.
 */

import { createServer } from "node:http";
import { parse } from "node:url";
// @next/env is CommonJS, so the named export does not survive ESM interop.
import nextEnv from "@next/env";
import next from "next";

// This file runs under tsx, before Next boots, so nothing has read .env yet —
// without this the CHAIN_* variables are simply absent and the chain silently
// stays off. Uses Next's own loader so .env/.env.local resolve identically on
// both sides of the process.
nextEnv.loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");
import { Server as IOServer, type Socket } from "socket.io";
import { BROADCAST_MS, TICK_MS } from "../shared/constants.js";
import type {
  ClientToServer,
  MinigameSubmission,
  ServerToClient,
  ShopItem,
} from "../shared/types.js";
import { SESSION_COOKIE, readToken } from "../src/lib/auth.js";
import { chain } from "./chain/client.js";
import type { Match } from "./engine/match.js";
import {
  createMatch,
  dropMatch,
  getMatch,
  listMatches,
  loadEngineConfig,
  markStarted,
  persistResult,
} from "./rooms.js";

const dev = process.env.NODE_ENV !== "production";
const port = Number(process.env.PORT ?? 3000);
const app = next({ dev, hostname: "0.0.0.0", port });
const handle = app.getRequestHandler();

interface SocketData {
  userId: string;
  displayName: string;
  role: string;
  code?: string;
}

function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};
  return Object.fromEntries(
    header.split(";").map((part) => {
      const idx = part.indexOf("=");
      if (idx === -1) return [part.trim(), ""];
      return [part.slice(0, idx).trim(), decodeURIComponent(part.slice(idx + 1).trim())];
    }),
  );
}

await app.prepare();
await chain.init();

const server = createServer((req, res) => {
  handle(req, res, parse(req.url ?? "/", true));
});

const io = new IOServer<ClientToServer, ServerToClient, never, SocketData>(server, {
  path: "/api/socket",
  transports: ["websocket", "polling"],
});

// Auth happens once, at the handshake, from the same HTTP-only cookie the
// pages use. A socket can never claim a different identity afterwards.
io.use(async (socket, nextFn) => {
  const cookies = parseCookies(socket.handshake.headers.cookie);
  const session = await readToken(cookies[SESSION_COOKIE]);
  if (!session) return nextFn(new Error("unauthenticated"));
  socket.data.userId = session.sub;
  socket.data.displayName = session.displayName || session.username;
  socket.data.role = session.role;
  nextFn();
});

const finishing = new Set<string>();

function broadcast(match: Match) {
  for (const socket of io.sockets.sockets.values()) {
    if (socket.data.code !== match.code) continue;
    socket.emit("state", match.viewFor(socket.data.userId));
  }
}

/**
 * A player can legitimately hold more than one socket — a second tab, or the
 * overlap while a flaky connection re-establishes before the old one times
 * out. Marking them offline when *any* socket closes would flag a live player
 * as disconnected, so only the last one counts.
 */
function hasOtherSocket(code: string, userId: string, exceptSocketId: string): boolean {
  for (const s of io.sockets.sockets.values()) {
    const d = s.data as SocketData;
    if (s.id !== exceptSocketId && s.connected && d.code === code && d.userId === userId) {
      return true;
    }
  }
  return false;
}

function attachFinishHook(match: Match) {
  match.onChange = (m) => broadcast(m);
  match.onFinish = (m) => {
    if (finishing.has(m.code)) return;
    finishing.add(m.code);
    void persistResult(m).finally(() => {
      broadcast(m);
      // Give clients time to show the result screen before dropping the room.
      setTimeout(() => {
        dropMatch(m.code);
        finishing.delete(m.code);
      }, 60_000);
    });
  };
}

/**
 * Socket.IO swallows anything a handler throws and logs a bare "@TODO", which
 * makes a real bug look like noise. Wrapping every handler means a failure
 * names itself, keeps its stack, and tells the player something went wrong
 * instead of the action silently doing nothing.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function safe(socket: Socket, event: string, handler: (...args: any[]) => unknown) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  socket.on(event, async (...args: any[]) => {
    try {
      await handler(...args);
    } catch (err) {
      console.error(`[socket] ${event} failed`, err);
      socket.emit("errorMsg", { message: "Something went wrong on the server." });
    }
  });
}

io.on("connection", (socket: Socket) => {
  const data = socket.data as SocketData;

  safe(socket, "join", async (payload: { code: string }, ack) => {
    const respond = typeof ack === "function" ? ack : () => {};
    const match = getMatch(payload?.code ?? "");
    if (!match) return respond({ ok: false, error: "No such match code." });

    const player = match.addPlayer(data.userId, data.displayName);
    if (!player) return respond({ ok: false, error: "That match is full or already running." });

    data.code = match.code;
    socket.join(match.code);
    attachFinishHook(match);
    respond({ ok: true, slot: player.slot });
    broadcast(match);
  });

  safe(socket, "ready", (p: { ready: boolean }) => {
    const match = data.code ? getMatch(data.code) : undefined;
    if (!match) return;
    match.setReady(data.userId, !!p?.ready);
    broadcast(match);
  });

  safe(socket, "start", async () => {
    const match = data.code ? getMatch(data.code) : undefined;
    if (!match) return;
    const err = match.canStart(data.userId);
    if (err) return socket.emit("errorMsg", { message: err });

    // Close the table on-chain before play: once the match is running nobody
    // else may join the pot. A full table has already locked itself.
    if (match.stakingActive && match.matchIdHex && match.stakedCount < 4) {
      match.starting = true;
      const locked = await chain.lockTournament(match.matchIdHex);
      match.starting = false;
      if (!locked) {
        return socket.emit("errorMsg", {
          message: "Could not lock the tournament on-chain. Check that at least 2 distinct wallets have staked.",
        });
      }
    }

    const config = await loadEngineConfig();
    match.configure(config.operations, config.tunings);
    match.start();
    void markStarted(match);
    broadcast(match);
  });

  safe(socket, "dispatch", () => {
    const match = data.code ? getMatch(data.code) : undefined;
    if (!match) return;
    const err = match.dispatch(data.userId);
    if (err) return socket.emit("errorMsg", { message: err });
    broadcast(match);
  });

  safe(socket, "decoy", () => {
    const match = data.code ? getMatch(data.code) : undefined;
    if (!match) return;
    const err = match.decoy(data.userId);
    if (err) return socket.emit("errorMsg", { message: err });
    broadcast(match);
  });

  safe(socket, "forfeit", () => {
    const match = data.code ? getMatch(data.code) : undefined;
    if (!match) return;
    const err = match.forfeit(data.userId);
    if (err) return socket.emit("errorMsg", { message: err });
    broadcast(match);
  });

  safe(socket, "buy", (p: { item: ShopItem }) => {
    const match = data.code ? getMatch(data.code) : undefined;
    if (!match || !p?.item) return;
    const err = match.buy(data.userId, p.item);
    if (err) return socket.emit("errorMsg", { message: err });
    broadcast(match);
  });

  safe(socket, "attack", (p: { messengerId: string }) => {
    const match = data.code ? getMatch(data.code) : undefined;
    if (!match || !p?.messengerId) return;
    const result = match.attack(data.userId, p.messengerId);
    if (typeof result === "string") return socket.emit("errorMsg", { message: result });
    socket.emit("minigame", {
      token: result.token,
      messengerId: result.messengerId,
      challenge: result.challenge,
    });
    broadcast(match);
  });

  safe(socket, "submit", (p: MinigameSubmission) => {
    const match = data.code ? getMatch(data.code) : undefined;
    if (!match || !p?.token) return;
    const result = match.submit(data.userId, p);
    if (typeof result === "string") return socket.emit("errorMsg", { message: result });
    socket.emit("minigameResult", result);
    broadcast(match);
  });

  safe(socket, "commit", (p: { messengerId: string; keyIndex: number }) => {
    const match = data.code ? getMatch(data.code) : undefined;
    if (!match || !p?.messengerId) return;
    const res = match.commit(data.userId, p.messengerId, Number(p.keyIndex));
    if ("error" in res && res.error) return socket.emit("errorMsg", { message: res.error });
    socket.emit("commitResult", {
      messengerId: p.messengerId,
      success: !!res.success,
      keyIndex: Number(p.keyIndex),
      payout: res.payout ?? 0,
    });
    broadcast(match);
  });

  safe(socket, "checkStake", async () => {
    const match = data.code ? getMatch(data.code) : undefined;
    if (!match || !match.stakingActive || !match.matchIdHex) return;
    const wallet = match.findByUser(data.userId)?.wallet;
    if (!wallet) return;
    // The client says it staked; the chain decides. The node can lag a moment
    // behind the receipt the player saw, so retry briefly.
    for (let i = 0; i < 8; i++) {
      if (await chain.hasStaked(match.matchIdHex, wallet)) {
        match.markStaked(wallet);
        return;
      }
      await new Promise((r) => setTimeout(r, 750));
    }
  });

  safe(socket, "linkWallet", (p: { address: string | null }) => {
    const match = data.code ? getMatch(data.code) : undefined;
    if (!match) return;
    const addr = typeof p?.address === "string" ? p.address : null;
    match.setWallet(data.userId, addr);
    broadcast(match);
    // A stake made earlier (page reloaded, wallet re-linked) won't re-emit its
    // event, so ask the contract.
    if (addr && match.stakingActive && match.matchIdHex) {
      void chain.hasStaked(match.matchIdHex, addr).then((joined) => {
        if (joined) match.markStaked(addr);
      });
    }
  });

  safe(socket, "leave", () => {
    const match = data.code ? getMatch(data.code) : undefined;
    if (!match) return;
    const code = match.code;
    socket.leave(code);
    data.code = undefined;
    if (!hasOtherSocket(code, data.userId, socket.id)) {
      match.setConnected(data.userId, false);
    }
    broadcast(match);
  });

  socket.on("disconnect", () => {
    const match = data.code ? getMatch(data.code) : undefined;
    if (!match) return;
    if (!hasOtherSocket(match.code, data.userId, socket.id)) {
      match.setConnected(data.userId, false);
    }
    broadcast(match);
  });
});

// A booster is only credited once the money has actually moved, so the signal
// comes from the contract event rather than from the player's client.
chain.onStake((e) => {
  for (const match of listMatches()) {
    if (match.matchIdHex?.toLowerCase() !== e.matchIdHex) continue;
    match.markStaked(e.player);
    break;
  }
});

chain.onBoost((e) => {
  for (const match of listMatches()) {
    if (match.matchIdHex?.toLowerCase() !== e.matchIdHex) continue;
    if (match.applyBoost(e.courierIdHex, e.totalUnits)) broadcast(match);
    break;
  }
});

// ─────────────────────────────── Game loop ───────────────────────────────

let lastBroadcast = 0;
setInterval(() => {
  const now = Date.now();
  let dirty = false;
  for (const match of listMatches()) {
    if (match.tick()) dirty = true;
  }
  if (dirty || now - lastBroadcast >= BROADCAST_MS) {
    lastBroadcast = now;
    for (const match of listMatches()) {
      if (match.status === "ACTIVE" || match.status === "FINISHED") broadcast(match);
    }
  }
}, TICK_MS);

// The HTTP API creates matches (it has the session cookie); the socket layer
// then adopts them. This keeps match creation idempotent and testable.
declare global {
  // eslint-disable-next-line no-var
  var __cipherWarCreateMatch: ((hostUserId: string) => Promise<Match>) | undefined;
  // eslint-disable-next-line no-var
  var __cipherWarGetMatch: ((code: string) => Match | undefined) | undefined;
}
globalThis.__cipherWarCreateMatch = createMatch;
globalThis.__cipherWarGetMatch = getMatch;

server.listen(port, () => {
  console.log(`\n  CIPHER WAR ready on http://localhost:${port}`);
  console.log(`  Socket.IO mounted at /api/socket`);
  console.log(`  Phones on the same network: http://<your-lan-ip>:${port}\n`);
});
