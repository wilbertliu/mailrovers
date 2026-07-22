import { defineConfig } from 'vite'
import { startupSplashSharedCssPlugin } from './vite.startup-splash-shared-css.js'

export default defineConfig({
  plugins: [startupSplashSharedCssPlugin()],
  build: { rollupOptions: { external: ['electron', 'better-sqlite3'] } },
})
