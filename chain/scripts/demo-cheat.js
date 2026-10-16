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

const STATUS = ["Unknown", "Committed (in flight)", "Revealed and proven", "Defaulted"];

const ERROR_FR = {
  BadCommitment: "BadCommitment — the hash does not match the (index, nonce) pair declared",
  NotGameServer: "NotGameServer — only the game server may commit or reveal",
  AlreadyCommitted: "AlreadyCommitted — this courier already has a commitment",
  NotCommitted: "NotCommitted — no commitment for this courier",
  AlreadyRevealed: "AlreadyRevealed — already revealed",
  RevealWindowClosed: "RevealWindowClosed — the reveal deadline has passed",
  IndexOutOfRange: "IndexOutOfRange — index beyond the candidate key count",
  InvalidWindow: "InvalidWindow — invalid reveal window",
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
  return e?.shortMessage || e?.message || "unknown error";
}

async function main() {
  const [server, observer] = await ethers.getSigners();
  const Factory = await ethers.getContractFactory("CommitRevealRegistry");
  const registry = await Factory.deploy(server.address);
  await registry.waitForDeployment();
  console.log("Registry deployed at", await registry.getAddress());
  console.log("");

  const matchId = ethers.id("DEMO-MATCH");
  const courierId = ethers.id("COURIER-D1");
  const CANDIDATES = 10;

  // ── 1. The server draws its secret ────────────────────────────────────
  const realIndex = 6;
  const nonce = ethers.hexlify(ethers.randomBytes(32));
  const commitment = commitmentOf(matchId, courierId, realIndex, nonce);

  console.log("1) The server draws its key in secret");
  console.log("   real index :", realIndex, "(known only to the server)");
  console.log("   nonce      :", nonce);
  console.log("   hash       :", commitment);
  console.log("");

  // ── 2. Commit, before the courier is attackable ───────────────────────
  await (await registry.commitCourier(matchId, courierId, commitment, CANDIDATES, 600)).wait();
  console.log("2) Commitment published on-chain");
  console.log("   state      :", STATUS[Number(await registry.statusOf(matchId, courierId))]);
  const stored = await registry.getCourier(matchId, courierId);
  console.log("   stored     :", stored.commitment);
  console.log("   -> the index appears nowhere: the chain only ever sees the hash.");
  console.log("");

  // ── 3. A dishonest reveal is refused ──────────────────────────────────
  console.log("3) The server tries to cheat: it claims 9 instead of", realIndex);
  try {
    await registry.revealCourier(matchId, courierId, 9, nonce);
    console.log("   TEST FAILED: the cheat went through!");
  } catch (e) {
    console.log("   rejected   :", decodeRevert(registry, e));
    console.log("   -> the contract recomputes the hash and refuses: the lie");
    console.log("      cannot even be written into the record.");
  }
  console.log("");

  // ── 4. The honest reveal goes through ─────────────────────────────────
  await (await registry.revealCourier(matchId, courierId, realIndex, nonce)).wait();
  console.log("4) Honest reveal accepted");
  console.log("   state      :", STATUS[Number(await registry.statusOf(matchId, courierId))]);
  console.log("");

  // ── 5. Anyone verifies, with no privilege ─────────────────────────────
  const asObserver = registry.connect(observer);
  const c = await asObserver.getCourier(matchId, courierId);
  const recomputed = commitmentOf(matchId, courierId, Number(c.keyIndex), c.nonce);
  console.log("5) Verified by a third party (account", observer.address.slice(0, 10) + "...)");
  console.log("   stored hash     :", c.commitment);
  console.log("   recomputed hash :", recomputed);
  console.log("   identical       :", recomputed === c.commitment);
  console.log("   isProven()      :", await asObserver.isProven(matchId, courierId));
  console.log("");
  console.log("   -> the real key was index", Number(c.keyIndex), "- fixed BEFORE the match.");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
