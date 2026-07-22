import { defineConfig } from 'vitest/config'
import { rendererAliases } from './vite.shared.config.js'

export default defineConfig({
  resolve: {
    alias: rendererAliases,
  },
  test: {
    // Keep `*.css?raw` as file contents (default stubs CSS imports to "").
    css: true,
  },
})
