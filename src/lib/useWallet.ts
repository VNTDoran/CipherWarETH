"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MatchView } from "../../shared/types";

/**
 * MetaMask inside the game itself.
 *
 * Players pay boosters from their own wallet, so the browser needs a signer —
 * the server cannot spend on their behalf. Everything degrades quietly: no
 * MetaMask, no chain configured, or a refused connection all leave the game
 * fully playable, just without boosters.
 */

const FUEL_ABI = [
  "function boost(bytes32 matchId, bytes32 courierId) payable",
  "function quote(uint32 units) view returns (uint256)",
];

interface EthereumProvider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, handler: (...args: unknown[]) => void): void;
  removeListener?(event: string, handler: (...args: unknown[]) => void): void;
}

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}

export interface WalletState {
  available: boolean;
  address: string | null;
  wrongNetwork: boolean;
  busy: boolean;
  error: string | null;
}

export function useWallet(
  chainCfg: MatchView["chain"],
  onAddress: (address: string | null) => void,
) {
  const [state, setState] = useState<WalletState>({
    available: false,
    address: null,
    wrongNetwork: false,
    busy: false,
    error: null,
  });
  // Keeping the callback in a ref means reconnecting does not need a new
  // identity for it, which would otherwise re-run the effect every render.
  const onAddressRef = useRef(onAddress);
  onAddressRef.current = onAddress;

  useEffect(() => {
    setState((s) => ({ ...s, available: typeof window !== "undefined" && !!window.ethereum }));
  }, []);

  const syncAccount = useCallback(
    async (address: string | null) => {
      setState((s) => ({ ...s, address }));
      onAddressRef.current(address);
    },
    [],
  );

  const connect = useCallback(async () => {
    if (!window.ethereum || !chainCfg) return;
    setState((s) => ({ ...s, busy: true, error: null }));
    try {
      const accounts = (await window.ethereum.request({
        method: "eth_requestAccounts",
      })) as string[];
      const chainIdHex = (await window.ethereum.request({ method: "eth_chainId" })) as string;
      const wrongNetwork = parseInt(chainIdHex, 16) !== chainCfg.chainId;
      setState((s) => ({ ...s, wrongNetwork, busy: false }));
      await syncAccount(accounts?.[0] ?? null);
    } catch (e) {
      setState((s) => ({
        ...s,
        busy: false,
        error: (e as { message?: string })?.message ?? "Connection refused",
      }));
    }
  }, [chainCfg, syncAccount]);

  // Switching account or network mid-match is normal; follow it.
  useEffect(() => {
    const eth = window.ethereum;
    if (!eth?.on || !chainCfg) return;
    const onAccounts = (...args: unknown[]) => {
      const accounts = args[0] as string[] | undefined;
      void syncAccount(accounts?.[0] ?? null);
    };
    const onChainChanged = (...args: unknown[]) => {
      const hex = args[0] as string;
      setState((s) => ({ ...s, wrongNetwork: parseInt(hex, 16) !== chainCfg.chainId }));
    };
    eth.on("accountsChanged", onAccounts);
    eth.on("chainChanged", onChainChanged);
    return () => {
      eth.removeListener?.("accountsChanged", onAccounts);
      eth.removeListener?.("chainChanged", onChainChanged);
    };
  }, [chainCfg, syncAccount]);

  /**
   * Pays for fuel. The amount is deliberately a blind choice: the player does
   * not know what the courier still owes, so they buy a chunk and watch
   * whether it starts moving.
   */
  const boost = useCallback(
    async (courierIdHex: string, units: number): Promise<string | null> => {
      if (!window.ethereum || !chainCfg) return "Portefeuille indisponible";
      setState((s) => ({ ...s, busy: true, error: null }));
      try {
        const { BrowserProvider, Contract } = await import("ethers");
        const provider = new BrowserProvider(window.ethereum as never);
        const signer = await provider.getSigner();
        const fuel = new Contract(chainCfg.courierFuelAddress, FUEL_ABI, signer);
        const value = await fuel.quote(units);
        const tx = await fuel.boost(chainCfg.matchIdHex, courierIdHex, { value });
        await tx.wait();
        setState((s) => ({ ...s, busy: false }));
        return null;
      } catch (e) {
        const err = e as { reason?: string; shortMessage?: string; message?: string };
        const reason = err.reason ?? err.shortMessage ?? err.message ?? "Transaction refused";
        setState((s) => ({ ...s, busy: false, error: reason }));
        return reason;
      }
    },
    [chainCfg],
  );

  return { ...state, connect, boost };
}
