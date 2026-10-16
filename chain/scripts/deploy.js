const { ethers, artifacts } = require("hardhat");
const fs = require("fs");
const path = require("path");

/**
 * Same shape as the TP's deploy-escrow.js: deploy, print the accounts, then
 * dump {address, abi} to a JSON the front-end fetches at runtime.
 *
 * Account #0 plays the GAME SERVER (the only address allowed to commit and
 * reveal). Accounts #1..#4 are the four players you import into MetaMask.
 */
async function main() {
  const signers = await ethers.getSigners();
  const server = signers[0];
  const players = signers.slice(1, 5);

  const CommitReveal = await ethers.getContractFactory("CommitRevealRegistry");
  const registry = await CommitReveal.deploy(server.address);
  await registry.waitForDeployment();
  const registryAddress = await registry.getAddress();

  const MatchReg = await ethers.getContractFactory("MatchRegistry");
  const matches = await MatchReg.deploy(server.address);
  await matches.waitForDeployment();
  const matchesAddress = await matches.getAddress();

  console.log("CommitRevealRegistry déployé à :", registryAddress);
  console.log("MatchRegistry         déployé à :", matchesAddress);
  console.log("Serveur de jeu (compte #0)      :", server.address);
  players.forEach((p, i) => console.log(`Joueur ${i + 1} (compte #${i + 1})           :`, p.address));

  const info = {
    chainId: 31337,
    rpc: "http://127.0.0.1:8545",
    gameServer: server.address,
    players: players.map((p) => p.address),
    commitReveal: {
      address: registryAddress,
      abi: (await artifacts.readArtifact("CommitRevealRegistry")).abi,
    },
    matchRegistry: {
      address: matchesAddress,
      abi: (await artifacts.readArtifact("MatchRegistry")).abi,
    },
  };

  // The verifier page reads this, exactly like escrow.html reads escrow-info.json.
  const out = path.join(__dirname, "..", "public", "cipherchain-info.json");
  fs.writeFileSync(out, JSON.stringify(info, null, 2));
  console.log("\nÉcrit :", out);

  // The game server (Next.js) reads this one to know where to send its txs.
  const envLine = [
    `CHAIN_RPC_URL="http://127.0.0.1:8545"`,
    `CHAIN_COMMIT_REVEAL_ADDRESS="${registryAddress}"`,
    `CHAIN_MATCH_REGISTRY_ADDRESS="${matchesAddress}"`,
    `CHAIN_SERVER_PRIVATE_KEY="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"`,
    "",
  ].join("\n");
  fs.writeFileSync(path.join(__dirname, "..", "chain.env"), envLine);
  console.log("Écrit :", path.join(__dirname, "..", "chain.env"));
  console.log("\n→ Copiez le contenu de chain.env dans le .env du jeu.");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
