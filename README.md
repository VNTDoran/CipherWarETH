# CIPHER WAR

A real-time 4-player espionage game. Four intelligence agencies transmit
encrypted directives to their capitals across a shared map; everyone can see
every courier, and the only way to stop a rival finishing is to intercept and
decrypt their traffic before it lands.

Web + installable PWA. Next.js 15, Socket.IO, Prisma/SQLite, TypeScript.

Read [DESIGN.md](DESIGN.md) for the game design — especially why the key-cracking
is skill-based rather than a lottery, and how the match ends fairly.

---

## Run it

```bash
npm install
npm run setup
npm run dev
```

Open <http://localhost:3000>.

`npm run setup` generates the Prisma client, creates `prisma/dev.db`, and seeds
agencies, operations, minigame tuning and demo accounts.

**Demo accounts** — password `cipher123` for all of them:

| Username | Role |
| --- | --- |
| `admin` | ADMIN (can reach `/admin`) |
| `nord`, `est`, `sud`, `ouest` | PLAYER |

### Playing with real people

One person opens a lobby and reads out the 6-character code; up to three others
join with it. 2–4 players work — the match is symmetric either way.

Phones on the same Wi-Fi can join at `http://<your-lan-ip>:3000`. Find the IP
with `ipconfig` (Windows) or `ifconfig` (macOS/Linux).

> The service worker and "Add to home screen" need a secure context. `localhost`
> counts; a raw LAN IP does not. To install on a phone, put it behind a tunnel
> (`npx localtunnel --port 3000`, ngrok, or similar) — the game itself plays
> fine over plain HTTP either way.

---

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Next.js + Socket.IO on one process, with reload |
| `npm run setup` | generate client, push schema, seed |
| `npm run build` / `npm start` | production build and serve |
| `npm run db:studio` | Prisma Studio — browse the database |
| `npm run db:seed` | re-seed (idempotent) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run playtest` | headless end-to-end match against a running server |
| `npm run balance` | measures whether an escort actually saves a courier |

`scripts/playtest.mjs` is the real integration test: it logs in two accounts,
opens a match, dispatches a directive, and grinds an intercept through the
actual minigame → eliminate → commit loop over a live socket.

`scripts/escort-check.mjs` is a balance harness — it runs the same courier with
and without an escort and reports how many attacks each took. It is what caught
an incorrect claim in an earlier draft of DESIGN.md.

`scripts/sit-in.mjs <CODE> <user> --play` drops a bot into a lobby so you can
look at a populated board without four people. Both need `npm run dev` running.

---

## Architecture

```
server/
  index.ts            Next.js + Socket.IO in one process; 10 Hz game loop
  rooms.ts            live match registry; loads templates, writes results
  engine/
    match.ts          authoritative state machine (the whole ruleset)
    minigames.ts      challenge generation and server-side scoring
shared/
  constants.ts        every tuning number, used by both server and UI
  types.ts            the wire protocol
src/
  app/                pages, API routes, admin panel
  components/         board, agency panels, ether map, minigames
  lib/                prisma client, auth, socket hook, admin model registry
