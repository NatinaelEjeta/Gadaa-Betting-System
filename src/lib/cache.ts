/**
 * Tiny TTL cache (Redis stand-in for the sandbox).
 * Production: replace with ioredis — same get/set/del semantics.
 */

interface Entry<T> {
  value: T;
  expiresAt: number;
}

const store = new Map<string, Entry<unknown>>();

export const cache = {
  get<T>(key: string): T | undefined {
    const e = store.get(key) as Entry<T> | undefined;
    if (!e) return undefined;
    if (e.expiresAt < Date.now()) {
      store.delete(key);
      return undefined;
    }
    return e.value;
  },
  set<T>(key: string, value: T, ttlMs: number) {
    store.set(key, { value, expiresAt: Date.now() + ttlMs });
  },
  del(key: string) {
    store.delete(key);
  },
  /** Read-through helper. */
  async withCache<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
    const hit = this.get<T>(key);
    if (hit !== undefined) return hit;
    const value = await loader();
    this.set(key, value, ttlMs);
    return value;
  },
};
