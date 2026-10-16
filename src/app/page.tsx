import Link from "next/link";
import { getSession } from "@/lib/session";

const BEATS = [
  {
    n: "01",
    title: "Dispatch",
    body: "Your operation has five directives. Each one needs a courier to reach your country. Dispatching costs intel you do not have yet.",
  },
  {
    n: "02",
    title: "Intercept",
    body: "Every courier crosses the shared ether in plain sight. Attack one and a minigame decides how many of its ten keys you cross off.",
  },
  {
    n: "03",
    title: "Commit",
    body: "Narrow the set to one key and the message is yours. Commit early and you are gambling — but the rival beside you might be about to take it.",
  },
  {
    n: "04",
    title: "Finish first",
    body: "Five confirmed directives wins. Or crack six enemy directives and the whole network goes dark in your favour.",
  },
];

export default async function Home() {
  const session = await getSession();

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col px-5 py-10 sm:px-8">
      <header className="flex items-center justify-between gap-4">
        <div className="font-mono text-[11px] uppercase tracking-[0.4em] text-slate-300">
          Dossier / classified
        </div>
        <nav className="flex items-center gap-2">
          <Link href="/leaderboard" className="btn-ghost">
            Ranks
          </Link>
          {session ? (
            <>
              <Link href="/profile" className="btn-ghost">
                {session.displayName}
              </Link>
              <Link href="/lobby" className="btn-primary">
                Play
              </Link>
            </>
          ) : (
            <>
              <Link href="/login" className="btn-ghost">
                Sign in
              </Link>
              <Link href="/register" className="btn-primary">
                Enlist
              </Link>
            </>
          )}
        </nav>
      </header>

      <section className="mt-16 sm:mt-24">
        <h1 className="font-display text-5xl font-bold leading-[0.95] tracking-tight text-slate-100 sm:text-7xl">
          CIPHER
          <br />
          <span className="text-signal">WAR</span>
        </h1>
        <p className="mt-6 max-w-xl text-lg leading-relaxed text-slate-300">
          Four intelligence agencies. One shared ether. Every message you send can be
          read by someone — and the only way to stop them finishing first is to read
          theirs.
        </p>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link href={session ? "/lobby" : "/register"} className="btn-primary px-5 py-3 text-sm">
            {session ? "Open a lobby" : "Create an account"}
          </Link>
          <Link href="/leaderboard" className="btn-ghost px-5 py-3 text-sm">
            See the board
          </Link>
        </div>
      </section>

      <section className="mt-20 grid gap-3 sm:grid-cols-2">
        {BEATS.map((b) => (
          <article key={b.n} className="panel p-5">
            <div className="font-mono text-[11px] tracking-[0.3em] text-signal/70">{b.n}</div>
            <h2 className="mt-2 font-display text-xl font-semibold text-slate-100">{b.title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-300">{b.body}</p>
          </article>
        ))}
      </section>

      <section className="panel mt-10 p-5">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.3em] text-slate-300">
          Why it is not a coin flip
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-slate-300">
          An attack never hands you a key. It <em className="not-italic text-slate-200">removes</em>{" "}
          candidates — one, two or three of them, decided by how well you play the
          intercept. Chance picks which keys fall; skill decides how fast the set
          collapses. Everyone races the same five steps, nobody is eliminated, and
          cracking the player in front pays more than cracking the player behind.
        </p>
      </section>

      <footer className="mt-auto pt-12 font-mono text-[10px] uppercase tracking-[0.25em] text-slate-300">
        4 players · real-time · installable
      </footer>
    </main>
  );
}
