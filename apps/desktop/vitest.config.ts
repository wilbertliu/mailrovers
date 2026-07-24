import { configDefaults, defineConfig } from 'vitest/config'
import { rendererAliases } from './vite.shared.config.js'

export default defineConfig({
  resolve: {
    alias: rendererAliases,
  },
  test: {
    // Keep `*.css?raw` as file contents (default stubs CSS imports to "").
    css: true,
    // Generated performance evidence is data, never executable test source.
    exclude: [...configDefaults.exclude, 'artifacts/**'],
  },
})
