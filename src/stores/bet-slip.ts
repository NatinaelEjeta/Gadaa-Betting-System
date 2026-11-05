"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Bet slip store — persisted to localStorage.
 * Legs snapshot the selection at click time; odds are re-validated server-side.
 */

export interface SlipLeg {
  selectionId: string;
  eventId: string;
  eventName: string;
  marketName: string;
  marketKey: string;
  marketId: string;
  selectionName: string;
  odds: number;
  eventStatus: string;
}

export type SlipMode = "SINGLE" | "MULTIPLE" | "SYSTEM";

interface BetSlipState {
  legs: SlipLeg[];
  mode: SlipMode;
  systemK: number;
  stakeCents: number;
  stakePerComboCents: number;
  open: boolean; // mobile sheet visibility
  acceptOddsChange: boolean;
  addLeg: (leg: SlipLeg) => void;
  removeLeg: (selectionId: string) => void;
  toggleOpen: () => void;
  setOpen: (open: boolean) => void;
  setMode: (mode: SlipMode) => void;
  setSystemK: (k: number) => void;
  setStake: (cents: number) => void;
  setStakePerCombo: (cents: number) => void;
  setAcceptOddsChange: (v: boolean) => void;
  clear: () => void;
}

export const useBetSlip = create<BetSlipState>()(
  persist(
    (set) => ({
      legs: [],
      mode: "SINGLE",
      systemK: 2,
      stakeCents: 1000,
      stakePerComboCents: 500,
      open: false,
      acceptOddsChange: false,
      addLeg: (leg) =>
        set((state) => {
          // toggle same selection off
          if (state.legs.some((l) => l.selectionId === leg.selectionId)) {
            return { legs: state.legs.filter((l) => l.selectionId !== leg.selectionId) };
          }
          // replace any leg from the same market (standard sportsbook behavior)
          const withoutMarket = state.legs.filter((l) => l.marketId !== leg.marketId);
          const legs = [...withoutMarket, leg];
          let mode = state.mode;
          if (legs.length === 1) mode = "SINGLE";
          else if (mode === "SINGLE") mode = "MULTIPLE";
          return { legs, mode, open: true };
        }),
      removeLeg: (selectionId) =>
        set((state) => {
          const legs = state.legs.filter((l) => l.selectionId !== selectionId);
          return { legs, mode: legs.length === 1 ? "SINGLE" : state.mode };
        }),
      toggleOpen: () => set((s) => ({ open: !s.open })),
      setOpen: (open) => set({ open }),
      setMode: (mode) => set({ mode }),
      setSystemK: (systemK) => set({ systemK }),
      setStake: (stakeCents) => set({ stakeCents }),
      setStakePerCombo: (stakePerComboCents) => set({ stakePerComboCents }),
      setAcceptOddsChange: (acceptOddsChange) => set({ acceptOddsChange }),
      clear: () => set({ legs: [], open: false }),
    }),
    { name: "gadaa-betslip" }
  )
);

/** Combination count C(n, k) for system bets. */
export function combinations(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let result = 1;
  for (let i = 1; i <= k; i++) result = (result * (n - k + i)) / i;
  return Math.round(result);
}

export function slipTotals(legs: SlipLeg[], mode: SlipMode, stakeCents: number, systemK: number, stakePerComboCents: number) {
  const product = legs.reduce((acc, l) => acc * Math.max(1.01, l.odds), 1);
  const totalOdds = Math.round(product * 100) / 100;
  if (mode === "SYSTEM" && legs.length > systemK) {
    const comboCount = combinations(legs.length, systemK);
    const totalStake = stakePerComboCents * comboCount;
    const potential = Math.floor(stakePerComboCents * totalOdds);
    return { totalOdds, totalStake, potentialWin: potential, comboCount };
  }
  return { totalOdds, totalStake: stakeCents, potentialWin: Math.floor(stakeCents * totalOdds), comboCount: 1 };
}
