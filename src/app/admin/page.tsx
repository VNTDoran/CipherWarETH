import Link from "next/link";
import { redirect } from "next/navigation";
import { MODELS } from "@/lib/admin-models";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function AdminHome() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "ADMIN") redirect("/lobby");

  const counts = await Promise.all(
    Object.values(MODELS).map(async (m) => [m.key, await m.delegate().count()] as const),
  );
  const countBy = Object.fromEntries(counts);

  return (
    <main className="mx-auto min-h-dvh max-w-3xl px-5 py-10">
      <Link href="/lobby" className="font-mono text-[11px] uppercase tracking-[0.3em] text-slate-300">
        ← lobby
      </Link>

      <h1 className="mt-6 font-display text-3xl font-bold text-slate-100">Control room</h1>
      <p className="mt-1 max-w-prose text-sm text-slate-300">
        Every table below is fully create / read / update / delete. The ones marked{" "}
        <span className="text-gold">live</span> are read by the game engine when a
        match starts — editing them changes how the next match actually plays.
      </p>

      <div className="mt-8 grid gap-2 sm:grid-cols-2">
        {Object.values(MODELS).map((m) => (
          <Link
            key={m.key}
            href={`/admin/${m.key}`}
            className="panel group p-4 transition hover:border-white/25"
          >
            <div className="flex items-center justify-between">
              <span className="font-display text-lg font-semibold text-slate-100">{m.label}</span>
              <span className="font-mono text-sm text-slate-300">{countBy[m.key] ?? 0}</span>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-slate-300">{m.description}</p>
            <div className="mt-2 flex gap-2">
              {m.affectsGameplay && (
                <span className="rounded-sm border border-gold/40 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-gold">
                  live
                </span>
              )}
              {m.readOnly && (
                <span className="rounded-sm border border-white/20 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-slate-300">
                  read-only
                </span>
              )}
            </div>
          </Link>
        ))}
      </div>
    </main>
  );
}
