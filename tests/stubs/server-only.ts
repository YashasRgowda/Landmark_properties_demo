/**
 * Server modules are marked with `server-only`, which throws when it is loaded
 * outside a Server Component. The test runner is neither, so it resolves the
 * marker here instead — the same no-op the server bundle gets.
 */
export {};
