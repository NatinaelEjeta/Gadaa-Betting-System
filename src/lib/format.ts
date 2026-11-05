/** Client-safe formatting helpers. */

export function formatETB(cents: number | null | undefined): string {
  const value = (cents ?? 0) / 100;
  return `${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ETB`;
}

export function formatOdds(odds: number | null | undefined): string {
  return (odds ?? 0).toFixed(2);
}

export function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString([], { day: "2-digit", month: "short" })} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

/** "in 2h" / "Live 34'" / "FT" helpers used by event cards. */
export function startsInLabel(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return "";
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ${mins % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** Market key → short i18n key for display names. */
export function marketKeyLabel(key: string): string {
  if (key === "1X2") return "markets.matchWinner";
  if (key === "BTTS") return "markets.btts";
  if (key.startsWith("OVER_UNDER")) return "markets.overUnder";
  if (key.startsWith("DOUBLE_CHANCE")) return "markets.doubleChance";
  if (key.startsWith("HANDICAP")) return "markets.handicap";
  if (key === "MONEY_LINE") return "markets.moneyLine";
  return key;
}

export function selectionLabel(key: string, name: string): string {
  if (key === "1X2") {
    if (name === "1") return "odds.home";
    if (name === "X") return "odds.draw";
    if (name === "2") return "odds.away";
  }
  if (key.startsWith("OVER_UNDER")) return name === "OVER" ? "odds.over" : "odds.under";
  if (key === "BTTS") return name === "YES" ? "odds.yes" : "odds.no";
  if (key === "MONEY_LINE") return name === "HOME" ? "odds.home" : "odds.away";
  if (key.startsWith("HANDICAP")) return name === "HOME" ? "odds.home" : "odds.away";
  return name;
}
