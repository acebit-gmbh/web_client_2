import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

import { readFileSync } from 'node:fs'

// The one source of the version: package.json, read at config time. Kept out of
// an `import` of the JSON so neither tsconfig needs resolveJsonModule. The same
// three lines are in vite.config.ts - both configs have to define it, because a test never
// goes through the app's build.
const { version } = JSON.parse(
  readFileSync(path.resolve(__dirname, './package.json'), 'utf-8'),
) as { version: string }

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    css: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
