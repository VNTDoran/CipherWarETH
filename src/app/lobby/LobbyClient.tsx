"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function LobbyClient({
  displayName,
  isAdmin,
}: {
  displayName: string;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<"create" | "join" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function createMatch() {
    setError(null);
    setBusy("create");
    try {
      const res = await fetch("/api/match/create", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Could not open a lobby");
        return;
      }
      router.push(`/play/${data.code}`);
    } catch {
      setError("Cannot reach the server");
    } finally {
      setBusy(null);
    }
  }

  function joinMatch(e: React.FormEvent) {
    e.preventDefault();
    const clean = code.trim().toUpperCase();
    if (clean.length !== 6) {
      setError("Join codes are 6 characters");
      return;
    }
    setBusy("join");
    router.push(`/play/${clean}`);
  }

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/");
    router.refresh();
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-5 py-10">
      <header className="flex items-center justify-between">
        <Link href="/" className="font-mono text-[11px] uppercase tracking-[0.3em] text-slate-300">
          cipher war
        </Link>
        <button type="button" onClick={signOut} className="btn-ghost px-2 py-1">
          sign out
        </button>
      </header>

      <div className="mt-10">
        <p className="stat">signed in as</p>
        <h1 className="font-display text-3xl font-bold text-slate-100">{displayName}</h1>
      </div>

      <div className="panel mt-8 p-5">
        <h2 className="font-display text-lg font-semibold text-slate-100">Host a match</h2>
        <p className="mt-1 text-sm text-slate-300">
          You get a 6-character code. Up to three others join with it.
        </p>
        <button
          type="button"
          className="btn-primary mt-4 w-full py-3"
          disabled={busy !== null}
          onClick={createMatch}
        >
          {busy === "create" ? "opening…" : "open a lobby"}
        </button>
      </div>

      <div className="panel mt-4 p-5">
        <h2 className="font-display text-lg font-semibold text-slate-100">Join a match</h2>
        <form onSubmit={joinMatch} className="mt-4 flex gap-2">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 6))}
            placeholder="ABC123"
            className="field flex-1 text-center text-lg tracking-[0.35em]"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            aria-label="Join code"
          />
          <button type="submit" className="btn-ghost px-5" disabled={busy !== null}>
            join
          </button>
        </form>
      </div>

      {error && (
        <p className="mt-4 rounded-md border border-alert/30 bg-alert/10 px-3 py-2 font-mono text-xs text-alert">
          {error}
        </p>
      )}

      <nav className="mt-auto flex gap-2 pt-10">
        <Link href="/profile" className="btn-ghost flex-1 py-2.5">
          record
        </Link>
        <Link href="/leaderboard" className="btn-ghost flex-1 py-2.5">
          ranks
        </Link>
        {isAdmin && (
          <Link href="/admin" className="btn-ghost flex-1 py-2.5">
            admin
          </Link>
        )}
      </nav>
    </main>
  );
}
