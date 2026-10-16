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
  let fuel, server, owner, other;

  beforeEach(async function () {
    [server, owner, other] = await ethers.getSigners();
    fuel = await (await ethers.getContractFactory("CourierFuel")).deploy(server.address);
    await fuel.waitForDeployment();
    await fuel.registerCourier(MATCH_ID, COURIER_ID, owner.address, 4);
  });

  it("records the fuel a courier leaves with", async function () {
    const c = await fuel.getCourier(MATCH_ID, COURIER_ID);
    expect(c.owner).to.equal(owner.address);
    expect(c.unitsAtDispatch).to.equal(4);
    expect(await fuel.travelSecondsOf(MATCH_ID, COURIER_ID)).to.equal(20); // 4 * 5s
  });

  it("adds fuel and grows the match bounty when boosted", async function () {
    const price = await fuel.FUEL_UNIT_PRICE();
    const value = price * 3n;

    await expect(fuel.connect(owner).boost(MATCH_ID, COURIER_ID, { value }))
      .to.emit(fuel, "CourierBoosted")
      .withArgs(MATCH_ID, COURIER_ID, owner.address, value, 3, 7);

    expect(await fuel.bounty(MATCH_ID)).to.equal(value);
    expect(await fuel.travelSecondsOf(MATCH_ID, COURIER_ID)).to.equal(35); // 7 * 5s
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

  it("rejects a boost below one full unit", async function () {
    await expect(
      fuel.connect(owner).boost(MATCH_ID, COURIER_ID, { value: 1n }),
    ).to.be.revertedWithCustomError(fuel, "NoValueSent");
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
    expect(await fuel.bounty(MATCH_ID)).to.equal(0);

    await expect(
      fuel.payBounty(MATCH_ID, other.address),
    ).to.be.revertedWithCustomError(fuel, "BountyAlreadyPaid");
  });
});
