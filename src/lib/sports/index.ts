import "server-only";
import { SportsDataProvider } from "@/lib/sports/types";
import { MockProvider } from "@/lib/sports/mock-provider";
import { ApiFootballProvider } from "@/lib/sports/api-football-provider";
import { getSettings } from "@/lib/settings";

/**
 * Provider factory — the ONLY place a provider is instantiated.
 * Switch providers via SPORTS_PROVIDER env var or the `platform.provider`
 * setting (admin-editable at runtime).
 */

let mockInstance: MockProvider | null = null;
let apiInstance: ApiFootballProvider | null = null;

export async function getProvider(): Promise<SportsDataProvider> {
  const settings = await getSettings();
  if (settings.provider === "api-football" && process.env.API_FOOTBALL_KEY) {
    if (!apiInstance) apiInstance = new ApiFootballProvider(process.env.API_FOOTBALL_KEY);
    return apiInstance;
  }
  if (!mockInstance) mockInstance = new MockProvider();
  return mockInstance;
}

export function getMockProvider(): MockProvider {
  if (!mockInstance) mockInstance = new MockProvider();
  return mockInstance;
}
