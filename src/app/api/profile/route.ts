import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

  const [user, plays] = await Promise.all([
    prisma.user.findUnique({
      where: { id: session.sub },
      select: { id: true, username: true, email: true, displayName: true, role: true, createdAt: true, avatarSeed: true },
    }),
    prisma.matchPlayer.findMany({
      where: { userId: session.sub, match: { status: "FINISHED" } },
      include: { match: { select: { code: true, endedAt: true, winType: true, durationMs: true } } },
      orderBy: { match: { endedAt: "desc" } },
      take: 25,
    }),
  ]);

  if (!user) return NextResponse.json({ error: "Account not found" }, { status: 404 });

  const totals = plays.reduce(
    (acc, p) => ({
      matches: acc.matches + 1,
      wins: acc.wins + (p.isWinner ? 1 : 0),
      cracks: acc.cracks + p.cracksMade,
      cracked: acc.cracked + p.timesCracked,
      directives: acc.directives + p.directivesConfirmed,
      spies: acc.spies + p.spiesRecruited,
      decoysBaited: acc.decoysBaited + p.decoysBaited,
    }),
    { matches: 0, wins: 0, cracks: 0, cracked: 0, directives: 0, spies: 0, decoysBaited: 0 },
  );

  return NextResponse.json({ user, totals, history: plays });
}

export async function PATCH(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const displayName = String(body?.displayName ?? "").trim();
  if (displayName.length < 2 || displayName.length > 28)
    return NextResponse.json({ error: "Display name must be 2-28 characters" }, { status: 400 });

  await prisma.user.update({ where: { id: session.sub }, data: { displayName } });
  return NextResponse.json({ ok: true });
}
