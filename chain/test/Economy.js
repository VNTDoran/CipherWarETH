const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const MATCH_ID = ethers.id("MATCH-ECON");
const COURIER_ID = ethers.id("COURIER-D3");
const STAKE = ethers.parseEther("100");

describe("IntelToken", function () {
  let token, server, player;

  beforeEach(async function () {
    [server, player] = await ethers.getSigners();
    token = await (await ethers.getContractFactory("IntelToken")).deploy(server.address);
    await token.waitForDeployment();
  });

  it("mints the initial supply to the server", async function () {
    expect(await token.balanceOf(server.address)).to.equal(ethers.parseEther("1000000"));
    expect(await token.symbol()).to.equal("INTEL");
  });

  it("lets any account claim from the faucet", async function () {
    await token.connect(player).faucet();
    expect(await token.balanceOf(player.address)).to.equal(ethers.parseEther("1000"));
  });

  it("rate-limits the faucet", async function () {
    await token.connect(player).faucet();
    await expect(token.connect(player).faucet()).to.be.revertedWithCustomError(
      token,
      "FaucetCooldown",
    );
    await time.increase(61);
    await token.connect(player).faucet(); // allowed again
    expect(await token.balanceOf(player.address)).to.equal(ethers.parseEther("2000"));
  });

  it("restricts mint to the owner", async function () {
    await expect(
      token.connect(player).mint(player.address, STAKE),
    ).to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount");
  });
});

describe("TournamentEscrow", function () {
  let token, escrow, server, p1, p2, p3;

  beforeEach(async function () {
    [server, p1, p2, p3] = await ethers.getSigners();
    token = await (await ethers.getContractFactory("IntelToken")).deploy(server.address);
    await token.waitForDeployment();
    escrow = await (await ethers.getContractFactory("TournamentEscrow")).deploy(
      await token.getAddress(),
      server.address,
    );
    await escrow.waitForDeployment();

    for (const p of [p1, p2, p3]) {
      await token.mint(p.address, ethers.parseEther("1000"));
      await token.connect(p).approve(await escrow.getAddress(), ethers.parseEther("1000"));
    }
  });

  async function openTournament(maxPlayers = 2) {
    await escrow.createTournament(MATCH_ID, STAKE, maxPlayers, 600, 600);
  }

  it("collects stakes and pays the pot to the winner", async function () {
    await openTournament(2);
    await escrow.connect(p1).join(MATCH_ID);
    await escrow.connect(p2).join(MATCH_ID);

    // A full table locks itself, so no extra server transaction is needed.
    let t = await escrow.getTournament(MATCH_ID);
    expect(t.state).to.equal(2); // Locked
    expect(t.pot).to.equal(STAKE * 2n);

    const before = await token.balanceOf(p1.address);
    await escrow.settle(MATCH_ID, p1.address);
    expect(await token.balanceOf(p1.address)).to.equal(before + STAKE * 2n);

    t = await escrow.getTournament(MATCH_ID);
    expect(t.state).to.equal(3); // Settled
  });

  it("refuses a second join from the same player", async function () {
    await openTournament(2);
    await escrow.connect(p1).join(MATCH_ID);
    await expect(escrow.connect(p1).join(MATCH_ID)).to.be.revertedWithCustomError(
      escrow,
      "AlreadyJoined",
    );
  });

  it("refuses to pay someone who never staked", async function () {
    await openTournament(2);
    await escrow.connect(p1).join(MATCH_ID);
    await escrow.connect(p2).join(MATCH_ID);
    await expect(escrow.settle(MATCH_ID, p3.address)).to.be.revertedWithCustomError(
      escrow,
      "WinnerNotPlaying",
    );
  });

  // This is what makes a silent server costly rather than safe.
  it("lets players reclaim their stake if the server never settles", async function () {
    await openTournament(2);
    await escrow.connect(p1).join(MATCH_ID);
    await escrow.connect(p2).join(MATCH_ID);

    await expect(escrow.connect(p1).claimRefund(MATCH_ID)).to.be.revertedWithCustomError(
      escrow,
      "SettleWindowOpen",
    );

    await time.increase(1300); // past joinDeadline + settleWindow
    expect(await escrow.refundAvailable(MATCH_ID)).to.equal(true);

    const before = await token.balanceOf(p1.address);
    await escrow.connect(p1).claimRefund(MATCH_ID);
    expect(await token.balanceOf(p1.address)).to.equal(before + STAKE);

    await expect(escrow.connect(p1).claimRefund(MATCH_ID)).to.be.revertedWithCustomError(
      escrow,
      "AlreadyRefunded",
    );
  });

  it("blocks settlement once the window has closed", async function () {
    await openTournament(2);
    await escrow.connect(p1).join(MATCH_ID);
    await escrow.connect(p2).join(MATCH_ID);
    await time.increase(1300);
    await expect(escrow.settle(MATCH_ID, p1.address)).to.be.revertedWithCustomError(
      escrow,
      "SettleWindowClosed",
    );
  });

  it("only the server can create or settle", async function () {
    await expect(
      escrow.connect(p1).createTournament(MATCH_ID, STAKE, 2, 600, 600),
    ).to.be.revertedWithCustomError(escrow, "NotGameServer");
  });
});


