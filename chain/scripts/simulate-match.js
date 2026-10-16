const { ethers } = require("hardhat");

/**
 * Simulates a whole match on-chain and prints a transaction ledger.
 *
 *   npx hardhat run scripts/simulate-match.js --network localhost
 *
 * Every line below is a real transaction against the local node, signed by the
 * account that would really sign it in play: the server commits and reveals,
 * the players stake and refuel their own couriers. It exists so you can show
 * the whole economy working without needing four people and four browsers.
 */

const STAKE = ethers.parseEther("100");
const CANDIDATES = 10;
const FUEL_AT_DISPATCH = 3; // 15 s of travel before a courier stalls

// ──────────────────────────── tx bookkeeping ─────────────────────────────

const ledger = [];
let gasTotal = 0n;

async function tx(label, who, promise) {
  const sent = await promise;
  const receipt = await sent.wait();
  gasTotal += receipt.gasUsed;
  ledger.push({ label, who, gas: receipt.gasUsed, hash: receipt.hash });
  console.log(
    `  [tx ${String(ledger.length).padStart(2)}] ${label.padEnd(34)} ${who.padEnd(10)} gas ${receipt.gasUsed
      .toString()
      .padStart(7)}`,
  );
  return receipt;
}

function commitmentOf(matchId, courierId, keyIndex, nonce) {
  return ethers.keccak256(
    ethers.solidityPacked(
      ["bytes32", "bytes32", "uint8", "bytes32"],
      [matchId, courierId, keyIndex, nonce],
    ),
  );
}

/**
 * The hidden fuel bill, derived from the SECRET preimage. The server can work
 * it out at dispatch; the player cannot, because it depends on a nonce they
 * will not see until the reveal. Mirrors CourierFuel.deriveRequiredUnits.
 */
function requiredUnitsOf(matchId, courierId, keyIndex, nonce, min = 4, max = 15) {
  const h = BigInt(
    ethers.keccak256(
      ethers.solidityPacked(
        ["string", "bytes32", "bytes32", "uint8", "bytes32"],
        ["FUEL", matchId, courierId, keyIndex, nonce],
      ),
    ),
  );
  return Number(BigInt(min) + (h % BigInt(max - min + 1)));
}

const fmt = (wei) => ethers.formatEther(wei);

