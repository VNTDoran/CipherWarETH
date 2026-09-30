"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

interface Props {
  mode: "login" | "register";
}

export default function AuthForm({ mode }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isRegister = mode === "register";

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);

    const form = new FormData(e.currentTarget);
    const payload = Object.fromEntries(form.entries());

    try {
      const res = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Something went wrong");
        return;
      }
      router.push("/lobby");
      router.refresh();
    } catch {
      setError("Cannot reach the server");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 py-10">
      <Link
        href="/"
        className="mb-8 font-mono text-[11px] uppercase tracking-[0.35em] text-slate-300 hover:text-slate-300"
      >
        ← Cipher War
      </Link>

      <div className="panel p-6">
        <h1 className="font-display text-2xl font-semibold text-slate-100">
          {isRegister ? "Enlist" : "Sign in"}
        </h1>
        <p className="mt-1 text-sm text-slate-300">
          {isRegister
            ? "One account, four agencies, a permanent record."
            : "Your clearance is still valid."}
        </p>

        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <div>
            <label className="label" htmlFor="username">
              {isRegister ? "Username" : "Username or email"}
            </label>
            <input
              id="username"
              name="username"
              className="field"
              autoComplete="username"
              required
              autoFocus
            />
          </div>

          {isRegister && (
            <>
              <div>
                <label className="label" htmlFor="email">
                  Email
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  className="field"
                  autoComplete="email"
                  required
                />
              </div>
              <div>
                <label className="label" htmlFor="displayName">
                  Display name
                </label>
                <input
                  id="displayName"
                  name="displayName"
                  className="field"
                  placeholder="What the other agencies will see"
                  required
                />
              </div>
            </>
          )}

          <div>
            <label className="label" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              className="field"
              autoComplete={isRegister ? "new-password" : "current-password"}
              required
            />
          </div>

          {error && (
            <p className="rounded-md border border-alert/30 bg-alert/10 px-3 py-2 font-mono text-xs text-alert">
              {error}
            </p>
          )}

          <button type="submit" className="btn-primary w-full py-3" disabled={busy}>
            {busy ? "Verifying…" : isRegister ? "Create account" : "Sign in"}
          </button>
        </form>

        <p className="mt-5 text-center font-mono text-[11px] text-slate-300">
          {isRegister ? (
            <>
              Already cleared?{" "}
              <Link href="/login" className="text-signal hover:underline">
                Sign in
              </Link>
            </>
          ) : (
            <>
              No account?{" "}
              <Link href="/register" className="text-signal hover:underline">
                Enlist
              </Link>
            </>
          )}
        </p>
      </div>

      {!isRegister && (
        <p className="mt-5 text-center font-mono text-[10px] uppercase tracking-[0.2em] text-slate-300">
          demo · nord / est / sud / ouest · password cipher123
        </p>
      )}
    </main>
  );
}
