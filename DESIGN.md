# CIPHER WAR — Game Design Document

> 4 intelligence agencies. One shared ether. Every message you send can be read by someone.

---

## 1. The two problems this design solves

Your concept had a strong fantasy but two open holes. Everything below is built around closing them.

### Problem A — "the random key drop is pure luck"

**Original:** messenger carries 10 keys (9 fake, 1 real); attacking drops a random key; you try keys until one works. That is a 1-in-10 lottery repeated. A player can win on variance alone, which is exactly what you flagged.

**Fix — attacks *eliminate* candidates instead of *granting* keys.**

The 10 keys stay. But an attack never hands you "the" key. It **crosses candidates off your personal list**, and *how many* it crosses off is decided by your performance in the attack minigame:

| Minigame result | Candidates eliminated |
| --- | --- |
| Bronze | 1 |
| Silver | 2 |
| Gold | 3 |

Every attack makes guaranteed progress. RNG decides *which* keys get crossed off; **skill decides how fast the list shrinks**. Two players attacking the same messenger with identical luck but different minigame scores get measurably different outcomes — which is the definition of a skill game.

Each attacker keeps their **own** candidate pool on each messenger. It is a live race: whoever narrows to one first cracks it.

### Problem B — "I can't think of a fair, non-luck-dependent way for the game to end"

**Fix — everyone races the same 5-step ladder, and the only way to stop someone is to actively intercept them.**

Every agency is running a secret **Operation** made of **5 Directives**. To advance from directive *N* to *N+1* you must **dispatch a confirmation messenger** that crosses the shared Ether to your country node.

- Messenger **arrives** -> directive confirmed, you advance one step.
- Messenger **cracked in transit** -> the directive **burns**. No advance. You must pay to re-dispatch.

**First agency to confirm all 5 directives wins.**

Why this is fair:

1. **Perfectly symmetric.** Every player needs exactly 5 confirmations. No asymmetric win races.
2. **No elimination.** Nobody is knocked out and left watching for ten minutes — critical for a 4-player classroom demo.
3. **Bounded runtime.** With zero interception the game ends in a predictable window. Hard cap at 20 minutes with a deterministic tiebreak.
4. **Anti-snowball is built into the economy, not bolted on.** Cracking a messenger pays `30 + 25 × directiveLevel`. Cracking the leader's *fifth* directive pays **155 Intel**; cracking a last-place player's first pays **55**. The leader is always the most profitable target, so the table naturally converges on whoever is ahead — with no rubber-band cheat.
5. **You cannot turtle.** Dispatching directives *costs Intel*, and the only meaningful income is cracking other people. A player who never attacks literally cannot afford to finish their own operation.
6. **You cannot pure-rush either.** A player who only attacks and never dispatches has to reach the much harder alternate win.

### Second victory path — **Blackout**

Crack **6 enemy directive messengers** in one match and you expose the entire network: instant win.

This exists so aggression is a real strategy rather than a chore, and so the "always hit the leader" incentive doesn't collapse into everyone farming one person forever — farming someone *also* walks you toward your own Blackout, which the other two players must then respect.

---

## 2. Core loop

```
        +--------------------------------------------+
        |                                            |
        v                                            |
  DISPATCH a directive confirmation  --+             |
  (costs Intel, crosses the Ether)     |             |
        |                              |             |
        | arrives                      | cracked     |
        v                              v             |
  +1 Operation step             directive burns      |
  +20 Intel                     enemy gains Intel    |
        |                              |             |
        +--------------+---------------+             |
                       v                             |
            you need more Intel ---------------------+
                       |
                       v
   ATTACK enemy messengers -> minigame -> eliminate candidate keys
                       |
                       v
        narrow to 1 -> COMMIT -> crack -> +Intel +dossier line
                       |
                       v
        spend Intel: Spies | Encryption | Escorts | Decoys
```

---

## 3. The crack mechanic in detail

