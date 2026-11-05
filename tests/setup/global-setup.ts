import { execSync } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const testDb = path.join(root, "db", "test.db");

/**
 * Runs once before the whole suite: recreates db/test.db from the current
 * Prisma schema so tests always start from a clean, schema-accurate state.
 * The dev database (db/custom.db) is never read or written.
 */
export default function globalSetup() {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    rmSync(testDb + suffix, { force: true });
  }
  execSync("bunx prisma db push --skip-generate --accept-data-loss", {
    cwd: root,
    env: { ...process.env, DATABASE_URL: `file:${testDb}` },
    stdio: "inherit",
  });
}
