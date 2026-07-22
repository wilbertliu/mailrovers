import { defineConfig } from 'vitest/config'
import { rendererAliases } from './vite.shared.config.js'
import { startupSplashSharedCssPlugin } from './vite.startup-splash-shared-css.js'

export default defineConfig({
  plugins: [startupSplashSharedCssPlugin()],
  resolve: {
    alias: rendererAliases,
  },
})
