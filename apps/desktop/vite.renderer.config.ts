import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { allowDevelopmentStyles } from './src/development-csp.js'

function developmentCspPlugin(): Plugin {
  return {
    name: 'mailrovers-development-csp',
    apply: 'serve',
    transformIndexHtml: allowDevelopmentStyles,
  }
}

export default defineConfig({
  plugins: [react(), developmentCspPlugin()],
  base: './',
})
