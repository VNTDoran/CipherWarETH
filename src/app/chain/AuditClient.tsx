"use client";

import clsx from "clsx";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

/**
 * The audit trail, read-only.
 *
 * This is where the commit-reveal claim is actually checkable: for every
 * resolved courier it recomputes the commitment in the browser from the
 * revealed values and compares it against what the chain stored. No wallet and
 * no privilege required — that is the whole point.
 */

interface ChainInfo {
  enabled: boolean;
  rpcUrl?: string;
  chainId?: number;
  contracts?: Record<string, { address: string; abi: unknown[] }>;
}

interface Row {
  courierId: string;
  matchId: string;
  commitment: string;
  candidateCount: number;
  revealed: boolean;
  keyIndex: number | null;
  nonce: string | null;
  recomputed: string | null;
  proven: boolean | null;
  requiredUnits: number | null;
  fuelHonest: boolean | null;
  boosts: number;
}

function short(hex: string, n = 10) {
  return hex.length > n + 6 ? `${hex.slice(0, n)}…${hex.slice(-4)}` : hex;
}

export default function AuditClient() {
  const [info, setInfo] = useState<ChainInfo | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/chain/info");
      const data: ChainInfo = await res.json();
      setInfo(data);
      if (!data.enabled || !data.contracts?.commitReveal) {
        setLoading(false);
        return;
      }

      const { JsonRpcProvider, Contract, keccak256, solidityPacked } = await import("ethers");
      const provider = new JsonRpcProvider(data.rpcUrl);
      const cr = new Contract(
        data.contracts.commitReveal.address,
        data.contracts.commitReveal.abi as never,
        provider,
      );
      const fuel = data.contracts.courierFuel
        ? new Contract(
            data.contracts.courierFuel.address,
            data.contracts.courierFuel.abi as never,
            provider,
          )
        : null;

      // Hardhat rejects an open-ended range, so bound it to recent blocks.
      const head = await provider.getBlockNumber();
      const from = Math.max(0, head - 2000);
      const committed = await cr.queryFilter("CourierCommitted", from, head);
      const boosted = fuel ? await fuel.queryFilter("CourierBoosted", from, head) : [];

      const boostsPer = new Map<string, number>();
      for (const b of boosted) {
        const id = String((b as { args: unknown[] }).args[1]).toLowerCase();
        boostsPer.set(id, (boostsPer.get(id) ?? 0) + 1);
      }

      const out: Row[] = [];
      for (const ev of committed.slice(-25).reverse()) {
        const args = (ev as { args: unknown[] }).args;
        const matchId = String(args[0]);
        const courierId = String(args[1]);
        const c = await cr.getCourier(matchId, courierId);

        let recomputed: string | null = null;
        let proven: boolean | null = null;
        let fuelHonest: boolean | null = null;
        let requiredUnits: number | null = null;

        if (fuel) {
          try {
            const fc = await fuel.getCourier(matchId, courierId);
            requiredUnits = Number(fc.requiredUnits);
          } catch {
            /* ambient traffic is not registered for fuel */
          }
        }

        if (c.revealed) {
          // The check, done here in the browser rather than taken on trust.
          recomputed = keccak256(
            solidityPacked(
              ["bytes32", "bytes32", "uint8", "bytes32"],
              [matchId, courierId, Number(c.keyIndex), c.nonce],
            ),
          );
          proven = recomputed.toLowerCase() === String(c.commitment).toLowerCase();
          if (fuel && requiredUnits !== null) {
            try {
              fuelHonest = await fuel.fuelWasHonest(
                matchId,
                courierId,
                Number(c.keyIndex),
                c.nonce,
              );
            } catch {
              fuelHonest = null;
            }
          }
        }

        out.push({
          courierId,
          matchId,
          commitment: String(c.commitment),
          candidateCount: Number(c.candidateCount),
          revealed: c.revealed,
          keyIndex: c.revealed ? Number(c.keyIndex) : null,
          nonce: c.revealed ? String(c.nonce) : null,
          recomputed,
          proven,
          requiredUnits,
          fuelHonest,
          boosts: boostsPer.get(courierId.toLowerCase()) ?? 0,
        });
      }
      setRows(out);
    } catch (e) {
      setError((e as Error)?.message ?? "Could not read the chain");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (info && !info.enabled) {
    return (
      <main className="mx-auto min-h-dvh max-w-3xl px-5 py-10">
        <Link href="/lobby" className="font-mono text-[11px] uppercase tracking-[0.3em] text-slate-300">
          ← lobby
        </Link>
        <h1 className="mt-6 font-display text-3xl font-bold text-slate-100">Audit trail</h1>
        <p className="panel mt-6 p-5 text-sm text-slate-300">
          This server is running without a chain, so there is nothing to audit.
          Matches play normally; couriers simply never stall. Set{" "}
          <code className="text-signal">CHAIN_ENABLED=true</code> to turn it on.
        </p>
      </main>
    );
  }

  const unproven = rows.filter((r) => r.revealed && r.proven === false).length;

  return (
    <main className="mx-auto min-h-dvh max-w-4xl px-5 py-10">
      <Link href="/lobby" className="font-mono text-[11px] uppercase tracking-[0.3em] text-slate-300">
        ← lobby
      </Link>

      <header className="mt-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold text-slate-100">Audit trail</h1>
          <p className="mt-1 max-w-prose text-sm text-slate-300">
            Every courier the server has anchored. For each revealed one, the
            commitment is recomputed here in your browser and compared against
            what the chain stored — no wallet, no privilege, no trust.
          </p>
        </div>
        <button type="button" className="btn-ghost px-4 py-2" onClick={load} disabled={loading}>
          {loading ? "reading…" : "refresh"}
        </button>
      </header>

      {info?.contracts && (
        <div className="panel mt-5 p-4">
          <span className="stat">contracts · chain {info.chainId}</span>
          <div className="mt-2 grid gap-1 sm:grid-cols-2">
            {Object.entries(info.contracts).map(([k, v]) => (
              <div key={k} className="flex items-baseline justify-between gap-2">
                <span className="font-mono text-[11px] text-slate-300">{k}</span>
                <code className="text-[10px]">{short(v.address, 12)}</code>
              </div>
            ))}
          </div>
        </div>
      )}

      {error && (
        <p className="mt-4 rounded-md border border-alert/40 bg-alert/10 px-3 py-2 font-mono text-xs text-alert">
          {error}
        </p>
      )}

      <div className="mt-5 flex items-center gap-4">
        <span className="stat">
          {rows.length} courier{rows.length === 1 ? "" : "s"} anchored
        </span>
        {unproven > 0 ? (
          <span className="font-mono text-[11px] text-alert">
            {unproven} failed verification
          </span>
        ) : (
          rows.some((r) => r.revealed) && (
            <span className="font-mono text-[11px] text-signal">all reveals verified</span>
          )
        )}
      </div>

      {rows.length === 0 && !loading && (
        <p className="panel mt-4 p-5 text-center text-sm text-slate-300">
          Nothing anchored yet. Play a match with the chain on and the couriers
          will appear here.
        </p>
      )}

      <div className="mt-3 space-y-2">
        {rows.map((r) => (
          <div
            key={r.courierId}
            className={clsx(
              "panel p-3",
              r.proven === false && "border-alert/60",
              r.proven === true && "border-signal/40",
            )}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <code className="text-[11px]">{short(r.courierId, 14)}</code>
              <span
                className={clsx(
                  "font-mono text-[10px] uppercase tracking-widest",
                  r.revealed ? (r.proven ? "text-signal" : "text-alert") : "text-gold",
                )}
              >
                {r.revealed ? (r.proven ? "verified" : "VERIFICATION FAILED") : "in flight"}
              </span>
            </div>

            <div className="mt-2 grid gap-x-6 gap-y-1 text-[11px] sm:grid-cols-2">
              <Field label="candidate keys" value={String(r.candidateCount)} />
              <Field label="boosters paid" value={String(r.boosts)} />
              <Field
                label="fuel demanded"
                value={r.requiredUnits === null ? "—" : `${r.requiredUnits} units`}
              />
              <Field
                label="real key"
                value={r.revealed ? `index ${r.keyIndex}` : "sealed until it resolves"}
              />
            </div>

            <div className="mt-2 space-y-0.5 font-mono text-[10px] text-slate-300">
              <div className="flex gap-2">
                <span className="w-24 shrink-0 text-slate-400">stored</span>
                <code>{short(r.commitment, 24)}</code>
              </div>
              {r.recomputed && (
                <div className="flex gap-2">
                  <span className="w-24 shrink-0 text-slate-400">recomputed</span>
                  <code>{short(r.recomputed, 24)}</code>
                </div>
              )}
              {r.fuelHonest !== null && (
                <div className="flex gap-2">
                  <span className="w-24 shrink-0 text-slate-400">fuel bill</span>
                  <span className={r.fuelHonest ? "text-signal" : "text-alert"}>
                    {r.fuelHonest
                      ? "matches the draw — not inflated"
                      : "DOES NOT match the draw"}
                  </span>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-slate-400">{label}</span>
      <span className="font-mono text-slate-200">{value}</span>
    </div>
  );
}
