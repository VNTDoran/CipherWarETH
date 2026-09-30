"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function RenameForm({ current }: { current: string }) {
  const router = useRouter();
  const [value, setValue] = useState(current);
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setState("saving");
    const res = await fetch("/api/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: value }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error ?? "Could not save");
      setState("idle");
      return;
    }
    setState("saved");
    router.refresh();
    setTimeout(() => setState("idle"), 1500);
  }

  return (
    <form onSubmit={save} className="flex gap-2">
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="field flex-1"
        maxLength={28}
        aria-label="Display name"
      />
      <button
        type="submit"
        className="btn-ghost px-4"
        disabled={state === "saving" || value.trim() === current}
      >
        {state === "saving" ? "…" : state === "saved" ? "saved" : "save"}
      </button>
      {error && <span className="self-center font-mono text-[11px] text-alert">{error}</span>}
    </form>
  );
}
