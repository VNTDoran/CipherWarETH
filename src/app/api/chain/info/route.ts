import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";

/**
 * Contract addresses and ABIs for the in-app audit view.
 *
 * ABIs are read from the Hardhat build output rather than duplicated here, so
 * they cannot drift from the deployed bytecode. Addresses come from the same
 * environment the game server itself signs with.
 */

const CONTRACTS = [
  { key: "commitReveal", name: "CommitRevealRegistry", env: "CHAIN_COMMIT_REVEAL_ADDRESS" },
  { key: "courierFuel", name: "CourierFuel", env: "CHAIN_COURIER_FUEL_ADDRESS" },
  { key: "matchRegistry", name: "MatchRegistry", env: "CHAIN_MATCH_REGISTRY_ADDRESS" },
  { key: "intelToken", name: "IntelToken", env: "CHAIN_INTEL_TOKEN_ADDRESS" },
  { key: "tournamentEscrow", name: "TournamentEscrow", env: "CHAIN_TOURNAMENT_ESCROW_ADDRESS" },
] as const;

async function abiOf(name: string): Promise<unknown[] | null> {
  const file = path.join(
    process.cwd(),
    "chain",
    "artifacts",
    "contracts",
    `${name}.sol`,
    `${name}.json`,
  );
  try {
    const raw = await readFile(file, "utf8");
    return JSON.parse(raw).abi as unknown[];
  } catch {
    return null;
  }
}

export async function GET() {
  // Signed-in only: this is an audit view for players, not a public endpoint.
  if (!(await getSession())) {
    return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  }

  if (process.env.CHAIN_ENABLED !== "true") {
    return NextResponse.json({ enabled: false });
  }

  const contracts: Record<string, { address: string; abi: unknown[] }> = {};
  for (const c of CONTRACTS) {
    const address = process.env[c.env];
    if (!address) continue;
    const abi = await abiOf(c.name);
    if (!abi) continue;
    contracts[c.key] = { address, abi };
  }

  return NextResponse.json({
    enabled: true,
    rpcUrl: process.env.CHAIN_RPC_URL ?? "http://127.0.0.1:8545",
    chainId: Number(process.env.CHAIN_ID ?? 31337),
    gameServer: process.env.CHAIN_SERVER_ADDRESS ?? null,
    contracts,
  });
}
