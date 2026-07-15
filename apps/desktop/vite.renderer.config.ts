import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'
import { allowDevelopmentStyles } from './src/development-csp.js'

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
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
