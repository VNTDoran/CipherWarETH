const { ethers, artifacts } = require("hardhat");
const fs = require("fs");
const path = require("path");

/**
 * Same shape as the TP's deploy-escrow.js: deploy, print the accounts, then
 * dump {address, abi} to a JSON the front-end fetches at runtime.
 *
 * Account #0 plays the GAME SERVER — the only address allowed to commit,
 * reveal, register couriers and settle. Accounts #1..#4 are the four players
 * you import into MetaMask.
 */
async function main() {
  const signers = await ethers.getSigners();
  const server = signers[0];
  const players = signers.slice(1, 5);

  const deployed = {};
  async function deploy(name, args) {
    const Factory = await ethers.getContractFactory(name);
    const c = await Factory.deploy(...args);
    await c.waitForDeployment();
    const address = await c.getAddress();
    deployed[name] = { address, abi: (await artifacts.readArtifact(name)).abi };
    console.log(`${name.padEnd(22)} deployed at ${address}`);
    return c;
  }

  const token = await deploy("IntelToken", [server.address]);
  const registry = await deploy("CommitRevealRegistry", [server.address]);
  const matches = await deploy("MatchRegistry", [server.address]);
  const fuel = await deploy("CourierFuel", [server.address]);
  const escrow = await deploy("TournamentEscrow", [
    await token.getAddress(),
    server.address,
  ]);

  // Seed the demo players with INTEL so staking works immediately. They can
  // also use the public faucet from the page.
  const seed = ethers.parseEther("5000");
  for (const p of players) {
    await (await token.mint(p.address, seed)).wait();
  }
  console.log("");
  console.log("Game server (account #0) :", server.address);
  players.forEach((p, i) =>
    console.log(`Player ${i + 1}  (account #${i + 1}) : ${p.address}  (5000 INTEL)`),
  );

  // The game reads addresses from its own .env and ABIs straight from
  // artifacts/, so there is no separate front-end bundle to feed.
  const env = [
    `CHAIN_ENABLED="true"`,
    `CHAIN_RPC_URL="http://127.0.0.1:8545"`,
    `CHAIN_SERVER_PRIVATE_KEY="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"`,
    `CHAIN_COMMIT_REVEAL_ADDRESS="${deployed.CommitRevealRegistry.address}"`,
    `CHAIN_MATCH_REGISTRY_ADDRESS="${deployed.MatchRegistry.address}"`,
    `CHAIN_COURIER_FUEL_ADDRESS="${deployed.CourierFuel.address}"`,
    `CHAIN_TOURNAMENT_ESCROW_ADDRESS="${deployed.TournamentEscrow.address}"`,
    `CHAIN_INTEL_TOKEN_ADDRESS="${deployed.IntelToken.address}"`,
    "",
  ].join("\n");
  const envPath = path.join(__dirname, "..", "chain.env");
  fs.writeFileSync(envPath, env);
  console.log("\nWrote:", envPath);
  console.log("→ Copy the contents of chain.env into the game's .env, then restart it.");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
