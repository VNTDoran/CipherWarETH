const { ethers } = require("hardhat");

/**
 * Walks the whole lifecycle against the local node, including a cheating
 * server being rejected. Run it in front of the professor — it is the shortest
 * proof that the mechanism does what the proposal claims.
 *
 *   npx hardhat run scripts/demo-cheat.js --network localhost
 */

function commitmentOf(matchId, courierId, keyIndex, nonce) {
  return ethers.keccak256(
    ethers.solidityPacked(
      ["bytes32", "bytes32", "uint8", "bytes32"],
      [matchId, courierId, keyIndex, nonce],
    ),
  );
}

const STATUS = ["Inconnu", "Engagé (en vol)", "Révélé et prouvé", "Défaillant"];

const ERROR_FR = {
  BadCommitment: "BadCommitment — l'empreinte ne correspond pas au couple (index, nonce) annoncé",
  NotGameServer: "NotGameServer — seul le serveur de jeu peut engager ou révéler",
  AlreadyCommitted: "AlreadyCommitted — ce messager a déjà un engagement",
  NotCommitted: "NotCommitted — aucun engagement pour ce messager",
  AlreadyRevealed: "AlreadyRevealed — déjà révélé",
  RevealWindowClosed: "RevealWindowClosed — délai de révélation dépassé",
  IndexOutOfRange: "IndexOutOfRange — index hors du nombre de clés candidates",
  InvalidWindow: "InvalidWindow — fenêtre de révélation invalide",
};

/**
 * ethers does not always decode a custom error raised during gas estimation,
 * so it can surface as a raw selector like 0xc38b437f. The ABI knows the name,
 * so decode it ourselves rather than printing hex at a demo.
 */
function decodeRevert(contract, e) {
  const data =
    e?.data ?? e?.info?.error?.data ?? e?.error?.data ?? e?.revert?.data ?? null;
  if (typeof data === "string" && data.length >= 10) {
    try {
      const parsed = contract.interface.parseError(data);
      if (parsed) return ERROR_FR[parsed.name] ?? parsed.name;
    } catch {
      /* fall through to the generic message */
    }
  }
  if (e?.revert?.name) return ERROR_FR[e.revert.name] ?? e.revert.name;
  return e?.shortMessage || e?.message || "erreur inconnue";
}

async function main() {
  const [server, observer] = await ethers.getSigners();
  const Factory = await ethers.getContractFactory("CommitRevealRegistry");
  const registry = await Factory.deploy(server.address);
  await registry.waitForDeployment();
  console.log("Registre déployé à :", await registry.getAddress());
  console.log("");

  const matchId = ethers.id("DEMO-MATCH");
  const courierId = ethers.id("COURIER-D1");
  const CANDIDATES = 10;

  // ── 1. The server draws its secret ────────────────────────────────────
  const realIndex = 6;
  const nonce = ethers.hexlify(ethers.randomBytes(32));
  const commitment = commitmentOf(matchId, courierId, realIndex, nonce);

  console.log("1) Le serveur tire sa clé en secret");
  console.log("   index réel  :", realIndex, "(connu du serveur seul)");
  console.log("   nonce       :", nonce);
  console.log("   empreinte   :", commitment);
  console.log("");

  // ── 2. Commit, before the courier is attackable ───────────────────────
  await (await registry.commitCourier(matchId, courierId, commitment, CANDIDATES, 600)).wait();
  console.log("2) Engagement publié on-chain");
  console.log("   état        :", STATUS[Number(await registry.statusOf(matchId, courierId))]);
  const stored = await registry.getCourier(matchId, courierId);
  console.log("   stocké      :", stored.commitment);
  console.log("   → l'index n'apparaît nulle part : la chaîne ne voit que l'empreinte.");
  console.log("");

  // ── 3. A dishonest reveal is refused ──────────────────────────────────
  console.log("3) Le serveur tente de tricher : il annonce 9 au lieu de", realIndex);
  try {
    await registry.revealCourier(matchId, courierId, 9, nonce);
    console.log("   ÉCHEC DU TEST : la triche est passée !");
  } catch (e) {
    console.log("   rejeté      :", decodeRevert(registry, e));
    console.log("   → le contrat recalcule l'empreinte et refuse : le mensonge");
    console.log("     ne peut même pas être inscrit dans l'historique.");
  }
  console.log("");

  // ── 4. The honest reveal goes through ─────────────────────────────────
  await (await registry.revealCourier(matchId, courierId, realIndex, nonce)).wait();
  console.log("4) Révélation honnête acceptée");
  console.log("   état        :", STATUS[Number(await registry.statusOf(matchId, courierId))]);
  console.log("");

  // ── 5. Anyone verifies, with no privilege ─────────────────────────────
  const asObserver = registry.connect(observer);
  const c = await asObserver.getCourier(matchId, courierId);
  const recomputed = commitmentOf(matchId, courierId, Number(c.keyIndex), c.nonce);
  console.log("5) Vérification par un tiers (compte", observer.address.slice(0, 10) + "…)");
  console.log("   empreinte stockée    :", c.commitment);
  console.log("   empreinte recalculée :", recomputed);
  console.log("   identiques           :", recomputed === c.commitment);
  console.log("   isProven()           :", await asObserver.isProven(matchId, courierId));
  console.log("");
  console.log("   → la clé réelle était l'index", Number(c.keyIndex), ", fixé AVANT la partie.");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
