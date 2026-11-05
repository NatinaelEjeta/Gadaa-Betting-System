"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { formatOdds } from "@/lib/format";
import { useBetSlip, SlipLeg } from "@/stores/bet-slip";

interface OddsButtonProps {
  leg: SlipLeg;
  label: string;
  suspended?: boolean;
  className?: string;
}

/**
 * The odds button — core sportsbook primitive.
 *  - toggles the selection in the bet slip
 *  - flashes when the odds move (prevOdds from live updates)
 *  - disabled while the market is suspended
 */
export function OddsButton({ leg, label, suspended, className }: OddsButtonProps) {
  const legs = useBetSlip((s) => s.legs);
  const addLeg = useBetSlip((s) => s.addLeg);
  const active = legs.some((l) => l.selectionId === leg.selectionId);
  // derived-state pattern: flash once whenever the odds value changes
  const [displayed, setDisplayed] = useState({ odds: leg.odds, flash: false });
  if (displayed.odds !== leg.odds) {
    setDisplayed({ odds: leg.odds, flash: true });
  }
  useEffect(() => {
    if (!displayed.flash) return;
    const t = setTimeout(() => setDisplayed((d) => ({ ...d, flash: false })), 900);
    return () => clearTimeout(t);
  }, [displayed.flash]);

  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={suspended}
      onClick={(e) => {
        e.stopPropagation();
        addLeg(leg);
      }}
      className={cn(
        "flex min-w-[64px] min-h-[44px] flex-col items-center justify-center rounded-md border px-2 py-1.5 transition-colors",
        "active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed",
        active
          ? "border-primary bg-primary text-primary-foreground shadow-sm"
          : "bg-card hover:border-primary/60 hover:bg-accent/60",
        displayed.flash ? "odds-flash" : "",
        className
      )}
    >
      <span className={cn("text-[10px] leading-tight opacity-80 truncate max-w-full")}>{label}</span>
      <span className="text-sm font-bold leading-tight tabular-nums">{formatOdds(leg.odds)}</span>
    </button>
  );
}
