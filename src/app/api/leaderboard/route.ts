import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  // Aggregate career stats from finished matches only.
  const rows = await prisma.matchPlayer.findMany({
    where: { match: { status: "FINISHED" } },
    select: {
      userId: true,
      isWinner: true,
      cracksMade: true,
      timesCracked: true,
      directivesConfirmed: true,
      finalIntel: true,
      user: { select: { displayName: true, username: true, avatarSeed: true } },
    },
  });

  const byUser = new Map<string, {
    userId: string; displayName: string; username: string; avatarSeed: string;
    matches: number; wins: number; cracks: number; cracked: number;
    directives: number; intel: number;
  }>();

  for (const r of rows) {
    const cur = byUser.get(r.userId) ?? {
      userId: r.userId,
      displayName: r.user.displayName,
      username: r.user.username,
      avatarSeed: r.user.avatarSeed,
      matches: 0, wins: 0, cracks: 0, cracked: 0, directives: 0, intel: 0,
    };
    cur.matches += 1;
    cur.wins += r.isWinner ? 1 : 0;
    cur.cracks += r.cracksMade;
    cur.cracked += r.timesCracked;
    cur.directives += r.directivesConfirmed;
    cur.intel += r.finalIntel;
    byUser.set(r.userId, cur);
  }

  const leaders = [...byUser.values()]
    .map((u) => ({
      ...u,
      winRate: u.matches ? Math.round((u.wins / u.matches) * 100) : 0,
      // Wins carry the ranking; cracks break ties so aggression is visible.
      score: u.wins * 100 + u.cracks * 6 + u.directives * 3,
    }))
    .sort((a, b) => b.score - a.score || b.winRate - a.winRate)
    .slice(0, 50);

  return NextResponse.json({ leaders });
}
