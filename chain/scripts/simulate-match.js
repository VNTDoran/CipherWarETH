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

const fmt = (wei) => ethers.formatEther(wei);

async function main() {
  const signers = await ethers.getSigners();
  const server = signers[0];
  const players = signers.slice(1, 5);
  const names = ["Nord", "Est", "Sud", "Ouest"];

  console.log("═══ DÉPLOIEMENT ═══\n");
  const token = await (await ethers.getContractFactory("IntelToken")).deploy(server.address);
  const registry = await (await ethers.getContractFactory("CommitRevealRegistry")).deploy(server.address);
  const fuel = await (await ethers.getContractFactory("CourierFuel")).deploy(server.address);
  const matches = await (await ethers.getContractFactory("MatchRegistry")).deploy(server.address);
  const escrow = await (await ethers.getContractFactory("TournamentEscrow")).deploy(
    await token.getAddress(),
    server.address,
  );
  for (const c of [token, registry, fuel, matches, escrow]) await c.waitForDeployment();
  console.log("  5 contrats déployés\n");

  const matchId = ethers.id("SIM-" + Date.now());

  // ── 1. Buy-in ──────────────────────────────────────────────────────────
  console.log("═══ 1 · MISE DES JOUEURS (ERC-20) ═══\n");
  await tx("createTournament", "serveur", escrow.createTournament(matchId, STAKE, 4, 3600, 3600));

  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    await (await token.mint(p.address, ethers.parseEther("1000"))).wait();
    // Two-step ERC-20: approve, then the contract pulls. MetaMask prompts twice.
    await tx("approve(escrow, 100 INTEL)", names[i], token.connect(p).approve(await escrow.getAddress(), STAKE));
    await tx("join (stake 100 INTEL)", names[i], escrow.connect(p).join(matchId));
  }

  const t = await escrow.getTournament(matchId);
  console.log(`\n  Pot : ${fmt(t.pot)} INTEL · table verrouillée automatiquement (4/4)\n`);

  // ── 2. The match: dispatch, stall, boost, reveal ───────────────────────
  console.log("═══ 2 · LA PARTIE : ENGAGEMENT, PANNE, BOOST, RÉVÉLATION ═══\n");

  const secrets = [];
  for (let i = 0; i < 3; i++) {
    const owner = players[i];
    const courierId = ethers.id(`COURIER-${i}-${Date.now()}`);
    const keyIndex = Math.floor(Math.random() * CANDIDATES);
    const nonce = ethers.hexlify(ethers.randomBytes(32));
    secrets.push({ courierId, keyIndex, nonce, owner, name: names[i] });

    console.log(`  — Messager ${i + 1} (${names[i]}), clé réelle ${keyIndex} gardée secrète`);
    await tx(
      "commitCourier",
      "serveur",
      registry.commitCourier(matchId, courierId, commitmentOf(matchId, courierId, keyIndex, nonce), CANDIDATES, 3600),
    );
    await tx("registerCourier (3 unités)", "serveur", fuel.registerCourier(matchId, courierId, owner.address, FUEL_AT_DISPATCH));

    // The courier runs dry mid-flight and freezes. Only the owner's own
    // wallet can restart it.
    const units = 1 + (i % 2); // 1 or 2 units
    const value = await fuel.quote(units);
    console.log(`    ↳ panne sèche à 15 s — ${names[i]} envoie un booster (${fmt(value)} ETH)`);
    await tx(`boost (+${units} unités)`, names[i], fuel.connect(owner).boost(matchId, courierId, { value }));
    const secs = await fuel.travelSecondsOf(matchId, courierId);
    console.log(`    ↳ reparti : ${secs} s de trajet payées au total\n`);
  }

  // ── 3. A cheating reveal is refused ────────────────────────────────────
  console.log("═══ 3 · TENTATIVE DE TRICHE ═══\n");
  const victim = secrets[0];
  const wrong = (victim.keyIndex + 3) % CANDIDATES;
  console.log(`  Le serveur tente d'annoncer ${wrong} au lieu de ${victim.keyIndex}…`);
  try {
    await registry.revealCourier(matchId, victim.courierId, wrong, victim.nonce);
    console.log("  ÉCHEC DU TEST : la triche est passée !\n");
  } catch (e) {
    let name = e.shortMessage || e.message;
    const data = e?.data ?? e?.info?.error?.data ?? null;
    if (typeof data === "string") {
      try { name = registry.interface.parseError(data).name; } catch (_) {}
    }
    console.log(`  rejeté : ${name} — l'empreinte ne correspond pas.`);
    console.log("  La transaction échoue, donc le mensonge n'est jamais inscrit.\n");
  }

  // ── 4. Honest reveals ──────────────────────────────────────────────────
  console.log("═══ 4 · RÉVÉLATIONS HONNÊTES ═══\n");
  for (const s of secrets) {
    await tx("revealCourier", "serveur", registry.revealCourier(matchId, s.courierId, s.keyIndex, s.nonce));
    await tx("markLanded", "serveur", fuel.markLanded(matchId, s.courierId));
  }
  console.log(`\n  Engagés : ${await registry.committedCount(matchId)} · Révélés : ${await registry.revealedCount(matchId)}\n`);

  // ── 5. Settlement ──────────────────────────────────────────────────────
  console.log("═══ 5 · RÈGLEMENT ═══\n");
  const winner = players[0];
  const winnerName = names[0];

  const intelBefore = await token.balanceOf(winner.address);
  const ethBefore = await ethers.provider.getBalance(winner.address);
  const bounty = await fuel.bounty(matchId);

  await tx("finalizeMatch", "serveur", matches.finalizeMatch(matchId, 0, 0, 480, [
    { player: players[0].address, slot: 0, directivesConfirmed: 5, cracksMade: 3, finalIntel: 210 },
    { player: players[1].address, slot: 1, directivesConfirmed: 3, cracksMade: 4, finalIntel: 150 },
    { player: players[2].address, slot: 2, directivesConfirmed: 2, cracksMade: 1, finalIntel: 90 },
    { player: players[3].address, slot: 3, directivesConfirmed: 1, cracksMade: 2, finalIntel: 60 },
  ]));
  await tx("settle (pot INTEL -> vainqueur)", "serveur", escrow.settle(matchId, winner.address));
  await tx("payBounty (gaz ETH -> vainqueur)", "serveur", fuel.payBounty(matchId, winner.address));

  const intelAfter = await token.balanceOf(winner.address);
  const ethAfter = await ethers.provider.getBalance(winner.address);

  console.log("");
  console.log(`  Vainqueur : ${winnerName} (${winner.address.slice(0, 12)}…)`);
  console.log(`  INTEL : ${fmt(intelBefore)} → ${fmt(intelAfter)}  (+${fmt(intelAfter - intelBefore)})`);
  console.log(`  ETH   : ${fmt(ethBefore)} → ${fmt(ethAfter)}  (prime de gaz +${fmt(bounty)})`);
  console.log(`  Palmarès on-chain : ${await matches.wins(winner.address)} victoire(s), ${await matches.totalCracks(winner.address)} décryptages`);

  // ── Ledger ─────────────────────────────────────────────────────────────
  console.log("\n═══ BILAN ═══\n");
  const byWho = {};
  for (const l of ledger) {
    byWho[l.who] = (byWho[l.who] ?? 0n) + l.gas;
  }
  console.log(`  Transactions : ${ledger.length}`);
  console.log(`  Gaz total    : ${gasTotal.toString()}`);
  for (const [who, gas] of Object.entries(byWho)) {
    console.log(`    ${who.padEnd(10)} ${gas.toString().padStart(8)}`);
  }
  const perMatch = ledger.length;
  console.log(`\n  Pour une partie complète (5 directives × 4 joueurs + boosts),`);
  console.log(`  comptez environ ${perMatch * 3}–${perMatch * 4} transactions.`);
  console.log("  Gratuit en local ; en production il faudrait regrouper ou passer sur un L2.");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
