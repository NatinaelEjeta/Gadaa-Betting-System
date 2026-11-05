/**
 * Next.js instrumentation hook — boots the background worker inside the
 * Node.js server runtime (skipped on edge). See src/lib/worker/index.ts.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.ENABLE_WORKER === "true") {
    const { startWorker } = await import("@/lib/worker");
    startWorker();
  }
}
