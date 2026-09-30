import Link from "next/link";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function LeaderboardPage() {
  const rows = await prisma.matchPlayer.findMany({
    where: { match: { status: "FINISHED" } },
    select: {
      userId: true,
      isWinner: true,
      cracksMade: true,
      directivesConfirmed: true,
      user: { select: { displayName: true, username: true } },
    },
  });

  const byUser = new Map<
    string,
    { name: string; username: string; matches: number; wins: number; cracks: number; directives: number }
  >();

  for (const r of rows) {
    const cur = byUser.get(r.userId) ?? {
      name: r.user.displayName,
      username: r.user.username,
      matches: 0,
      wins: 0,
      cracks: 0,
      directives: 0,
    };
    cur.matches += 1;
    cur.wins += r.isWinner ? 1 : 0;
    cur.cracks += r.cracksMade;
    cur.directives += r.directivesConfirmed;
    byUser.set(r.userId, cur);
  }

  // Wins carry the ranking; cracks and directives break ties so an aggressive
  // player and a quiet one can't end up indistinguishable.
  const leaders = [...byUser.values()]
    .map((u) => ({ ...u, score: u.wins * 100 + u.cracks * 6 + u.directives * 3 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 50);

  return (
    <main className="mx-auto min-h-dvh max-w-2xl px-5 py-10">
      <Link href="/" className="font-mono text-[11px] uppercase tracking-[0.3em] text-slate-300">
        ← cipher war
      </Link>

      <h1 className="mt-6 font-display text-3xl font-bold text-slate-100">Ranks</h1>
      <p className="mt-1 text-sm text-slate-300">
        Career totals across every finished match.
      </p>

      {leaders.length === 0 ? (
        <p className="panel mt-8 p-6 text-center text-sm text-slate-300">
          No finished matches yet. The board fills after the first game.
        </p>
      ) : (
        <div className="mt-8 space-y-1.5">
          <div className="flex items-center gap-3 px-3 font-mono text-[10px] uppercase tracking-widest text-slate-300">
            <span className="w-5">#</span>
            <span className="flex-1">agent</span>
            <span className="w-10 text-right">won</span>
            <span className="w-10 text-right">played</span>
            <span className="w-12 text-right">cracks</span>
          </div>
          {leaders.map((u, i) => (
            <div
              key={u.username}
              className="flex items-center gap-3 rounded-md border border-white/20 bg-ink-800/50 px-3 py-2.5"
            >
              <span
                className={`w-5 font-mono text-xs ${i < 3 ? "text-gold" : "text-slate-300"}`}
              >
                {i + 1}
              </span>
              <span className="min-w-0 flex-1 truncate font-display text-sm text-slate-200">
                {u.name}
                <span className="ml-1.5 font-mono text-[10px] text-slate-300">@{u.username}</span>
              </span>
              <span className="w-10 text-right font-mono text-sm text-gold">{u.wins}</span>
              <span className="w-10 text-right font-mono text-sm text-slate-300">{u.matches}</span>
              <span className="w-12 text-right font-mono text-sm text-signal">{u.cracks}</span>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
