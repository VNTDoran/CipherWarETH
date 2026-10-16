const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const MATCH_ID = ethers.id("MATCH-001");
const COURIER_ID = ethers.id("COURIER-D1");
const CANDIDATES = 10;
const WINDOW = 300; // seconds

/** The exact hash the contract expects: keccak256(abi.encodePacked(...)). */
function commitmentOf(matchId, courierId, keyIndex, nonce) {
  return ethers.keccak256(
    ethers.solidityPacked(
      ["bytes32", "bytes32", "uint8", "bytes32"],
      [matchId, courierId, keyIndex, nonce],
    ),
  );
}

describe("CommitRevealRegistry", function () {
  let registry, server, player, nonce;

  beforeEach(async function () {
    [server, player] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("CommitRevealRegistry");
    registry = await Factory.deploy(server.address);
    await registry.waitForDeployment();
    nonce = ethers.hexlify(ethers.randomBytes(32));
  });

  it("accepts a reveal that matches the commitment", async function () {
    const keyIndex = 7;
    const commitment = commitmentOf(MATCH_ID, COURIER_ID, keyIndex, nonce);

    await registry.commitCourier(MATCH_ID, COURIER_ID, commitment, CANDIDATES, WINDOW);
    expect(await registry.statusOf(MATCH_ID, COURIER_ID)).to.equal(1); // Committed

    await expect(registry.revealCourier(MATCH_ID, COURIER_ID, keyIndex, nonce))
      .to.emit(registry, "CourierRevealed")
      .withArgs(MATCH_ID, COURIER_ID, keyIndex, nonce);

    expect(await registry.statusOf(MATCH_ID, COURIER_ID)).to.equal(2); // Revealed
    expect(await registry.isProven(MATCH_ID, COURIER_ID)).to.equal(true);
  });

  // This is the whole point of the project: a server that changes its mind
  // mid-match cannot get that lie recorded.
  it("rejects a server that swaps the key after committing", async function () {
    const honestIndex = 3;
    const commitment = commitmentOf(MATCH_ID, COURIER_ID, honestIndex, nonce);
    await registry.commitCourier(MATCH_ID, COURIER_ID, commitment, CANDIDATES, WINDOW);

    // A player is about to guess 3, so the server tries to claim it was 8.
    await expect(
      registry.revealCourier(MATCH_ID, COURIER_ID, 8, nonce),
    ).to.be.revertedWithCustomError(registry, "BadCommitment");

    // And it cannot brute-force a different nonce either.
    const otherNonce = ethers.hexlify(ethers.randomBytes(32));
    await expect(
      registry.revealCourier(MATCH_ID, COURIER_ID, 8, otherNonce),
    ).to.be.revertedWithCustomError(registry, "BadCommitment");

    // The courier stays unproven.
    expect(await registry.isProven(MATCH_ID, COURIER_ID)).to.equal(false);
  });

  it("marks a silent server as Defaulted once the deadline passes", async function () {
    const commitment = commitmentOf(MATCH_ID, COURIER_ID, 1, nonce);
    await registry.commitCourier(MATCH_ID, COURIER_ID, commitment, CANDIDATES, WINDOW);

    await time.increase(WINDOW + 1);
    expect(await registry.statusOf(MATCH_ID, COURIER_ID)).to.equal(3); // Defaulted

    await expect(
      registry.revealCourier(MATCH_ID, COURIER_ID, 1, nonce),
    ).to.be.revertedWithCustomError(registry, "RevealWindowClosed");
  });

  it("only the game server can commit or reveal", async function () {
    const commitment = commitmentOf(MATCH_ID, COURIER_ID, 1, nonce);
    await expect(
      registry.connect(player).commitCourier(MATCH_ID, COURIER_ID, commitment, CANDIDATES, WINDOW),
    ).to.be.revertedWithCustomError(registry, "NotGameServer");
  });

  it("refuses a second commitment for the same courier", async function () {
    const commitment = commitmentOf(MATCH_ID, COURIER_ID, 1, nonce);
    await registry.commitCourier(MATCH_ID, COURIER_ID, commitment, CANDIDATES, WINDOW);
    await expect(
      registry.commitCourier(MATCH_ID, COURIER_ID, commitment, CANDIDATES, WINDOW),
    ).to.be.revertedWithCustomError(registry, "AlreadyCommitted");
  });

  it("rejects an index outside the candidate range", async function () {
    const commitment = commitmentOf(MATCH_ID, COURIER_ID, 99, nonce);
    await registry.commitCourier(MATCH_ID, COURIER_ID, commitment, CANDIDATES, WINDOW);
    await expect(
      registry.revealCourier(MATCH_ID, COURIER_ID, 99, nonce),
    ).to.be.revertedWithCustomError(registry, "IndexOutOfRange");
  });

  // A commitment is bound to its courier, so it cannot be reused elsewhere.
  it("will not let a commitment be replayed onto another courier", async function () {
    const keyIndex = 4;
    const commitment = commitmentOf(MATCH_ID, COURIER_ID, keyIndex, nonce);
    const otherCourier = ethers.id("COURIER-D2");

    await registry.commitCourier(MATCH_ID, otherCourier, commitment, CANDIDATES, WINDOW);
    await expect(
      registry.revealCourier(MATCH_ID, otherCourier, keyIndex, nonce),
    ).to.be.revertedWithCustomError(registry, "BadCommitment");
  });

  it("computes the same commitment off-chain and on-chain", async function () {
    const keyIndex = 5;
    const offChain = commitmentOf(MATCH_ID, COURIER_ID, keyIndex, nonce);
    const onChain = await registry.computeCommitment(MATCH_ID, COURIER_ID, keyIndex, nonce);
    expect(onChain).to.equal(offChain);
  });
});