prisma/               schema + seed
```

### Why the server owns everything

Match state lives in server memory and ticks at 10 Hz. Clients send *intents*
("attack this courier", "I typed this"), never outcomes. Each player receives a
personalised snapshot with the real key index and every rival's candidate pool
stripped out — the information needed to cheat never reaches the browser.

Courier positions are never transmitted. The server sends two timestamps per
courier and the client interpolates, so the animation is smooth regardless of
tick rate and the bandwidth stays tiny.

**One honest limitation:** Signal Trace and Frequency Lock have to send their
target to the client so it can be *drawn*, so someone reading the websocket
could beat those two. Cipher Type is fully sound. What matters — a client
posting `{ tier: "GOLD" }` straight at the socket — is closed everywhere,
because the server scores from raw inputs and issues the challenge itself.

### Persistence

SQLite via Prisma. Live match state stays in memory for speed; the durable
record (match, per-player results, placements) is written when a match ends.
Swapping to PostgreSQL is a one-line change to `datasource db` in
`prisma/schema.prisma`.

---

## Performance

Measured on a production build (`npm run build && npm start`) with a live
4-agency match running, via `npm run perf <CODE> <user>`:

| | |
| --- | --- |
| TTFB | 20 ms |
| DOMContentLoaded | 87 ms |
| Load complete | 160 ms |
| First-load JS (game screen) | 133 kB |
| DOM nodes, mid-match | 346 |
| JS heap | 11.6 MB |
| Server RSS | ~105 MB |

| Route | p50 | p95 |
| --- | --- | --- |
| `/` | 17 ms | 34 ms |
| `/lobby` | 14 ms | 30 ms |
| `/leaderboard` | 23 ms | 37 ms |
| `/api/auth/me` | 8 ms | 13 ms |

**Realtime layer, per connected client:** 3.3 snapshots/s (p50 interval 317 ms
against a 300 ms target — the loop does not drift), ~3.9 KB per snapshot,
~14 KB/s. Four players is roughly **57 KB/s of total server egress**, so a
match runs comfortably over a phone connection.

Courier positions are never transmitted — the server sends two timestamps and
the client interpolates. That is what keeps the snapshot small despite the
board updating continuously.

**One optimisation worth noting:** the first measurement showed 5.25 KB per
snapshot. About 60% of that was the event log — the server was resending the
last 24 entries, roughly 3 kB of text, three times a second even when nothing
had changed. The server now sends only a 6-entry tail and the client
accumulates by entry id, which cut the payload by 29% with no loss of history.
Entry ids are unique, so a dropped or duplicated snapshot cannot corrupt the
transcript; it resyncs on the next one.

---

## The admin panel

`/admin`, ADMIN role only. Generic CRUD over every table, generated from a
single registry in [`src/lib/admin-models.ts`](src/lib/admin-models.ts) — adding
a model there gives it a paginated table, a validated create/edit form, search
and delete, with no new routes or components.

The tables marked **live** (agencies, operations, directives, minigames) are
read by the game engine when a match starts. Editing a directive's
`transitMs`, `dispatchCost` or `crackPayout` retunes the next match; disabling a
minigame stops it being dealt. The CRUD is wired into gameplay rather than
sitting beside it.

---

## Project requirements

**CRUD** — 12 Prisma models with full create/read/update/delete through
`/api/admin/[model]`, zod validation at the edge, pagination, search, unique and
foreign-key error handling, and role-guarded access.

**Advanced modules**

- Real-time authoritative multiplayer over WebSocket with a server-side game loop
- PWA: web manifest, service worker with app-shell precache and an offline page, installable, standalone display
- Auth: bcrypt password hashing, JWT in HTTP-only cookies, route protection, ADMIN role
- Lobby: 6-character join codes, ready-up, host controls, reconnect handling
- Persistence and analytics: match history, career stats, leaderboard

---

## Art

Ships with procedural CSS/SVG art so a fresh clone renders with zero downloads.
To upgrade, drop sprites into `public/assets/` — see
[DESIGN.md §7](DESIGN.md) for vetted CC0 sources (Kenney.nl is the main one;
CC0 means no attribution obligation).

---

## Known gaps

- Balance is tuned from a headless perfect-play bot, not from four humans. The
  bot submits instantly, so it attacks about twice as fast as a person can —
  see **Measured balance** in DESIGN.md for both columns and which constant to
  turn first.
- A player who disconnects mid-match keeps their slot and state, but there is no
  AI takeover — their couriers simply stop being dispatched.
- Match state is in memory, so restarting the server ends any live match.
- The service worker is served correctly (200, right MIME type, parses clean,
  secure context) but has only been verified as *served*, not as *registered* —
  the embedded browser used during development refuses SW registration with a
  generic fetch error, which is a known limitation of that environment rather
  than of the file. Confirm installability in real Chrome via DevTools →
  Application → Service Workers before relying on it in a demo.