Every messenger in transit carries **N candidate keys** (default 10, one is real).

**Step 1 — Open an attack.** Tap any enemy messenger in the Ether. Your personal candidate pool on that messenger initialises at `N − yourSpyCount` (spies are passive key-stealers; they pre-eliminate candidates the moment you engage).

**Step 2 — Minigame.** A 4.5–5 second minigame fires. Your tier eliminates 1–3 candidates. Per-messenger attack cooldown: **5 s**. One attack cycle is therefore about **10 seconds**, and every other timing in the game is derived from that number.

**Step 3 — Commit.** You may commit a key at any pool size. Success chance is `1 / poolSize`.

| Pool size when you commit | Success chance | Why you'd do it |
| --- | --- | --- |
| 1 | 100% | Safe. The patient play. |
| 2 | 50% | A rival is clearly about to crack it. |
| 3 | 33% | The messenger is 4 seconds from arriving. |

Wrong commit -> **10 s lockout on that messenger and −15 Intel**.

This turns the endgame of every interception into a genuine decision: grind for certainty, or gamble to beat the player next to you. Nerve and read become part of the skill — and it directly recycles your "try keys until it decrypts" fantasy, except every wrong try now costs something you *chose* to risk.

**Step 4 — Transit clock.** Every messenger has a transit timer. Late directives travel slower and pay more, so the final steps produce long, loud, everyone-piles-in windows.

| Directive | Transit time | Attack windows | Dispatch cost | Crack payout |
| --- | --- | --- | --- | --- |
| D1 | 28 s | ~3 | 0 (free opener) | 55 |
| D2 | 32 s | ~3 | 40 | 80 |
| D3 | 38 s | ~4 | 70 | 105 |
| D4 | 45 s | ~5 | 110 | 130 |
| D5 | 54 s | ~6 | 160 | 155 |

Re-dispatching a burned directive costs **50%** of the original.

Key-space also grows with level: `10 + (level − 1) + 2 × encryptionLevel`, so a
fully-encrypted D5 carries 20 candidates against a D1's 10.

### Measured balance

Two headless scripts drive a *perfect* attacker — one that answers every
minigame correctly, so every intercept is GOLD (3 eliminations). Measured
against a D1 (10 keys, 9 fake, 28 s transit):

| Scenario | Attacks needed | Bot time | Human time |
| --- | --- | --- | --- |
| Undefended | 3 | 14.3 s | ~30 s |
| Under escort | 5 | 26.7 s | ~50 s |

**The bot and human columns differ for a real reason.** The bot submits the
instant it receives a challenge, so its attack cycle is just the 5 s cooldown.
A human has to actually *play* the ~5 s minigame first, making their true cycle
roughly 10 s. The human column is what the balance has to hold against; the bot
column is a ceiling nobody reaches.

Read that way, the numbers land somewhere good:

1. **An undefended D1 is genuinely marginal** — ~30 s of flawless, undivided
   attention against a 28 s transit. A single dropped Gold and it lands. It is
   not a formality in either direction.
2. **The escort is decisive, not decorative.** It costs 50 of your starting 60
   intel and buys two extra attacks — pushing a solo human attacker to ~50 s
   against a 28 s window. **An escorted courier beats a flawless solo
   attacker.** Breaking it requires two people looking at the same target,
   which is exactly the coordination the design wants to force.
3. **Attention is the deeper defence.** These scripts are the degenerate case:
   one courier, one attacker, nothing else on screen. In a real 4-player match
   two or three couriers plus ambient traffic are in the ether at once, and
   30 s spent grinding one target is 30 s of everything else flying past.

Reproduce with `npm run dev` running:

```bash
node scripts/escort-check.mjs
```

**Open question for human playtesting:** whether three rivals dogpiling the
leader's D5 makes the lead unfinishable. The intended counter is the decoy —
dispatch bait first, let someone burn 40 intel on it, then send the real one
while they are locked out. If that proves too weak in practice, the lever to
turn first is `ATTACK_COOLDOWN_MS` upward, then `DECOY_COST` downward.

