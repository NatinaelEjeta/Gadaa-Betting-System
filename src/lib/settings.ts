import "server-only";
import { db } from "@/lib/db";
import { cache } from "@/lib/cache";

/**
 * Platform configuration stored in the Setting table (admin-editable) with an
 * in-memory cache. Values are JSON-encoded.
 */

export interface PlatformSettings {
  // payments (cents)
  minDepositCents: number;
  maxDepositCents: number;
  minWithdrawalCents: number;
  maxWithdrawalCents: number;
  withdrawalFeeBps: number; // basis points of the amount
  withdrawalApprovalThresholdCents: number; // above this, admin approval is required
  // betting
  minStakeCents: number;
  maxStakeCents: number;
  maxPotentialWinCents: number;
  maxLegs: number;
  liveBetDelaySeconds: number;
  cashoutDiscount: number; // 0..1
  // bonuses
  welcomeBonusPercent: number;
  welcomeBonusMaxCents: number;
  referralBonusCents: number;
  // worker cadence
  livePollSeconds: number;
  oddsSyncSeconds: number;
  fixturesSyncMinutes: number;
  marketSuspendSeconds: number; // markets stay suspended after a goal for N seconds
  // provider
  provider: "mock" | "api-football";
}

export const DEFAULT_SETTINGS: PlatformSettings = {
  minDepositCents: 1000, // 10 ETB
  maxDepositCents: 5_000_000, // 50,000 ETB
  minWithdrawalCents: 10_000, // 100 ETB
  maxWithdrawalCents: 100_000_000,
  withdrawalFeeBps: 0,
  withdrawalApprovalThresholdCents: 5_000_000, // 50,000 ETB
  minStakeCents: 500, // 5 ETB
  maxStakeCents: 2_000_000, // 20,000 ETB
  maxPotentialWinCents: 100_000_000, // 1,000,000 ETB
  maxLegs: 20,
  liveBetDelaySeconds: 5,
  cashoutDiscount: 0.85,
  welcomeBonusPercent: 100,
  welcomeBonusMaxCents: 2_000, // 20 ETB
  referralBonusCents: 2_000, // 20 ETB
  livePollSeconds: 10,
  oddsSyncSeconds: 20,
  fixturesSyncMinutes: 5,
  marketSuspendSeconds: 45,
  provider: (process.env.SPORTS_PROVIDER as "mock" | "api-football") ?? "mock",
};

const SETTINGS_CACHE_KEY = "platform-settings";
const SETTINGS_TTL_MS = 10_000;

export async function getSettings(): Promise<PlatformSettings> {
  return cache.withCache(SETTINGS_CACHE_KEY, SETTINGS_TTL_MS, async () => {
    const rows = await db.setting.findMany({ where: { key: { startsWith: "platform." } } });
    const merged: PlatformSettings = { ...DEFAULT_SETTINGS };
    for (const row of rows) {
      const shortKey = row.key.replace("platform.", "") as keyof PlatformSettings;
      if (shortKey in merged) {
        try {
          (merged as unknown as Record<string, unknown>)[shortKey] = JSON.parse(row.valueJson);
        } catch {
          // ignore malformed values, keep default
        }
      }
    }
    return merged;
  });
}

export async function setSetting(key: string, value: unknown) {
  const valueJson = JSON.stringify(value);
  await db.setting.upsert({
    where: { key },
    update: { valueJson },
    create: { key, valueJson },
  });
  cache.del(SETTINGS_CACHE_KEY);
}

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await db.setting.findUnique({ where: { key } });
  if (!row) return fallback;
  try {
    return JSON.parse(row.valueJson) as T;
  } catch {
    return fallback;
  }
}