describe("CourierFuel", function () {
  let fuel, server, owner, other, nonce, required;
  const KEY_INDEX = 6;
  const AT_DISPATCH = 3;

  // Mirrors deriveRequiredUnits off-chain, the way the game server computes it.
  function deriveOffChain(matchId, courierId, keyIndex, nonceHex, min = 4, max = 15) {
    const h = BigInt(
      ethers.keccak256(
        ethers.solidityPacked(
          ["string", "bytes32", "bytes32", "uint8", "bytes32"],
          ["FUEL", matchId, courierId, keyIndex, nonceHex],
        ),
      ),
    );
    return Number(BigInt(min) + (h % BigInt(max - min + 1)));
  }

  beforeEach(async function () {
    [server, owner, other] = await ethers.getSigners();
    fuel = await (await ethers.getContractFactory("CourierFuel")).deploy(server.address);
    await fuel.waitForDeployment();
    nonce = ethers.hexlify(ethers.randomBytes(32));
    required = deriveOffChain(MATCH_ID, COURIER_ID, KEY_INDEX, nonce);
    await fuel.registerCourier(MATCH_ID, COURIER_ID, owner.address, AT_DISPATCH, required);
  });

  it("derives the same hidden fuel demand on-chain and off-chain", async function () {
    const onChain = await fuel.deriveRequiredUnits(MATCH_ID, COURIER_ID, KEY_INDEX, nonce);
    expect(Number(onChain)).to.equal(required);
    expect(required).to.be.within(4, 15);
  });

  // The whole point: the player cannot know the bill in advance, because it
  // comes from a preimage only the server holds until the reveal.
  it("produces an unpredictable demand across different draws", async function () {
    const seen = new Set();
    for (let i = 0; i < 40; i++) {
      const n = ethers.hexlify(ethers.randomBytes(32));
      seen.add(deriveOffChain(MATCH_ID, COURIER_ID, i % 10, n));
    }
    // A constant would collapse to one value; a usable spread is the point.
    expect(seen.size).to.be.greaterThan(5);
  });

  it("starts stalled when the demand exceeds the dispatch fuel", async function () {
    expect(Number(await fuel.unitsOutstanding(MATCH_ID, COURIER_ID))).to.equal(
      required - AT_DISPATCH,
    );
    expect(await fuel.isStalled(MATCH_ID, COURIER_ID)).to.equal(true);
  });

  it("clears the stall only once the full demand is paid", async function () {
    const price = await fuel.FUEL_UNIT_PRICE();
    let owed = Number(await fuel.unitsOutstanding(MATCH_ID, COURIER_ID));

    // Pay it off in capped chunks, as a player would click Boost repeatedly.
    while (owed > 0) {
      const chunk = Math.min(owed, 6);
      await fuel.connect(owner).boost(MATCH_ID, COURIER_ID, { value: price * BigInt(chunk) });
      owed = Number(await fuel.unitsOutstanding(MATCH_ID, COURIER_ID));
    }

    expect(await fuel.isStalled(MATCH_ID, COURIER_ID)).to.equal(false);
    expect(Number(await fuel.unitsOutstanding(MATCH_ID, COURIER_ID))).to.equal(0);
  });

  it("reports what is still owed in the boost event", async function () {
    const price = await fuel.FUEL_UNIT_PRICE();
    const owedBefore = Number(await fuel.unitsOutstanding(MATCH_ID, COURIER_ID));
    const units = Math.min(owedBefore, 2);
    await expect(fuel.connect(owner).boost(MATCH_ID, COURIER_ID, { value: price * BigInt(units) }))
      .to.emit(fuel, "CourierBoosted")
      .withArgs(
        MATCH_ID, COURIER_ID, owner.address,
        price * BigInt(units), units, AT_DISPATCH + units, owedBefore - units,
      );
  });

  it("lets anyone prove the server did not inflate the bill", async function () {
    expect(await fuel.fuelWasHonest(MATCH_ID, COURIER_ID, KEY_INDEX, nonce)).to.equal(true);
    // A courier billed for something other than its draw is caught here.
    const other2 = ethers.id("COURIER-OTHER");
    await fuel.registerCourier(MATCH_ID, other2, owner.address, AT_DISPATCH, 15);
    const honest = deriveOffChain(MATCH_ID, other2, KEY_INDEX, nonce);
    if (honest !== 15) {
      expect(await fuel.fuelWasHonest(MATCH_ID, other2, KEY_INDEX, nonce)).to.equal(false);
    }
  });

  it("rejects a demand outside the allowed range", async function () {
    const c = ethers.id("COURIER-BAD");
    await expect(
      fuel.registerCourier(MATCH_ID, c, owner.address, AT_DISPATCH, 99),
    ).to.be.revertedWithCustomError(fuel, "BadRequirement");
  });

  it("grows the match bounty when boosted", async function () {
    const price = await fuel.FUEL_UNIT_PRICE();
    await fuel.connect(owner).boost(MATCH_ID, COURIER_ID, { value: price * 2n });
    expect(await fuel.bounty(MATCH_ID)).to.equal(price * 2n);
  });

  it("only the courier owner may refuel it", async function () {
    const value = await fuel.FUEL_UNIT_PRICE();
    await expect(
      fuel.connect(other).boost(MATCH_ID, COURIER_ID, { value }),
    ).to.be.revertedWithCustomError(fuel, "NotCourierOwner");
  });

  it("caps how much fuel one transaction can buy", async function () {
    const price = await fuel.FUEL_UNIT_PRICE();
    await expect(
      fuel.connect(owner).boost(MATCH_ID, COURIER_ID, { value: price * 20n }),
    ).to.be.revertedWithCustomError(fuel, "TooMuchFuel");
  });

  it("will not refuel a courier that already landed", async function () {
    const value = await fuel.FUEL_UNIT_PRICE();
    await fuel.markLanded(MATCH_ID, COURIER_ID);
    await expect(
      fuel.connect(owner).boost(MATCH_ID, COURIER_ID, { value }),
    ).to.be.revertedWithCustomError(fuel, "CourierAlreadyLanded");
  });

  it("pays the accumulated gas bounty to the winner, once", async function () {
    const price = await fuel.FUEL_UNIT_PRICE();
    await fuel.connect(owner).boost(MATCH_ID, COURIER_ID, { value: price * 5n });
    const pot = await fuel.bounty(MATCH_ID);

    const before = await ethers.provider.getBalance(other.address);
    await fuel.payBounty(MATCH_ID, other.address);
    expect(await ethers.provider.getBalance(other.address)).to.equal(before + pot);
    await expect(
      fuel.payBounty(MATCH_ID, other.address),
    ).to.be.revertedWithCustomError(fuel, "BountyAlreadyPaid");
  });
});
