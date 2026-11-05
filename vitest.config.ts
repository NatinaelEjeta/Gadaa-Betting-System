import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = path.resolve(fileURLToPath(new URL(".", import.meta.url)));
const testDb = path.join(root, "db", "test.db");

/**
 * Vitest configuration for the Gadaa Betting test suite.
 *
 *  - The suite runs against a dedicated SQLite file (db/test.db) that the
 *    global setup recreates from prisma/schema.prisma. Dev/prod data
 *    (db/custom.db) is never touched.
 *  - `connection_limit=1` funnels every query through a single connection, so
 *    concurrent interactive transactions queue up instead of colliding on
 *    SQLite's coarse file lock (which would surface as nondeterministic
 *    SQLITE_BUSY errors). This makes the concurrency tests deterministic:
 *    every parallel mutation is fully serialized, and the tests assert exact
 *    balances / ledger invariants. On production PostgreSQL the same code
 *    paths run with a real pool plus the optimistic `version` guard in
 *    wallet.ts and row-level locks.
 *  - "server-only" is aliased to a no-op stub: tests run outside React Server
 *    Components, where importing that package would throw.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(root, "src"),
      "server-only": path.resolve(root, "tests/mocks/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    globalSetup: path.resolve(root, "tests/setup/global-setup.ts"),
    // All test files share one database → execute them sequentially.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
    env: {
      NODE_ENV: "test",
      DATABASE_URL: `file:${testDb}?connection_limit=1`,
      CHAPA_SECRET_KEY: "sk_test_gadaa_vitest",
      CHAPA_WEBHOOK_SECRET: "whsec_gadaa_vitest",
      CHAPA_TEST_MODE: "false",
      APP_URL: "http://localhost:3000",
      JWT_SECRET: "vitest-jwt-secret-do-not-use-in-prod",
      SPORTS_PROVIDER: "mock",
    },
  },
});