---

## 4. Economy

### Income

| Source | Intel |
| --- | --- |
| Crack an enemy directive | `30 + 25 × level` |
| Crack ambient / routine traffic | 15 |
| Crack a decoy | **−40** (and you gain a poisoned dossier line) |
| Your directive arrives safely | +20 |
| Passive drip | +4 per 10 s |

Ambient traffic (neutral messengers with no owner) spawns continuously, so a broke player always has something to farm. No death spiral, no lockout.

### Spending

| Item | Cost | Effect | Cap |
| --- | --- | --- | --- |
| **Spy** | 60 / 110 / 180 / 270 | Passive: pre-eliminates 1 candidate on every messenger you engage | 4 |
| **Encryption** | 90 each | +2 candidate keys on *your* messengers (10 -> 16) | 3 |
| **Escort** | 50 | Next dispatch only: every attacker's tier is downgraded one step | consumable |
| **Decoy** | 35 | Dispatch a fake that is visually identical to a real directive | — |

**Why decoys matter:** without them, attacking is a no-brainer. With them, every messenger you see is a question — is this their real D4, or 35 Intel of bait that will cost me 40? That's a bluffing layer with no extra rules, and it is the cheapest possible way to add depth here.

**The central tension:** every Intel is either offense (spies), defense (encryption / escorts), or progress (dispatching). You never have enough for all three. That's the game.

---

## 5. Minigames (attack resolution)

Three rotate at random. All ≤ 5 s, all touch-first, all pure DOM/SVG — no engine, no heavy assets.

An intercept interrupts the board, so it has to be *brief*. The first pass ran
7–8 s each and felt like a chore; everything below is sized so a full attack —
open, play, resolve — costs about five seconds of attention.

1. **Cipher Type** — a codeword plus a 3-digit group (~10 characters); type it. Speed × accuracy -> tier. *(your typeracer idea)*
2. **Frequency Lock** — a needle sweeps a dial; tap inside the green band. 3 rounds, band shrinks and the sweep accelerates each round.
3. **Signal Trace** — 4 glyphs flash over 1.4 s; reproduce the sequence by tapping.

They deliberately test three different skills (dexterity, timing, memory) so no single player type dominates every interception.

---

## 6. Screen layout

**Desktop and tablet — 2×2 split with a shared centre.**

```
+------------------+------------------+
|  AGENCY NORD     |    AGENCY EST    |
|  [#][#][#][ ][ ] |  [#][#][ ][ ][ ] |
|  intel 240       |  intel 115       |
|  spies * * o o   |  spies * o o o   |
+------------------+------------------+
|         T H E   E T H E R           |
|    >>--      >>--        --<<       |   <- all messengers cross here
+------------------+------------------+
|  AGENCY SUD      |   AGENCY OUEST   |
+------------------+------------------+
| [ATTACK] [RECRUIT] [ENCRYPT] [DECOY]|   <- pinned action bar
+-------------------------------------+
```

Each quadrant shows the agency sigil, a 5-pip operation track, Intel balance, spy dots and encryption level. The centre Ether is where every messenger animates — routes are curved so **all traffic passes through the middle**, guaranteeing it is always visible and reachable by everyone. That is what makes the table feel alive.

**Phone (PWA):** the 2×2 grid holds — it is already compact. Quadrants compress to sigil + pips + Intel, the Ether takes the middle band, the action bar pins to the bottom safe area, and Attack opens the minigame full-screen.

---

## 7. Art direction and sources (all legitimately free)

Ships with **procedural CSS/SVG art** so the repo runs with zero downloads. A documented drop-in folder upgrades it:

