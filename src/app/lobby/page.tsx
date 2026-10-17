import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import LobbyClient from "./LobbyClient";

export default async function LobbyPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  // Same switches the game server uses to decide whether a match is staked.
  const staked =
    process.env.CHAIN_ENABLED === "true" && !!process.env.CHAIN_TOURNAMENT_ESCROW_ADDRESS;
  const stakeIntel = staked ? Math.max(0, Math.floor(Number(process.env.CHAIN_STAKE_INTEL ?? 100))) : 0;
  return (
    <LobbyClient
      displayName={session.displayName}
      isAdmin={session.role === "ADMIN"}
      stakeIntel={stakeIntel}
    />
  );
}
