# CIPHER WAR / CIPHERCHAIN

A real-time 4-player espionage game whose core mechanic — a secret key draw —
is made **provable** by a set of Solidity contracts, and whose gas is turned
into a game mechanic rather than an invisible tax.

This document covers the game, the contracts, the ETH economy, and — the part
people ask about most — **where every number actually lives and why you should
believe it**.

---

## Table of contents

1. [The game in two minutes](#1-the-game-in-two-minutes)
2. [The two design problems](#2-the-two-design-problems)
3. [The crack mechanic](#3-the-crack-mechanic)
4. [The economy](#4-the-economy)
5. [Where the data lives](#5-where-the-data-lives)
6. [The trust model](#6-the-trust-model-why-believe-any-of-it)
7. [The contracts](#7-the-contracts)
8. [Commit-reveal, properly explained](#8-commit-reveal-properly-explained)
9. [The ETH part: gas as a mechanic](#9-the-eth-part-gas-as-a-mechanic)
10. [Measured numbers](#10-measured-numbers)
11. [Running it](#11-running-it)
12. [Honest limitations](#12-honest-limitations)

---

## 1. The game in two minutes

Four intelligence agencies share one map. Each is running a secret **Operation**
made of **5 Directives**. To advance a step you dispatch a **courier** carrying
a confirmation message to your capital. It crosses the shared ether in plain
sight, and rivals can intercept it.

Every courier carries **10 candidate decryption keys**, exactly one of which is
real. Attacking a courier plays a short minigame; how well you do decides how
many candidates you cross off **your own** list. Narrow it to one and you can
commit with certainty. Commit earlier and you are gambling at `1 / poolSize`.

- Courier **arrives** → the directive is confirmed, you advance.
- Courier is **cracked** → the directive burns, and you pay to re-send it.

**First agency to confirm 5 directives wins.** Alternatively, crack **6 enemy
directives** and you win by *Blackout*.

---

## 2. The two design problems

### "The random key drop is pure luck"

The naive version — drop a random key, try it, repeat — is a 1-in-10 lottery.
A player can win on variance alone.

**The fix: attacks eliminate candidates instead of granting keys.**

| Minigame result | Candidates eliminated |
| --- | --- |
| Bronze | 1 |
| Silver | 2 |
| Gold | 3 |

Every attack makes guaranteed progress. Chance decides *which* keys fall; skill
decides *how fast the set collapses*. Two players with identical luck and
different minigame scores get measurably different outcomes — which is what
makes it a skill game.

Each attacker keeps a **separate pool** on each courier, so interception is a
live race: whoever narrows to one first takes it.

### "How does the game end fairly?"

Everyone races the same 5-step ladder, and the only way to stop someone is to
actively intercept them. This is fair because:

1. **Symmetric** — every player needs exactly 5 confirmations.
2. **No elimination** — nobody sits out watching.
3. **Bounded** — hard cap at 15 minutes with a deterministic tiebreak
   (steps → cracks → intel).
4. **Anti-snowball is in the economy, not bolted on.** Cracking pays
   `30 + 25 × level`, so the leader's D5 is worth 155 while a last-place D1 is
   worth 55. The table naturally converges on whoever is ahead.
5. **You cannot turtle** — dispatching costs intel, and cracking is the only
   real income.
6. **You cannot pure-rush** — an attacker who never dispatches must reach the
   much harder Blackout.

---

## 3. The crack mechanic

**1 — Open an attack.** Your pool initialises at `N − yourSpyCount`. Spies are
passive key-stealers that pre-eliminate candidates.

**2 — Minigame.** 4.5–5 seconds. Three rotate: *Cipher Type* (type a codeword
plus a 3-digit group), *Frequency Lock* (tap a sweeping needle inside a
shrinking band, 3 rounds), *Signal Trace* (reproduce 4 glyphs flashed over
1.4 s). They test dexterity, timing and memory, so no single player type
dominates every intercept.

**3 — Commit.** Success is `1 / poolSize`.

| Pool size | Odds | Why you'd do it |
| --- | --- | --- |
| 1 | 100% | The patient play |
| 2 | 50% | A rival is about to take it |
| 3 | 33% | It is seconds from landing |

Wrong commit → **7 s lockout on that courier, −15 intel**.

**Per-courier attack cooldown is 5 s**, so one attack cycle is about 10 seconds
for a human (≈5 s playing the minigame plus the cooldown).

### Pacing

| Directive | Transit | Dispatch cost | Crack payout |
| --- | --- | --- | --- |
| D1 | 28 s | 0 | 55 |
| D2 | 32 s | 40 | 80 |
| D3 | 38 s | 70 | 105 |
| D4 | 45 s | 110 | 130 |
| D5 | 54 s | 160 | 155 |

Key-space grows too: `10 + (level − 1) + 2 × encryptionLevel`, so a fully
encrypted D5 carries 20 candidates against a D1's 10. Re-dispatching a burned
directive costs 50%.

---

## 4. The economy

### Income

| Source | Intel |
| --- | --- |
| Crack an enemy directive | `30 + 25 × level` |
| Crack ambient traffic | 15 |
| Crack a decoy | **−40** |
| Your directive arrives | +20 |
| Passive drip | +4 / 10 s |
| Starting balance | 60 |

Ambient traffic spawns continuously so a broke player always has something to
farm — no death spiral.

### Spending

| Item | Cost | Effect | Cap |
| --- | --- | --- | --- |
| **Spy** | 60 / 110 / 180 / 270 | Pre-eliminates 1 candidate per intercept | 4 |
| **Encryption** | 90 | +2 candidates on *your* couriers | 3 |
| **Escort** | 50 | Next dispatch: every attacker downgraded one tier | consumable |
| **Decoy** | 35 | A fake courier; cracking it costs the attacker 40 | — |

**Why decoys matter:** without them, attacking is a no-brainer. With them,
every courier is a question — is this their real D4, or 35 intel of bait?

**The central tension:** every intel is offense (spies), defense
(encryption/escorts) or progress (dispatching). You never have enough for all
three.

---

## 5. Where the data lives

This is the part worth getting straight, because **"intel" exists in two
different places and they are not the same thing.**

### Three storage layers

| Layer | Holds | Lifetime | Who can write |
| --- | --- | --- | --- |
| **Server memory** | the live match | until the match ends or the server restarts | the server only |
| **SQLite (Prisma)** | accounts, history, engine config | permanent | the server only |
| **The chain** | proofs, tokens, stakes, gas | permanent, public | per-contract rules |

### What is in server memory

The authoritative live match: every player's **in-match intel**, step count,
spies, encryption, escorts, each courier's position and fuel, each attacker's
candidate pool, cooldowns and lockouts, and the real key index.

It ticks **10 times a second**. Nothing that changes at that rate can live in a
database or on a chain, so it doesn't.

This is why a server restart ends a live match — a known limitation, stated
plainly rather than hidden.

### What is in SQLite

12 Prisma models: `User`, `AgencyTemplate`, `OperationTemplate`,
`DirectiveTemplate`, `MinigameConfig`, `Match`, `MatchPlayer`, `Messenger`,
`KeyCandidate`, `CrackAttempt`, `Purchase`, `MinigameScore`.

Per finished match, each `MatchPlayer` row keeps `finalIntel`,
`directivesConfirmed`, `cracksMade`, `timesCracked`, `spiesRecruited`,
`encryptLevel`, `decoysBaited`, `placement`, `isWinner`.

The template tables are **read by the live engine at match start**, so editing a
directive's `transitMs` or `crackPayout` in `/admin` retunes the next match.
The CRUD is wired into gameplay, not decorative.

### What is on the chain

| Contract | Stores |
| --- | --- |
| `CommitRevealRegistry` | per courier: the commitment, candidate count, reveal deadline, and (after reveal) the real key index and nonce. Per match: committed/revealed counts |
| `CourierFuel` | per courier: owner, units at dispatch, units boosted, the hidden bill, booster count, landed flag. Per match: the accumulated ETH bounty |
| `IntelToken` | every address's **INTEL ERC-20 balance**, plus faucet cooldowns |
| `TournamentEscrow` | per match: stake size, pot, player list, state, winner. Per player: joined and refunded flags |
| `MatchRegistry` | per match: winner slot, win type, duration, per-player score lines. Per address: career `wins`, `played`, `totalCracks` |

### The two kinds of "intel" — do not confuse them

| | In-match intel | INTEL token |
| --- | --- | --- |
| Where | server memory | ERC-20 balance on-chain |
| Changes | many times per second | only on explicit transactions |
| Used for | spies, encryption, escorts, dispatching | staking on the outcome |
| Visible in MetaMask | no | yes |
| Survives the match | no (only the final figure is recorded) | yes |

In-match intel is **gameplay currency**. INTEL the token is the **settlement
layer** — what you wager and what the winner is paid in. Putting the gameplay
balance on-chain would mean a transaction every time you crack a courier, which
is absurd at 10 Hz.

### How much each account holds

| Account | ETH | INTEL |
| --- | --- | --- |
| Hardhat #0 — game server | 10 000 (test) | 1 000 000 minted at deploy |
| Hardhat #1–#4 — players | 10 000 each (test) | 5 000 each, seeded at deploy |
| Anyone | — | +1 000 per `faucet()` call, 1-minute cooldown |

All of this is **local test value on a Hardhat node**. It is not real money and
has no value outside your machine.

---

## 6. The trust model: why believe any of it?

Different layers earn trust differently. Being honest about which is which is
the whole point of the project.

### Server memory — trusted because you cannot reach it

The server owns all live state and clients send **intents** ("attack this
courier", "I typed this"), never outcomes. Two consequences:

- A client cannot fabricate a crack, because the server scores every minigame
  from raw inputs and the client never reports a score.
- Each player's snapshot has the real key index and every rival's pool
  **stripped before serialisation**. The information needed to cheat never
  reaches the browser.

This protects players *from each other*. It does nothing to protect them *from
the server* — which is the gap the chain closes.

### SQLite — trusted only as much as the operator

An administrator can edit any row. That is fine for match history and fine for
a school project, but it is exactly why the leaderboard is *also* anchored
on-chain: a database can be rewritten, an anchored result cannot.

### The chain — trusted because it does not need to be

Three properties do the work:

1. **The server cannot change the key.** It publishes
   `keccak256(matchId, courierId, keyIndex, nonce)` before the courier is
   attackable. At resolution it reveals the preimage, and the contract
   **rejects a reveal that does not hash to the commitment**. A lie cannot even
   be recorded.
2. **The server cannot inflate the gas bill.** The fuel demand is derived from
   the *same secret preimage*, and `deriveRequiredUnits` is `pure` and public —
   anyone recomputes it after the reveal and catches a padded bill.
3. **The server cannot steal the pot.** `TournamentEscrow` holds the stakes. If
   it never settles, every player reclaims their own stake after the deadline.
   Staying silent costs the server rather than saving it.

Access control is simple and uniform: every write-capable contract pins an
`immutable gameServer` at deployment and gates writes behind `onlyServer` —
except `boost()`, which only a **courier's owner** may call, and `faucet()` /
`claimRefund()`, which anyone may call for themselves.

### What is still trusted, and should be said out loud

- **The server decides who cracked what.** The chain proves the key was not
  swapped; it does not prove the server scored the minigame honestly.
- **The draw is not proven uniform.** Commit-reveal proves the server did not
  *change* the key, not that it picked it fairly. Making that trustless needs a
  shared source — players contributing to the nonce, or a VRF. That is the
  natural extension of the project and a good answer if asked.
- **`requiredUnits` is publicly readable** once registered. The bill is
  unpredictable *before* dispatch but visible on-chain *during* flight; it is
  hidden from the UI, not from the chain. Storing a hash of it instead would
  fix that, at the cost of moving stall detection off-chain.

---

## 7. The contracts

Solidity 0.8.20, Hardhat, OpenZeppelin for ERC-20 / `SafeERC20` /
`ReentrancyGuard`. **30 passing tests.**

### `CommitRevealRegistry`

The core proof.

```solidity
commitCourier(matchId, courierId, commitment, candidateCount, revealWindowSeconds)
revealCourier(matchId, courierId, keyIndex, nonce)   // reverts on mismatch
computeCommitment(matchId, courierId, keyIndex, nonce) pure
statusOf(matchId, courierId)   // Unknown | Committed | Revealed | Defaulted
isProven(matchId, courierId)
```

`matchId` and `courierId` are inside the hash, so a commitment **cannot be
replayed** onto another courier. A server that never reveals is marked
`Defaulted` past its deadline — public evidence rather than a silent exit.

### `CourierFuel`

Gas as a mechanic.

```solidity
registerCourier(matchId, courierId, owner, unitsAtDispatch, requiredUnits)
boost(matchId, courierId) payable          // owner only
deriveRequiredUnits(matchId, courierId, keyIndex, nonce) pure
fuelWasHonest(matchId, courierId, keyIndex, nonce)
unitsOutstanding(...)  isStalled(...)  quote(units)
markLanded(...)  payBounty(matchId, winner)
```

### `IntelToken` (ERC-20, `INTEL`)

1 000 000 minted to the server at deploy; owner `mint`; public `faucet()`
granting 1 000 with a 1-minute per-address cooldown so demo accounts can be
funded without the owner.

### `TournamentEscrow`

```solidity
createTournament(matchId, stake, maxPlayers, joinWindow, settleWindow)
join(matchId)              // requires approve() first — the ERC-20 two-step
lock(matchId)              // a full table locks itself
settle(matchId, winner)    // before settleDeadline
claimRefund(matchId)       // after it, if never settled
```

### `MatchRegistry`

`finalizeMatch(matchId, winnerSlot, winType, durationSeconds, results[])` plus
per-address `wins`, `played`, `totalCracks`. **One write per match, not per
action.**

---

## 8. Commit-reveal, properly explained

Two properties do all the work.

| Property | Guarantees | Comes from |
| --- | --- | --- |
| **Binding** | the server cannot change its answer | keccak256 is collision-resistant |
| **Hiding** | nobody can read the key early | the random 32-byte **nonce** |

**The nonce is the detail to know cold.** Without it there are only 10 possible
commitments — anyone hashes indices 0–9 and finds yours instantly. The nonce is
what makes the commitment hiding rather than merely binding. It is the most
likely question at a defence.

```
BEFORE the courier is attackable
  index = 6, nonce = 0x2b14…
  commitCourier(matchId, courierId, keccak256(...), 10, window)
  → the chain sees ONLY the hash

DURING flight (~30 s, off-chain)
  players attack and eliminate candidates
  → the server's answer is already frozen

ON RESOLUTION
  revealCourier(matchId, courierId, 6, 0x2b14…)
  → the contract recomputes and REFUSES if it differs

AFTERWARDS, anyone
  recompute locally and compare — the /chain audit page does exactly this
```

**The constraint that must not be missed:** the commitment has to land *before*
the courier becomes attackable. A late commitment would leave the server a
window to choose the key after the fact, voiding the guarantee. The engine
therefore holds a courier out of play until both its anchoring transactions
confirm, and cancels the dispatch if either fails.

---

## 9. The ETH part: gas as a mechanic

A courier *is* a transaction: dispatched, in flight, landing or not. So it burns
fuel like one.

```
0.001 ETH = 1 fuel unit = 5 seconds of travel      (max 6 units per transaction)
```

Every courier leaves with **3 units — 15 seconds of fuel** for a route that
needs 28–54 seconds. It **always** runs dry. A courier out of fuel **freezes in
the ether, still fully attackable**, until its owner signs a `boost()`.

### The bill is unknown, and provably not inflated

`requiredUnits` is derived from the **secret preimage** (`keyIndex` + `nonce`),
in the range **4–15 units**:

- The player cannot predict it — it depends on a nonce they will not see until
  the reveal. They discover it by paying until the courier moves.
- The server cannot inflate it — `deriveRequiredUnits` is pure and public, so
  after the reveal anyone calls `fuelWasHonest()` and catches a padded bill the
  same way a swapped key is caught.

Measured in a single simulated match: two couriers drew **5 units** (one
booster, 0.002 ETH) while a third drew **13** (two boosters, 0.01 ETH). Five
times the cost, unknowable in advance.

### Where the ETH goes

Not burned. It accumulates into a **per-match bounty paid to the winner**, so
everything spent keeping messages alive enlarges the prize everyone is fighting
over. The per-transaction cap exists so a rich player cannot buy away all the
tension at once.

### Two pots at the end

| Pot | Asset | Paid by |
| --- | --- | --- |
| Stakes | INTEL (ERC-20) | `TournamentEscrow.settle()` |
| Gas bounty | ETH | `CourierFuel.payBounty()` |

### The wallet flow

1. **In the lobby**, link your wallet — this must happen *before* your first
   dispatch, because the server records the courier's owner on-chain at dispatch
   time. A player with no wallet gets a courier nobody can refuel, so it is
   given unlimited fuel and skips the mechanic entirely.
2. **Stake** — `approve` then `join`. MetaMask prompts twice; that is the
   standard ERC-20 allowance pattern, not a bug.
3. **In the match**, a stalled courier shows **PANNE** on the map and the fuel
   panel offers `+1 / +3 / +6`.
4. Boosts are credited from the **`CourierBoosted` event**, never from the
   client — fuel cannot be claimed without the money having actually moved.

---

## 10. Measured numbers

### Transactions and gas

From `scripts/simulate-match.js`, one match with 3 couriers and 4 players:

```
Transactions : 27
Total gas    : 2 369 912
  server       1 517 808
  Nord           275 157
  Est            206 757
  Sud            206 757
  Ouest          163 433
```

A full 5-directive, 4-player match is roughly **81–108 transactions**. Free on a
local node; in production you would batch commitments per dispatch wave or move
to an L2.

### Balance, and what is still unknown

Against a *perfect* attacker (answers every minigame correctly, so always Gold):

| Scenario | Attacks needed | Bot time | Human time |
| --- | --- | --- | --- |
| Undefended D1 | 3 | 14.3 s | ~30 s |
| Under escort | 5 | 26.7 s | ~50 s |

The columns differ for a real reason: the bot submits instantly, so its cycle is
just the 5 s cooldown, while a human must actually *play* the ~5 s minigame.
**The human column is what the balance has to hold against.**

An undefended D1 is genuinely marginal — ~30 s of flawless, undivided attention
against a 28 s transit. The escort costs 50 of your starting 60 intel and pushes
a solo human attacker to ~50 s, so **an escorted courier beats a flawless solo
attacker**; breaking it needs two people on the same target.

**Open question.** The stall mechanic was measured with `scripts/stall-balance.mjs`
and the result was *inconclusive*: the bot cracks in 3 attacks (~15 s), which
lands right as the courier first stalls, so the stall never mattered to it. At
human pace the arithmetic says roughly **+1 attack window per 10 s stalled**, and
since a 28 s transit only affords about 2.8 windows against 3 needed, even one
extra window tips an already-marginal D1 into reliably burning. If that plays
badly, the first lever is `FUEL_UNITS_AT_DISPATCH` (stall later, less remaining
travel to exploit), then `BASE_CANDIDATES`.

---

## 11. Running it

**One app, one port.** The chain console that once lived on `:8080` is gone; its
verification view is now the `/chain` page inside the game.

```bash
cd chain && npx hardhat node
```

```bash
cd chain && npx hardhat run scripts/deploy.js --network localhost
```

Copy `chain/chain.env` into the game's `.env`, then:

```bash
npm run setup && npm run dev
```

Open **http://localhost:3100** in Chrome with MetaMask. Add the network
(`http://127.0.0.1:8545`, chain ID `31337`) and import a player key:

```
Player 1  0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d
Player 2  0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a
```

Demo accounts: `admin`, `nord`, `est`, `sud`, `ouest` — password `cipher123`.

### Scripts

| Command | Does |
| --- | --- |
| `cd chain && npx hardhat test` | 30 contract tests |
| `npm run simulate` (in `chain/`) | whole match on-chain + gas ledger |
| `npm run demo` (in `chain/`) | commit/reveal with a rejected cheat |
| `node scripts/chain-playtest.mjs` | anchor → stall → boost → resume, live |
| `node scripts/stall-balance.mjs` | what a stall costs under attack |
| `node scripts/sit-in.mjs CODE est --play` | drop a bot into a lobby |

**Do not run `deploy.js` or `simulate-match.js` while the game server is live** —
they spend from the same account #0 and will fight it for nonces.

---

## 12. Honest limitations

- **The server restarting ends live matches.** Match state is in memory by
  design; only finished matches are persisted.
- **Minigame scoring is trusted.** *Cipher Type* is sound. *Signal Trace* and
  *Frequency Lock* must ship their target to the client in order to be drawn,
  so someone reading the websocket could beat those two. Score *injection* is
  closed everywhere — the server scores from raw inputs and issues the
  challenge itself.
- **The draw is not proven uniform** — see §6.
- **`requiredUnits` is readable on-chain during flight** — see §6.
- **Balance is tuned from a perfect-play bot**, not four humans, and the stall's
  cost is still unmeasured at human pace — see §10.
- **Everything is a local testnet.** Deploying publicly needs a funded account,
  an RPC endpoint, and hosting that supports WebSockets (Vercel does not).
- **The service worker is production-only.** In development it would pair fresh
  HTML with stale JavaScript, because Next's dev chunk names are not
  content-hashed.
