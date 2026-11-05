/**
 * Test stub for the "server-only" package.
 *
 * "server-only" throws when imported outside a React Server Component
 * environment, which is exactly what unit tests are. vitest.config.ts aliases
 * the package to this empty module so the server modules under src/lib can be
 * exercised directly.
 */
export {};
