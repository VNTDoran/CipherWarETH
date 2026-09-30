import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ user: null }, { status: 200 });
  return NextResponse.json({
    user: {
      id: session.sub,
      username: session.username,
      displayName: session.displayName,
      role: session.role,
    },
  });
}