| Source | Licence | Use |
| --- | --- | --- |
| [Kenney.nl](https://kenney.nl/assets) — *Top-down Tanks Redux*, *1-Bit Pack*, *Game Icons* | **CC0**, no attribution required | agent sprites, couriers, UI icons |
| [game-icons.net](https://game-icons.net) | CC BY 3.0 | spy / key / satellite iconography |
| [OpenGameArt](https://opengameart.org) filtered to CC0 | CC0 | tilesets, ambient |
| [Google Fonts](https://fonts.google.com) — *JetBrains Mono*, *Chakra Petch* | OFL | terminal / dossier typeface |

Drop sprites into `public/assets/` and flip `ART_MODE`. Keeping procedural art as the default means a fresh clone always renders — which matters when someone else has to run your project.

---

## 8. School-project requirement mapping

### CRUD (the data module)

Full create / read / update / delete over `User`, `AgencyTemplate`, `OperationTemplate`, `DirectiveTemplate`, `MinigameConfig`, `Match`, `MatchPlayer`, `Messenger`, `KeyCandidate`, `CrackAttempt`, `Purchase`, `MinigameScore`. Admin panel at `/admin` with paginated tables, edit forms and validation.

Because `OperationTemplate`, `DirectiveTemplate` and `MinigameConfig` are **read by the live game engine**, the CRUD is not a decorative side panel — editing a row changes how the next match plays. That is worth saying out loud in your defence.

### Advanced modules

- **Real-time authoritative multiplayer** — Socket.IO, server-side game loop, server as single source of truth (clients cannot fabricate a crack).
- **PWA** — installable, offline app shell, service worker, web manifest, standalone display.
- **Auth and sessions** — bcrypt + JWT in HTTP-only cookies, route protection, role-based admin.
- **Lobby system** — 6-character join codes, host controls, ready-up, reconnect-into-match.
- **Persistence and analytics** — full match history, per-player career stats, leaderboard, minigame performance breakdown.

---

## 9. Tuning constants (single source of truth)

All live in `server/engine/constants.ts` — these are the knobs to turn during playtesting:

```
OPERATION_STEPS        5
BASE_CANDIDATES        10    CANDIDATES_PER_LEVEL  1
SPY_COST               [60, 110, 180, 270]      SPY_MAX       4
ENCRYPT_COST           90  (+2 candidates)      ENCRYPT_MAX   3
ESCORT_COST            50
DECOY_COST             35   DECOY_PENALTY -40   DECOY_REWARD  25
ATTACK_COOLDOWN_MS     5000
WRONG_COMMIT_LOCK_MS   7000   WRONG_COMMIT_COST 15
PASSIVE_INTEL          4 per 10s   STARTING_INTEL  60
BLACKOUT_CRACKS        6
MATCH_HARD_CAP_MS      15 * 60 * 1000
AMBIENT_SPAWN_MS       9000   AMBIENT_TRANSIT_MS  24000
minigame durations     cipher 5000 · frequency 4500 · signal 4500
```

**These three move together.** Minigame duration, `ATTACK_COOLDOWN_MS` and the
per-directive `transitMs` define the same ratio — how many intercept windows a
courier offers. Changing one without the others silently rebalances the game.

**Timeout resolution:** most directives confirmed -> most enemy cracks -> most Intel.

---

## 10. Why this ends up a *skill* game

| Skill | Where it is tested |
| --- | --- |
| Dexterity / reflex | the three attack minigames |
| Risk assessment | when to commit at pool 2 or 3 instead of grinding to 1 |
| Economy management | spies vs encryption vs dispatching, never enough Intel |
| Threat reading | which of three rivals deserves your attention |
| Deception | decoy timing, dispatching under cover of ambient traffic |
| Tempo | dispatching D5 while the table is busy with someone else's D4 |

Luck is confined to *which* candidate keys an attack removes, and to gambles the player voluntarily takes. Everything that decides the match — how much you crack, what you buy, when you dispatch, whether you bluff — is a decision.
