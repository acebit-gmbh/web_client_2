/// <reference types="vite/client" />

/**
 * The version from `package.json`, substituted at build time by the `define`
 * in `vite.config.ts` (and in `vitest.config.ts`, so tests see the same value).
 * It exists so the number shown to the user cannot drift from the released one
 * the way a hand-kept copy did.
 */
declare const __APP_VERSION__: string
