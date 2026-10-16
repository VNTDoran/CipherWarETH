"use client";

import clsx from "clsx";
import { useEffect, useMemo, useState } from "react";
import { AGENCY_META } from "../../../shared/constants";
import type { MatchView } from "../../../shared/types";
import type { WalletState } from "@/lib/useWallet";

/**
 * Refuelling, from the player's own wallet.
 *
 * Shows up only when the server is anchoring to a chain. Its job is to make a
 * stall impossible to miss — a frozen courier is still being attacked, and the
 * only way out is a signature.
 */
export default function BoostPanel({
  view,
  wallet,
  onConnect,
  onBoost,
}: {
  view: MatchView;
  wallet: WalletState;
  onConnect: () => void;
  onBoost: (courierIdHex: string, units: number) => Promise<string | null>;
}) {
  const [note, setNote] = useState<string | null>(null);

  const mine = useMemo(
    () => view.messengers.filter((m) => m.ownerSlot === view.youSlot && m.courierIdHex),
    [view.messengers, view.youSlot],
  );
  const stalled = mine.filter((m) => m.stalled);

  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), 4000);
    return () => clearTimeout(t);
  }, [note]);

  if (!view.chain) return null;

  const me = view.players.find((p) => p.slot === view.youSlot);
  const color = me ? AGENCY_META[me.agency].color : "#cbd5e1";

  if (!wallet.available) {
    return (
      <div className="panel p-3">
        <span className="stat">carburant</span>
        <p className="mt-1 text-xs leading-relaxed text-slate-300">
          Aucun portefeuille détecté. Installez MetaMask pour ravitailler vos
          messagers — la partie reste jouable sans.
        </p>
      </div>
    );
  }

  if (!wallet.address) {
    return (
      <div className="panel p-3">
        <span className="stat">carburant</span>
        <p className="mt-1 mb-2 text-xs leading-relaxed text-slate-300">
          Vos messagers tombent en panne en cours de route. Connectez votre
          portefeuille pour pouvoir les relancer.
        </p>
        <button type="button" className="btn-primary w-full py-2" onClick={onConnect} disabled={wallet.busy}>
          {wallet.busy ? "connexion…" : "connecter le portefeuille"}
        </button>
      </div>
    );
  }

  async function boost(courierIdHex: string, units: number) {
    const err = await onBoost(courierIdHex, units);
    setNote(err ?? `Booster de ${units} unité${units > 1 ? "s" : ""} envoyé.`);
  }

  const maxUnits = view.chain.maxUnitsPerBoost;

  return (
    <div className={clsx("panel p-3", stalled.length > 0 && "border-alert/60")}>
      <div className="flex items-center justify-between">
        <span className="stat">carburant</span>
        <span className="font-mono text-[10px] text-slate-300">
          {wallet.address.slice(0, 6)}…{wallet.address.slice(-4)}
        </span>
      </div>

      {wallet.wrongNetwork && (
        <p className="mt-2 rounded border border-alert/40 bg-alert/10 px-2 py-1 font-mono text-[10px] text-alert">
          Mauvais réseau — basculez sur la chaîne {view.chain.chainId} dans MetaMask.
        </p>
      )}

      {mine.length === 0 && (
        <p className="mt-2 text-xs text-slate-300">Aucun messager en vol.</p>
      )}

      {mine.map((m) => (
        <div key={m.id} className="mt-2 rounded-md border border-white/20 p-2">
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs" style={{ color }}>
              {m.codename}
            </span>
            <span
              className={clsx(
                "font-mono text-[10px] uppercase tracking-widest",
                m.stalled ? "animate-flicker text-alert" : "text-signal",
              )}
            >
              {m.stalled ? "en panne" : "en vol"}
            </span>
          </div>

          <div className="mt-1 flex items-center justify-between font-mono text-[10px] text-slate-300">
            <span>{Math.round(m.progress * 100)}% du trajet</span>
            <span>{m.boostCount} booster{m.boostCount === 1 ? "" : "s"}</span>
          </div>

          {m.stalled && (
            <>
              <p className="mt-1.5 text-[11px] leading-snug text-slate-300">
                Immobilisé et toujours attaquable. La facture restante est inconnue —
                payez jusqu'à ce qu'il reparte.
              </p>
              <div className="mt-1.5 flex gap-1.5">
                {[1, 3, maxUnits].map((u, i, arr) =>
                  arr.indexOf(u) === i ? (
                    <button
                      key={u}
                      type="button"
                      className="btn-ghost flex-1 border-gold/50 py-1.5 text-gold"
                      disabled={wallet.busy || wallet.wrongNetwork}
                      onClick={() => boost(m.courierIdHex!, u)}
                    >
                      +{u}
                    </button>
                  ) : null,
                )}
              </div>
            </>
          )}
        </div>
      ))}

      {note && (
        <p className="mt-2 font-mono text-[10px] leading-snug text-slate-300">{note}</p>
      )}
    </div>
  );
}
