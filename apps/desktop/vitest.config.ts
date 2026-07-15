import { defineConfig } from 'vitest/config'
import { rendererAliases } from './vite.shared.config.js'

export default defineConfig({
  resolve: {
    alias: rendererAliases,
  },
})
