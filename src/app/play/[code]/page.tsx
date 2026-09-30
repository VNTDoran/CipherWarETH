import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import PlayClient from "./PlayClient";

export default async function PlayPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const session = await getSession();
  const { code } = await params;
  if (!session) redirect(`/login?next=/play/${code}`);
  return <PlayClient code={code.toUpperCase()} />;
}
