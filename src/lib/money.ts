/** Money & odds helpers. All amounts are integer cents (ETB santim). */

export function toCents(amount: number | string): number {
  const n = typeof amount === "string" ? Number.parseFloat(amount) : amount;
  if (!Number.isFinite(n)) throw new Error("Invalid amount");
  return Math.round(n * 100);
}

export function centsToETB(cents: number): number {
  return Math.round(cents) / 100;
}

/** Format decimal odds to 2 places, min 1.01. */
export function roundOdds(odds: number): number {
  return Math.max(1.01, Math.round(odds * 100) / 100);
}

/** Product of decimal odds, rounded to 2 places. */
export function productOdds(oddsList: number[]): number {
  return roundOdds(oddsList.reduce((acc, o) => acc * Math.max(1.01, o), 1));
}

/** Potential win for a stake at given total odds (rounded down to the cent). */
export function potentialWin(stakeCents: number, totalOdds: number): number {
  return Math.floor(stakeCents * totalOdds);
}

/** Number of k-combinations out of n (system bets). */
export function combinations(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let result = 1;
  for (let i = 1; i <= k; i++) result = (result * (n - k + i)) / i;
  return Math.round(result);
}

/** Age in full years from an ISO date string (YYYY-MM-DD). */
export function ageFromDob(dob: string): number {
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return -1;
  const now = new Date();
  let age = now.getUTCFullYear() - d.getUTCFullYear();
  const m = now.getUTCMonth() - d.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < d.getUTCDate())) age--;
  return age;
}
