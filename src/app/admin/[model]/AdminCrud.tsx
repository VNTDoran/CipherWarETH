"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { FieldSpec } from "@/lib/admin-models";

interface Spec {
  key: string;
  label: string;
  description: string;
  readOnly: boolean;
  affectsGameplay: boolean;
  fields: FieldSpec[];
}

type Row = Record<string, any>;

function display(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v);
  return s.length > 42 ? `${s.slice(0, 41)}…` : s;
}

export default function AdminCrud({ spec }: { spec: Spec }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Row | "new" | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const columns = spec.fields.filter((f) => !f.hideInTable);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/${spec.key}?page=${page}&q=${encodeURIComponent(q)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not load");
      setRows(data.rows);
      setPages(data.pages);
      setTotal(data.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load");
    } finally {
      setLoading(false);
    }
  }, [spec.key, page, q]);

  useEffect(() => {
    void load();
  }, [load]);

  async function remove(id: string) {
    const res = await fetch(`/api/admin/${spec.key}/${id}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) setError(data.error ?? "Could not delete");
    setConfirmId(null);
    void load();
  }

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const isNew = editing === "new";
    const form = new FormData(e.currentTarget);

    const payload: Record<string, unknown> = {};
    for (const f of spec.fields) {
      if (!isNew && f.createOnly) continue;
      const raw = form.get(f.name);
      if (f.type === "boolean") payload[f.name] = form.get(f.name) === "on";
      else if (raw !== null && String(raw) !== "") payload[f.name] = raw;
      else if (isNew && f.type !== "password") payload[f.name] = "";
    }
    // Never send an empty password; the API keeps the existing hash.
    if (!isNew && payload.password === "") delete payload.password;

    const url = isNew
      ? `/api/admin/${spec.key}`
      : `/api/admin/${spec.key}/${(editing as Row).id}`;
    const res = await fetch(url, {
      method: isNew ? "POST" : "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error ?? "Could not save");
      return;
    }
    setEditing(null);
    void load();
  }

  return (
    <main className="mx-auto min-h-dvh max-w-5xl px-4 py-8 sm:px-6">
      <Link href="/admin" className="font-mono text-[11px] uppercase tracking-[0.3em] text-slate-300">
        ← control room
      </Link>

      <header className="mt-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-100">
            {spec.label}
            <span className="ml-2 font-mono text-sm text-slate-300">{total}</span>
          </h1>
          <p className="mt-1 max-w-prose text-xs text-slate-300">{spec.description}</p>
        </div>
        {!spec.readOnly && (
          <button type="button" className="btn-primary px-4 py-2" onClick={() => setEditing("new")}>
            new
          </button>
        )}
      </header>

      {spec.affectsGameplay && (
        <p className="mt-4 rounded-md border border-gold/30 bg-gold/5 px-3 py-2 font-mono text-[11px] text-gold/90">
          Read by the engine at match start — changes here retune live gameplay.
        </p>
      )}

      <div className="mt-4 flex gap-2">
        <input
          value={q}
          onChange={(e) => {
            setPage(1);
            setQ(e.target.value);
          }}
          placeholder="search…"
          className="field max-w-xs"
          aria-label="Search"
        />
      </div>

      {error && (
        <p className="mt-4 rounded-md border border-alert/30 bg-alert/10 px-3 py-2 font-mono text-xs text-alert">
          {error}
        </p>
      )}

      <div className="panel mt-4 overflow-x-auto">
        <table className="w-full min-w-[640px] text-left">
          <thead>
            <tr className="border-b border-white/20">
              {columns.map((f) => (
                <th key={f.name} className="px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-slate-300">
                  {f.label}
                </th>
              ))}
              <th className="w-24 px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={columns.length + 1} className="px-3 py-8 text-center font-mono text-xs text-slate-300">
                  loading…
                </td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={columns.length + 1} className="px-3 py-8 text-center font-mono text-xs text-slate-300">
                  nothing here
                </td>
              </tr>
            )}
            {!loading &&
              rows.map((row) => (
                <tr key={row.id} className="border-b border-white/25 last:border-0 hover:bg-white/[0.02]">
                  {columns.map((f) => (
                    <td key={f.name} className="px-3 py-2 font-mono text-xs text-slate-300">
                      {display(row[f.name])}
                    </td>
                  ))}
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-1">
                      {!spec.readOnly && (
                        <button
                          type="button"
                          className="btn-ghost px-2 py-1"
                          onClick={() => setEditing(row)}
                        >
                          edit
                        </button>
                      )}
                      {confirmId === row.id ? (
                        <button type="button" className="btn-danger px-2 py-1" onClick={() => remove(row.id)}>
                          sure?
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn-ghost px-2 py-1"
                          onClick={() => setConfirmId(row.id)}
                        >
                          del
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-3">
          <button
            type="button"
            className="btn-ghost px-3 py-1.5"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            prev
          </button>
          <span className="font-mono text-xs text-slate-300">
            {page} / {pages}
          </span>
          <button
            type="button"
            className="btn-ghost px-3 py-1.5"
            disabled={page >= pages}
            onClick={() => setPage((p) => p + 1)}
          >
            next
          </button>
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-ink-900/90 p-5 backdrop-blur-sm">
          <form onSubmit={save} className="panel w-full max-w-lg animate-popIn p-5">
            <h2 className="font-display text-lg font-semibold text-slate-100">
              {editing === "new" ? `New ${spec.label.replace(/s$/, "")}` : "Edit record"}
            </h2>

            <div className="mt-4 max-h-[60vh] space-y-3 overflow-y-auto pr-1">
              {spec.fields.map((f) => {
                const isNew = editing === "new";
                if (!isNew && f.createOnly) {
                  return (
                    <div key={f.name}>
                      <span className="label">{f.label}</span>
                      <p className="font-mono text-xs text-slate-300">
                        {display((editing as Row)[f.name])}{" "}
                        <span className="text-slate-300">· not editable</span>
                      </p>
                    </div>
                  );
                }
                const defaultValue = isNew ? "" : ((editing as Row)[f.name] ?? "");

                return (
                  <div key={f.name}>
                    <label className="label" htmlFor={`f-${f.name}`}>
                      {f.label}
                    </label>
                    {f.type === "boolean" ? (
                      <input
                        id={`f-${f.name}`}
                        name={f.name}
                        type="checkbox"
                        defaultChecked={isNew ? true : !!(editing as Row)[f.name]}
                        className="h-4 w-4 accent-emerald-400"
                      />
                    ) : f.type === "select" ? (
                      <select
                        id={`f-${f.name}`}
                        name={f.name}
                        defaultValue={String(defaultValue || f.options?.[0] || "")}
                        className="field"
                      >
                        {f.options?.map((o) => (
                          <option key={o} value={o}>
                            {o}
                          </option>
                        ))}
                      </select>
                    ) : f.type === "textarea" ? (
                      <textarea
                        id={`f-${f.name}`}
                        name={f.name}
                        defaultValue={String(defaultValue)}
                        rows={3}
                        className="field resize-y"
                      />
                    ) : (
                      <input
                        id={`f-${f.name}`}
                        name={f.name}
                        type={f.type === "number" ? "number" : f.type === "password" ? "password" : "text"}
                        defaultValue={f.type === "password" ? "" : String(defaultValue)}
                        className="field"
                      />
                    )}
                    {f.help && <p className="mt-1 font-mono text-[10px] text-slate-300">{f.help}</p>}
                  </div>
                );
              })}
            </div>

            <div className="mt-5 flex gap-2">
              <button type="submit" className="btn-primary flex-1 py-2.5">
                save
              </button>
              <button
                type="button"
                className="btn-ghost flex-1 py-2.5"
                onClick={() => {
                  setEditing(null);
                  setError(null);
                }}
              >
                cancel
              </button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}