async function main() {
  const signers = await ethers.getSigners();
  const server = signers[0];
  const players = signers.slice(1, 5);
  const names = ["Nord", "Est", "Sud", "Ouest"];

  console.log("=== DEPLOYMENT ===\n");
  const token = await (await ethers.getContractFactory("IntelToken")).deploy(server.address);
  const registry = await (await ethers.getContractFactory("CommitRevealRegistry")).deploy(server.address);
  const fuel = await (await ethers.getContractFactory("CourierFuel")).deploy(server.address);
  const matches = await (await ethers.getContractFactory("MatchRegistry")).deploy(server.address);
  const escrow = await (await ethers.getContractFactory("TournamentEscrow")).deploy(
    await token.getAddress(),
    server.address,
  );
  for (const c of [token, registry, fuel, matches, escrow]) await c.waitForDeployment();
  console.log("  5 contracts deployed\n");

  const matchId = ethers.id("SIM-" + Date.now());

  // ── 1. Buy-in ──────────────────────────────────────────────────────────
  console.log("=== 1. PLAYERS STAKE (ERC-20) ===\n");
  await tx("createTournament", "server", escrow.createTournament(matchId, STAKE, 4, 3600, 3600));

  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    await (await token.mint(p.address, ethers.parseEther("1000"))).wait();
    // Two-step ERC-20: approve, then the contract pulls. MetaMask prompts twice.
    await tx("approve(escrow, 100 INTEL)", names[i], token.connect(p).approve(await escrow.getAddress(), STAKE));
    await tx("join (stake 100 INTEL)", names[i], escrow.connect(p).join(matchId));
  }

  const t = await escrow.getTournament(matchId);
  console.log(`\n  Pot: ${fmt(t.pot)} INTEL - table locked automatically (4/4)\n`);

  // ── 2. The match: dispatch, stall, boost, reveal ───────────────────────
  console.log("=== 2. THE MATCH: COMMIT, STALL, BOOST, REVEAL ===\n");

  const secrets = [];
  for (let i = 0; i < 3; i++) {
    const owner = players[i];
    const courierId = ethers.id(`COURIER-${i}-${Date.now()}`);
    const keyIndex = Math.floor(Math.random() * CANDIDATES);
    const nonce = ethers.hexlify(ethers.randomBytes(32));
    secrets.push({ courierId, keyIndex, nonce, owner, name: names[i] });

    const required = requiredUnitsOf(matchId, courierId, keyIndex, nonce);

    console.log(`  - Courier ${i + 1} (${names[i]}), real key ${keyIndex} kept secret`);
    await tx(
      "commitCourier",
      "server",
      registry.commitCourier(matchId, courierId, commitmentOf(matchId, courierId, keyIndex, nonce), CANDIDATES, 3600),
    );
    await tx(
      `registerCourier (${FUEL_AT_DISPATCH} at dispatch)`,
      "server",
      fuel.registerCourier(matchId, courierId, owner.address, FUEL_AT_DISPATCH, required),
    );
    console.log(`    -> hidden bill: ${required} units - ${names[i]} cannot see it`);

    // The courier freezes and stays frozen until the full bill is paid. The
    // player pays blind, in capped chunks, discovering the cost as they go.
    let owed = Number(await fuel.unitsOutstanding(matchId, courierId));
    let spent = 0n;
    let clicks = 0;
    while (owed > 0) {
      const chunk = Math.min(owed, 6);
      const value = await fuel.quote(chunk);
      await tx(`boost (+${chunk})`, names[i], fuel.connect(owner).boost(matchId, courierId, { value }));
      spent += value;
      clicks++;
      owed = Number(await fuel.unitsOutstanding(matchId, courierId));
      console.log(`    -> booster ${clicks}: ${fmt(value)} ETH, ${owed} unit(s) still owed`);
    }
    console.log(`    -> moving again after ${clicks} booster(s), ${fmt(spent)} ETH spent\n`);
  }

  // ── 3. A cheating reveal is refused ────────────────────────────────────
  console.log("=== 3. CHEAT ATTEMPT ===\n");
  const victim = secrets[0];
  const wrong = (victim.keyIndex + 3) % CANDIDATES;
  console.log(`  The server tries to claim ${wrong} instead of ${victim.keyIndex}...`);
  try {
    await registry.revealCourier(matchId, victim.courierId, wrong, victim.nonce);
    console.log("  TEST FAILED: the cheat went through!\n");
  } catch (e) {
    let name = e.shortMessage || e.message;
    const data = e?.data ?? e?.info?.error?.data ?? null;
    if (typeof data === "string") {
      try { name = registry.interface.parseError(data).name; } catch (_) {}
    }
    console.log(`  rejected: ${name} - the hash does not match.`);
    console.log("  The transaction fails, so the lie is never recorded.\n");
  }

  // ── 4. Honest reveals ──────────────────────────────────────────────────
  console.log("=== 4. HONEST REVEALS ===\n");
  for (const s of secrets) {
    await tx("revealCourier", "server", registry.revealCourier(matchId, s.courierId, s.keyIndex, s.nonce));
    await tx("markLanded", "server", fuel.markLanded(matchId, s.courierId));
  }
  console.log(`\n  Committed: ${await registry.committedCount(matchId)} - Revealed: ${await registry.revealedCount(matchId)}\n`);

  // ── 5. Settlement ──────────────────────────────────────────────────────
  console.log("=== 5. SETTLEMENT ===\n");
  const winner = players[0];
  const winnerName = names[0];

  const intelBefore = await token.balanceOf(winner.address);
  const ethBefore = await ethers.provider.getBalance(winner.address);
  const bounty = await fuel.bounty(matchId);

  await tx("finalizeMatch", "server", matches.finalizeMatch(matchId, 0, 0, 480, [
    { player: players[0].address, slot: 0, directivesConfirmed: 5, cracksMade: 3, finalIntel: 210 },
    { player: players[1].address, slot: 1, directivesConfirmed: 3, cracksMade: 4, finalIntel: 150 },
    { player: players[2].address, slot: 2, directivesConfirmed: 2, cracksMade: 1, finalIntel: 90 },
    { player: players[3].address, slot: 3, directivesConfirmed: 1, cracksMade: 2, finalIntel: 60 },
  ]));
  await tx("settle (INTEL pot -> winner)", "server", escrow.settle(matchId, winner.address));
  await tx("payBounty (ETH gas bounty -> winner)", "server", fuel.payBounty(matchId, winner.address));

  const intelAfter = await token.balanceOf(winner.address);
  const ethAfter = await ethers.provider.getBalance(winner.address);

  console.log("");
  console.log(`  Winner: ${winnerName} (${winner.address.slice(0, 12)}...)`);
  console.log(`  INTEL: ${fmt(intelBefore)} -> ${fmt(intelAfter)}  (+${fmt(intelAfter - intelBefore)})`);
  console.log(`  ETH  : ${fmt(ethBefore)} -> ${fmt(ethAfter)}  (gas bounty +${fmt(bounty)})`);
  console.log(`  On-chain record: ${await matches.wins(winner.address)} win(s), ${await matches.totalCracks(winner.address)} cracks`);

  // ── Ledger ─────────────────────────────────────────────────────────────
  console.log("\n=== SUMMARY ===\n");
  const byWho = {};
  for (const l of ledger) {
    byWho[l.who] = (byWho[l.who] ?? 0n) + l.gas;
  }
  console.log(`  Transactions: ${ledger.length}`);
  console.log(`  Total gas   : ${gasTotal.toString()}`);
  for (const [who, gas] of Object.entries(byWho)) {
    console.log(`    ${who.padEnd(10)} ${gas.toString().padStart(8)}`);
  }
  const perMatch = ledger.length;
  console.log(`\n  For a full match (5 directives x 4 players + boosters),`);
  console.log(`  expect roughly ${perMatch * 3}-${perMatch * 4} transactions.`);
  console.log("  Free locally; in production you would batch these or move to an L2.");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
