import Link from "next/link";
import { redirect } from "next/navigation";
import { AGENCY_META, OPERATION_STEPS } from "../../../shared/constants";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import RenameForm from "./RenameForm";

function Stat({ label, value, accent }: { label: string; value: string | number; accent?: string }) {
  return (
    <div className="panel p-3">
      <div className="font-mono text-xl font-bold" style={{ color: accent ?? "#e2e8f0" }}>
        {value}
      </div>
      <div className="stat mt-0.5">{label}</div>
    </div>
  );
}

export default async function ProfilePage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const [user, plays] = await Promise.all([
    prisma.user.findUnique({
      where: { id: session.sub },
      select: { username: true, email: true, displayName: true, role: true, createdAt: true },
    }),
    prisma.matchPlayer.findMany({
      where: { userId: session.sub, match: { status: "FINISHED" } },
      include: { match: { select: { code: true, endedAt: true, winType: true } } },
      orderBy: { id: "desc" },
      take: 20,
    }),
  ]);

  if (!user) redirect("/login");

  const t = plays.reduce(
    (a, p) => ({
      matches: a.matches + 1,
      wins: a.wins + (p.isWinner ? 1 : 0),
      cracks: a.cracks + p.cracksMade,
      cracked: a.cracked + p.timesCracked,
      directives: a.directives + p.directivesConfirmed,
      baited: a.baited + p.decoysBaited,
    }),
    { matches: 0, wins: 0, cracks: 0, cracked: 0, directives: 0, baited: 0 },
  );
  const winRate = t.matches ? Math.round((t.wins / t.matches) * 100) : 0;

  return (
    <main className="mx-auto min-h-dvh max-w-2xl px-5 py-10">
      <Link href="/lobby" className="font-mono text-[11px] uppercase tracking-[0.3em] text-slate-300">
        ← lobby
      </Link>

      <header className="mt-6">
        <p className="stat">personnel file</p>
        <h1 className="font-display text-3xl font-bold text-slate-100">{user.displayName}</h1>
        <p className="mt-1 font-mono text-xs text-slate-300">
          @{user.username} · {user.email}
          {user.role === "ADMIN" && <span className="ml-2 text-gold">ADMIN</span>}
        </p>
      </header>

      <section className="mt-6 grid grid-cols-3 gap-2">
        <Stat label="matches" value={t.matches} />
        <Stat label="wins" value={t.wins} accent="#fbbf24" />
        <Stat label="win rate" value={`${winRate}%`} />
        <Stat label="cracks made" value={t.cracks} accent="#4ade80" />
        <Stat label="times burned" value={t.cracked} accent="#f87171" />
        <Stat label="decoys baited" value={t.baited} accent="#e879f9" />
      </section>

      <section className="mt-6">
        <h2 className="stat mb-2">change display name</h2>
        <RenameForm current={user.displayName} />
      </section>

      <section className="mt-8">
        <h2 className="stat mb-2">recent matches</h2>
        {plays.length === 0 ? (
          <p className="panel p-5 text-center text-sm text-slate-300">
            No finished matches yet.{" "}
            <Link href="/lobby" className="text-signal hover:underline">
              Open a lobby.
            </Link>
          </p>
        ) : (
          <div className="space-y-1.5">
            {plays.map((p) => {
              const meta = AGENCY_META[p.agencyCode] ?? AGENCY_META.NORD;
              return (
                <div
                  key={p.id}
                  className="flex items-center gap-3 rounded-md border border-white/20 bg-ink-800/50 px-3 py-2.5"
                  style={{ borderLeftColor: meta.color, borderLeftWidth: 3 }}
                >
                  <span className="font-mono text-[11px] text-slate-300">{p.match.code}</span>
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-slate-300">
                    {p.operationName || meta.name}
                  </span>
                  <span className="font-mono text-[11px] text-slate-300">
                    {p.directivesConfirmed}/{OPERATION_STEPS}
                  </span>
                  <span className="font-mono text-[11px] text-signal">{p.cracksMade}c</span>
                  <span
                    className={`font-mono text-[10px] uppercase tracking-widest ${
                      p.isWinner ? "text-gold" : "text-slate-300"
                    }`}
                  >
                    {p.isWinner ? "win" : `#${p.placement ?? "-"}`}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
