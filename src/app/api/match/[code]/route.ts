import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

  const { code } = await params;
  const lookup = globalThis.__cipherWarGetMatch;
  const match = lookup?.(code);
  if (!match) return NextResponse.json({ exists: false }, { status: 404 });

  return NextResponse.json({
    exists: true,
    code: match.code,
    status: match.status,
    players: match.playerList.length,
  });
}
