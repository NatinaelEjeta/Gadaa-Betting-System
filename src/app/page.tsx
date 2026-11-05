import { GadaaApp } from "@/components/app/gadaa-app";

/**
 * Gadaa Betting — single-route SPA.
 * All views (home, sports, live, bet slip, wallet, my bets, profile, admin)
 * are switched client-side; the backend lives under /api/*.
 */
export default function Page() {
  return <GadaaApp />;
}
