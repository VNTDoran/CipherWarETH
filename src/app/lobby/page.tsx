import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import LobbyClient from "./LobbyClient";

export default async function LobbyPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  return (
    <LobbyClient displayName={session.displayName} isAdmin={session.role === "ADMIN"} />
  );
}
