import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

import { readFileSync } from 'node:fs'

// The one source of the version: package.json, read at config time. Kept out of
// an `import` of the JSON so neither tsconfig needs resolveJsonModule. The same
// three lines are in vitest.config.ts - both configs have to define it, because a test never
// goes through the app's build.
const { version } = JSON.parse(
  readFileSync(path.resolve(__dirname, './package.json'), 'utf-8'),
) as { version: string }

export default defineConfig(({ mode }) => {
  // Dev-server proxy target — where `npm run dev` forwards the PD Server routes.
  // Set DEV_PROXY_TARGET in a (gitignored) .env.local to point at your server,
  // e.g. https://your-pd-server:8714. Defaults to localhost so the repo ships no
  // internal hostnames. Not VITE_-prefixed, so it never reaches the client bundle.
  const env = loadEnv(mode, process.cwd(), '')
  const proxyTarget = env.DEV_PROXY_TARGET || 'https://localhost:8714'

  // secure: false accepts the PD Server's self-signed/private TLS certificate in dev.
  const proxyRoute = { target: proxyTarget, changeOrigin: true, secure: false }

  return {
    base: './',
    plugins: [react(), tailwindcss()],
    define: {
      __APP_VERSION__: JSON.stringify(version),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    build: {
      rollupOptions: {
        output: {
          // Keep stable third-party code in its own chunk so it stays cached in
          // the browser across app releases. Function form for cross-bundler
          // (Rollup/Rolldown) type compatibility.
          manualChunks(id) {
            const n = id.replace(/\\/g, '/')
            if (!n.includes('/node_modules/')) return
            if (
              /\/node_modules\/(react|react-dom|react-router|scheduler|@tanstack\/react-query|i18next|react-i18next|zustand)\//.test(
                n,
              )
            ) {
              return 'vendor'
            }
          },
        },
      },
    },
    server: {
      proxy: {
        // The /file route serves entry icons in development — proxy it too, or
        // custom icons will 404.
        '/v2.0': { ...proxyRoute },
        '/file': { ...proxyRoute },
        '/temp': { ...proxyRoute },
      },
    },
  }
})
