import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { allowDevelopmentStyles } from './src/development-csp.js'
import { rendererAliases } from './vite.shared.config.js'

function developmentCspPlugin(): Plugin {
  return {
    name: 'mailrovers-development-csp',
    apply: 'serve',
    transformIndexHtml: allowDevelopmentStyles,
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), developmentCspPlugin()],
  base: './',
  // Electron loads MAIN_WINDOW_VITE_DEV_SERVER_URL as http://localhost:<port>.
  // Bind IPv4 explicitly so Chromium does not miss an IPv6-only Vite listener.
  server: {
    host: '127.0.0.1',
    strictPort: true,
  },
  optimizeDeps: {
    entries: ['index.html'],
  },
  resolve: {
    alias: rendererAliases,
  },
})
