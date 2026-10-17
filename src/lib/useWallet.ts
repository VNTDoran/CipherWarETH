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

const TOKEN_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)",
];

const ESCROW_ABI = ["function join(bytes32 matchId)"];

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
  /** Chain id the wallet currently reports, or null until it has been asked. */
  walletChainId: number | null;
  /** INTEL balance in wei, or null when unknown. Only read when staking. */
  intelBalance: bigint | null;
  busy: boolean;
  error: string | null;
}

export type WalletApi = ReturnType<typeof useWallet>;

export function useWallet(
  chainCfg: MatchView["chain"],
  onAddress: (address: string | null) => void,
  onStaked?: () => void,
) {
  const [state, setState] = useState<WalletState>({
    available: false,
    address: null,
    wrongNetwork: false,
    walletChainId: null,
    intelBalance: null,
    busy: false,
    error: null,
  });
  // Keeping the callback in a ref means reconnecting does not need a new
  // identity for it, which would otherwise re-run the effect every render.
  const onAddressRef = useRef(onAddress);
  onAddressRef.current = onAddress;
  const onStakedRef = useRef(onStaked);
  onStakedRef.current = onStaked;

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
      const walletChainId = parseInt(chainIdHex, 16);
      setState((s) => ({
        ...s,
        wrongNetwork: walletChainId !== chainCfg.chainId,
        walletChainId,
        busy: false,
      }));
      await syncAccount(accounts?.[0] ?? null);
    } catch (e) {
      setState((s) => ({
        ...s,
        busy: false,
        error: (e as { message?: string })?.message ?? "Connection refused",
      }));
    }
  }, [chainCfg, syncAccount]);

  // Keyed on the id, not the config object: every state snapshot builds a new
  // object, which would otherwise tear down and re-attach these listeners 2x/s.
  const wantedChainId = chainCfg?.chainId ?? null;

  // Switching account or network mid-match is normal; follow it.
  useEffect(() => {
    const eth = window.ethereum;
    if (!eth?.on || wantedChainId === null) return;
    const onAccounts = (...args: unknown[]) => {
      const accounts = args[0] as string[] | undefined;
      void syncAccount(accounts?.[0] ?? null);
    };
    const onChainChanged = (...args: unknown[]) => {
      const id = parseInt(args[0] as string, 16);
      setState((s) => ({ ...s, wrongNetwork: id !== wantedChainId, walletChainId: id }));
    };
    // The event only fires on a change, so a switch made before this listener
    // attached (or a missed event) would leave a stale warning. Ask directly.
    const recheck = async () => {
      try {
        const id = parseInt((await eth.request({ method: "eth_chainId" })) as string, 16);
        setState((st) => ({ ...st, wrongNetwork: id !== wantedChainId, walletChainId: id }));
      } catch {
        /* wallet locked or unavailable — leave the state alone */
      }
    };
    void recheck();
    window.addEventListener("focus", recheck);
    eth.on("accountsChanged", onAccounts);
    eth.on("chainChanged", onChainChanged);
    return () => {
      window.removeEventListener("focus", recheck);
      eth.removeListener?.("accountsChanged", onAccounts);
      eth.removeListener?.("chainChanged", onChainChanged);
    };
  }, [wantedChainId, syncAccount]);

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

  // Balance is only worth a round trip when this match is staked and the
  // wallet is actually on the right chain.
  const tokenAddress = chainCfg?.tournament?.tokenAddress ?? null;
  const refreshBalance = useCallback(async () => {
    if (!window.ethereum || !tokenAddress || !state.address || state.wrongNetwork) return;
    try {
      const { BrowserProvider, Contract } = await import("ethers");
      const token = new Contract(tokenAddress, TOKEN_ABI, new BrowserProvider(window.ethereum as never));
      const bal = (await token.balanceOf(state.address)) as bigint;
      setState((s) => ({ ...s, intelBalance: bal }));
    } catch {
      setState((s) => ({ ...s, intelBalance: null }));
    }
  }, [tokenAddress, state.address, state.wrongNetwork]);

  useEffect(() => {
    void refreshBalance();
  }, [refreshBalance]);

  /**
   * Puts the stake into the escrow: approve the escrow to pull it, then join.
   * The usual two-step ERC-20 flow, so MetaMask asks twice. The game server is
   * told by the contract's own event, not by this client.
   */
  const stake = useCallback(async (): Promise<string | null> => {
    const t = chainCfg?.tournament;
    if (!window.ethereum || !chainCfg || !t) return "No tournament to join";
    setState((s) => ({ ...s, busy: true, error: null }));
    try {
      const { BrowserProvider, Contract } = await import("ethers");
      const signer = await new BrowserProvider(window.ethereum as never).getSigner();
      const owner = await signer.getAddress();
      const amount = BigInt(t.stakeWei);

      const token = new Contract(t.tokenAddress, TOKEN_ABI, signer);
      const balance = (await token.balanceOf(owner)) as bigint;
      if (balance < amount) {
        throw new Error("Not enough INTEL in this wallet to cover the stake.");
      }
      const allowance = (await token.allowance(owner, t.escrowAddress)) as bigint;
      if (allowance < amount) {
        await (await token.approve(t.escrowAddress, amount)).wait();
      }
      const escrow = new Contract(t.escrowAddress, ESCROW_ABI, signer);
      await (await escrow.join(chainCfg.matchIdHex)).wait();

      setState((s) => ({ ...s, busy: false }));
      // Don't wait for the server's own event poll: tell it now, and it will
      // verify against the contract before showing anything.
      onStakedRef.current?.();
      void refreshBalance();
      return null;
    } catch (e) {
      const err = e as { reason?: string; shortMessage?: string; message?: string };
      const reason = err.reason ?? err.shortMessage ?? err.message ?? "Stake refused";
      setState((s) => ({ ...s, busy: false, error: reason }));
      return reason;
    }
  }, [chainCfg, refreshBalance]);

  /**
   * MetaMask scopes the selected network per site, so picking it in the
   * extension's own menu does not necessarily change what this page sees.
   * Asking from the page switches this site. It cannot *add* the chain: MetaMask
   * only accepts https RPC URLs there, and a LAN node is plain http — so the
   * network has to be added by hand once.
   */
  const switchNetwork = useCallback(async () => {
    if (!window.ethereum || !chainCfg) return;
    const chainId = "0x" + chainCfg.chainId.toString(16);
    setState((s) => ({ ...s, error: null }));
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId }],
      });
    } catch (e) {
      const err = e as { code?: number; message?: string };
      setState((s) => ({
        ...s,
        error:
          err.code === 4902
            ? `MetaMask doesn't know chain ${chainCfg.chainId}. Add it manually: RPC ${chainCfg.rpcUrl}, chain ID ${chainCfg.chainId}, symbol ETH.`
            : (err.message ?? "Network switch refused"),
      }));
    }
  }, [chainCfg]);

  return { ...state, connect, boost, switchNetwork, stake };
}
